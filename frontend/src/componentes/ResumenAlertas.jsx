import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useEjecutarPipeline, useResumenAlertas } from '../api/hooks.js';

/* Mismos colores que los chips de estado: una sola semántica visual. */
const ESTADOS = [
  { estado: 'NUEVA', etiqueta: 'Nuevas', color: '#d97706' },
  { estado: 'EN_REVISION', etiqueta: 'En revisión', color: '#2563eb' },
  { estado: 'RESUELTA', etiqueta: 'Resueltas', color: '#16a34a' },
  { estado: 'DESCARTADA', etiqueta: 'Descartadas', color: '#9ca3af' },
];

export default function ResumenAlertas() {
  const { data, isPending, isError } = useResumenAlertas();
  const ejecutar = useEjecutarPipeline();

  return (
    <div className="tarjeta">
      <div className="tarjeta__encabezado">
        <span className="etiqueta">Gestión</span>
        <h3>Alertas por estado</h3>
      </div>

      {isPending && <p>Cargando resumen…</p>}
      {isError && <p className="error">No se pudo cargar el resumen.</p>}

      {data && data.total === 0 && (
        <p className="vacio">
          Sin alertas todavía. El pipeline detecta los quiebres y puebla la bandeja.
        </p>
      )}

      {data && data.total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div className="grafico" style={{ width: 150, height: 150, flex: '0 0 auto' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ESTADOS.map((e) => ({ ...e, valor: data.conteos[e.estado] }))}
                  dataKey="valor"
                  nameKey="etiqueta"
                  innerRadius={44}
                  outerRadius={70}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {ESTADOS.map((e) => (
                    <Cell key={e.estado} fill={e.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="leyenda" style={{ flex: 1 }}>
            {ESTADOS.map((e) => (
              <li key={e.estado}>
                <span className="punto" style={{ background: e.color }} />
                {e.etiqueta}
                <span className="num">{data.conteos[e.estado]}</span>
              </li>
            ))}
            <li>
              <strong>Total</strong>
              <span className="num">
                <strong>{data.total}</strong>
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
