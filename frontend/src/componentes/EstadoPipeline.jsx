import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useEjecutarPipeline, usePipelineEstado } from '../api/hooks.js';
import { formatearFechaHora } from '../util/formato.js';

/* Estado del pipeline (/api/pipeline): ultima corrida, cola y disparo.
   "Ejecutar ahora" encola (202) y, en desarrollo, la API lanza el
   runner embebido que la procesa: el refetch acelerado del hook hace
   que SOLICITADA -> EN_CURSO -> OK se vea solo en pantalla. Cuando la
   corrida termina, este componente invalida el cache de alertas: la
   dona y la bandeja se llenan sin tocar nada. */
export default function EstadoPipeline() {
  const { data, isPending, isError, error } = usePipelineEstado();
  const ejecutar = useEjecutarPipeline();
  const qc = useQueryClient();

  const ultima = data?.ultimaCorrida;

  // Transicion a estado terminal => las alertas nuevas ya estan en la base
  const estadoPrevio = useRef(null);
  useEffect(() => {
    const actual = ultima?.Estado ?? null;
    const previo = estadoPrevio.current;
    const estabaCorriendo = previo === 'SOLICITADA' || previo === 'EN_CURSO';
    const termino = actual === 'OK' || actual === 'ERROR';
    if (estabaCorriendo && termino) {
      qc.invalidateQueries({ queryKey: ['alertas'] });
    }
    estadoPrevio.current = actual;
  }, [ultima?.Estado, qc]);

  const runner = ejecutar.data?.runner;

  return (
    <div className="tarjeta">
      <div className="tarjeta__encabezado">
        <span className="etiqueta">Automatización</span>
        <h3>Pipeline de datos</h3>
      </div>

      {isPending && <p>Cargando estado…</p>}
      {isError && (
        <p className="error" role="alert">
          {error.mensaje ?? error.message}
        </p>
      )}

      {data && !ultima && <p className="vacio">Sin corridas registradas todavía.</p>}

      {ultima && (
        <div>
          <p>
            <span className={`chip chip--${ultima.Estado}`}>{ultima.Estado.replace('_', ' ')}</span>{' '}
            <strong className="num">#{ultima.RunId}</strong> ·{' '}
            <span className="num">{formatearFechaHora(ultima.FechaSolicitud)}</span>
            {ultima.DuracionSegundos != null && (
              <> · <span className="num">{ultima.DuracionSegundos}s</span></>
            )}
          </p>
          {ultima.Detalle && <p className="pista">{ultima.Detalle}</p>}
        </div>
      )}

      {data && data.solicitudesPendientes > 0 && (
        <p className="pista" aria-live="polite">
          {data.solicitudesPendientes} solicitud(es) en cola.
        </p>
      )}

      <div className="form-inline">
        <button
          type="button"
          className="boton boton--primario"
          onClick={() => ejecutar.mutate()}
          disabled={ejecutar.isPending}
        >
          {ejecutar.isPending ? 'Encolando…' : 'Ejecutar ahora'}
        </button>
        {ejecutar.isSuccess && runner?.lanzado && (
          <p className="exito" role="status">
            Corrida #{ejecutar.data.runId} lanzada — el runner embebido la está procesando.
          </p>
        )}
        {ejecutar.isSuccess && runner && !runner.lanzado && (
          <p className="pista" role="status">
            Corrida #{ejecutar.data.runId} encolada. {runner.motivo}
          </p>
        )}
        {ejecutar.isError && (
          <p className="error" role="alert">
            {ejecutar.error.mensaje} ({ejecutar.error.codigo})
          </p>
        )}
      </div>

      {data && data.historial.length > 1 && (
        <ul className="historial">
          {data.historial.slice(1, 4).map((run) => (
            <li key={run.RunId}>
              #{run.RunId} · {run.Estado.replace('_', ' ')} ·{' '}
              {formatearFechaHora(run.FechaSolicitud)} · {run.DisparadoPor}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
