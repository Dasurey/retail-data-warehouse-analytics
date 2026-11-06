import { Router } from 'express';
import { consultar, enTransaccion, sql } from '../db.js';
import { requiereRol } from '../middleware/auth.js';
import { ErrorApi, asincronico } from '../middleware/errores.js';
import {
  cuerpoOrdenReglas,
  cuerpoRegla,
  cuerpoResolverRuta,
} from '../validacion/esquemas.js';

export const rutasEnrutamiento = Router();

/* GET /api/rutas - reglas en orden de evaluacion */
rutasEnrutamiento.get(
  '/',
  asincronico(async (_req, res) => {
    const r = await consultar(`
      SELECT re.ReglaId, re.Prioridad, re.CondRegion, re.CondCategoria,
             re.VentaPerdidaMin, re.Activo,
             re.CanalId, c.Nombre AS CanalNombre, c.Tipo AS CanalTipo
      FROM app.ReglaEnrutamiento re
      JOIN app.CanalAlerta c ON c.CanalId = re.CanalId
      ORDER BY re.Prioridad;`);
    res.json({ reglas: r.recordset });
  })
);

/* POST /api/rutas - crea al final de la cola de prioridades. ADMIN. */
rutasEnrutamiento.post(
  '/',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const { condRegion, condCategoria, ventaPerdidaMin, canalId } = cuerpoRegla.parse(req.body);
    const r = await consultar(
      `
      IF NOT EXISTS (SELECT 1 FROM app.CanalAlerta WHERE CanalId = @canalId)
          THROW 50001, 'CANAL_INEXISTENTE', 1;

      INSERT INTO app.ReglaEnrutamiento
             (Prioridad, CondRegion, CondCategoria, VentaPerdidaMin, CanalId)
      OUTPUT inserted.ReglaId, inserted.Prioridad
      SELECT ISNULL(MAX(Prioridad), 0) + 1, @condRegion, @condCategoria, @ventaPerdidaMin, @canalId
      FROM app.ReglaEnrutamiento;`,
      {
        condRegion: { tipo: sql.NVarChar(40), valor: condRegion ?? null },
        condCategoria: { tipo: sql.NVarChar(50), valor: condCategoria ?? null },
        ventaPerdidaMin: { tipo: sql.Decimal(18, 2), valor: ventaPerdidaMin ?? null },
        canalId: { tipo: sql.Int, valor: canalId },
      }
    ).catch((err) => {
      if (String(err.message).includes('CANAL_INEXISTENTE')) {
        throw new ErrorApi(404, 'CANAL_INEXISTENTE', `No existe el canal ${canalId}`);
      }
      throw err;
    });
    res.status(201).json({ regla: r.recordset[0] });
  })
);

/* PUT /api/rutas/orden  { ids: [...] } - reordena por drag & drop.
   Exige la lista COMPLETA de reglas: reordenar un subconjunto dejaria
   prioridades duplicadas. Un solo UPDATE via OPENJSON = atomico incluso
   con el UNIQUE(Prioridad). ADMIN. */
rutasEnrutamiento.put(
  '/orden',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const { ids } = cuerpoOrdenReglas.parse(req.body);

    await enTransaccion(async (solicitud) => {
      const total = await solicitud().query(
        `SELECT COUNT(*) AS Total FROM app.ReglaEnrutamiento;`
      );
      if (total.recordset[0].Total !== ids.length || new Set(ids).size !== ids.length) {
        throw new ErrorApi(
          422,
          'ORDEN_INCOMPLETO',
          'El nuevo orden debe incluir todas las reglas exactamente una vez'
        );
      }
      const actualizadas = await solicitud()
        .input('orden', sql.NVarChar(sql.MAX), JSON.stringify(ids))
        .query(`
          UPDATE re
             SET re.Prioridad = o.[key] + 1        -- OPENJSON: key = indice 0..n-1
          FROM app.ReglaEnrutamiento re
          JOIN OPENJSON(@orden) o ON o.value = re.ReglaId;`);
      if (actualizadas.rowsAffected[0] !== ids.length) {
        throw new ErrorApi(422, 'REGLA_DESCONOCIDA', 'El orden incluye reglas inexistentes');
      }
    });
    res.json({ ok: true, orden: ids });
  })
);

/* DELETE /api/rutas/:id - las reglas si se borran (no tienen hijos). ADMIN. */
rutasEnrutamiento.delete(
  '/:id',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorApi(400, 'ID_INVALIDO', 'El id de regla debe ser un entero positivo');
    }
    const r = await consultar(
      `DELETE FROM app.ReglaEnrutamiento OUTPUT deleted.ReglaId WHERE ReglaId = @id;`,
      { id: { tipo: sql.Int, valor: id } }
    );
    if (r.recordset.length === 0) {
      throw new ErrorApi(404, 'REGLA_INEXISTENTE', `No existe la regla ${id}`);
    }
    res.status(204).end();
  })
);

/* POST /api/rutas/resolver  { region?, categoria?, ventaPerdida } -
   la misma logica que usara el orquestador: primera regla ACTIVA que
   matchea por prioridad (NULL = comodin). Sirve para previsualizar
   "esta alerta, ¿a que canal iria?" desde la UI. */
rutasEnrutamiento.post(
  '/resolver',
  asincronico(async (req, res) => {
    const { region, categoria, ventaPerdida } = cuerpoResolverRuta.parse(req.body);
    const r = await consultar(
      `
      SELECT TOP (1) re.ReglaId, re.Prioridad,
             c.CanalId, c.Nombre AS CanalNombre, c.Tipo AS CanalTipo
      FROM app.ReglaEnrutamiento re
      JOIN app.CanalAlerta c ON c.CanalId = re.CanalId AND c.Activo = 1
      WHERE re.Activo = 1
        AND (re.CondRegion      IS NULL OR re.CondRegion      = @region)
        AND (re.CondCategoria   IS NULL OR re.CondCategoria   = @categoria)
        AND (re.VentaPerdidaMin IS NULL OR @ventaPerdida >= re.VentaPerdidaMin)
      ORDER BY re.Prioridad;`,
      {
        region: { tipo: sql.NVarChar(40), valor: region ?? null },
        categoria: { tipo: sql.NVarChar(50), valor: categoria ?? null },
        ventaPerdida: { tipo: sql.Decimal(18, 2), valor: ventaPerdida },
      }
    );
    res.json({ canal: r.recordset[0] ?? null });
  })
);
