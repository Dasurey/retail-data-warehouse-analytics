import { consultar, sql } from '../db.js';
import { ErrorApi } from '../middleware/errores.js';
import { RANGOS } from '../validacion/esquemas.js';

/* =====================================================================
   Simulador de impacto: responde "que pasa si cambio este parametro"
   ejecutando las TVFs con el valor propuesto, SIN persistir nada.
   ===================================================================== */

const CLAVES_FUGA = [
  'MIN_VISITAS_FUGA',
  'DIAS_PISO_FUGA',
  'MULTIPLICADOR_FRECUENCIA',
  'UMBRAL_GASTO_ALTO_VALOR',
];
const CLAVES_QUIEBRE = ['MIN_SNAPSHOTS_QUIEBRE', 'UMBRAL_VENTA_PERDIDA', 'TOP_N_QUIEBRES'];

export async function leerParametrosVigentes() {
  const r = await consultar(
    `SELECT Clave, ValorNumerico FROM app.ConfigParametro WHERE Tipo = 'NUMERICO'`
  );
  return Object.fromEntries(r.recordset.map((f) => [f.Clave, Number(f.ValorNumerico)]));
}

/* La fecha de corte es el ultimo dia con ventas: en un DW vivo equivale
   a "hoy" y hace la simulacion reproducible sobre datos historicos. */
const DECLARAR_CORTE = `
DECLARE @Corte DATE =
  (SELECT CONVERT(date, CONVERT(char(8), MAX(TiempoKey)), 112) FROM dbo.FactVentas);`;

async function simularFuga(parametros) {
  const agregado = `
    SELECT COUNT(*) AS Fugados,
           SUM(CASE WHEN GastoTotal >= @umbralGasto{S} THEN 1 ELSE 0 END) AS AltoValor,
           ISNULL(SUM(CASE WHEN GastoTotal >= @umbralGasto{S} THEN GastoTotal END), 0) AS IngresoEnRiesgo
    FROM dbo.fn_ClientesFugados(@Corte, @minVisitas{S}, @diasPiso{S}, @mult{S});`;

  const r = await consultar(
    DECLARAR_CORTE + agregado.replaceAll('{S}', 'A') + agregado.replaceAll('{S}', 'P'),
    {
      minVisitasA: { tipo: sql.Int, valor: parametros.actual.MIN_VISITAS_FUGA },
      diasPisoA: { tipo: sql.Int, valor: parametros.actual.DIAS_PISO_FUGA },
      multA: { tipo: sql.Decimal(4, 1), valor: parametros.actual.MULTIPLICADOR_FRECUENCIA },
      umbralGastoA: { tipo: sql.Decimal(18, 2), valor: parametros.actual.UMBRAL_GASTO_ALTO_VALOR },
      minVisitasP: { tipo: sql.Int, valor: parametros.propuesto.MIN_VISITAS_FUGA },
      diasPisoP: { tipo: sql.Int, valor: parametros.propuesto.DIAS_PISO_FUGA },
      multP: { tipo: sql.Decimal(4, 1), valor: parametros.propuesto.MULTIPLICADOR_FRECUENCIA },
      umbralGastoP: { tipo: sql.Decimal(18, 2), valor: parametros.propuesto.UMBRAL_GASTO_ALTO_VALOR },
    }
  );
  const [actual, propuesto] = [r.recordsets[0][0], r.recordsets[1][0]];
  const forma = (x) => ({
    clientesFugados: x.Fugados,
    clientesAltoValor: x.AltoValor ?? 0,
    ingresoEnRiesgo: Number(x.IngresoEnRiesgo),
  });
  return { actual: forma(actual), propuesto: forma(propuesto) };
}

