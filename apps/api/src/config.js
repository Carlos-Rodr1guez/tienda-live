// @ts-check
// Lee las variables del entorno del Worker y devuelve una configuración congelada.
//
// En producción la configuración FALLA CERRADA: si SITE_URL falta o no es un origen https público, `problems` trae el
// motivo ('site_url') y la tubería responde 503 a todo /v1 (ver http/pipeline.js). Antes caía en localhost, lo que
// dejaba los orígenes, los enlaces del correo y la comprobación de hostname de Turnstile apuntando a un sitio falso.
// En desarrollo se conservan los valores por defecto locales.

import { BRAND } from '@tienda/contracts/brand';

/** Orígenes locales que se suman en desarrollo: la web (Astro, 4400) y la API con su propia web (8790). */
const ORIGENES_LOCALES = ['http://localhost:4400', 'http://localhost:8790'];
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);
const ACCION_TURNSTILE = 'waitlist';

/** Claves secretas de PRUEBA publicadas por Cloudflare (siempre pasa, siempre falla, token ya usado). */
const SECRETOS_DE_PRUEBA = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

/**
 * El origen de una URL http(s), o null si no lo es.
 * @param {unknown} valor
 */
function origenDe(valor) {
  if (typeof valor !== 'string') return null;
  try {
    const url = new URL(valor.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Un origen https cuyo host no es local: lo único que vale como SITE_URL en producción.
 * @param {string | null} origen
 */
function esOrigenPublicoHttps(origen) {
  if (origen === null) return false;
  const url = new URL(origen);
  return url.protocol === 'https:' && !HOSTS_LOCALES.has(url.hostname);
}

/**
 * @param {Record<string, unknown>} env Variables y secretos del Worker (`env` de wrangler).
 * @returns {import('./ports.js').AppConfig}
 */
export function readConfig(env) {
  // Solo "development" a propósito: cualquier otro valor, o ninguno, es producción.
  const environment = env.ENVIRONMENT === 'development' ? 'development' : 'production';
  const esProduccion = environment === 'production';
  const origen = origenDe(env.SITE_URL);

  /** @type {string[]} */
  const problems = [];
  /** @type {string} */
  let siteUrl;
  if (esProduccion) {
    if (esOrigenPublicoHttps(origen)) siteUrl = /** @type {string} */ (origen);
    else {
      problems.push('site_url');
      siteUrl = '';
    }
  } else {
    siteUrl = origen ?? origenDe(BRAND.siteUrlDefault) ?? BRAND.siteUrlDefault;
  }

  const origenes = esProduccion ? (siteUrl === '' ? [] : [siteUrl]) : [siteUrl, ...ORIGENES_LOCALES];
  const hostname = siteUrl === '' ? '' : new URL(siteUrl).hostname;

  // Sin sitio válido, o con una clave de prueba en producción, es como si no hubiera secreto: Turnstile no está
  // disponible (503) en vez de aceptar a cualquiera.
  // Se guarda recortado: un salto de línea final (típico al pegar el secreto) no debe llegar a siteverify.
  const secreto = typeof env.TURNSTILE_SECRET_KEY === 'string' ? env.TURNSTILE_SECRET_KEY.trim() : '';
  const secretoInutil = problems.length > 0 || (esProduccion && SECRETOS_DE_PRUEBA.has(secreto));

  return Object.freeze({
    environment,
    siteUrl,
    allowedOrigins: Object.freeze([...new Set(origenes)]),
    problems: Object.freeze(problems),
    turnstile: Object.freeze({
      secret: secretoInutil ? '' : secreto,
      expectedHostname: hostname === '' || HOSTS_LOCALES.has(hostname) ? null : hostname,
      expectedAction: ACCION_TURNSTILE,
    }),
  });
}
