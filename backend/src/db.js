import sql from 'mssql';
import { config } from './config.js';
import { logger } from './logger.js';

const configuracionSql = {
  server: config.DW_SERVER,
  port: config.DW_PORT,
  database: config.DW_DATABASE,
  user: config.DW_USER,
  password: config.DW_PASSWORD,
  connectionTimeout: config.DW_CONNECT_TIMEOUT_MS,
  requestTimeout: 30000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: {
    encrypt: config.DW_ENCRYPT,
    trustServerCertificate: config.DW_TRUST_CERT,
    enableArithAbort: true,
  },
};

/** @type {sql.ConnectionPool | null} */
let pool = null;

export async function obtenerPool() {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool(configuracionSql).connect();
  pool.on('error', (err) => logger.error({ err }, 'Error en el pool de SQL Server'));
  return pool;
}

/**
 * Ejecuta una consulta parametrizada.
 * @param {string} texto - T-SQL con parametros @nombre
 * @param {Record<string, { tipo: sql.ISqlType | (() => sql.ISqlType), valor: unknown }>} entradas
 */
export async function consultar(texto, entradas = {}) {
  const p = await obtenerPool();
  const solicitud = p.request();
  for (const [nombre, { tipo, valor }] of Object.entries(entradas)) {
    solicitud.input(nombre, tipo, valor);
  }
  return solicitud.query(texto);
}

/**
 * Ejecuta una funcion dentro de una transaccion. Commit si resuelve,
 * rollback si lanza.
 * @template T
 * @param {(solicitud: () => sql.Request) => Promise<T>} fn
 */
export async function enTransaccion(fn) {
  const p = await obtenerPool();
  const tx = new sql.Transaction(p);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const resultado = await fn(() => new sql.Request(tx));
    await tx.commit();
    return resultado;
  } catch (err) {
    try { await tx.rollback(); } catch { /* la conexion ya pudo cerrarse */ }
    throw err;
  }
}

export async function cerrarPool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { sql };
