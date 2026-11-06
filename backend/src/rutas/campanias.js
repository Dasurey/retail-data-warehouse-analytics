import { Router } from 'express';
import { consultar, enTransaccion, sql } from '../db.js';
import { requiereRol } from '../middleware/auth.js';
import { ErrorApi, asincronico } from '../middleware/errores.js';
import { leerParametrosVigentes } from '../servicios/simulador.js';
import { cuerpoCampania } from '../validacion/esquemas.js';

export const rutasCampanias = Router();

/* La fecha de corte es el ultimo dia con ventas (en un DW vivo = hoy). */
const DECLARAR_CORTE = `
DECLARE @Corte DATE =
  (SELECT CONVERT(date, CONVERT(char(8), MAX(TiempoKey)), 112) FROM dbo.FactVentas);`;

function entradasFuga(p) {
  return {
    minVisitas: { tipo: sql.Int, valor: p.MIN_VISITAS_FUGA },
    diasPiso: { tipo: sql.Int, valor: p.DIAS_PISO_FUGA },
    mult: { tipo: sql.Decimal(4, 1), valor: p.MULTIPLICADOR_FRECUENCIA },
    umbralGasto: { tipo: sql.Decimal(18, 2), valor: p.UMBRAL_GASTO_ALTO_VALOR },
    cooldown: { tipo: sql.Int, valor: p.COOLDOWN_CONTACTO_DIAS },
  };
}

/* GET /api/campanias/fugados - la lista de rescate VIGENTE segun los
   parametros gobernados, con el cooldown aplicado: aca es donde
   COOLDOWN_CONTACTO_DIAS deja de ser un numero en una tabla y pasa a
   proteger a los clientes del spam. */
rutasCampanias.get(
  '/fugados',
  requiereRol('FIDELIZACION'),
  asincronico(async (_req, res) => {
    const p = await leerParametrosVigentes();
    const r = await consultar(
      DECLARAR_CORTE +
        `
      SELECT f.ClienteKey, f.NombreCompleto, f.SegmentoCliente,
             f.FechaUltimaCompra, f.DiasSinComprar, f.FrecuenciaPromedioDias,
             f.VisitasTotales, f.GastoTotal, f.RankingEnSegmento,
             CASE WHEN f.GastoTotal >= @umbralGasto THEN 1 ELSE 0 END AS AltoValor,
             uc.UltimoContacto,
             CASE WHEN uc.UltimoContacto >= DATEADD(DAY, -@cooldown, @Corte)
                  THEN 1 ELSE 0 END AS EnCooldown
      FROM dbo.fn_ClientesFugados(@Corte, @minVisitas, @diasPiso, @mult) f
      OUTER APPLY (
          SELECT MAX(a.FechaEnvio) AS UltimoContacto
          FROM app.AccionRetencion a
          WHERE a.ClienteKey = f.ClienteKey
      ) uc
      ORDER BY f.GastoTotal DESC;`,
      entradasFuga(p)
    );
    res.json({
      parametros: {
        umbralGasto: p.UMBRAL_GASTO_ALTO_VALOR,
        cooldownDias: p.COOLDOWN_CONTACTO_DIAS,
      },
      fugados: r.recordset,
    });
  })
);

/* POST /api/campanias  { excluirClienteKeys?, nota? } - dispara la
   campania en una transaccion: crea la campania e inserta un cupon por
   cada fugado de alto valor elegible (fuera de cooldown, no excluido).
   El cupon es unico y auditable: VOLVE{pct}-C{campania}K{cliente}. */
