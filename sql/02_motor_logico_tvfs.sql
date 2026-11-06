/* =====================================================================
   02 - MOTOR LOGICO: TVFs PARAMETRIZADAS + VISTAS WRAPPER
   ---------------------------------------------------------------------
   Refactor de las vistas analiticas a inline TVFs (misma logica CTE,
   literales -> parametros). Las TVFs devuelven el conjunto COMPLETO y
   exponen las claves (ClienteKey, ProductoCodigo, SucursalKey) para el
   orquestador y la API; las vistas wrapper conservan el contrato
   original (TOP N + columnas) para Power BI y consumidores simples.

   El orquestador llama las TVFs con los valores de app.ConfigParametro.
   ===================================================================== */


/* =====================================================================
   PROBLEMA 1 - Crecimiento interanual por categoria
   @AnioActual: anio a analizar (se compara contra @AnioActual - 1)
   ===================================================================== */
CREATE OR ALTER FUNCTION dbo.fn_CrecimientoInteranualCategoria
(
    @AnioActual INT
)
RETURNS TABLE
AS
RETURN
(
    WITH VentasMensuales AS (
        -- Grano: Categoria x Anio x Mes. El BETWEEN sobre la clave
        -- inteligente YYYYMMDD habilita rowgroup elimination.
        SELECT
            p.Categoria,
            t.Anio,
            t.Mes,
            SUM(f.ImporteNeto) AS VentaNeta,
            SUM(f.Cantidad)    AS Unidades
        FROM dbo.FactVentas f
        JOIN dbo.DimTiempo   t ON t.TiempoKey   = f.TiempoKey
        JOIN dbo.DimProducto p ON p.ProductoKey = f.ProductoKey
        WHERE f.TiempoKey BETWEEN (@AnioActual - 1) * 10000 + 101
                              AND  @AnioActual      * 10000 + 1231
        GROUP BY p.Categoria, t.Anio, t.Mes
    ),
    Comparativa AS (
        -- LAG(1) particionado por (Categoria, Mes) = mismo mes, anio previo.
        SELECT
            Categoria, Anio, Mes, VentaNeta, Unidades,
            LAG(VentaNeta) OVER (PARTITION BY Categoria, Mes ORDER BY Anio) AS VentaNetaPrev,
            LAG(Unidades)  OVER (PARTITION BY Categoria, Mes ORDER BY Anio) AS UnidadesPrev
        FROM VentasMensuales
    ),
    Anual AS (
        SELECT
            Categoria, Mes,
            VentaNeta     AS VentaNetaActual,
            VentaNetaPrev AS VentaNetaAnterior,
            Unidades      AS UnidadesActual,
            UnidadesPrev  AS UnidadesAnterior,
            SUM(Unidades)     OVER (PARTITION BY Categoria) AS UnidadesAnioActual,
            SUM(UnidadesPrev) OVER (PARTITION BY Categoria) AS UnidadesAnioAnterior
        FROM Comparativa
        WHERE Anio = @AnioActual
    )
    SELECT
        Categoria,
        Mes,
        CAST(VentaNetaActual   AS DECIMAL(18,2)) AS VentaNetaActual,
        CAST(VentaNetaAnterior AS DECIMAL(18,2)) AS VentaNetaAnterior,
        CAST((VentaNetaActual - VentaNetaAnterior) * 100.0
             / NULLIF(VentaNetaAnterior, 0) AS DECIMAL(9,2))  AS VarVentaPct,
        CAST(UnidadesActual   AS DECIMAL(18,3)) AS UnidadesActual,
        CAST(UnidadesAnterior AS DECIMAL(18,3)) AS UnidadesAnterior,
        CAST((UnidadesActual - UnidadesAnterior) * 100.0
             / NULLIF(UnidadesAnterior, 0) AS DECIMAL(9,2))   AS VarUnidadesPct,
        DENSE_RANK() OVER (
            ORDER BY UnidadesAnioActual * 1.0 / NULLIF(UnidadesAnioAnterior, 0) DESC
        ) AS RankingCategoria
    FROM Anual
);
GO

-- Wrapper: contrato original de columnas (anio 2025 vs 2024)
CREATE OR ALTER VIEW dbo.vw_CrecimientoInteranualCategoria
AS
SELECT
    Categoria,
    Mes,
    VentaNetaActual   AS VentaNeta2025,
    VentaNetaAnterior AS VentaNeta2024,
    VarVentaPct,
    UnidadesActual    AS Unidades2025,
    UnidadesAnterior  AS Unidades2024,
    VarUnidadesPct,
    RankingCategoria
FROM dbo.fn_CrecimientoInteranualCategoria(2025);
GO


/* =====================================================================
   PROBLEMA 2 - Quiebres de stock persistentes y venta perdida
   @MinSnapshotsConsecutivos: largo minimo de racha (config: 2)
   Devuelve TODAS las rachas; el consumidor corta y ordena.
   ===================================================================== */
