/* Emision de tokens SOLO para desarrollo local.
   En produccion los tokens vienen del IdP / SSO corporativo.

   Uso:
     JWT_SECRET=... node scripts/generar-token.js --nombre "Ana Gomez" --roles ADMIN,SUPPLY
*/
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const args = process.argv.slice(2);
const leer = (flag, porDefecto) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : porDefecto;
};

const nombre = leer('--nombre', 'Usuario Dev');
const roles = leer('--roles', 'ADMIN').split(',').map((r) => r.trim().toUpperCase());

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el entorno (.env)');
  process.exit(1);
}

const token = jwt.sign(
  { sub: nombre.toLowerCase().replace(/\s+/g, '.'), nombre, roles },
  process.env.JWT_SECRET,
  { expiresIn: '8h' }
);

console.log(token);
