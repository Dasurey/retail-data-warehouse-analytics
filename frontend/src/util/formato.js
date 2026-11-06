const plata = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const numero = new Intl.NumberFormat('es-AR');
const fecha = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatearPlata = (v) => (v == null ? '—' : plata.format(v));
export const formatearNumero = (v) => (v == null ? '—' : numero.format(v));
export const formatearPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
export const formatearFecha = (v) => (v == null ? '—' : fecha.format(new Date(v)));
const fechaHora = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
export const formatearFechaHora = (v) => (v == null ? '—' : fechaHora.format(new Date(v)));
export const formatearMes = (v) =>
  v == null
    ? '—'
    : new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(new Date(v));
