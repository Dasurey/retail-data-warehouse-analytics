/* =====================================================================
   01 - ESQUEMA app: CONFIGURACION, ALERTAS Y ACCIONES
   ---------------------------------------------------------------------
   SQL Server 2017+. Idempotente: se puede re-ejecutar sin romper nada.
   Unica escritora en produccion: la API de Node (login con DML solo
   sobre app) + el orquestador (via app.usp_UpsertAlerta).
   ===================================================================== */

IF SCHEMA_ID(N'app') IS NULL
    EXEC (N'CREATE SCHEMA app AUTHORIZATION dbo');
GO


/* ---------------------------------------------------------------
   app.ConfigParametro - fuente de verdad de las reglas de negocio
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.ConfigParametro') IS NULL
BEGIN
    CREATE TABLE app.ConfigParametro (
        Clave              VARCHAR(60)   NOT NULL,
        ValorNumerico      DECIMAL(18,4) NULL,
        ValorTexto         NVARCHAR(200) NULL,
        Tipo               VARCHAR(10)   NOT NULL,   -- NUMERICO | TEXTO
        Modulo             VARCHAR(20)   NOT NULL,   -- COMERCIAL | SUPPLY | FIDELIZACION | GENERAL
        Descripcion        NVARCHAR(300) NOT NULL,
        ActualizadoPor     NVARCHAR(100) NOT NULL CONSTRAINT DF_Config_Usuario DEFAULT (SUSER_SNAME()),
        FechaActualizacion DATETIME2(0)  NOT NULL CONSTRAINT DF_Config_Fecha   DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_ConfigParametro PRIMARY KEY CLUSTERED (Clave),
        CONSTRAINT CK_ConfigParametro_Tipo  CHECK (Tipo IN ('NUMERICO','TEXTO')),
        CONSTRAINT CK_ConfigParametro_Valor CHECK (
            (Tipo = 'NUMERICO' AND ValorNumerico IS NOT NULL) OR
            (Tipo = 'TEXTO'    AND ValorTexto    IS NOT NULL))
    );
END
GO

-- Semilla de parametros (MERGE: no pisa valores ya modificados por el negocio)
MERGE app.ConfigParametro AS destino
USING (VALUES
    ('INFLACION_MENSUAL_ESPERADA', 0.04,     'COMERCIAL',    N'Tasa mensual usada para deflactar la venta a moneda constante (P1)'),
    ('MIN_SNAPSHOTS_QUIEBRE',      2,        'SUPPLY',       N'Snapshots mensuales consecutivos en quiebre para considerar racha (P2)'),
    ('UMBRAL_VENTA_PERDIDA',       40000,    'SUPPLY',       N'Venta perdida estimada minima ($) para emitir alerta critica (P2)'),
    ('TOP_N_QUIEBRES',             20,       'SUPPLY',       N'Cantidad de rachas en el reporte priorizado (P2)'),
    ('MIN_VISITAS_FUGA',           8,        'FIDELIZACION', N'Visitas historicas minimas para evaluar fuga (P3)'),
    ('DIAS_PISO_FUGA',             60,       'FIDELIZACION', N'Piso de dias sin comprar para considerar fuga (P3)'),
    ('MULTIPLICADOR_FRECUENCIA',   2.0,      'FIDELIZACION', N'Dias sin comprar > multiplicador x frecuencia promedio (P3)'),
    ('UMBRAL_GASTO_ALTO_VALOR',    400000,   'FIDELIZACION', N'Gasto historico minimo ($) para campania de retencion (P3)'),
    ('DESCUENTO_PREMIUM',          20,       'FIDELIZACION', N'% de descuento del cupon para segmento Premium'),
    ('DESCUENTO_FRECUENTE',        15,       'FIDELIZACION', N'% de descuento del cupon para segmento Frecuente'),
    ('DESCUENTO_OCASIONAL',        10,       'FIDELIZACION', N'% de descuento del cupon para el resto de los segmentos'),
    ('COOLDOWN_CONTACTO_DIAS',     90,       'FIDELIZACION', N'Dias minimos entre contactos al mismo cliente')
) AS origen (Clave, ValorNumerico, Modulo, Descripcion)
   ON destino.Clave = origen.Clave
WHEN NOT MATCHED THEN
    INSERT (Clave, ValorNumerico, Tipo, Modulo, Descripcion)
    VALUES (origen.Clave, origen.ValorNumerico, 'NUMERICO', origen.Modulo, origen.Descripcion);
GO


/* ---------------------------------------------------------------
   app.HistorialConfig - auditoria append-only de cambios
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.HistorialConfig') IS NULL
BEGIN
    CREATE TABLE app.HistorialConfig (
        HistorialId   BIGINT IDENTITY(1,1) NOT NULL,
        Clave         VARCHAR(60)   NOT NULL,
        ValorAnterior NVARCHAR(200) NULL,
        ValorNuevo    NVARCHAR(200) NULL,
        Usuario       NVARCHAR(100) NOT NULL,
        Fecha         DATETIME2(0)  NOT NULL CONSTRAINT DF_HistCfg_Fecha DEFAULT (SYSDATETIME()),
        Motivo        NVARCHAR(300) NULL,

        CONSTRAINT PK_HistorialConfig PRIMARY KEY CLUSTERED (HistorialId),
        CONSTRAINT FK_HistorialConfig_Clave FOREIGN KEY (Clave)
            REFERENCES app.ConfigParametro (Clave)
    );
END
GO

/* Auditoria a nivel base (red de seguridad: audita aunque alguien
   toque la tabla por fuera de la API). La API setea usuario y motivo
   con sp_set_session_context antes del UPDATE. */
