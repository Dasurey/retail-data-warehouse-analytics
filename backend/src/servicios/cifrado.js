import crypto from 'node:crypto';
import { config } from '../config.js';
import { ErrorApi } from '../middleware/errores.js';

/* =====================================================================
   Cifrado at-rest de destinos de canales (webhooks / emails).
   AES-256-GCM: confidencialidad + integridad (el tag detecta cualquier
   alteracion del registro). Formato almacenado: iv.tag.cifrado (base64).
   La clave viene de CIFRADO_CLAVE (64 chars hex = 32 bytes); generarla:
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ===================================================================== */

function obtenerClave() {
  if (!config.CIFRADO_CLAVE) {
    throw new ErrorApi(
      501,
      'CIFRADO_NO_CONFIGURADO',
      'Falta CIFRADO_CLAVE en el entorno (64 caracteres hex) para gestionar canales'
    );
  }
  return Buffer.from(config.CIFRADO_CLAVE, 'hex');
}

export function cifrar(textoPlano) {
  const clave = obtenerClave();
  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cifrador.update(textoPlano, 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [iv, tag, cifrado].map((b) => b.toString('base64')).join('.');
}

export function descifrar(paquete) {
  const clave = obtenerClave();
  const [iv, tag, cifrado] = paquete.split('.').map((p) => Buffer.from(p, 'base64'));
  const descifrador = crypto.createDecipheriv('aes-256-gcm', clave, iv);
  descifrador.setAuthTag(tag);
  return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
}

/** El destino completo jamas vuelve al cliente: solo los ultimos 4. */
export function enmascarar(destino) {
  return `••••${destino.slice(-4)}`;
}
