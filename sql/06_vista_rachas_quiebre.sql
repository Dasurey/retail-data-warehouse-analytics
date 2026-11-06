/* =====================================================================
   03 - VISTA PARA POWER BI: TODAS LAS RACHAS DE QUIEBRE
   ---------------------------------------------------------------------
   dbo.vw_QuiebresPersistentes (02_motor_logico_tvfs.sql) es un wrapper
   con TOP (20): alcanza para un ranking, pero no para el grafico mensual
   ni para el scatter de la pagina Supply Chain, que necesitan TODAS las
   rachas. Esta vista usa la misma funcion y el mismo minimo de snapshots,
   sin TOP, y expone ProductoCodigo (clave de negocio) para que Power BI
   relacione las rachas con DimProducto.

   Ejecutar UNA vez en la base del DW, ANTES de actualizar el modelo de
   Power BI (la tabla RachasQuiebre ahora lee de esta vista).
   ===================================================================== */
CREATE OR ALTER VIEW dbo.vw_RachasQuiebre
AS
SELECT
    ProductoCodigo,
    SucursalKey,
    SucursalNombre,
    ProductoNombre,
    MesInicio,
    MesFin,
    SnapshotsEnQuiebre,
    VentaPerdidaEstimada
FROM dbo.fn_QuiebresPersistentes(2);   -- 2 = minimo de snapshots consecutivos (igual que el wrapper)
GO

-- Chequeo rapido: debe devolver mas de 20 filas y 1 fila por racha
-- SELECT COUNT(*) AS Rachas, MAX(MesFin) AS UltimoSnapshot FROM dbo.vw_RachasQuiebre;