CREATE OR ALTER TRIGGER app.trg_ConfigParametro_Auditoria
ON app.ConfigParametro
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO app.HistorialConfig (Clave, ValorAnterior, ValorNuevo, Usuario, Motivo)
    SELECT
        d.Clave,
        COALESCE(CONVERT(NVARCHAR(200), d.ValorNumerico), d.ValorTexto),
        COALESCE(CONVERT(NVARCHAR(200), i.ValorNumerico), i.ValorTexto),
        COALESCE(CONVERT(NVARCHAR(100), SESSION_CONTEXT(N'usuario')), SUSER_SNAME()),
        CONVERT(NVARCHAR(300), SESSION_CONTEXT(N'motivo'))
    FROM deleted d
    JOIN inserted i ON i.Clave = d.Clave
    -- solo registra si el valor realmente cambio (EXCEPT maneja NULLs)
    WHERE EXISTS (SELECT d.ValorNumerico, d.ValorTexto
                  EXCEPT
                  SELECT i.ValorNumerico, i.ValorTexto);
END;
GO


/* ---------------------------------------------------------------
   app.Alerta - bandeja de quiebres con workflow de estados
   Clave natural UNIQUE => el upsert del orquestador es idempotente.
   ProductoCodigo sin FK: no es unico en DimProducto por el SCD2.
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.Alerta') IS NULL
BEGIN
    CREATE TABLE app.Alerta (
        AlertaId             INT IDENTITY(1,1) NOT NULL,
        TipoAlerta           VARCHAR(30)   NOT NULL CONSTRAINT DF_Alerta_Tipo DEFAULT ('QUIEBRE_STOCK'),
        ProductoCodigo       NVARCHAR(20)  NOT NULL,
        SucursalKey          INT           NOT NULL,
        MesInicio            DATE          NOT NULL,
        MesFin               DATE          NOT NULL,
        SnapshotsEnQuiebre   INT           NOT NULL,
        VentaPerdidaEstimada DECIMAL(18,2) NOT NULL,
        Estado               VARCHAR(15)   NOT NULL CONSTRAINT DF_Alerta_Estado DEFAULT ('NUEVA'),
        AsignadoA            NVARCHAR(100) NULL,
        Nota                 NVARCHAR(500) NULL,
        FechaCreacion        DATETIME2(0)  NOT NULL CONSTRAINT DF_Alerta_Creada DEFAULT (SYSDATETIME()),
        FechaCambioEstado    DATETIME2(0)  NULL,
        FechaResolucion      DATETIME2(0)  NULL,

        CONSTRAINT PK_Alerta PRIMARY KEY CLUSTERED (AlertaId),
        CONSTRAINT UQ_Alerta_ClaveNatural UNIQUE (TipoAlerta, ProductoCodigo, SucursalKey, MesInicio),
        CONSTRAINT CK_Alerta_Estado CHECK (Estado IN ('NUEVA','EN_REVISION','RESUELTA','DESCARTADA')),
        CONSTRAINT FK_Alerta_Sucursal FOREIGN KEY (SucursalKey)
            REFERENCES dbo.DimSucursal (SucursalKey)
    );

    CREATE NONCLUSTERED INDEX IX_Alerta_Estado
        ON app.Alerta (Estado, FechaCreacion)
        INCLUDE (VentaPerdidaEstimada, AsignadoA);
END
GO

IF OBJECT_ID(N'app.AlertaHistorial') IS NULL
BEGIN
    CREATE TABLE app.AlertaHistorial (
        AlertaHistorialId BIGINT IDENTITY(1,1) NOT NULL,
        AlertaId          INT           NOT NULL,
        EstadoDesde       VARCHAR(15)   NOT NULL,
        EstadoHasta       VARCHAR(15)   NOT NULL,
        Usuario           NVARCHAR(100) NOT NULL,
        Fecha             DATETIME2(0)  NOT NULL CONSTRAINT DF_AlertaHist_Fecha DEFAULT (SYSDATETIME()),
        Nota              NVARCHAR(500) NULL,

        CONSTRAINT PK_AlertaHistorial PRIMARY KEY CLUSTERED (AlertaHistorialId),
        CONSTRAINT FK_AlertaHistorial_Alerta FOREIGN KEY (AlertaId)
            REFERENCES app.Alerta (AlertaId)
    );
END
GO

/* Upsert idempotente para el orquestador: re-ejecutar el pipeline
   actualiza la racha (que puede seguir creciendo) sin duplicar filas
   ni pisar la gestion (Estado/AsignadoA/Nota no se tocan). */
