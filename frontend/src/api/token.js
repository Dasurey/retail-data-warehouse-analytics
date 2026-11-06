/* Almacen del token JWT. En produccion con IdP propio conviene migrar a
   cookie httpOnly; con Bearer, este modulo es el UNICO que toca el token. */
const CLAVE = 'dw-admin-token';
let enMemoria = null;

const hayStorage = typeof window !== 'undefined' && !!window.localStorage;

export function obtenerToken() {
  if (enMemoria) return enMemoria;
  if (hayStorage) enMemoria = window.localStorage.getItem(CLAVE);
  return enMemoria;
}

export function guardarToken(token) {
  enMemoria = token;
  if (hayStorage) window.localStorage.setItem(CLAVE, token);
}

export function limpiarToken() {
  enMemoria = null;
  if (hayStorage) window.localStorage.removeItem(CLAVE);
}

/* La capa de datos avisa; la UI decide que mostrar. */
export function avisarSesionExpirada() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sesion-expirada'));
  }
}

/* ------------------------- Sesion (usuario + token) ------------------------- */
const CLAVE_USUARIO = 'dw-admin-usuario';

export function guardarSesion({ token, usuario }) {
  guardarToken(token);
  if (hayStorage) window.localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
}

export function obtenerUsuario() {
  if (!hayStorage) return null;
  try {
    return JSON.parse(window.localStorage.getItem(CLAVE_USUARIO));
  } catch {
    return null;
  }
}

export function cerrarSesion() {
  limpiarToken();
  if (hayStorage) window.localStorage.removeItem(CLAVE_USUARIO);
}
