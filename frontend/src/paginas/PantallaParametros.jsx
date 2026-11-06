import { useState } from 'react';
import { useHistorialParametro, useParametros } from '../api/hooks.js';
import EditorParametro from '../componentes/EditorParametro.jsx';
import GraficoDescuentos from '../componentes/GraficoDescuentos.jsx';
import Modal from '../componentes/Modal.jsx';
import { formatearFecha } from '../util/formato.js';

function Historial({ clave, visible }) {
  const { data, isPending } = useHistorialParametro(clave, visible);
  if (!visible) return null;
  if (isPending) return <p className="pista">Cargando historial…</p>;
  if (!data?.historial?.length) return <p className="pista">Sin cambios registrados todavía.</p>;
  return (
    <ul className="historial">
      {data.historial.map((h) => (
        <li key={h.HistorialId}>
          {formatearFecha(h.Fecha)} — {h.Usuario}: <span className="num">{h.ValorAnterior}</span> →{' '}
          <span className="num">{h.ValorNuevo}</span>
          {h.Motivo && <> · “{h.Motivo}”</>}
        </li>
      ))}
    </ul>
  );
}

export default function PantallaParametros() {
  const { data: porModulo, isPending, isError, error, refetch } = useParametros();
  const [seleccionado, setSeleccionado] = useState(null);
  const [historialDe, setHistorialDe] = useState(null);

  if (isPending) return <p>Cargando parametros…</p>;
  if (isError) {
    return (
      <p className="error" role="alert">
        No se pudieron cargar los parametros: {error.mensaje ?? error.message}{' '}
        <button type="button" className="boton boton--fantasma boton--chico" onClick={() => refetch()}>
          Reintentar
        </button>
      </p>
    );
  }

  return (
    <section>
      <h2 style={{ marginBottom: 16 }}>Parámetros de negocio</h2>

      <GraficoDescuentos parametrosFidelizacion={porModulo.FIDELIZACION} />

      {Object.entries(porModulo).map(([modulo, parametros]) => (
        <div className="tarjeta" key={modulo}>
          <div className="tarjeta__encabezado">
            <span className="etiqueta">Módulo</span>
            <h3>{modulo}</h3>
          </div>
          <div className="tabla-contenedor">
            <table className="tabla" aria-label={`Parametros del modulo ${modulo}`}>
              <thead>
                <tr>
                  <th>Parámetro</th>
                  <th>Valor vigente</th>
                  <th>Último cambio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {parametros.map((p) => (
                  <tr key={p.Clave}>
                    <td>
                      <strong>{p.Clave}</strong>
                      <br />
                      <small>{p.Descripcion}</small>
                    </td>
                    <td className="num">{p.ValorNumerico}</td>
                    <td>
                      <small>
                        {p.ActualizadoPor}
                        <br />
                        {formatearFecha(p.FechaActualizacion)}
                      </small>
                    </td>
                    <td>
                      <div className="form-inline" style={{ marginTop: 0 }}>
                        <button
                          type="button"
                          className="boton boton--primario boton--chico"
                          onClick={() => setSeleccionado(p)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="boton boton--fantasma boton--chico"
                          onClick={() =>
                            setHistorialDe(historialDe === p.Clave ? null : p.Clave)
                          }
                        >
                          {historialDe === p.Clave ? 'Ocultar historial' : 'Ver historial'}
                        </button>
                      </div>
                      <Historial clave={p.Clave} visible={historialDe === p.Clave} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {seleccionado && (
        <Modal titulo={`Editar ${seleccionado.Clave}`} onCerrar={() => setSeleccionado(null)}>
          {/* key: cambiar de parametro remonta el editor y limpia todo su estado */}
          <EditorParametro
            key={seleccionado.Clave}
            parametro={seleccionado}
            onGuardado={() => setSeleccionado(null)}
            onCerrar={() => setSeleccionado(null)}
          />
        </Modal>
      )}
    </section>
  );
}