async function simularQuiebres(parametros) {
  const agregado = `
    SELECT COUNT(*) AS Rachas,
           SUM(CASE WHEN VentaPerdidaEstimada >= @umbral{S} THEN 1 ELSE 0 END) AS AlertasCriticas,
           ISNULL(SUM(CASE WHEN VentaPerdidaEstimada >= @umbral{S} THEN VentaPerdidaEstimada END), 0) AS VentaPerdidaCritica
    FROM dbo.fn_QuiebresPersistentes(@minSnap{S});`;

  const r = await consultar(
    agregado.replaceAll('{S}', 'A') + agregado.replaceAll('{S}', 'P'),
    {
      minSnapA: { tipo: sql.Int, valor: parametros.actual.MIN_SNAPSHOTS_QUIEBRE },
      umbralA: { tipo: sql.Decimal(18, 2), valor: parametros.actual.UMBRAL_VENTA_PERDIDA },
      minSnapP: { tipo: sql.Int, valor: parametros.propuesto.MIN_SNAPSHOTS_QUIEBRE },
      umbralP: { tipo: sql.Decimal(18, 2), valor: parametros.propuesto.UMBRAL_VENTA_PERDIDA },
    }
  );
  const topNA = parametros.actual.TOP_N_QUIEBRES;
  const topNP = parametros.propuesto.TOP_N_QUIEBRES;
  const forma = (x, topN) => ({
    rachasDetectadas: x.Rachas,
    alertasCriticas: x.AlertasCriticas ?? 0,
    ventaPerdidaEnAlerta: Number(x.VentaPerdidaCritica),
    filasEnReporte: Math.min(topN, x.Rachas),
  });
  return {
    actual: forma(r.recordsets[0][0], topNA),
    propuesto: forma(r.recordsets[1][0], topNP),
  };
}

async function simularInflacion(tasaActual, tasaPropuesta) {
  const r = await consultar(
    `
    WITH m AS (
        SELECT t.Anio, t.Anio * 12 + t.Mes AS MesIdx, SUM(f.ImporteNeto) AS V
        FROM dbo.FactVentas f
        JOIN dbo.DimTiempo t ON t.TiempoKey = f.TiempoKey
        GROUP BY t.Anio, t.Anio * 12 + t.Mes
    ),
    c AS (SELECT MAX(MesIdx) AS Corte FROM m)
    SELECT m.Anio,
           SUM(m.V) AS Nominal,
           SUM(m.V * POWER(1e0 + @tasaActual,    c.Corte - m.MesIdx)) AS ConstanteActual,
           SUM(m.V * POWER(1e0 + @tasaPropuesta, c.Corte - m.MesIdx)) AS ConstantePropuesta
    FROM m CROSS JOIN c
    GROUP BY m.Anio
    ORDER BY m.Anio;`,
    {
      tasaActual: { tipo: sql.Float, valor: tasaActual },
      tasaPropuesta: { tipo: sql.Float, valor: tasaPropuesta },
    }
  );
  const filas = r.recordset;
  if (filas.length < 2) {
    throw new ErrorApi(409, 'DATOS_INSUFICIENTES', 'Se necesitan al menos 2 anios cargados');
  }
  const [previo, ultimo] = filas.slice(-2);
  const variacion = (a, b) => Number((((a - b) / b) * 100).toFixed(2));
  return {
    aniosComparados: [previo.Anio, ultimo.Anio],
    varNominalPct: variacion(ultimo.Nominal, previo.Nominal),
    actual: { varRealPct: variacion(ultimo.ConstanteActual, previo.ConstanteActual) },
    propuesto: { varRealPct: variacion(ultimo.ConstantePropuesta, previo.ConstantePropuesta) },
  };
}

/**
 * Punto de entrada del endpoint POST /api/parametros/simular.
 * Ejecuta la logica real con el valor propuesto y devuelve el "antes y
 * despues" para que el administrador decida viendo consecuencias.
 */
export async function simular(clave, valorPropuesto) {
  const [min, max] = RANGOS[clave];
  if (valorPropuesto < min || valorPropuesto > max) {
    throw new ErrorApi(422, 'FUERA_DE_RANGO', `${clave} debe estar entre ${min} y ${max}`);
  }

  const vigentes = await leerParametrosVigentes();
  if (!(clave in vigentes)) {
    throw new ErrorApi(404, 'PARAMETRO_INEXISTENTE', `No existe el parametro ${clave}`);
  }
  const propuestos = { ...vigentes, [clave]: valorPropuesto };
  const base = { clave, valorActual: vigentes[clave], valorPropuesto, simulable: true };

  if (CLAVES_FUGA.includes(clave)) {
    return {
      ...base,
      impacto: await simularFuga({ actual: vigentes, propuesto: propuestos }),
    };
  }
  if (CLAVES_QUIEBRE.includes(clave)) {
    return {
      ...base,
      impacto: await simularQuiebres({ actual: vigentes, propuesto: propuestos }),
    };
  }
  if (clave === 'INFLACION_MENSUAL_ESPERADA') {
    return { ...base, impacto: await simularInflacion(vigentes[clave], valorPropuesto) };
  }
  // Claves sin simulacion cuantitativa (ej: % de descuento, cooldown):
  // el impacto es directo y no depende de recalcular las TVFs.
  return {
    ...base,
    simulable: false,
    mensaje: 'Este parametro no requiere simulacion: su efecto es directo sobre la accion.',
  };
}
