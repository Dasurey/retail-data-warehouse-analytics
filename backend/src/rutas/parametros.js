import { Router } from 'express';
import { consultar, sql } from '../db.js';
import { requiereRol } from '../middleware/auth.js';
import { ErrorApi, asincronico } from '../middleware/errores.js';
import { simular } from '../servicios/simulador.js';
import {
  RANGOS,
  clavesParametro,
  consultaParametros,
  cuerpoActualizarParametro,
  cuerpoSimulacion,
} from '../validacion/esquemas.js';

export const rutasParametros = Router();

/* GET /api/parametros?modulo=FIDELIZACION - cualquier usuario autenticado */
rutasParametros.get(
  '/',
  asincronico(async (req, res) => {
    const { modulo } = consultaParametros.parse(req.query);
    const r = await consultar(
      `
      SELECT Clave, ValorNumerico, ValorTexto, Tipo, Modulo, Descripcion,
             ActualizadoPor, FechaActualizacion
      FROM app.ConfigParametro
      WHERE (@modulo IS NULL OR Modulo = @modulo)
      ORDER BY Modulo, Clave;`,
      { modulo: { tipo: sql.VarChar(20), valor: modulo ?? null } }
    );
    // El front recibe ademas el rango valido de cada clave para armar
    // los controles (slider/stepper) sin duplicar reglas.
    const filas = r.recordset.map((f) => ({ ...f, rango: RANGOS[f.Clave] ?? null }));
    res.json({ parametros: filas });
  })
);

/* GET /api/parametros/:clave/historial */
rutasParametros.get(
  '/:clave/historial',
  asincronico(async (req, res) => {
    const clave = clavesParametro.parse(req.params.clave);
    const r = await consultar(
      `
      SELECT TOP (50) HistorialId, Clave, ValorAnterior, ValorNuevo, Usuario, Fecha, Motivo
      FROM app.HistorialConfig
      WHERE Clave = @clave
      ORDER BY Fecha DESC;`,
      { clave: { tipo: sql.VarChar(60), valor: clave } }
    );
    res.json({ historial: r.recordset });
  })
);

/* PUT /api/parametros/:clave  { valor, motivo } - solo ADMIN.
   El trigger de la base registra el historial leyendo usuario y motivo
   de SESSION_CONTEXT, seteados y limpiados en el MISMO batch para no
   contaminar la conexion del pool. */
rutasParametros.put(
  '/:clave',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const clave = clavesParametro.parse(req.params.clave);
    const { valor, motivo } = cuerpoActualizarParametro.parse(req.body);

    const [min, max] = RANGOS[clave];
    if (valor < min || valor > max) {
      throw new ErrorApi(422, 'FUERA_DE_RANGO', `${clave} debe estar entre ${min} y ${max}`);
    }

    const r = await consultar(
      `
      EXEC sp_set_session_context @key = N'usuario', @value = @usuario;
      EXEC sp_set_session_context @key = N'motivo',  @value = @motivo;

      DECLARE @filas INT;
      UPDATE app.ConfigParametro
         SET ValorNumerico      = @valor,
             ActualizadoPor     = @usuario,
             FechaActualizacion = SYSDATETIME()
       WHERE Clave = @clave AND Tipo = 'NUMERICO';
      SET @filas = @@ROWCOUNT;

      EXEC sp_set_session_context @key = N'usuario', @value = NULL;
      EXEC sp_set_session_context @key = N'motivo',  @value = NULL;

      SELECT @filas AS Filas;
      SELECT Clave, ValorNumerico, Modulo, ActualizadoPor, FechaActualizacion
      FROM app.ConfigParametro WHERE Clave = @clave;`,
      {
        clave: { tipo: sql.VarChar(60), valor: clave },
        valor: { tipo: sql.Decimal(18, 4), valor },
        usuario: { tipo: sql.NVarChar(100), valor: req.usuario.nombre },
        motivo: { tipo: sql.NVarChar(300), valor: motivo },
      }
    );

    if (r.recordsets[0][0].Filas === 0) {
      throw new ErrorApi(404, 'PARAMETRO_INEXISTENTE', `No existe el parametro ${clave}`);
    }
    res.json({ parametro: r.recordsets[1][0] });
  })
);

/* POST /api/parametros/simular  { clave, valorPropuesto } - solo ADMIN.
   Ejecuta las TVFs con el valor propuesto SIN persistir: el admin
   decide viendo consecuencias, no adivinando. */
rutasParametros.post(
  '/simular',
  requiereRol('ADMIN'),
  asincronico(async (req, res) => {
    const { clave, valorPropuesto } = cuerpoSimulacion.parse(req.body);
    res.json(await simular(clave, valorPropuesto));
  })
);
