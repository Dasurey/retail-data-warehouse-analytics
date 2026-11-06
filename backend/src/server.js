import 'dotenv/config';
import { app } from './app.js';
import { config } from './config.js';
import { cerrarPool } from './db.js';
import { logger } from './logger.js';

const servidor = app.listen(config.PUERTO, () => {
  logger.info({ puerto: config.PUERTO }, 'API del Panel de Administracion escuchando');
});

/* Apagado ordenado: dejar de aceptar conexiones, drenar las vivas,
   cerrar el pool de SQL y recien ahi salir. Un SIGTERM de Kubernetes o
   docker stop no debe cortar transacciones a la mitad. */
async function apagar(senial) {
  logger.info({ senial }, 'Apagando la API...');
  servidor.close(async () => {
    await cerrarPool();
    logger.info('Recursos liberados. Chau.');
    process.exit(0);
  });
  // Red de seguridad si algo queda colgado
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Promesa rechazada sin manejar');
});
