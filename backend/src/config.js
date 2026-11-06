import { z } from 'zod';

const esquemaEnv = z.object({
  DW_SERVER: z.string().default('localhost'),
  DW_PORT: z.coerce.number().int().default(1433),
  DW_DATABASE: z.string().default('DW_Supermercado'),
  DW_USER: z.string().min(1, 'DW_USER es obligatorio (la API usa autenticacion SQL)'),
  DW_PASSWORD: z.string().min(1, 'DW_PASSWORD es obligatorio'),
  DW_TRUST_CERT: z.coerce.boolean().default(true),
  DW_ENCRYPT: z.coerce.boolean().default(true),
  DW_CONNECT_TIMEOUT_MS: z.coerce.number().int().default(15000),

  PUERTO: z.coerce.number().int().default(3001),
  CORS_ORIGEN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  CIFRADO_CLAVE: z.preprocess(
    (v) => (v === '' ? undefined : v),   // .env.example la trae vacia: vacia = no configurada
    z.string().regex(/^[0-9a-fA-F]{64}$/,
      'CIFRADO_CLAVE debe ser 64 caracteres hex (32 bytes)').optional()
  ),
  ORQUESTADOR_AUTORUN: z.string().default('true'),
  ORQUESTADOR_PYTHON: z.string().optional(),
  ORQUESTADOR_SCRIPT: z.string().optional(),
  NIVEL_LOG: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
});

const resultado = esquemaEnv.safeParse(process.env);
if (!resultado.success) {
  // Fallar rapido y con mensaje claro: una API que arranca mal configurada
  // es peor que una que no arranca.
  console.error('Configuracion invalida:');
  for (const issue of resultado.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = resultado.data;
