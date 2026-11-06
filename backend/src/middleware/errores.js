import { ZodError } from 'zod';
import { logger } from '../logger.js';

/** Error de dominio con status HTTP y codigo estable para el front. */
export class ErrorApi extends Error {
  /**
   * @param {number} status
   * @param {string} codigo
   * @param {string} mensaje
   * @param {unknown} [detalle]
   */
  constructor(status, codigo, mensaje, detalle) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

/** Envuelve handlers async para que sus errores lleguen al middleware. */
export const asincronico = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function noEncontrado(_req, _res, next) {
  next(new ErrorApi(404, 'NO_ENCONTRADO', 'Recurso inexistente'));
}

// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      codigo: 'VALIDACION',
      mensaje: 'Datos de entrada invalidos',
      detalle: err.issues.map((i) => ({ campo: i.path.join('.'), error: i.message })),
    });
  }
  if (err instanceof ErrorApi) {
    return res.status(err.status).json({
      codigo: err.codigo,
      mensaje: err.message,
      ...(err.detalle !== undefined && { detalle: err.detalle }),
    });
  }
  // Error no controlado: log completo adentro, respuesta generica afuera.
  // Nunca filtrar mensajes de SQL Server al cliente.
  logger.error({ err, ruta: req.originalUrl }, 'Error no controlado');
  return res.status(500).json({ codigo: 'INTERNO', mensaje: 'Error interno del servidor' });
}
