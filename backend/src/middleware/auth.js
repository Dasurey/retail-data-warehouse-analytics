import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ErrorApi } from './errores.js';

/**
 * La emision de tokens vive fuera de esta API (IdP / SSO corporativo).
 * Aca solo se VALIDA: firma, expiracion y claims.
 * Payload esperado: { sub, nombre, roles: ['ADMIN'|'SUPPLY'|'FIDELIZACION'|'LECTURA'] }
 * Para desarrollo: npm run token -- --nombre "Ana" --roles ADMIN
 */
export function autenticar(req, _res, next) {
  const encabezado = req.headers.authorization ?? '';
  const [esquema, token] = encabezado.split(' ');
  if (esquema !== 'Bearer' || !token) {
    return next(new ErrorApi(401, 'NO_AUTENTICADO', 'Falta el token Bearer'));
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.usuario = {
      id: payload.sub,
      nombre: payload.nombre ?? payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
    return next();
  } catch {
    return next(new ErrorApi(401, 'TOKEN_INVALIDO', 'Token invalido o expirado'));
  }
}

/**
 * Autorizacion por rol. ADMIN tiene acceso a todo.
 * @param {...string} rolesPermitidos
 */
export function requiereRol(...rolesPermitidos) {
  return (req, _res, next) => {
    const roles = req.usuario?.roles ?? [];
    const autorizado =
      roles.includes('ADMIN') || rolesPermitidos.some((r) => roles.includes(r));
    if (!autorizado) {
      return next(
        new ErrorApi(403, 'PROHIBIDO', `Requiere rol: ${rolesPermitidos.join(' o ')}`)
      );
    }
    return next();
  };
}
