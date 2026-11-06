/* =====================================================================
   DATA WAREHOUSE - CADENA DE SUPERMERCADOS
   Modelo Estrella (Star Schema) - SQL Server 2019 o superior
   ---------------------------------------------------------------------
   Fact principal  : FactVentas       (grano: linea de ticket)
   Fact secundaria : FactStockDiario  (snapshot periodico diario)
   Dimensiones     : DimTiempo, DimProducto, DimSucursal, DimCliente
   ===================================================================== */

-- CREATE DATABASE DW_Supermercado;
-- GO
-- USE DW_Supermercado;
-- GO


/* =====================================================================
   1. DIMENSIONES
   ===================================================================== */

/* ---------------------------------------------------------------------
   DimTiempo
   - Clave "inteligente" INT con formato YYYYMMDD (ej: 20260727).
     Permite filtrar/particionar por rango de fechas sin hacer join.
   - Se precarga con un script de poblado (ej: 2020-2035).
   - Grano: dia. Para analisis intradia (ventas por hora) conviene
     agregar una DimHora separada, no mezclarla aca.
--------------------------------------------------------------------- */
CREATE TABLE dbo.DimTiempo (
    TiempoKey        INT           NOT NULL,   -- YYYYMMDD
    Fecha            DATE          NOT NULL,
    Anio             SMALLINT      NOT NULL,
    Trimestre        TINYINT       NOT NULL,   -- 1 a 4
    Mes              TINYINT       NOT NULL,   -- 1 a 12
    MesNombre        NVARCHAR(20)  NOT NULL,   -- 'Enero', 'Febrero', ...
    SemanaAnio       TINYINT       NOT NULL,   -- 1 a 53
    Dia              TINYINT       NOT NULL,   -- 1 a 31
    DiaSemanaNumero  TINYINT       NOT NULL,   -- 1=Lunes ... 7=Domingo
    DiaSemanaNombre  NVARCHAR(20)  NOT NULL,
    EsFinDeSemana    BIT           NOT NULL,
    EsFeriado        BIT           NOT NULL CONSTRAINT DF_DimTiempo_Feriado DEFAULT (0),

    CONSTRAINT PK_DimTiempo PRIMARY KEY CLUSTERED (TiempoKey),
    CONSTRAINT UQ_DimTiempo_Fecha UNIQUE (Fecha)
);
GO


/* ---------------------------------------------------------------------
   DimProducto
   - Clave subrogada IDENTITY; el SKU/EAN queda como clave de negocio.
   - SCD Tipo 2: si un producto cambia de categoria, marca o precio de
     lista, se cierra la fila vigente (FechaHasta, EsVigente=0) y se
     inserta una nueva. Los hechos historicos siguen apuntando a la
     version del producto vigente al momento de la venta.
--------------------------------------------------------------------- */
CREATE TABLE dbo.DimProducto (
    ProductoKey      INT           IDENTITY(1,1) NOT NULL,
    ProductoCodigo   NVARCHAR(20)  NOT NULL,   -- SKU / EAN (clave de negocio)
    ProductoNombre   NVARCHAR(100) NOT NULL,
    Marca            NVARCHAR(50)  NULL,
    Categoria        NVARCHAR(50)  NOT NULL,   -- ej: Lacteos (desnormalizado)
    Subcategoria     NVARCHAR(50)  NULL,       -- ej: Yogures  (desnormalizado)
    UnidadMedida     NVARCHAR(10)  NOT NULL,   -- 'UN', 'KG', 'LT'
    EsPerecedero     BIT           NOT NULL CONSTRAINT DF_DimProducto_Perec DEFAULT (0),
    -- Control SCD Tipo 2
    FechaDesde       DATE          NOT NULL,
    FechaHasta       DATE          NULL,       -- NULL = version vigente
    EsVigente        BIT           NOT NULL CONSTRAINT DF_DimProducto_Vig DEFAULT (1),

    CONSTRAINT PK_DimProducto PRIMARY KEY CLUSTERED (ProductoKey)
);
GO

-- Un solo registro vigente por SKU (indice unico filtrado)
CREATE UNIQUE NONCLUSTERED INDEX UX_DimProducto_Codigo_Vigente
    ON dbo.DimProducto (ProductoCodigo)
    WHERE EsVigente = 1;
GO


