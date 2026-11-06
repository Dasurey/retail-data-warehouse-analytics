import { useState } from 'react';
import { useAlertas } from '../api/hooks.js';
import AccionesAlerta from '../componentes/AccionesAlerta.jsx';
import EstadoPipeline from '../componentes/EstadoPipeline.jsx';
import GestionCanales from '../componentes/GestionCanales.jsx';
import ResumenAlertas from '../componentes/ResumenAlertas.jsx';
import { formatearMes, formatearPlata } from '../util/formato.js';

const ESTADOS = ['NUEVA', 'EN_REVISION', 'RESUELTA', 'DESCARTADA'];
const SLA_DIAS = 7;

function ChipEstado({ estado }) {
  return <span className={`chip chip--${estado}`}>{estado.replace('_', ' ')}</span>;
}

export default function BandejaAlertas() {
  const [filtros, setFiltros] = useState({
    estado: undefined,
    orden: 'ventaPerdida',
    pagina: 1,
    tamanio: 20,
  });

  const { data, isPending, isError, error, isFetching, refetch } = useAlertas(filtros);

  const cambiarFiltro = (parche) =>
    setFiltros((previos) => ({ ...previos, ...parche, pagina: parche.pagina ?? 1 }));

  if (isPending) return <p>Cargando alertas…</p>;
  if (isError) {
    return (
      <p className="error" role="alert">
        No se pudo cargar la bandeja: {error.mensaje ?? error.message}{' '}
        <button type="button" className="boton boton--fantasma boton--chico" onClick={() => refetch()}>
          Reintentar
        </button>
      </p>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(data.total / filtros.tamanio));

  return (
    <section>
      <h2 style={{ marginBottom: 16 }}>Bandeja de alertas de quiebre</h2>

      <div className="fila-tarjetas">
        <ResumenAlertas />
        <GestionCanales />
        <EstadoPipeline />
      </div>

      <div className="tarjeta">
        <div className="barra-herramientas" role="group" aria-label="Filtrar por estado">
          <button
            type="button"
            className="boton boton--fantasma boton--chico filtro"
            onClick={() => cambiarFiltro({ estado: undefined })}
            disabled={!filtros.estado}
          >
            Todas ({data.total})
          </button>
          {ESTADOS.map((estado) => (
            <button
              key={estado}
              type="button"
              className="boton boton--fantasma boton--chico filtro"
              onClick={() => cambiarFiltro({ estado })}
              disabled={filtros.estado === estado}
            >
              {estado.replace('_', ' ')}
            </button>
          ))}
          <span className="espaciador" />
          <label className="pista">
            Ordenar por{' '}
            <select
              value={filtros.orden}
              onChange={(e) => cambiarFiltro({ orden: e.target.value })}
            >
              <option value="ventaPerdida">Mayor venta perdida</option>
              <option value="antiguedad">Mas antiguas primero</option>
              <option value="reciente">Mas recientes primero</option>
            </select>
          </label>
          {isFetching && <em className="actualizando" aria-live="polite">actualizando…</em>}
        </div>

        {data.alertas.length === 0 ? (
          <p className="vacio">
            No hay alertas con estos filtros. Proba con “Todas” o espera la
            proxima corrida del pipeline.
          </p>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Sucursal</th>
                  <th>Racha</th>
                  <th>Venta perdida</th>
                  <th>Estado</th>
                  <th>Responsable</th>
                  <th>Días abierta</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.alertas.map((a) => (
                  <tr key={a.AlertaId} style={a._optimista ? { opacity: 0.55 } : undefined}>
                    <td>
                      {a.ProductoNombre ?? a.ProductoCodigo}
                      <br />
                      <small className="num">{a.ProductoCodigo}</small>
                    </td>
                    <td>{a.SucursalNombre}</td>
                    <td>
                      <span className="num">
                        {formatearMes(a.MesInicio)} → {formatearMes(a.MesFin)}
                      </span>
                      <br />
                      <small>{a.SnapshotsEnQuiebre} meses</small>
                    </td>
                    <td className="num">{formatearPlata(a.VentaPerdidaEstimada)}</td>
                    <td>
                      <ChipEstado estado={a.Estado} />
                    </td>
                    <td>{a.AsignadoA ?? '—'}</td>
                    <td className="num">
                      {a.DiasAbierta}
                      {a.Estado !== 'RESUELTA' && a.Estado !== 'DESCARTADA' &&
                        a.DiasAbierta > SLA_DIAS && (
                          <>
                            {' '}
                            <span className="chip chip--sla">SLA vencido</span>
                          </>
                        )}
                    </td>
                    <td>
                      <AccionesAlerta alerta={a} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <nav className="paginacion" aria-label="Paginacion">
          <button
            type="button"
            className="boton boton--fantasma boton--chico"
            onClick={() => cambiarFiltro({ pagina: filtros.pagina - 1 })}
            disabled={filtros.pagina <= 1}
          >
            ← Anterior
          </button>
          <span>
            Página {filtros.pagina} de {totalPaginas}
          </span>
          <button
            type="button"
            className="boton boton--fantasma boton--chico"
            onClick={() => cambiarFiltro({ pagina: filtros.pagina + 1 })}
            disabled={filtros.pagina >= totalPaginas}
          >
            Siguiente →
          </button>
        </nav>
      </div>
    </section>
  );
}
