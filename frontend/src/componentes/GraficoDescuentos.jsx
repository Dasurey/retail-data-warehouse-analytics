import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

const SEGMENTOS = [
  { clave: 'DESCUENTO_PREMIUM', segmento: 'Premium', color: '#0e6b4e' },
  { clave: 'DESCUENTO_FRECUENTE', segmento: 'Frecuente', color: '#2f9c77' },
  { clave: 'DESCUENTO_OCASIONAL', segmento: 'Ocasional', color: '#79c3a8' },
];

/**
 * Lee los % de descuento desde los parámetros VIVOS del panel: editar
 * DESCUENTO_PREMIUM y guardar actualiza este gráfico solo (la mutación
 * invalida la query de parámetros).
 */
export default function GraficoDescuentos({ parametrosFidelizacion }) {
  const porClave = Object.fromEntries(
    (parametrosFidelizacion ?? []).map((p) => [p.Clave, Number(p.ValorNumerico)])
  );
  const datos = SEGMENTOS.filter((s) => porClave[s.clave] != null).map((s) => ({
    ...s,
    pct: porClave[s.clave],
  }));

  if (datos.length === 0) return null;

  return (
    <div className="tarjeta">
      <div className="tarjeta__encabezado">
        <span className="etiqueta">Campaña de retención</span>
        <h3>Descuento del cupón por segmento (%)</h3>
      </div>
      <div className="grafico">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 18, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3e8e6" vertical={false} />
            <XAxis
              dataKey="segmento"
              tickLine={false}
              axisLine={{ stroke: '#e3e8e6' }}
              tick={{ fontSize: 12, fill: '#5c6b66' }}
            />
            <YAxis
              domain={[0, 30]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#8b9793' }}
            />
            <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={64}>
              <LabelList
                dataKey="pct"
                position="top"
                formatter={(v) => `${v}%`}
                style={{ fontSize: 12, fontWeight: 600, fill: '#152420' }}
              />
              {datos.map((d) => (
                <Cell key={d.segmento} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="pista">
        Valores en vivo desde los parámetros: editá un descuento y el gráfico se actualiza.
      </p>
    </div>
  );
}