/* ---------------------------------------------------------------------
   DimSucursal
   - Jerarquia geografica desnormalizada: Sucursal > Ciudad > Provincia
     > Region, todo en la misma tabla (estrella, no copo de nieve).
   - Atributos operativos (formato, m2, cajas) para normalizar KPIs:
     venta por m2, venta por caja, etc.
--------------------------------------------------------------------- */
CREATE TABLE dbo.DimSucursal (
    SucursalKey      INT           IDENTITY(1,1) NOT NULL,
    SucursalCodigo   NVARCHAR(10)  NOT NULL,   -- codigo de negocio
    SucursalNombre   NVARCHAR(80)  NOT NULL,
    Formato          NVARCHAR(20)  NOT NULL,   -- 'Hipermercado' | 'Supermercado' | 'Express'
    Direccion        NVARCHAR(120) NULL,
    Ciudad           NVARCHAR(60)  NOT NULL,
    Provincia        NVARCHAR(60)  NOT NULL,
    Region           NVARCHAR(40)  NOT NULL,   -- 'AMBA', 'NOA', 'Patagonia', ...
    SuperficieM2     INT           NULL,
    CantidadCajas    TINYINT       NULL,
    FechaApertura    DATE          NULL,

    CONSTRAINT PK_DimSucursal PRIMARY KEY CLUSTERED (SucursalKey),
    CONSTRAINT UQ_DimSucursal_Codigo UNIQUE (SucursalCodigo)
);
GO


/* ---------------------------------------------------------------------
   DimCliente
   - Basada en el programa de fidelizacion (tarjeta de cliente).
   - Incluye "miembro desconocido" (ClienteKey = 0, 'Consumidor Final')
     para tickets sin tarjeta: en retail son la mayoria y no se pierden.
--------------------------------------------------------------------- */
CREATE TABLE dbo.DimCliente (
    ClienteKey       INT           IDENTITY(1,1) NOT NULL,
    ClienteCodigo    NVARCHAR(20)  NOT NULL,   -- nro tarjeta fidelizacion
    NombreCompleto   NVARCHAR(100) NULL,
    Genero           CHAR(1)       NULL,       -- 'F' | 'M' | 'X'
    FechaNacimiento  DATE          NULL,
    RangoEtario      NVARCHAR(20)  NULL,       -- '18-25', '26-35', ... (derivado en ETL)
    Ciudad           NVARCHAR(60)  NULL,
    Provincia        NVARCHAR(60)  NULL,
    SegmentoCliente  NVARCHAR(30)  NULL,       -- 'Premium', 'Frecuente', 'Ocasional'
    FechaAlta        DATE          NULL,

    CONSTRAINT PK_DimCliente PRIMARY KEY CLUSTERED (ClienteKey)
);
GO

-- Miembro desconocido para ventas sin tarjeta
SET IDENTITY_INSERT dbo.DimCliente ON;
INSERT INTO dbo.DimCliente (ClienteKey, ClienteCodigo, NombreCompleto, SegmentoCliente)
VALUES (0, N'S/D', N'Consumidor Final', N'No identificado');
SET IDENTITY_INSERT dbo.DimCliente OFF;
GO


/* =====================================================================
   2. TABLA DE HECHOS PRINCIPAL: FactVentas
   ---------------------------------------------------------------------
   - Grano: UNA FILA POR LINEA DE TICKET (producto x ticket).
   - NumeroTicket es una "dimension degenerada": vive en la fact sin
     tabla propia y permite reconstruir la canasta (basket analysis).
   - Medidas 100% aditivas: se pueden sumar por cualquier dimension.
   - MargenBruto = ImporteNeto - CostoTotal, precalculado en el ETL
     para que el BI solo tenga que sumar.
   - PK subrogada NONCLUSTERED + indice CLUSTERED COLUMNSTORE:
     el columnstore comprime ~10x y ejecuta agregaciones en batch mode.
   ===================================================================== */
