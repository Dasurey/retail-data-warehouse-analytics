import { formatearNumero, formatearPlata, formatearPct } from '../util/formato.js';

function Delta({ etiqueta, antes, despues, formato = formatearNumero }) {
  const cambio = antes != null && despues != null ? despues - antes : null;
  return (
    <div className="delta">
      <span>{etiqueta}</span>
      <span>
        {formato(antes)} → <strong>{formato(despues)}</strong>
        {cambio != null && cambio !== 0 && (
          <em className={cambio > 0 ? 'delta--sube' : 'delta--baja'} style={{ marginLeft: 8 }}>
            ({cambio > 0 ? '+' : ''}
            {formato === formatearPlata ? formatearPlata(cambio) : formatearNumero(cambio)})
          </em>
        )}
      </span>
    </div>
  );
}

/**
 * Render del resultado de POST /api/parametros/simular. Detecta la forma
 * del impacto (fuga / quiebres / inflacion / sin simulacion) por sus
 * campos, que son el contrato del backend.
 */
export default function ImpactoSimulacion({ simulacion }) {
  if (!simulacion) return null;

  if (!simulacion.simulable) {
    return (
      <p role="status" className="pista">
        {simulacion.mensaje ?? 'Este parametro aplica directo, sin recalcular las reglas.'}
      </p>
    );
  }

  const { impacto } = simulacion;

  if (impacto.actual?.clientesFugados !== undefined) {
    return (
      <div role="status" aria-label="Impacto en fuga de clientes">
        <Delta etiqueta="Clientes fugados" antes={impacto.actual.clientesFugados} despues={impacto.propuesto.clientesFugados} />
        <Delta etiqueta="De alto valor (a contactar)" antes={impacto.actual.clientesAltoValor} despues={impacto.propuesto.clientesAltoValor} />
        <Delta etiqueta="Ingreso en riesgo" antes={impacto.actual.ingresoEnRiesgo} despues={impacto.propuesto.ingresoEnRiesgo} formato={formatearPlata} />
      </div>
    );
  }

  if (impacto.actual?.rachasDetectadas !== undefined) {
    return (
      <div role="status" aria-label="Impacto en alertas de quiebre">
        <Delta etiqueta="Rachas detectadas" antes={impacto.actual.rachasDetectadas} despues={impacto.propuesto.rachasDetectadas} />
        <Delta etiqueta="Alertas criticas a emitir" antes={impacto.actual.alertasCriticas} despues={impacto.propuesto.alertasCriticas} />
        <Delta etiqueta="Venta perdida en alerta" antes={impacto.actual.ventaPerdidaEnAlerta} despues={impacto.propuesto.ventaPerdidaEnAlerta} formato={formatearPlata} />
        <Delta etiqueta="Filas en el reporte" antes={impacto.actual.filasEnReporte} despues={impacto.propuesto.filasEnReporte} />
      </div>
    );
  }

  if (impacto.varNominalPct !== undefined) {
    const [previo, ultimo] = impacto.aniosComparados;
    return (
      <div role="status" aria-label="Impacto en crecimiento real">
        <p className="pista">
          Crecimiento {previo} → {ultimo}: nominal {formatearPct(impacto.varNominalPct)}.
        </p>
        <Delta
          etiqueta="Crecimiento real (moneda constante)"
          antes={impacto.actual.varRealPct}
          despues={impacto.propuesto.varRealPct}
          formato={formatearPct}
        />
      </div>
    );
  }

  return <p role="status">La simulacion respondio con un formato desconocido.</p>;
}
