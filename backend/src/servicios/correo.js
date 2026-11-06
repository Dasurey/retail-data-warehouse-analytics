import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { ErrorApi } from '../middleware/errores.js';

let transportador = null;

function obtenerTransportador() {
  if (transportador) return transportador;

  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) {
    throw new ErrorApi(
      501,
      'SMTP_NO_CONFIG',
      'No hay configuracion SMTP para enviar correos reales. Define SMTP_HOST, SMTP_USER y SMTP_PASSWORD.'
    );
  }

  transportador = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    secure: config.SMTP_SECURE,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASSWORD,
    },
  });
  return transportador;
}

export async function enviarPruebaEmail({ destino, nombreCanal }) {
  const from = config.SMTP_FROM ?? config.SMTP_USER;
  if (!from) {
    throw new ErrorApi(
      501,
      'SMTP_NO_FROM',
      'Falta SMTP_FROM o SMTP_USER para definir el remitente del correo.'
    );
  }

  const info = await obtenerTransportador().sendMail({
    from,
    to: destino,
    subject: `Prueba de envío del Panel DW Supermercado - ${nombreCanal}`,
    text: [
      `Este es un correo de prueba del Panel DW Supermercado.`,
      `Canal: ${nombreCanal}`,
      `Destino: ${destino}`,
      `Si recibiste esto, la configuración SMTP está funcionando correctamente.`,
    ].join('\n'),
  });

  return {
    ok: true,
    status: 200,
    modo: 'smtp',
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

export async function enviarPruebaEmailConErrorClaro(datos) {
  try {
    return await enviarPruebaEmail(datos);
  } catch (err) {
    if (String(err?.code) === 'ESOCKET' || String(err?.message).includes('wrong version number')) {
      throw new ErrorApi(
        502,
        'SMTP_TLS_INVALIDO',
        'La configuracion SMTP no coincide con el puerto: para 587 usá SMTP_SECURE=false; para 465 usá SMTP_SECURE=true.'
      );
    }
    throw err;
  }
}