import { useState } from 'react';
import { useCambiarEstadoAlerta } from '../api/hooks.js';

/* Espejo de la maquina de estados del backend, SOLO para decidir que
   botones pintar. La autoridad es la API: si otro operador gano la
   carrera, llega un 409 y la fila optimista se revierte sola. */
const ACCIONES_POR_ESTADO = {
  NUEVA: [{ etiqueta: 'Tomar y asignar', destino: 'EN_REVISION', pide: 'responsable', estilo: 'boton--primario' }],
  EN_REVISION: [
    { etiqueta: 'Marcar resuelta', destino: 'RESUELTA', estilo: 'boton--primario' },
    { etiqueta: 'Descartar…', destino: 'DESCARTADA', pide: 'motivo', estilo: 'boton--peligro' },
  ],
  RESUELTA: [],
  DESCARTADA: [],
};

export default function AccionesAlerta({ alerta }) {
  const cambiar = useCambiarEstadoAlerta();
  const [pendiente, setPendiente] = useState(null); // accion esperando dato extra
  const [dato, setDato] = useState('');

  const acciones = ACCIONES_POR_ESTADO[alerta.Estado] ?? [];
  if (acciones.length === 0) return <span className="pista">—</span>;

  const ejecutar = (accion, extra) => {
    cambiar.mutate(
      {
        alertaId: alerta.AlertaId,
        estado: accion.destino,
        ...(accion.pide === 'responsable' && { asignadoA: extra }),
        ...(accion.pide === 'motivo' && { nota: extra }),
      },
      {
        onSuccess: () => {
          setPendiente(null);
          setDato('');
        },
      }
    );
  };

  const alClicear = (accion) => {
    if (accion.pide) {
      setPendiente(accion);
      setDato('');
    } else {
      ejecutar(accion);
    }
  };

  return (
    <div>
      <div className="form-inline" style={{ marginTop: 0 }}>
        {acciones.map((accion) => (
          <button
            key={accion.destino}
            type="button"
            className={`boton boton--chico ${accion.estilo}`}
            onClick={() => alClicear(accion)}
            disabled={cambiar.isPending}
          >
            {accion.etiqueta}
          </button>
        ))}
      </div>

      {pendiente && (
        <form
          className="form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (dato.trim()) ejecutar(pendiente, dato.trim());
          }}
        >
          <label className="campo" style={{ margin: 0 }}>
            <span>
              {pendiente.pide === 'responsable'
                ? 'Responsable del seguimiento'
                : 'Motivo del descarte (queda en el historial)'}
            </span>
            <input
              autoFocus
              value={dato}
              onChange={(e) => setDato(e.target.value)}
              placeholder={
                pendiente.pide === 'responsable' ? 'ej: laura.paez' : 'ej: falso positivo, SKU discontinuado'
              }
            />
          </label>
          <button type="submit" className="boton boton--primario boton--chico" disabled={!dato.trim() || cambiar.isPending}>
            {cambiar.isPending ? 'Aplicando…' : 'Confirmar'}
          </button>
          <button type="button" className="boton boton--fantasma boton--chico" onClick={() => setPendiente(null)}>
            Cancelar
          </button>
        </form>
      )}

      {cambiar.isError && (
        <p className="error" role="alert">
          {cambiar.error.mensaje} ({cambiar.error.codigo})
          {cambiar.error.detalle?.transicionesValidas && (
            <> · transiciones validas: {cambiar.error.detalle.transicionesValidas.join(', ') || 'ninguna'}</>
          )}
        </p>
      )}
    </div>
  );
}