CREATE OR ALTER FUNCTION dbo.fn_QuiebresPersistentes
(
    @MinSnapshotsConsecutivos INT
)
RETURNS TABLE
AS
RETURN
(
    WITH SnapshotsMes AS (
        -- Grano: ProductoCodigo x Sucursal x MesNum. Identidad = SKU de
        -- negocio: una racha sobrevive al cambio de version SCD2.
        SELECT
            p.ProductoCodigo,
            s.SucursalKey,
            t.Anio * 12 + t.Mes AS MesNum,
            MAX(CAST(s.QuiebreStock AS INT)) AS EnQuiebre
        FROM dbo.FactStockDiario s
        JOIN dbo.DimTiempo   t ON t.TiempoKey   = s.TiempoKey
        JOIN dbo.DimProducto p ON p.ProductoKey = s.ProductoKey
        GROUP BY p.ProductoCodigo, s.SucursalKey, t.Anio * 12 + t.Mes
    ),
    Islas AS (
        -- Gaps & islands: MesNum - ROW_NUMBER() es constante dentro de
        -- una racha de meses consecutivos.
        SELECT
            ProductoCodigo, SucursalKey, MesNum,
            MesNum - ROW_NUMBER() OVER (
                PARTITION BY ProductoCodigo, SucursalKey ORDER BY MesNum
            ) AS GrupoRacha
        FROM SnapshotsMes
        WHERE EnQuiebre = 1
    ),
    Rachas AS (
        SELECT
            ProductoCodigo, SucursalKey,
            MIN(MesNum) AS MesNumInicio,
            MAX(MesNum) AS MesNumFin,
            COUNT(*)    AS SnapshotsEnQuiebre
        FROM Islas
        GROUP BY ProductoCodigo, SucursalKey, GrupoRacha
        HAVING COUNT(*) >= @MinSnapshotsConsecutivos
    ),
    VentasMes AS (
        SELECT
            p.ProductoCodigo,
            f.SucursalKey,
            t.Anio * 12 + t.Mes AS MesNum,
            SUM(f.Cantidad)    AS Unidades,
            SUM(f.ImporteNeto) AS Importe
        FROM dbo.FactVentas f
        JOIN dbo.DimTiempo   t ON t.TiempoKey   = f.TiempoKey
        JOIN dbo.DimProducto p ON p.ProductoKey = f.ProductoKey
        GROUP BY p.ProductoCodigo, f.SucursalKey, t.Anio * 12 + t.Mes
    ),
    Baseline AS (
        -- Promedio mensual SOLO de meses sin quiebre; LEFT JOIN para que
        -- un mes sin quiebre y sin ventas pese 0. Precio realizado
        -- ponderado (importe/unidades), no AVG(PrecioUnitario).
        SELECT
            sm.ProductoCodigo,
            sm.SucursalKey,
            AVG(COALESCE(vm.Unidades, 0))                 AS UnidadesPromMes,
            SUM(vm.Importe) / NULLIF(SUM(vm.Unidades), 0) AS PrecioPromedio
        FROM SnapshotsMes sm
        LEFT JOIN VentasMes vm
               ON vm.ProductoCodigo = sm.ProductoCodigo
              AND vm.SucursalKey    = sm.SucursalKey
              AND vm.MesNum         = sm.MesNum
        WHERE sm.EnQuiebre = 0
        GROUP BY sm.ProductoCodigo, sm.SucursalKey
    )
    SELECT
        r.ProductoCodigo,                                  -- clave para app.Alerta
        r.SucursalKey,
        suc.SucursalNombre,
        prod.ProductoNombre,
        DATEFROMPARTS((r.MesNumInicio - 1) / 12, ((r.MesNumInicio - 1) % 12) + 1, 1) AS MesInicio,
        DATEFROMPARTS((r.MesNumFin    - 1) / 12, ((r.MesNumFin    - 1) % 12) + 1, 1) AS MesFin,
        r.SnapshotsEnQuiebre,
        CAST(b.UnidadesPromMes * b.PrecioPromedio * r.SnapshotsEnQuiebre
             AS DECIMAL(18,2)) AS VentaPerdidaEstimada
    FROM Rachas r
    JOIN Baseline b           ON b.ProductoCodigo = r.ProductoCodigo
                             AND b.SucursalKey    = r.SucursalKey
    JOIN dbo.DimSucursal suc  ON suc.SucursalKey  = r.SucursalKey
    JOIN dbo.DimProducto prod ON prod.ProductoCodigo = r.ProductoCodigo
                             AND prod.EsVigente = 1
);
GO

-- Wrapper: contrato original (top 20 por venta perdida)
CREATE OR ALTER VIEW dbo.vw_QuiebresPersistentes
AS
SELECT TOP (20)
    SucursalNombre,
    ProductoNombre,
    MesInicio,
    MesFin,
    SnapshotsEnQuiebre,
    VentaPerdidaEstimada
