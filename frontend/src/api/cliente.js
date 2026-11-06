import { obtenerToken } from './token.js';

const BASE = import.meta.env?.VITE_API_URL ?? 'http://localhost:3001/api';

/* Espejo del contrato de error del backend: { codigo, mensaje, detalle }.
   Toda la UI puede confiar en err.codigo y err.mensaje sin adivinar. */
export class ErrorApi extends Error {
  constructor(status, cuerpo) {
    super(cuerpo?.mensaje ?? `Error HTTP ${status}`);
    this.status = status;
    this.codigo = cuerpo?.codigo ?? 'DESCONOCIDO';
    this.detalle = cuerpo?.detalle;
  }
}

function armarQuery(params) {
  if (!params) return '';
  const limpios = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return limpios.length ? `?${new URLSearchParams(limpios)}` : '';
}

async function solicitar(ruta, { metodo = 'GET', cuerpo, params } = {}) {
  const token = obtenerToken();
  const respuesta = await fetch(`${BASE}${ruta}${armarQuery(params)}`, {
    method: metodo,
    headers: {
      ...(cuerpo && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  const json = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new ErrorApi(respuesta.status, json);
  return json;
}

export const api = {
  get: (ruta, params) => solicitar(ruta, { params }),
  post: (ruta, cuerpo) => solicitar(ruta, { metodo: 'POST', cuerpo }),
  put: (ruta, cuerpo) => solicitar(ruta, { metodo: 'PUT', cuerpo }),
  patch: (ruta, cuerpo) => solicitar(ruta, { metodo: 'PATCH', cuerpo }),
  delete: (ruta, cuerpo) => solicitar(ruta, { metodo: 'DELETE', cuerpo }),
};
