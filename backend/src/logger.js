import pino from 'pino';
import { config } from './config.js';

// Logs estructurados en JSON: lo que un colector (Datadog, Loki, CloudWatch)
// puede indexar. Nada de console.log en el codigo de la API.
export const logger = pino({
  level: config.NIVEL_LOG,
  base: { servicio: 'dw-admin-api' },
  redact: ['req.headers.authorization'],
});
