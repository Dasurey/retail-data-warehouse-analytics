import { Router } from 'express';
import { consultar, sql } from '../db.js';
import { requiereRol } from '../middleware/auth.js';
import { ErrorApi, asincronico } from '../middleware/errores.js';
import { enviarPruebaEmailConErrorClaro } from '../servicios/correo.js';
import { cifrar, descifrar, enmascarar } from '../servicios/cifrado.js';
import { cuerpoActualizarCanal, cuerpoCanal } from '../validacion/esquemas.js';

export const rutasCanales = Router();

const COLUMNAS_PUBLICAS = `
  CanalId, Nombre, Tipo, DestinoMascara, Activo,
  CreadoPor, FechaCreacion, FechaActualizacion`;

function validarId(crudo) {
  const id = Number.parseInt(crudo, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorApi(400, 'ID_INVALIDO', 'El id de canal debe ser un entero positivo');
  }
  return id;
}

/* GET /api/canales - el destino NUNCA viaja completo, solo la mascara */
rutasCanales.get(
  '/',
  asincronico(async (_req, res) => {
    const r = await consultar(
      `SELECT ${COLUMNAS_PUBLICAS} FROM app.CanalAlerta ORDER BY Nombre;`
    );
    res.json({ canales: r.recordset });
  })
);

/* POST /api/canales  { nombre, tipo, destino, activo? } - solo ADMIN */
rutasCanales.post(
  '/',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const { nombre, tipo, destino, activo } = cuerpoCanal.parse(req.body);
    const r = await consultar(
      `
      INSERT INTO app.CanalAlerta (Nombre, Tipo, DestinoCifrado, DestinoMascara, Activo, CreadoPor)
      OUTPUT inserted.CanalId, inserted.Nombre, inserted.Tipo,
             inserted.DestinoMascara, inserted.Activo, inserted.FechaCreacion
      VALUES (@nombre, @tipo, @destinoCifrado, @mascara, @activo, @usuario);`,
      {
        nombre: { tipo: sql.NVarChar(60), valor: nombre },
        tipo: { tipo: sql.VarChar(10), valor: tipo },
        destinoCifrado: { tipo: sql.NVarChar(600), valor: cifrar(destino) },
        mascara: { tipo: sql.NVarChar(60), valor: enmascarar(destino) },
        activo: { tipo: sql.Bit, valor: activo ?? true },
        usuario: { tipo: sql.NVarChar(100), valor: req.usuario.nombre },
      }
    );
    res.status(201).json({ canal: r.recordset[0] });
  })
);

/* PATCH /api/canales/:id  { nombre?, activo?, destino? } - solo ADMIN.
   Si viene destino, se recifra y se regenera la mascara. */
rutasCanales.patch(
  '/:id',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const id = validarId(req.params.id);
    const { nombre, activo, destino } = cuerpoActualizarCanal.parse(req.body);

    const r = await consultar(
      `
      UPDATE app.CanalAlerta
         SET Nombre             = COALESCE(@nombre, Nombre),
             Activo             = COALESCE(@activo, Activo),
             DestinoCifrado     = COALESCE(@destinoCifrado, DestinoCifrado),
             DestinoMascara     = COALESCE(@mascara, DestinoMascara),
             FechaActualizacion = SYSDATETIME()
      OUTPUT inserted.CanalId, inserted.Nombre, inserted.Tipo,
             inserted.DestinoMascara, inserted.Activo, inserted.FechaActualizacion
      WHERE CanalId = @id;`,
      {
        id: { tipo: sql.Int, valor: id },
        nombre: { tipo: sql.NVarChar(60), valor: nombre ?? null },
        activo: { tipo: sql.Bit, valor: activo ?? null },
        destinoCifrado: { tipo: sql.NVarChar(600), valor: destino ? cifrar(destino) : null },
        mascara: { tipo: sql.NVarChar(60), valor: destino ? enmascarar(destino) : null },
      }
    );
    if (r.recordset.length === 0) {
      throw new ErrorApi(404, 'CANAL_INEXISTENTE', `No existe el canal ${id}`);
    }
    res.json({ canal: r.recordset[0] });
  })
);

/* DELETE /api/canales/:id - elimina un canal solo si no esta en uso. */
rutasCanales.delete(
  '/:id',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const id = validarId(req.params.id);
    try {
      await consultar(
        `EXEC app.usp_EliminarCanal @CanalId = @id;`,
        { id: { tipo: sql.Int, valor: id } }
      );
    } catch (err) {
      if (String(err.message).includes('CANAL_EN_USO')) {
        throw new ErrorApi(
          409,
          'CANAL_EN_USO',
          'No se puede eliminar el canal porque tiene reglas de enrutamiento asociadas. Borrá o reasigná esas reglas primero.'
        );
      }
      if (String(err.message).includes('CANAL_INEXISTENTE')) {
        throw new ErrorApi(404, 'CANAL_INEXISTENTE', `No existe el canal ${id}`);
      }
      throw err;
    }
    res.status(204).end();
  })
);

/* POST /api/canales/:id/probar - descifra en el servidor y dispara un
   mensaje de test al webhook. El destino jamas vuelve en la respuesta. */
rutasCanales.post(
  '/:id/probar',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const id = validarId(req.params.id);
    const r = await consultar(
      `SELECT Nombre, Tipo, DestinoCifrado FROM app.CanalAlerta WHERE CanalId = @id;`,
      { id: { tipo: sql.Int, valor: id } }
    );
    if (r.recordset.length === 0) {
      throw new ErrorApi(404, 'CANAL_INEXISTENTE', `No existe el canal ${id}`);
    }
    const canal = r.recordset[0];
    if (canal.Tipo === 'sms') {
      throw new ErrorApi(
        422,
        'PRUEBA_NO_DISPONIBLE',
        'La prueba de envio no esta disponible para SMS; se valida al disparar la campania'
      );
    }

    if (canal.Tipo === 'email') {
      const destino = descifrar(canal.DestinoCifrado);
      const resultado = await enviarPruebaEmailConErrorClaro({ destino, nombreCanal: canal.Nombre });
      res.json(resultado);
      return;
    }

    const destino = descifrar(canal.DestinoCifrado);
    try {
      const respuesta = await fetch(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Mensaje de prueba del Panel DW Supermercado — canal "${canal.Nombre}" configurado correctamente.`,
        }),
        signal: AbortSignal.timeout(5000),
      });
      res.json({ ok: respuesta.ok, status: respuesta.status });
    } catch {
      // Timeout o red caida: resultado honesto, sin filtrar el destino
      res.status(502).json({ ok: false, codigo: 'DESTINO_INALCANZABLE' });
    }
  })
);
