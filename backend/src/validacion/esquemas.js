import { z } from 'zod';

/**
 * Rango valido [min, max] por parametro. Doble proposito:
 *  - whitelist de claves editables/simulables (todo lo demas se rechaza)
 *  - validacion de negocio en PUT y en /simular
 */
export const RANGOS = {
  INFLACION_MENSUAL_ESPERADA: [0, 0.5],
  MIN_SNAPSHOTS_QUIEBRE: [1, 12],
  UMBRAL_VENTA_PERDIDA: [0, 1_000_000_000],
  TOP_N_QUIEBRES: [1, 100],
  MIN_VISITAS_FUGA: [1, 100],
  DIAS_PISO_FUGA: [1, 365],
  MULTIPLICADOR_FRECUENCIA: [0.5, 10],
  UMBRAL_GASTO_ALTO_VALOR: [0, 1_000_000_000],
  DESCUENTO_PREMIUM: [1, 90],
  DESCUENTO_FRECUENTE: [1, 90],
  DESCUENTO_OCASIONAL: [1, 90],
  COOLDOWN_CONTACTO_DIAS: [0, 365],
};

export const clavesParametro = z.enum(Object.keys(RANGOS));

export const cuerpoActualizarParametro = z.object({
  valor: z.number().finite(),
  motivo: z.string().trim().min(5, 'El motivo es obligatorio (minimo 5 caracteres)').max(300),
});

export const cuerpoSimulacion = z.object({
  clave: clavesParametro,
  valorPropuesto: z.number().finite(),
});

export const consultaParametros = z.object({
  modulo: z.enum(['COMERCIAL', 'SUPPLY', 'FIDELIZACION', 'GENERAL']).optional(),
});

export const ESTADOS_ALERTA = ['NUEVA', 'EN_REVISION', 'RESUELTA', 'DESCARTADA'];

export const cuerpoCambioEstado = z.object({
  estado: z.enum(['EN_REVISION', 'RESUELTA', 'DESCARTADA']),
  nota: z.string().trim().max(500).optional(),
  asignadoA: z.string().trim().max(100).optional(),
});

export const cuerpoCambioLote = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  estado: z.enum(['EN_REVISION', 'RESUELTA', 'DESCARTADA']),
  nota: z.string().trim().max(500).optional(),
  asignadoA: z.string().trim().max(100).optional(),
});

export const consultaAlertas = z.object({
  estado: z.enum(ESTADOS_ALERTA).optional(),
  sucursalKey: z.coerce.number().int().positive().optional(),
  asignadoA: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  tamanio: z.coerce.number().int().min(1).max(100).default(20),
  orden: z.enum(['ventaPerdida', 'antiguedad', 'reciente']).default('ventaPerdida'),
});

/* ----------------------- Canales y enrutamiento ----------------------- */

export const cuerpoCanal = z
  .object({
    nombre: z.string().trim().min(2).max(60),
    tipo: z.enum(['slack', 'teams', 'email', 'sms']),
    destino: z.string().trim().min(5).max(400),
    activo: z.boolean().optional(),
  })
  .superRefine((datos, contexto) => {
    if (datos.tipo === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(datos.destino)) {
        contexto.addIssue({ code: 'custom', path: ['destino'], message: 'Email invalido' });
      }
    } else if (datos.tipo === 'sms') {
      if (!/^[\d\s()+-]{6,20}$/.test(datos.destino)) {
        contexto.addIssue({ code: 'custom', path: ['destino'], message: 'Telefono invalido' });
      }
    } else if (!datos.destino.startsWith('https://')) {
      contexto.addIssue({
        code: 'custom',
        path: ['destino'],
        message: 'El webhook debe ser una URL https://',
      });
    }
  });

export const cuerpoActualizarCanal = z
  .object({
    nombre: z.string().trim().min(2).max(60).optional(),
    activo: z.boolean().optional(),
    destino: z.string().trim().min(5).max(400).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nada para actualizar' });

export const cuerpoRegla = z.object({
  condRegion: z.string().trim().max(40).optional(),
  condCategoria: z.string().trim().max(50).optional(),
  ventaPerdidaMin: z.number().nonnegative().optional(),
  canalId: z.number().int().positive(),
});

export const cuerpoOrdenReglas = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

export const cuerpoResolverRuta = z.object({
  region: z.string().trim().max(40).optional(),
  categoria: z.string().trim().max(50).optional(),
  ventaPerdida: z.number().nonnegative(),
});

/* ----------------------------- Campanias ----------------------------- */

export const cuerpoCampania = z.object({
  excluirClienteKeys: z.array(z.number().int().positive()).max(500).optional(),
  nota: z.string().trim().max(300).optional(),
});

/* ------------------------------- Auth ------------------------------- */

export const cuerpoLogin = z.object({
  usuario: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(100),
});
