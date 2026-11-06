import { Router } from 'express';
import { consultar, sql } from '../db.js';
import { requiereRol } from '../middleware/auth.js';
import { asincronico } from '../middleware/errores.js';
import { lanzarOrquestador } from '../servicios/runner.js';

export const rutasPipeline = Router();

/* GET /api/pipeline/estado - ultima corrida, bitacora y solicitudes en cola */
rutasPipeline.get(
  '/estado',
  asincronico(async (_req, res) => {
    const r = await consultar(`
      SELECT TOP (10) RunId, Estado, DisparadoPor, FechaSolicitud,
             FechaInicio, FechaFin,
             DATEDIFF(SECOND, FechaInicio, FechaFin) AS DuracionSegundos,
             AlertasEmitidas, CuponesEmitidos, Detalle
      FROM app.PipelineRun
      ORDER BY RunId DESC;

      SELECT COUNT(*) AS Pendientes
      FROM app.PipelineRun
      WHERE Estado = 'SOLICITADA';`);
    res.json({
      ultimaCorrida: r.recordsets[0][0] ?? null,
      historial: r.recordsets[0],
      solicitudesPendientes: r.recordsets[1][0].Pendientes,
    });
  })
);

/* POST /api/pipeline/ejecutar - encola (o reusa la solicitud pendiente)
   y, en modo desarrollo, lanza el runner embebido que la consume.

   Secuencia dentro del batch:
     1. Watchdog: una corrida EN_CURSO hace >10 min es un proceso muerto
        (API reiniciada a mitad de corrida, Python caido): se cierra en
        ERROR para no bloquear el boton para siempre.
     2. EN_CURSO fresca  -> 409 (de verdad hay algo corriendo).
     3. SOLICITADA vieja -> se reusa (no se apilan solicitudes).
     4. Nada pendiente   -> se inserta una nueva.
   En 3 y 4 se intenta lanzar el runner. */
rutasPipeline.post(
  '/ejecutar',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const r = await consultar(
      `
      UPDATE app.PipelineRun
         SET Estado = 'ERROR', FechaFin = SYSDATETIME(),
             Detalle = CONCAT(ISNULL(Detalle + ' | ', ''),
                              'Expirada por watchdog: EN_CURSO por mas de 10 minutos')
       WHERE Estado = 'EN_CURSO'
         AND FechaInicio < DATEADD(MINUTE, -10, SYSDATETIME());

      DECLARE @enCurso INT =
          (SELECT TOP (1) RunId FROM app.PipelineRun
           WHERE Estado = 'EN_CURSO' ORDER BY RunId DESC);
      IF @enCurso IS NOT NULL
          SELECT 'EN_CURSO' AS Situacion, @enCurso AS RunId;
      ELSE
      BEGIN
          DECLARE @pendiente INT =
              (SELECT TOP (1) RunId FROM app.PipelineRun
               WHERE Estado = 'SOLICITADA' ORDER BY RunId);
          IF @pendiente IS NOT NULL
              SELECT 'REUSA' AS Situacion, @pendiente AS RunId;
          ELSE
          BEGIN
              INSERT INTO app.PipelineRun (DisparadoPor) VALUES (@usuario);
              SELECT 'NUEVA' AS Situacion, SCOPE_IDENTITY() AS RunId;
          END
      END`,
      { usuario: { tipo: sql.NVarChar(100), valor: req.usuario.nombre } }
    );

    const { Situacion, RunId } = r.recordset[0];
    if (Situacion === 'EN_CURSO') {
      res.status(409).json({
        codigo: 'CORRIDA_EN_CURSO',
        mensaje: 'Ya hay una corrida en curso',
        runId: RunId,
      });
      return;
    }

    const runner = lanzarOrquestador();
    res.status(202).json({
      runId: RunId,
      estado: 'SOLICITADA',
      reutilizada: Situacion === 'REUSA',
      runner,
    });
  })
);
