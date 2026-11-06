import { Router } from 'express';
import { consultar, sql } from '../db.js';
import { requiereRol } from '../middleware/auth.js';
import { ErrorApi, asincronico } from '../middleware/errores.js';
import { cambiarEstado } from '../servicios/alertas.js';
import {
  consultaAlertas,
  cuerpoCambioEstado,
  cuerpoCambioLote,
} from '../validacion/esquemas.js';

export const rutasAlertas = Router();

/* Whitelist de ordenamiento: el parametro del cliente jamas se
   concatena al SQL, se mapea a una expresion fija. */
const ORDENES = {
  ventaPerdida: 'a.VentaPerdidaEstimada DESC',
  antiguedad: 'a.FechaCreacion ASC',
  reciente: 'a.FechaCreacion DESC',
};

/* GET /api/alertas?estado=&sucursalKey=&asignadoA=&pagina=&tamanio=&orden= */
rutasAlertas.get(
  '/',
  asincronico(async (req, res) => {
    const q = consultaAlertas.parse(req.query);
    const r = await consultar(
      `
      SELECT a.AlertaId, a.TipoAlerta, a.ProductoCodigo, p.ProductoNombre,
             a.SucursalKey, s.SucursalNombre,
             a.MesInicio, a.MesFin, a.SnapshotsEnQuiebre, a.VentaPerdidaEstimada,
             a.Estado, a.AsignadoA, a.Nota,
             a.FechaCreacion, a.FechaCambioEstado, a.FechaResolucion,
             DATEDIFF(DAY, a.FechaCreacion,
                      COALESCE(a.FechaResolucion, SYSDATETIME())) AS DiasAbierta,
             COUNT(*) OVER () AS Total
      FROM app.Alerta a
      JOIN dbo.DimSucursal s   ON s.SucursalKey = a.SucursalKey
      LEFT JOIN dbo.DimProducto p ON p.ProductoCodigo = a.ProductoCodigo
                                 AND p.EsVigente = 1
      WHERE (@estado      IS NULL OR a.Estado      = @estado)
        AND (@sucursalKey IS NULL OR a.SucursalKey = @sucursalKey)
        AND (@asignadoA   IS NULL OR a.AsignadoA   = @asignadoA)
      ORDER BY ${ORDENES[q.orden]}
      OFFSET @offset ROWS FETCH NEXT @tamanio ROWS ONLY;`,
      {
        estado: { tipo: sql.VarChar(15), valor: q.estado ?? null },
        sucursalKey: { tipo: sql.Int, valor: q.sucursalKey ?? null },
        asignadoA: { tipo: sql.NVarChar(100), valor: q.asignadoA ?? null },
        offset: { tipo: sql.Int, valor: (q.pagina - 1) * q.tamanio },
        tamanio: { tipo: sql.Int, valor: q.tamanio },
      }
    );
    const total = r.recordset[0]?.Total ?? 0;
    res.json({
      pagina: q.pagina,
      tamanio: q.tamanio,
      total,
      alertas: r.recordset.map(({ Total, ...fila }) => fila),
    });
  })
);

/* GET /api/alertas/:id - detalle + historial de transiciones */
rutasAlertas.get(
  '/:id',
  asincronico(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorApi(400, 'ID_INVALIDO', 'El id de alerta debe ser un entero positivo');
    }
    const r = await consultar(
      `
      SELECT a.*, s.SucursalNombre, p.ProductoNombre
      FROM app.Alerta a
      JOIN dbo.DimSucursal s   ON s.SucursalKey = a.SucursalKey
      LEFT JOIN dbo.DimProducto p ON p.ProductoCodigo = a.ProductoCodigo
                                 AND p.EsVigente = 1
      WHERE a.AlertaId = @id;

      SELECT EstadoDesde, EstadoHasta, Usuario, Fecha, Nota
      FROM app.AlertaHistorial
      WHERE AlertaId = @id
      ORDER BY Fecha DESC;`,
      { id: { tipo: sql.Int, valor: id } }
    );
    if (r.recordsets[0].length === 0) {
      throw new ErrorApi(404, 'ALERTA_INEXISTENTE', `No existe la alerta ${id}`);
    }
    res.json({ alerta: r.recordsets[0][0], historial: r.recordsets[1] });
  })
);

/* PATCH /api/alertas/:id/estado  { estado, nota?, asignadoA? }
   La maquina de estados se valida en el servicio, dentro de una
   transaccion con bloqueo de fila. */
rutasAlertas.patch(
  '/:id/estado',
  requiereRol('SUPPLY'),
  asincronico(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorApi(400, 'ID_INVALIDO', 'El id de alerta debe ser un entero positivo');
    }
    const { estado, nota, asignadoA } = cuerpoCambioEstado.parse(req.body);
    const resultado = await cambiarEstado({
      alertaId: id,
      estadoDestino: estado,
      nota,
      asignadoA,
      usuario: req.usuario.nombre,
    });
    res.json({ alerta: resultado });
  })
);

/* PATCH /api/alertas/lote  { ids[], estado, nota?, asignadoA? }
   Procesa cada alerta con la misma maquina de estados y devuelve el
   resultado individual: las validas avanzan, las invalidas explican. */
rutasAlertas.patch(
  '/lote',
  requiereRol('SUPPLY'),
  asincronico(async (req, res) => {
    const { ids, estado, nota, asignadoA } = cuerpoCambioLote.parse(req.body);
    const resultados = [];
    for (const alertaId of ids) {
      try {
        const r = await cambiarEstado({
          alertaId,
          estadoDestino: estado,
          nota,
          asignadoA,
          usuario: req.usuario.nombre,
        });
        resultados.push({ alertaId, ok: true, estado: r.Estado });
      } catch (err) {
        resultados.push({
          alertaId,
          ok: false,
          codigo: err instanceof ErrorApi ? err.codigo : 'INTERNO',
          mensaje: err instanceof ErrorApi ? err.message : 'Error interno',
        });
      }
    }
    res.json({ resultados });
  })
);

/* Sin DELETE a proposito: las alertas nunca se borran (auditoria).
   El estado DESCARTADA cumple ese rol dejando rastro. */
