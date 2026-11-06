/* Smoke test de wiring (sin SQL Server): verifica que la seguridad, la
   validacion y el contrato de errores respondan como corresponde.
   Uso: npm run smoke  */
import 'dotenv/config';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ??= 'secreto-solo-para-smoke-test-de-32-chars!';
process.env.DW_USER ??= 'smoke';
process.env.DW_PASSWORD ??= 'smoke';
process.env.DW_CONNECT_TIMEOUT_MS = '1500'; // que el fallo de DB sea rapido
process.env.NIVEL_LOG = 'silent';
if (!process.env.CIFRADO_CLAVE) process.env.CIFRADO_CLAVE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { app } = await import('../src/app.js');

const servidor = app.listen(0);
const puerto = servidor.address().port;
const base = `http://127.0.0.1:${puerto}`;

const token = (roles) =>
  jwt.sign({ sub: 'smoke', nombre: 'Smoke', roles }, process.env.JWT_SECRET, { expiresIn: '5m' });

const pedir = async (ruta, opciones = {}) => {
  const r = await fetch(base + ruta, opciones);
  return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
};

let paso = 0;
const ok = (nombre) => console.log(`  OK ${++paso}. ${nombre}`);

try {
  // 1. Health check honesto: sin DB responde 503
  let r = await pedir('/api/salud');
  assert.equal(r.status, 503);
  assert.equal(r.cuerpo.db, false);
  ok('salud reporta 503 con la base caida');

  // 2. Sin token -> 401
  r = await pedir('/api/parametros');
  assert.equal(r.status, 401);
  assert.equal(r.cuerpo.codigo, 'NO_AUTENTICADO');
  ok('endpoints protegidos exigen token');

  // 3. Token invalido -> 401
  r = await pedir('/api/parametros', { headers: { Authorization: 'Bearer basura' } });
  assert.equal(r.status, 401);
  assert.equal(r.cuerpo.codigo, 'TOKEN_INVALIDO');
  ok('token invalido rechazado');

  // 4. Token valido pero DB caida -> 500 controlado (la auth paso)
  r = await pedir('/api/parametros', {
    headers: { Authorization: `Bearer ${token(['LECTURA'])}` },
  });
  assert.equal(r.status, 500);
  assert.equal(r.cuerpo.codigo, 'INTERNO');
  ok('auth valida atraviesa y el error de DB no filtra detalles');

  // 5. RBAC: LECTURA no puede escribir parametros -> 403
  r = await pedir('/api/parametros/DIAS_PISO_FUGA', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token(['LECTURA'])}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ valor: 45, motivo: 'prueba de rbac' }),
  });
  assert.equal(r.status, 403);
  ok('RBAC bloquea escritura sin rol ADMIN');

  // 6. Validacion zod: body invalido -> 400 con detalle por campo
  r = await pedir('/api/alertas/7/estado', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token(['SUPPLY'])}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ estado: 'INVENTADO' }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.codigo, 'VALIDACION');
  ok('estados fuera del enum rechazados con contrato de error');

  // 7. Clave de parametro fuera de la whitelist -> 400
  r = await pedir('/api/parametros/DROP_TABLE/historial', {
    headers: { Authorization: `Bearer ${token(['LECTURA'])}` },
  });
  assert.equal(r.status, 400);
  ok('claves fuera de la whitelist rechazadas');

  // 8. Cifrado AES-256-GCM: ida y vuelta + mascara (sin base)
  const { cifrar, descifrar, enmascarar } = await import('../src/servicios/cifrado.js');
  const secreto = 'https://hooks.slack.com/services/T000/B000/XXXX';
  const paquete = cifrar(secreto);
  assert.notEqual(paquete, secreto);
  assert.equal(descifrar(paquete), secreto);
  assert.equal(enmascarar(secreto), '••••XXXX');
  ok('cifrado de destinos: roundtrip integro y mascara correcta');

  // 9. Canales: body invalido (webhook sin https) -> 400 VALIDACION
  r = await pedir('/api/canales', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token(['ADMIN'])}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nombre: 'Supply', tipo: 'slack', destino: 'http://inseguro' }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.codigo, 'VALIDACION');
  ok('canales exigen webhook https via zod');

  // 10. Canales: sin rol ADMIN -> 403
  r = await pedir('/api/canales', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token(['SUPPLY'])}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nombre: 'X', tipo: 'slack', destino: 'https://ok.example' }),
  });
  assert.equal(r.status, 403);
  ok('RBAC bloquea alta de canales sin ADMIN');

  // 11. Pipeline: ejecutar sin ADMIN -> 403
  r = await pedir('/api/pipeline/ejecutar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(['FIDELIZACION'])}` },
  });
  assert.equal(r.status, 403);
  ok('RBAC bloquea disparo del pipeline sin ADMIN');

  // 12. Campanias: rol correcto atraviesa auth (falla por DB, no por permisos)
  r = await pedir('/api/campanias/fugados', {
    headers: { Authorization: `Bearer ${token(['FIDELIZACION'])}` },
  });
  assert.equal(r.status, 500);
  assert.equal(r.cuerpo.codigo, 'INTERNO');
  ok('campanias accesibles con rol FIDELIZACION (error controlado de DB)');

  // 13. Canal sms con telefono invalido -> 400 VALIDACION
  r = await pedir('/api/canales', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token(['ADMIN'])}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nombre: 'Guardia Supply', tipo: 'sms', destino: 'abc' }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.codigo, 'VALIDACION');
  ok('canales sms validan el telefono via zod');

  // 14. Pipeline: ejecutar con ADMIN -> el error de DB es controlado ANTES
  // de llegar al runner embebido (con la base caida no se lanza ningun hijo)
  r = await pedir('/api/pipeline/ejecutar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(['ADMIN'])}` },
  });
  assert.equal(r.status, 500);
  assert.equal(r.cuerpo.codigo, 'INTERNO');
  ok('pipeline/ejecutar: auth OK y error de DB controlado sin lanzar el runner');

  // 15. Login es publico (no exige token) y valida el body con zod
  r = await pedir('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'x', password: 'corta' }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.codigo, 'VALIDACION');
  ok('auth/login publico con validacion de formato');

  // 16. Login con formato valido atraviesa hasta la base (error controlado)
  r = await pedir('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'ana', password: 'ClaveDePrueba1' }),
  });
  assert.equal(r.status, 500);
  assert.equal(r.cuerpo.codigo, 'INTERNO');
  ok('auth/login consulta la base con error controlado si esta caida');

  console.log('\nSMOKE TEST COMPLETO: wiring de seguridad y validacion correcto.');
} finally {
  servidor.close();
}
