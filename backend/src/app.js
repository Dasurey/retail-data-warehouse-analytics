import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { consultar } from './db.js';
import { logger } from './logger.js';
import { autenticar } from './middleware/auth.js';
import { manejadorErrores, noEncontrado } from './middleware/errores.js';
import { rutasAlertas } from './rutas/alertas.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasCampanias } from './rutas/campanias.js';
import { rutasCanales } from './rutas/canales.js';
import { rutasEnrutamiento } from './rutas/enrutamiento.js';
import { rutasPipeline } from './rutas/pipeline.js';
import { rutasParametros } from './rutas/parametros.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // detras de un reverse proxy / load balancer

app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGEN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/salud' } }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { codigo: 'RATE_LIMIT', mensaje: 'Demasiadas solicitudes, reintentar mas tarde' },
  })
);

/* Health check para el contenedor / load balancer (sin auth):
   responde 503 si la base no contesta, para que el orquestador de
   infraestructura saque la instancia de rotacion. */
app.get('/api/salud', async (_req, res) => {
  try {
    await consultar('SELECT 1 AS ok;');
    res.json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

/* Login: publico (es el que EMITE el token) */
app.use('/api/auth', rutasAuth);

/* Todo lo demas requiere token */
app.use('/api', autenticar);
app.use('/api/parametros', rutasParametros);
app.use('/api/alertas', rutasAlertas);
app.use('/api/canales', rutasCanales);
app.use('/api/rutas', rutasEnrutamiento);
app.use('/api/campanias', rutasCampanias);
app.use('/api/pipeline', rutasPipeline);

app.use(noEncontrado);
app.use(manejadorErrores);
