USE DW_Supermercado;
GO

-- 1. Poblar bandeja de alertas desde las rachas críticas (>= $40.000)
DECLARE @pc NVARCHAR(20), @sk INT, @mi DATE, @mf DATE, @sn INT, @vp DECIMAL(18,2);

DECLARE cur_alertas CURSOR LOCAL FAST_FORWARD FOR
    SELECT ProductoCodigo, SucursalKey, MesInicio, MesFin, SnapshotsEnQuiebre, VentaPerdidaEstimada
    FROM dbo.fn_QuiebresPersistentes(2)
    WHERE VentaPerdidaEstimada >= 40000;

OPEN cur_alertas;
FETCH NEXT FROM cur_alertas INTO @pc, @sk, @mi, @mf, @sn, @vp;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC app.usp_UpsertAlerta @pc, @sk, @mi, @mf, @sn, @vp;
    FETCH NEXT FROM cur_alertas INTO @pc, @sk, @mi, @mf, @sn, @vp;
END
CLOSE cur_alertas;
DEALLOCATE cur_alertas;
GO

-- 2. Simular workflow de gestión en app.Alerta (evita que Días Promedio de Resolución dé 0,0 d)
WITH AlertasOrdenadas AS (
    SELECT AlertaId, FechaCreacion,
           ROW_NUMBER() OVER (ORDER BY VentaPerdidaEstimada DESC) AS rn
    FROM app.Alerta
)
UPDATE a
SET Estado = CASE 
        WHEN o.rn IN (1, 2, 3) THEN 'EN_REVISION'
        WHEN o.rn IN (4, 5)    THEN 'RESUELTA'
        WHEN o.rn = 6          THEN 'DESCARTADA'
        ELSE 'NUEVA'
    END,
    AsignadoA = CASE WHEN o.rn <= 6 THEN N'laura.paez' ELSE NULL END,
    Nota = CASE WHEN o.rn = 6 THEN N'SKU discontinuado por proveedor' ELSE Nota END,
    FechaCambioEstado = CASE WHEN o.rn <= 6 THEN DATEADD(DAY, 2, a.FechaCreacion) ELSE NULL END,
    FechaResolucion   = CASE WHEN o.rn IN (4, 5) THEN DATEADD(DAY, 2, a.FechaCreacion) ELSE NULL END
FROM app.Alerta a
JOIN AlertasOrdenadas o ON o.AlertaId = a.AlertaId;
GO

USE DW_Supermercado;
GO

-- 3. Crear campaña de retención con envíos en octubre 2025 (WhatsApp, SMS, Email)
DELETE FROM app.AccionRetencion;
DELETE FROM app.Campania;

INSERT INTO app.Campania (CreadaPor, Nota)
VALUES (N'Sistema Automatizado', N'Campaña Q4 Retención Alto Valor');

DECLARE @CampaniaId INT = SCOPE_IDENTITY();

-- OJO: Evaluamos la fuga a la FECHA DE ENVÍO (15 de Octubre), no a fin de año.
-- Esto asegura que los contactados incluyan a los que luego se recuperaron en Noviembre.
INSERT INTO app.AccionRetencion (ClienteKey, CampaniaId, FechaEnvio, CuponCodigo, PctDescuento, Canal, Estado, FechaCanje)
SELECT
    f.ClienteKey,
    @CampaniaId,
    '2025-10-15',
    CONCAT('RET-', f.ClienteKey, '-2025'),
    CASE f.SegmentoCliente
        WHEN 'Premium'   THEN 20
        WHEN 'Frecuente' THEN 15
        ELSE 10
    END,
    CASE 
        WHEN f.ClienteKey % 10 IN (0, 1, 2) THEN 'WhatsApp'
        WHEN f.ClienteKey % 10 IN (3, 4, 5) THEN 'SMS' 
        ELSE 'EMAIL' 
    END,
    'EMITIDO',
    NULL
FROM dbo.fn_ClientesFugados('20251015', 3, 60, 2.0) f
WHERE f.GastoTotal >= 100000;

UPDATE app.Campania
SET TotalContactados = (SELECT COUNT(*) FROM app.AccionRetencion WHERE CampaniaId = @CampaniaId)
WHERE CampaniaId = @CampaniaId;
GO