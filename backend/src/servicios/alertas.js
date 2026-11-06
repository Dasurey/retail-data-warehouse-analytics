import { sql, enTransaccion } from '../db.js';
import { ErrorApi } from '../middleware/errores.js';

/* =====================================================================
   Maquina de estados de app.Alerta (identica al diagrama del disenio):

       NUEVA ──asignar──▶ EN_REVISION ──▶ RESUELTA
                              └─────────▶ DESCARTADA (nota obligatoria)

   RESUELTA y DESCARTADA son terminales. El backend es la unica
   autoridad: el front solo pinta lo que aca se permite.
   ===================================================================== */
const TRANSICIONES = {
  NUEVA: ['EN_REVISION'],
  EN_REVISION: ['RESUELTA', 'DESCARTADA'],
  RESUELTA: [],
  DESCARTADA: [],
};

/**
 * Cambia el estado de una alerta con validacion de transicion, en una
 * transaccion que bloquea la fila (UPDLOCK) para evitar carreras entre
 * dos operadores tocando la misma alerta.
 */
export async function cambiarEstado({ alertaId, estadoDestino, nota, asignadoA, usuario }) {
  return enTransaccion(async (solicitud) => {
    const actual = await solicitud()
      .input('id', sql.Int, alertaId)
      .query(`
        SELECT AlertaId, Estado, AsignadoA
        FROM app.Alerta WITH (UPDLOCK, ROWLOCK)
        WHERE AlertaId = @id;`);

    if (actual.recordset.length === 0) {
      throw new ErrorApi(404, 'ALERTA_INEXISTENTE', `No existe la alerta ${alertaId}`);
    }
    const alerta = actual.recordset[0];

    if (!TRANSICIONES[alerta.Estado].includes(estadoDestino)) {
      throw new ErrorApi(
        409,
        'TRANSICION_INVALIDA',
        `No se puede pasar de ${alerta.Estado} a ${estadoDestino}`,
        { transicionesValidas: TRANSICIONES[alerta.Estado] }
      );
    }
    if (estadoDestino === 'EN_REVISION' && !asignadoA && !alerta.AsignadoA) {
      throw new ErrorApi(422, 'FALTA_ASIGNADO', 'Pasar a EN_REVISION requiere un responsable (asignadoA)');
    }
    if (estadoDestino === 'DESCARTADA' && !nota) {
      throw new ErrorApi(422, 'FALTA_MOTIVO', 'Descartar una alerta requiere una nota con el motivo');
    }

    const actualizada = await solicitud()
      .input('id', sql.Int, alertaId)
      .input('estado', sql.VarChar(15), estadoDestino)
      .input('asignadoA', sql.NVarChar(100), asignadoA ?? alerta.AsignadoA ?? null)
      .input('nota', sql.NVarChar(500), nota ?? null)
      .query(`
        UPDATE app.Alerta
           SET Estado            = @estado,
               AsignadoA         = @asignadoA,
               Nota              = COALESCE(@nota, Nota),
               FechaCambioEstado = SYSDATETIME(),
               FechaResolucion   = CASE WHEN @estado = 'RESUELTA'
                                        THEN SYSDATETIME() ELSE FechaResolucion END
        OUTPUT inserted.AlertaId, inserted.Estado, inserted.AsignadoA,
               inserted.Nota, inserted.FechaCambioEstado, inserted.FechaResolucion
        WHERE AlertaId = @id;`);

    await solicitud()
      .input('id', sql.Int, alertaId)
      .input('desde', sql.VarChar(15), alerta.Estado)
      .input('hasta', sql.VarChar(15), estadoDestino)
      .input('usuario', sql.NVarChar(100), usuario)
      .input('nota', sql.NVarChar(500), nota ?? null)
      .query(`
        INSERT INTO app.AlertaHistorial (AlertaId, EstadoDesde, EstadoHasta, Usuario, Nota)
        VALUES (@id, @desde, @hasta, @usuario, @nota);`);

    return { estadoAnterior: alerta.Estado, ...actualizada.recordset[0] };
  });
}
