import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { consultar, sql } from '../db.js';
import { ErrorApi, asincronico } from '../middleware/errores.js';
import { cuerpoLogin } from '../validacion/esquemas.js';

export const rutasAuth = Router();

/* Rate limit MAS estricto que el general: el login es el endpoint que
   los bots martillan. 10 intentos por IP cada 15 minutos. */
rutasAuth.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { codigo: 'RATE_LIMIT', mensaje: 'Demasiados intentos de acceso, esperá unos minutos' },
  })
);

/* POST /api/auth/login  { usuario, password }  (publico, sin token)
   La respuesta de error es SIEMPRE la misma exista o no el usuario:
   no se regala la enumeracion de cuentas. */
rutasAuth.post(
  '/login',
  asincronico(async (req, res) => {
    const { usuario, password } = cuerpoLogin.parse(req.body);

    const r = await consultar(
      `
      SELECT UsuarioId, NombreUsuario, NombreCompleto, HashPassword, Roles
      FROM app.Usuario
      WHERE NombreUsuario = @usuario AND Activo = 1;`,
      { usuario: { tipo: sql.NVarChar(50), valor: usuario } }
    );

    const cuenta = r.recordset[0];
    const hashAComparar =
      cuenta?.HashPassword ??
      // Hash dummy: el compare corre igual y el tiempo de respuesta no
      // delata si el usuario existe (timing attack basico).
      '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpUuLmqiym0mkZxYekVSbZv/6TP2u';
    const passwordValida = await bcrypt.compare(password, hashAComparar);

    if (!cuenta || !passwordValida) {
      throw new ErrorApi(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');
    }

    await consultar(
      `UPDATE app.Usuario SET UltimoAcceso = SYSDATETIME() WHERE UsuarioId = @id;`,
      { id: { tipo: sql.Int, valor: cuenta.UsuarioId } }
    );

    const roles = cuenta.Roles.split(',').map((rol) => rol.trim().toUpperCase());
    const token = jwt.sign(
      { sub: cuenta.NombreUsuario, nombre: cuenta.NombreCompleto, roles },
      config.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: { nombre: cuenta.NombreCompleto, roles },
      expiraEnHoras: 8,
    });
  })
);
