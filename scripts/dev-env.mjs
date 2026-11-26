// Entorno de desarrollo para las herramientas que escriben fuera del repositorio (Astro y Wrangler).
// Las redirige a una carpeta de estado en D:, junto al repositorio, para que no ensucien C: ni el árbol de git.
// Es una función pura: no toca el disco salvo para preguntar si existe ~/.wrangler (y eso se puede inyectar).

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {object} opciones
 * @param {Record<string, string | undefined>} opciones.env Entorno de partida (no se modifica).
 * @param {NodeJS.Platform} opciones.platform Plataforma, para elegir el separador de rutas.
 * @param {string} opciones.repoRoot Raíz del repositorio.
 * @param {(ruta: string) => boolean} [opciones.exists] Pregunta si una ruta existe (para probar sin disco).
 * @returns {{ env: Record<string, string | undefined>, dirs: { state: string, config: string, logs: string, tmp: string }, warnings: string[] }}
 */
export function buildDevEnv({ env, platform, repoRoot, exists = existsSync }) {
  const ruta = platform === 'win32' ? path.win32 : path.posix;
  const state = env.TIENDA_DEV_STATE || ruta.join(repoRoot, '..', '.dev-state', 'tienda-live');
  const dirs = {
    state,
    config: ruta.join(state, 'config'),
    logs: ruta.join(state, 'logs'),
    tmp: ruta.join(state, 'tmp'),
  };

  const salida = {
    ...env,
    // Configuración global de Wrangler (en Windows, por defecto, %APPDATA%\xdg.config\.wrangler)
    XDG_CONFIG_HOME: dirs.config,
    WRANGLER_LOG_PATH: dirs.logs,
    // Miniflare y otras herramientas usan la carpeta temporal del sistema
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
    TMPDIR: dirs.tmp,
    // Sin telemetría ni consultas de red que no hacen falta. Astro, con esto, no escribe en %APPDATA%\astro.
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    ASTRO_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false',
  };

  const warnings = [];
  const home = env.USERPROFILE || env.HOME;
  if (home) {
    const wranglerHome = ruta.join(home, '.wrangler');
    if (exists(wranglerHome)) {
      warnings.push(
        `existe ${wranglerHome}: Wrangler lo usa en lugar de XDG_CONFIG_HOME, así que su configuración global ` +
          'no queda en la carpeta de estado. Mové o borrá esa carpeta si no la necesitás.',
      );
    }
  }

  return { env: salida, dirs, warnings };
}
