import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';

/* =====================================================================
   Runner embebido (modo desarrollo): al encolar una corrida, la API
   lanza el MISMO orquestador Python como proceso hijo. El hijo hereda
   process.env (DW_*, CIFRADO_CLAVE), toma la solicitud de
   app.PipelineRun con su propio UPDLOCK y la cierra con metricas:
   cero logica duplicada entre Node y Python.

   En produccion: ORQUESTADOR_AUTORUN=false y la cola la consume el
   cron / SQL Agent / `orquestador_pipeline.py --watch`.
   ===================================================================== */

let hijoActivo = null;
const directorioModulo = path.dirname(fileURLToPath(import.meta.url));
const raizRepo = path.resolve(directorioModulo, '..', '..', '..');

export function lanzarOrquestador() {
  if (config.ORQUESTADOR_AUTORUN === 'false') {
    return {
      lanzado: false,
      motivo: 'Runner embebido deshabilitado: la solicitud queda para el --watch o el cron',
    };
  }
  if (hijoActivo) {
    return { lanzado: false, motivo: 'Ya hay un runner en ejecucion' };
  }

  const candidatos = config.ORQUESTADOR_SCRIPT
    ? [
        path.isAbsolute(config.ORQUESTADOR_SCRIPT)
          ? config.ORQUESTADOR_SCRIPT
          : path.resolve(raizRepo, config.ORQUESTADOR_SCRIPT),
      ]
    : [
        path.resolve(raizRepo, 'pipeline', 'orquestador_pipeline.py'),
      ];
  const script = candidatos.find((c) => existsSync(c));
  if (!script) {
    return {
      lanzado: false,
      motivo: `No encuentro orquestador_pipeline.py (probe: ${candidatos.join(' | ')}). Configura ORQUESTADOR_SCRIPT en el .env`,
    };
  }

  const python =
    config.ORQUESTADOR_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

  // --solo-cola: el hijo drena la cola y sale; si --watch o el cron ya
  // tomaron la solicitud, termina sin ejecutar nada (cero doble corrida).
  const hijo = spawn(python, [script, '--solo-cola'], {
    cwd: path.dirname(script),
    env: process.env,          // mismo .env que la API: DW_*, CIFRADO_CLAVE
    windowsHide: true,
  });
  hijoActivo = hijo;
  logger.info({ python, script, pid: hijo.pid }, 'Runner embebido: orquestador lanzado');

  // La salida del pipeline aparece en el log de la API con su origen
  const reenviar = (nivel) => (bloque) =>
    String(bloque)
      .split('\n')
      .filter(Boolean)
      .forEach((linea) => logger[nivel]({ origen: 'orquestador' }, linea));
  hijo.stdout.on('data', reenviar('info'));
  hijo.stderr.on('data', reenviar('warn'));

  hijo.on('error', (err) => {
    hijoActivo = null;
    logger.error(
      { err, python },
      'Runner embebido: no se pudo lanzar Python (revisa ORQUESTADOR_PYTHON en el .env)'
    );
  });
  hijo.on('close', (codigo) => {
    hijoActivo = null;
    logger.info({ codigo }, 'Runner embebido: orquestador finalizo');
  });

  return { lanzado: true, pid: hijo.pid };
}
