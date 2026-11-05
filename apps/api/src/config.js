// @ts-check
// Lee las variables del entorno del Worker y devuelve una configuración congelada.

import { BRAND } from '@tienda/contracts/brand';

/** Orígenes locales que se suman en desarrollo: la web (Astro, 4400) y la API con su propia web (8790). */
const ORIGENES_LOCALES = ['http://localhost:4400', 'http://localhost:8790'];
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);
const ACCION_TURNSTILE = 'waitlist';

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
 * @param {Record<string, unknown>} env Variables y secretos del Worker (`env` de wrangler).
 * @returns {import('./ports.js').AppConfig}
 */
export function readConfig(env) {
  // Solo "development" a propósito: cualquier otro valor, o ninguno, es producción.
  const environment = env.ENVIRONMENT === 'development' ? 'development' : 'production';
  const siteUrl = origenDe(env.SITE_URL) ?? origenDe(BRAND.siteUrlDefault) ?? BRAND.siteUrlDefault;
  const origenes = environment === 'development' ? [siteUrl, ...ORIGENES_LOCALES] : [siteUrl];
  const { hostname } = new URL(siteUrl);

  return Object.freeze({
    environment,
    siteUrl,
    allowedOrigins: Object.freeze([...new Set(origenes)]),
    turnstile: Object.freeze({
      secret: typeof env.TURNSTILE_SECRET_KEY === 'string' ? env.TURNSTILE_SECRET_KEY : '',
      expectedHostname: HOSTS_LOCALES.has(hostname) ? null : hostname,
      expectedAction: ACCION_TURNSTILE,
    }),
  });
}