rutasCampanias.post(
  '/',
  requiereRol('FIDELIZACION'),
  asincronico(async (req, res) => {
    const { excluirClienteKeys, nota } = cuerpoCampania.parse(req.body);
    const p = await leerParametrosVigentes();

    const resultado = await enTransaccion(async (solicitud) => {
      const creada = await solicitud()
        .input('usuario', sql.NVarChar(100), req.usuario.nombre)
        .input('nota', sql.NVarChar(300), nota ?? null)
        .query(`
          INSERT INTO app.Campania (CreadaPor, Nota)
          OUTPUT inserted.CampaniaId
          VALUES (@usuario, @nota);`);
      const campaniaId = creada.recordset[0].CampaniaId;

      const req2 = solicitud()
        .input('campaniaId', sql.Int, campaniaId)
        .input('excluidos', sql.NVarChar(sql.MAX), JSON.stringify(excluirClienteKeys ?? []))
        .input('dPremium', sql.TinyInt, p.DESCUENTO_PREMIUM)
        .input('dFrecuente', sql.TinyInt, p.DESCUENTO_FRECUENTE)
        .input('dOcasional', sql.TinyInt, p.DESCUENTO_OCASIONAL);
      for (const [nombre, def] of Object.entries(entradasFuga(p))) {
        req2.input(nombre, def.tipo, def.valor);
      }

      const emitidos = await req2.query(
        DECLARAR_CORTE +
          `
        INSERT INTO app.AccionRetencion
               (ClienteKey, CuponCodigo, PctDescuento, Canal, CampaniaId)
        SELECT f.ClienteKey,
               CONCAT('VOLVE', d.Pct, '-C', @campaniaId, 'K', f.ClienteKey),
               d.Pct,
               'EMAIL',
               @campaniaId
        FROM dbo.fn_ClientesFugados(@Corte, @minVisitas, @diasPiso, @mult) f
        CROSS APPLY (SELECT CASE f.SegmentoCliente
                                 WHEN 'Premium'   THEN @dPremium
                                 WHEN 'Frecuente' THEN @dFrecuente
                                 ELSE @dOcasional END AS Pct) d
        WHERE f.GastoTotal >= @umbralGasto
          AND f.ClienteKey NOT IN (SELECT TRY_CONVERT(INT, value) FROM OPENJSON(@excluidos))
          AND NOT EXISTS (
              SELECT 1 FROM app.AccionRetencion a
              WHERE a.ClienteKey = f.ClienteKey
                AND a.FechaEnvio >= DATEADD(DAY, -@cooldown, @Corte)
          );

        UPDATE app.Campania SET TotalContactados = @@ROWCOUNT
        OUTPUT inserted.TotalContactados
        WHERE CampaniaId = @campaniaId;`
      );

      return {
        campaniaId,
        contactados: emitidos.recordset[0].TotalContactados,
      };
    });

    if (resultado.contactados === 0) {
      // Campania vacia: valida pero honesta (todos excluidos o en cooldown)
      res.status(200).json({ ...resultado, mensaje: 'Ningun cliente elegible para contactar' });
      return;
    }
    res.status(201).json(resultado);
  })
);

/* GET /api/campanias - historial con efectividad agregada */
rutasCampanias.get(
  '/',
  asincronico(async (_req, res) => {
    const r = await consultar(`
      SELECT c.CampaniaId, c.FechaCreacion, c.CreadaPor, c.Nota, c.TotalContactados,
             SUM(CASE WHEN a.Estado = 'CANJEADO'   THEN 1 ELSE 0 END) AS Canjeados,
             SUM(CASE WHEN a.Estado = 'RECOMPRADO' THEN 1 ELSE 0 END) AS Recomprados
      FROM app.Campania c
      LEFT JOIN app.AccionRetencion a ON a.CampaniaId = c.CampaniaId
      GROUP BY c.CampaniaId, c.FechaCreacion, c.CreadaPor, c.Nota, c.TotalContactados
      ORDER BY c.CampaniaId DESC;`);
    res.json({ campanias: r.recordset });
  })
);

/* GET /api/campanias/:id/seguimiento - detalle cupon por cupon */
rutasCampanias.get(
  '/:id/seguimiento',
  asincronico(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorApi(400, 'ID_INVALIDO', 'El id de campania debe ser un entero positivo');
    }
    const r = await consultar(
      `
      SELECT c.CampaniaId, c.FechaCreacion, c.CreadaPor, c.Nota, c.TotalContactados
      FROM app.Campania c
      WHERE c.CampaniaId = @id;

      SELECT a.AccionId, a.ClienteKey, cli.NombreCompleto, cli.SegmentoCliente,
             a.CuponCodigo, a.PctDescuento, a.Canal, a.Estado,
             a.FechaEnvio, a.FechaCanje
      FROM app.AccionRetencion a
      JOIN dbo.DimCliente cli ON cli.ClienteKey = a.ClienteKey
      WHERE a.CampaniaId = @id
      ORDER BY a.PctDescuento DESC, cli.NombreCompleto;`,
      { id: { tipo: sql.Int, valor: id } }
    );
    if (r.recordsets[0].length === 0) {
      throw new ErrorApi(404, 'CAMPANIA_INEXISTENTE', `No existe la campania ${id}`);
    }
    res.json({ campania: r.recordsets[0][0], acciones: r.recordsets[1] });
  })
);
