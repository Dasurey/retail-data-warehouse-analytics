/* =====================================================================
   CARGA MASIVA DEL DW - BULK INSERT (SQL Server 2017+)
   ---------------------------------------------------------------------
   Prerrequisitos:
     1. Ejecutar dw_supermercado_star_schema.sql (crea las tablas).
     2. Copiar los CSV generados por generar_datos_dw.py a una carpeta
        VISIBLE PARA EL MOTOR de SQL Server (no para tu maquina cliente):
        aca se asume C:\ruta\absoluta\a\tu\repo\datos\csv_dw  ->  ajustar la ruta si difiere.

   Claves de la configuracion:
     - FORMAT = 'CSV'      : parsea comillas RFC 4180 (nombres con comas).
     - CODEPAGE = '65001'  : los CSV estan en UTF-8 (tildes, enies).
     - FIRSTROW = 2        : salta la fila de encabezados.
     - ROWTERMINATOR 0x0a  : los CSV usan \n (generados en Python).
     - KEEPIDENTITY        : respeta las claves subrogadas del CSV; sin
                             esto el IDENTITY renumera y las FKs de las
                             facts quedan apuntando a cualquier lado.
     - KEEPNULLS           : campo vacio -> NULL (ej: FechaHasta).
     - TABLOCK             : carga en paralelo y, en las facts con
                             columnstore, va directo a rowgroups
                             comprimidos si el lote supera 102.400 filas.
   ===================================================================== */

SET NOCOUNT ON;

-- ---------------------------------------------------------------
-- 0. Limpiar en orden seguro para las FKs
--    (facts primero con TRUNCATE; dimensiones despues con DELETE,
--     que es lo unico permitido sobre tablas referenciadas por FK.
--     Esto tambien elimina el 'Consumidor Final' que inserto el DDL:
--     el CSV de clientes ya lo trae incluido con ClienteKey = 0.)
-- ---------------------------------------------------------------
TRUNCATE TABLE dbo.FactVentas;
TRUNCATE TABLE dbo.FactStockDiario;
DELETE FROM dbo.DimCliente;
DELETE FROM dbo.DimProducto;
DELETE FROM dbo.DimSucursal;
DELETE FROM dbo.DimTiempo;

-- ---------------------------------------------------------------
-- 1. Dimensiones (siempre antes que las facts)
-- ---------------------------------------------------------------
BULK INSERT dbo.DimTiempo
FROM '$(RutaCSV)\dim_tiempo.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001',
      FIELDTERMINATOR = ',', ROWTERMINATOR = '0x0a', KEEPNULLS, TABLOCK);

BULK INSERT dbo.DimProducto
FROM '$(RutaCSV)\dim_producto.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001',
      FIELDTERMINATOR = ',', ROWTERMINATOR = '0x0a', KEEPIDENTITY, KEEPNULLS, TABLOCK);

BULK INSERT dbo.DimSucursal
FROM '$(RutaCSV)\dim_sucursal.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001',
      FIELDTERMINATOR = ',', ROWTERMINATOR = '0x0a', KEEPIDENTITY, KEEPNULLS, TABLOCK);

BULK INSERT dbo.DimCliente
FROM '$(RutaCSV)\dim_cliente.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001',
      FIELDTERMINATOR = ',', ROWTERMINATOR = '0x0a', KEEPIDENTITY, KEEPNULLS, TABLOCK);

-- ---------------------------------------------------------------
-- 2. Tablas de hechos
--    (BULK INSERT no valida FKs por defecto: carga rapido y las
--     marca como 'not trusted'; se revalidan en el paso 3.)
-- ---------------------------------------------------------------
BULK INSERT dbo.FactVentas
FROM '$(RutaCSV)\fact_ventas.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001',
      FIELDTERMINATOR = ',', ROWTERMINATOR = '0x0a', KEEPIDENTITY, KEEPNULLS,
      TABLOCK, BATCHSIZE = 150000);

BULK INSERT dbo.FactStockDiario
FROM '$(RutaCSV)\fact_stock_diario.csv'
WITH (FORMAT = 'CSV', FIELDQUOTE = '"', FIRSTROW = 2, CODEPAGE = '65001',
      FIELDTERMINATOR = ',', ROWTERMINATOR = '0x0a', KEEPNULLS,
      TABLOCK, BATCHSIZE = 300000);

-- ---------------------------------------------------------------
-- 3. Revalidar FKs para que el optimizador vuelva a confiar en ellas
--    (si algo falla aca, hay claves huerfanas: revisar los CSV)
-- ---------------------------------------------------------------
ALTER TABLE dbo.FactVentas       WITH CHECK CHECK CONSTRAINT ALL;
ALTER TABLE dbo.FactStockDiario  WITH CHECK CHECK CONSTRAINT ALL;

-- Compactar los rowgroups del columnstore que hayan quedado abiertos
ALTER INDEX CCI_FactVentas      ON dbo.FactVentas      REORGANIZE
      WITH (COMPRESS_ALL_ROW_GROUPS = ON);
ALTER INDEX CCI_FactStockDiario ON dbo.FactStockDiario REORGANIZE
      WITH (COMPRESS_ALL_ROW_GROUPS = ON);

-- ---------------------------------------------------------------
-- 4. Verificacion
-- ---------------------------------------------------------------
SELECT 'DimTiempo'       AS Tabla, COUNT(*) AS Filas FROM dbo.DimTiempo
UNION ALL SELECT 'DimProducto',      COUNT(*) FROM dbo.DimProducto
UNION ALL SELECT 'DimSucursal',      COUNT(*) FROM dbo.DimSucursal
UNION ALL SELECT 'DimCliente',       COUNT(*) FROM dbo.DimCliente
UNION ALL SELECT 'FactVentas',       COUNT(*) FROM dbo.FactVentas
UNION ALL SELECT 'FactStockDiario',  COUNT(*) FROM dbo.FactStockDiario;

-- La estacionalidad deberia saltar a la vista: diciembre ~1.9x
SELECT t.Anio, t.Mes, COUNT(*) AS Lineas, SUM(f.ImporteNeto) AS VentaNeta
FROM dbo.FactVentas f
JOIN dbo.DimTiempo t ON t.TiempoKey = f.TiempoKey
GROUP BY t.Anio, t.Mes
ORDER BY t.Anio, t.Mes;