CREATE OR ALTER PROCEDURE app.usp_UpsertAlerta
    @ProductoCodigo       NVARCHAR(20),
    @SucursalKey          INT,
    @MesInicio            DATE,
    @MesFin               DATE,
    @SnapshotsEnQuiebre   INT,
    @VentaPerdidaEstimada DECIMAL(18,2)
AS
BEGIN
    SET NOCOUNT ON;
    MERGE app.Alerta WITH (HOLDLOCK) AS destino
    USING (SELECT @ProductoCodigo, @SucursalKey, @MesInicio)
          AS origen (ProductoCodigo, SucursalKey, MesInicio)
       ON destino.TipoAlerta     = 'QUIEBRE_STOCK'
      AND destino.ProductoCodigo = origen.ProductoCodigo
      AND destino.SucursalKey    = origen.SucursalKey
      AND destino.MesInicio      = origen.MesInicio
    WHEN MATCHED THEN
        UPDATE SET MesFin               = @MesFin,
                   SnapshotsEnQuiebre   = @SnapshotsEnQuiebre,
                   VentaPerdidaEstimada = @VentaPerdidaEstimada
    WHEN NOT MATCHED THEN
        INSERT (ProductoCodigo, SucursalKey, MesInicio, MesFin,
                SnapshotsEnQuiebre, VentaPerdidaEstimada)
        VALUES (@ProductoCodigo, @SucursalKey, @MesInicio, @MesFin,
                @SnapshotsEnQuiebre, @VentaPerdidaEstimada);
END;
GO


/* ---------------------------------------------------------------
   app.AccionRetencion - campanias de retencion (P3)
   La consume la medida DAX "Tasa Recuperacion 60d". El estado
   RECOMPRADO lo setea el orquestador cruzando contra FactVentas.
--------------------------------------------------------------- */
IF OBJECT_ID(N'app.AccionRetencion') IS NULL
BEGIN
    CREATE TABLE app.AccionRetencion (
        AccionId     INT IDENTITY(1,1) NOT NULL,
        ClienteKey   INT          NOT NULL,
        FechaEnvio   DATE         NOT NULL CONSTRAINT DF_Accion_Fecha DEFAULT (CAST(SYSDATETIME() AS DATE)),
        CuponCodigo  VARCHAR(30)  NOT NULL,
        PctDescuento TINYINT      NOT NULL,
        Canal        VARCHAR(15)  NOT NULL CONSTRAINT DF_Accion_Canal DEFAULT ('EMAIL'),
        Estado       VARCHAR(15)  NOT NULL CONSTRAINT DF_Accion_Estado DEFAULT ('EMITIDO'),
        FechaCanje   DATE         NULL,

        CONSTRAINT PK_AccionRetencion PRIMARY KEY CLUSTERED (AccionId),
        CONSTRAINT UQ_AccionRetencion_Cupon UNIQUE (CuponCodigo),
        CONSTRAINT CK_AccionRetencion_Estado CHECK (Estado IN ('EMITIDO','CANJEADO','RECOMPRADO','VENCIDO')),
        CONSTRAINT CK_AccionRetencion_Pct CHECK (PctDescuento BETWEEN 1 AND 90),
        CONSTRAINT FK_AccionRetencion_Cliente FOREIGN KEY (ClienteKey)
            REFERENCES dbo.DimCliente (ClienteKey)
    );

    CREATE NONCLUSTERED INDEX IX_AccionRetencion_Cliente
        ON app.AccionRetencion (ClienteKey, FechaEnvio DESC)
        INCLUDE (Estado);
END
GO