CREATE TABLE dbo.FactVentas (
    VentaID          BIGINT        IDENTITY(1,1) NOT NULL,  -- surrogate tecnico
    TiempoKey        INT           NOT NULL,
    ProductoKey      INT           NOT NULL,
    SucursalKey      INT           NOT NULL,
    ClienteKey       INT           NOT NULL CONSTRAINT DF_FactVentas_Cliente DEFAULT (0),
    NumeroTicket     NVARCHAR(20)  NOT NULL,                -- dimension degenerada
    Cantidad         DECIMAL(9,3)  NOT NULL,                -- soporta pesables (2.350 kg)
    PrecioUnitario   DECIMAL(12,2) NOT NULL,
    ImporteDescuento DECIMAL(12,2) NOT NULL CONSTRAINT DF_FactVentas_Desc DEFAULT (0),
    ImporteNeto      DECIMAL(12,2) NOT NULL,                -- (Cantidad * Precio) - Descuento
    CostoTotal       DECIMAL(12,2) NOT NULL,                -- costo de reposicion
    MargenBruto      DECIMAL(12,2) NOT NULL,                -- ImporteNeto - CostoTotal (ETL)

    CONSTRAINT PK_FactVentas PRIMARY KEY NONCLUSTERED (VentaID),
    CONSTRAINT FK_FactVentas_Tiempo   FOREIGN KEY (TiempoKey)   REFERENCES dbo.DimTiempo   (TiempoKey),
    CONSTRAINT FK_FactVentas_Producto FOREIGN KEY (ProductoKey) REFERENCES dbo.DimProducto (ProductoKey),
    CONSTRAINT FK_FactVentas_Sucursal FOREIGN KEY (SucursalKey) REFERENCES dbo.DimSucursal (SucursalKey),
    CONSTRAINT FK_FactVentas_Cliente  FOREIGN KEY (ClienteKey)  REFERENCES dbo.DimCliente  (ClienteKey)
);
GO

-- Motor de la performance analitica
CREATE CLUSTERED COLUMNSTORE INDEX CCI_FactVentas ON dbo.FactVentas;
GO

/* Nota de operacion: en cargas masivas del ETL, las FKs pueden
   deshabilitarse (NOCHECK) durante el bulk insert y revalidarse al
   final, para no penalizar el tiempo de carga. */


/* =====================================================================
   3. FACT SECUNDARIA: FactStockDiario (snapshot periodico)
   ---------------------------------------------------------------------
   - El stock NO es transaccional: es una foto. Grano: producto x
     sucursal x dia.
   - Reutiliza las mismas dimensiones (dimensiones CONFORMADAS), lo que
     habilita el analisis cruzado ventas vs. stock: quiebres, rotacion,
     venta perdida.
   - OJO: StockUnidades es SEMIADITIVA. Se suma por producto/sucursal,
     pero NUNCA a traves del tiempo (usar ultimo valor o promedio).
   ===================================================================== */
CREATE TABLE dbo.FactStockDiario (
    TiempoKey        INT           NOT NULL,
    ProductoKey      INT           NOT NULL,
    SucursalKey      INT           NOT NULL,
    StockUnidades    DECIMAL(12,3) NOT NULL,
    StockValorizado  DECIMAL(14,2) NOT NULL,   -- unidades * costo vigente
    DiasSinVenta     SMALLINT      NULL,
    QuiebreStock     BIT           NOT NULL CONSTRAINT DF_FactStock_Quiebre DEFAULT (0),

    CONSTRAINT PK_FactStockDiario PRIMARY KEY NONCLUSTERED (TiempoKey, ProductoKey, SucursalKey),
    CONSTRAINT FK_FactStock_Tiempo   FOREIGN KEY (TiempoKey)   REFERENCES dbo.DimTiempo   (TiempoKey),
    CONSTRAINT FK_FactStock_Producto FOREIGN KEY (ProductoKey) REFERENCES dbo.DimProducto (ProductoKey),
    CONSTRAINT FK_FactStock_Sucursal FOREIGN KEY (SucursalKey) REFERENCES dbo.DimSucursal (SucursalKey)
);
GO

CREATE CLUSTERED COLUMNSTORE INDEX CCI_FactStockDiario ON dbo.FactStockDiario;
GO


/* =====================================================================
   4. CONSULTA DE EJEMPLO
   Venta y margen por region y categoria, julio 2026
   ===================================================================== */
SELECT
    s.Region,
    p.Categoria,
    SUM(f.ImporteNeto) AS VentaNeta,
    SUM(f.MargenBruto) AS Margen,
    CAST(SUM(f.MargenBruto) * 100.0
         / NULLIF(SUM(f.ImporteNeto), 0) AS DECIMAL(5,2)) AS MargenPct
FROM dbo.FactVentas f
JOIN dbo.DimTiempo   t ON t.TiempoKey   = f.TiempoKey
JOIN dbo.DimSucursal s ON s.SucursalKey = f.SucursalKey
JOIN dbo.DimProducto p ON p.ProductoKey = f.ProductoKey
WHERE t.Anio = 2026
  AND t.Mes  = 7
GROUP BY s.Region, p.Categoria
ORDER BY VentaNeta DESC;