FROM dbo.fn_QuiebresPersistentes(2)
ORDER BY VentaPerdidaEstimada DESC;
GO


/* =====================================================================
   PROBLEMA 3 - Fuga silenciosa de clientes de alto valor
   @FechaCorte      : "hoy" del analisis (en prod: CAST(GETDATE() AS DATE))
   @MinVisitas      : visitas historicas minimas          (config: 8)
   @DiasPiso        : piso de dias sin comprar            (config: 60)
   @MultFrecuencia  : multiplicador de frecuencia propia  (config: 2.0)
   Devuelve TODOS los fugados; el consumidor corta y ordena.
   ===================================================================== */
CREATE OR ALTER FUNCTION dbo.fn_ClientesFugados
(
    @FechaCorte     DATE,
    @MinVisitas     INT,
    @DiasPiso       INT,
    @MultFrecuencia DECIMAL(4,1)
)
RETURNS TABLE
AS
RETURN
(
    WITH Visitas AS (
        -- Grano: cliente x ticket (una visita = un ticket, no una linea).
        -- Solo ventas hasta la fecha de corte, expresada como clave
        -- inteligente para filtrar la fact sin join.
        SELECT
            f.ClienteKey,
            f.NumeroTicket,
            MIN(t.Fecha)       AS FechaVisita,
            SUM(f.ImporteNeto) AS GastoTicket
        FROM dbo.FactVentas f
        JOIN dbo.DimTiempo t ON t.TiempoKey = f.TiempoKey
        WHERE f.ClienteKey <> 0
          AND f.TiempoKey <= YEAR(@FechaCorte) * 10000
                           + MONTH(@FechaCorte) * 100
                           + DAY(@FechaCorte)
        GROUP BY f.ClienteKey, f.NumeroTicket
    ),
    Secuencia AS (
        SELECT
            ClienteKey, FechaVisita, GastoTicket,
            DATEDIFF(DAY,
                     LAG(FechaVisita) OVER (PARTITION BY ClienteKey
                                            ORDER BY FechaVisita, NumeroTicket),
                     FechaVisita) AS DiasDesdeVisitaAnterior
        FROM Visitas
    ),
    MetricasCliente AS (
        SELECT
            ClienteKey,
            COUNT(*)          AS VisitasTotales,
            MAX(FechaVisita)  AS FechaUltimaCompra,
            SUM(GastoTicket)  AS GastoTotal,
            AVG(CAST(DiasDesdeVisitaAnterior AS DECIMAL(9,2))) AS FrecuenciaPromedioDias
        FROM Secuencia
        GROUP BY ClienteKey
    ),
    Ranking AS (
        -- Ranking sobre TODOS los clientes identificados del segmento,
        -- calculado antes del filtro de fuga (valor absoluto del cliente).
        SELECT
            m.ClienteKey,                                  -- clave para app.AccionRetencion
            c.NombreCompleto,
            c.SegmentoCliente,
            m.FechaUltimaCompra,
            DATEDIFF(DAY, m.FechaUltimaCompra, @FechaCorte) AS DiasSinComprar,
            m.FrecuenciaPromedioDias,
            m.VisitasTotales,
            m.GastoTotal,
            DENSE_RANK() OVER (PARTITION BY c.SegmentoCliente
                               ORDER BY m.GastoTotal DESC) AS RankingEnSegmento
        FROM MetricasCliente m
        JOIN dbo.DimCliente c ON c.ClienteKey = m.ClienteKey
    )
    SELECT
        ClienteKey,
        NombreCompleto,
        SegmentoCliente,
        FechaUltimaCompra,
        DiasSinComprar,
        CAST(FrecuenciaPromedioDias AS DECIMAL(9,1)) AS FrecuenciaPromedioDias,
        VisitasTotales,
        CAST(GastoTotal AS DECIMAL(18,2)) AS GastoTotal,
        RankingEnSegmento
    FROM Ranking
    WHERE VisitasTotales >= @MinVisitas
      AND DiasSinComprar >= @DiasPiso
      AND DiasSinComprar > @MultFrecuencia * FrecuenciaPromedioDias
);
GO

-- Wrapper: contrato original (top 25 por gasto, fecha de corte del ejercicio)
CREATE OR ALTER VIEW dbo.vw_ClientesFugados
AS
SELECT TOP (25)
    ClienteKey,
    NombreCompleto,
    SegmentoCliente,
    FechaUltimaCompra,
    DiasSinComprar,
    FrecuenciaPromedioDias,
    VisitasTotales,
    GastoTotal,
    RankingEnSegmento
FROM dbo.fn_ClientesFugados('20251231', 8, 60, 2.0)
ORDER BY GastoTotal DESC;
GO
