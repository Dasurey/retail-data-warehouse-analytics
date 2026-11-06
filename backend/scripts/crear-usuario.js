/* Alta/actualizacion de usuarios del panel.
   La contrasenia se hashea con bcrypt aca: la base jamas la ve en claro.

   Uso (desde backend/, con el .env configurado):
     npm run usuario -- --usuario ana --nombre "Ana Gomez" --password MiClaveSegura1 --roles ADMIN
     npm run usuario -- --usuario supply --nombre "Guardia Supply" --password ... --roles SUPPLY,LECTURA
*/
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { cerrarPool, consultar, sql } from '../src/db.js';

const args = process.argv.slice(2);
const leer = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const usuario = leer('--usuario');
const nombre = leer('--nombre') ?? usuario;
const password = leer('--password');
const roles = (leer('--roles') ?? 'LECTURA').toUpperCase();

if (!usuario || !password || password.length < 8) {
  console.error('Uso: npm run usuario -- --usuario <u> --nombre "<Nombre>" --password <min 8> --roles ADMIN[,SUPPLY,...]');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);

try {
  await consultar(
    `
    MERGE app.Usuario WITH (HOLDLOCK) AS destino
    USING (SELECT @usuario AS NombreUsuario) AS origen
       ON destino.NombreUsuario = origen.NombreUsuario
    WHEN MATCHED THEN
        UPDATE SET NombreCompleto = @nombre, HashPassword = @hash,
                   Roles = @roles, Activo = 1
    WHEN NOT MATCHED THEN
        INSERT (NombreUsuario, NombreCompleto, HashPassword, Roles)
        VALUES (@usuario, @nombre, @hash, @roles);`,
    {
      usuario: { tipo: sql.NVarChar(50), valor: usuario },
      nombre: { tipo: sql.NVarChar(100), valor: nombre },
      hash: { tipo: sql.VarChar(80), valor: hash },
      roles: { tipo: sql.NVarChar(100), valor: roles },
    }
  );
  console.log(`Usuario "${usuario}" listo con roles [${roles}]. Ya puede entrar al panel.`);
} finally {
  await cerrarPool();
}
