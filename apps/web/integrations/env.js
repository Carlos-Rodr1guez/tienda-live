// Sin `// @ts-check`: usa módulos de Node y la web no tiene @types/node (no se suman dependencias), igual que los scripts.
// Entorno de construcción de la web: UNA sola fuente para la configuración, las integraciones y el cliente.
//
// - Astro NO vuelca el `.env` en `process.env` mientras carga astro.config.mjs y las integraciones, pero el código del
//   navegador sí lo ve por `import.meta.env`. Para que los tres lean lo mismo, aquí se usa `loadEnv` de Vite (la
//   dependencia de Astro, que no se agrega al package.json): lee el `.env` del proyecto y el entorno real del proceso
//   gana sobre el archivo, igual que en `import.meta.env`.
// - Una construcción (`astro build`) EXIGE `SITE_URL` y `PUBLIC_TURNSTILE_SITE_KEY` puestos de forma explícita. Sin la
//   guarda, faltar una dejaba `localhost` en las URL canónicas, Open Graph, sitemap y robots, y la clave de PRUEBA de
//   Turnstile en el formulario: cada alta real fallaba. `astro dev` conserva sus valores locales por defecto.

import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

/**
 * Lee las variables del proyecto: `.env` (y sus variantes por modo) con el entorno del proceso por encima.
 * @param {{ mode: string, root: string, cargar?: (modo: string, raiz: string, prefijos: string) => Record<string, string> }} opciones
 * @returns {Record<string, string>}
 */
export function readEnv({ mode, root, cargar = loadEnv }) {
  return cargar(mode, root, '');
}

/** Fin de la ayuda que acompaña a cada error: dónde se definen las variables. */
const DONDE =
  'Defínela en el entorno de la construcción o en apps/web/.env (para la vista previa local, `npm run preview` la pone sola).';

/** Origen local que Astro usa como `site` cuando SITE_URL no sirve (solo desarrollo; una construcción lo rechaza antes). */
export const SITE_LOCAL_POR_DEFECTO = 'http://localhost:8790';

/**
 * El origen de un SITE_URL válido (http o https absoluto, sin ruta, parámetros ni credenciales), o null.
 * @param {string} crudo Ya recortado.
 * @returns {string | null}
 */
function origenValido(crudo) {
  const url = URL.canParse(crudo) ? new URL(crudo) : null;
  const esOrigen =
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  return url && esOrigen ? url.origin : null;
}

/**
 * El `site` que se le entrega a Astro: SITE_URL solo si pasa las mismas reglas que `checkBuildEnv`; si no, el origen
 * local. Así un valor mal formado (`ejemplo.com`) no llega al esquema de Astro, que fallaría con un error genérico antes
 * de que la guarda (`buildEnvGuard`) pueda nombrar la variable en español. Pura.
 * @param {string | undefined} siteUrl
 * @returns {string}
 */
export function siteParaAstro(siteUrl) {
  return origenValido((siteUrl ?? '').trim()) ?? SITE_LOCAL_POR_DEFECTO;
}

/**
 * Comprueba las variables que una construcción necesita. Pura: no lee el disco ni el proceso.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, site: string, siteKey: string } | { ok: false, errores: string[] }}
 */
export function checkBuildEnv(env) {
  /** @type {string[]} */
  const errores = [];

  const crudo = (env.SITE_URL ?? '').trim();
  let site = '';
  if (crudo === '') {
    errores.push(`Falta SITE_URL: es el origen público del sitio (por ejemplo https://ejemplo.com). ${DONDE}`);
  } else {
    const origen = origenValido(crudo);
    if (origen !== null) site = origen;
    else {
      errores.push(
        `SITE_URL no es válida ("${crudo}"): tiene que ser un origen http o https absoluto, sin ruta, parámetros ni credenciales (por ejemplo https://ejemplo.com).`,
      );
    }
  }

  const siteKey = (env.PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
  if (siteKey === '') {
    errores.push(
      `Falta PUBLIC_TURNSTILE_SITE_KEY: es la clave pública de Turnstile. Sin ella el formulario usaría la clave de PRUEBA y ningún alta real se podría verificar. ${DONDE}`,
    );
  }

  return errores.length === 0 ? { ok: true, site, siteKey } : { ok: false, errores };
}

/**
 * Como `checkBuildEnv`, pero lanza un error en español que nombra cada variable que falta o está mal.
 * @param {Record<string, string | undefined>} env
 * @returns {{ site: string, siteKey: string }}
 */
export function assertBuildEnv(env) {
  const r = checkBuildEnv(env);
  if (r.ok) return { site: r.site, siteKey: r.siteKey };
  throw new Error(`No se puede hacer la construcción de la web:\n- ${r.errores.join('\n- ')}`);
}

/**
 * Integración de Astro: al construir comprueba las variables y fija `site` con el valor ya validado. En `astro dev`,
 * `astro sync` y `astro preview` no exige nada.
 * @returns {import('astro').AstroIntegration}
 */
export function buildEnvGuard() {
  return {
    name: 'entorno-de-construccion',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig }) => {
        if (command !== 'build') return;
        const env = readEnv({ mode: 'production', root: fileURLToPath(config.root) });
        updateConfig({ site: assertBuildEnv(env).site });
      },
    },
  };
}
