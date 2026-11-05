// @ts-check
// Verificación de Cloudflare Turnstile en el servidor (WL-3). Se manda { secret, response } por POST a siteverify.
// NO se manda `remoteip`: la API no sabe ni guarda la IP de nadie (WL-12).
//
// Resultados:
//   { ok: true }                      Cloudflare dijo success:true (y, fuera de localhost, hostname y acción coinciden)
//   { ok: false, reason: 'rechazado' }     el token es falso, vencido o ya usado: la persona puede reintentar
//   { ok: false, reason: 'no_disponible' } no se pudo preguntar (sin secreto, red caída, tiempo agotado, respuesta rara)
//                                          o Cloudflare dice que el problema es NUESTRO (secreto malo, mal pedido, falla
//                                          interna): ver CODIGOS_NUESTROS. Ese caso deja una línea en el registro.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TIEMPO_MAXIMO_MS = 5000;

/**
 * `error-codes` de siteverify que no son culpa de la persona: el secreto falta o es inválido, el pedido está mal
 * armado o falla Cloudflare. Los demás (`missing-input-response`, `invalid-input-response`, `timeout-or-duplicate`) y
 * cualquier código desconocido son del visitante: se rechaza y no se registra nada.
 */
export const CODIGOS_NUESTROS = Object.freeze([
  'missing-input-secret',
  'invalid-input-secret',
  'bad-request',
  'internal-error',
]);

/** @type {import('../ports.js').TurnstileResult} */
const RECHAZADO = { ok: false, reason: 'rechazado' };
/** @type {import('../ports.js').TurnstileResult} */
const NO_DISPONIBLE = { ok: false, reason: 'no_disponible' };

/**
 * Los códigos nuestros que trae la respuesta, sin repetir y en el orden en que llegaron. Nunca devuelve texto que no
 * esté en la lista cerrada, así que lo registrado no puede arrastrar nada que Cloudflare haya escrito.
 * @param {unknown} codigos
 * @returns {string[]}
 */
function codigosNuestros(codigos) {
  if (!Array.isArray(codigos)) return [];
  return [...new Set(codigos.filter((c) => CODIGOS_NUESTROS.includes(c)))];
}

/**
 * @param {import('../ports.js').AppConfig['turnstile']} config
 * @param {{ fetch?: typeof fetch, timeoutMs?: number, logger?: import('../ports.js').Logger }} [opciones]
 *   Para las pruebas: fetch falso y otro tiempo máximo. `logger`: donde se avisa que el secreto o el pedido están mal.
 * @returns {import('../ports.js').TurnstileVerifier}
 */
export function createTurnstileVerifier(
  config,
  { fetch: llamar = globalThis.fetch, timeoutMs = TIEMPO_MAXIMO_MS, logger } = {},
) {
  return {
    async verify(token) {
      if (config.secret.trim() === '') return NO_DISPONIBLE;
      try {
        const respuesta = await llamar(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: config.secret, response: token }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!respuesta.ok) return NO_DISPONIBLE;
        const cuerpo = await respuesta.json();
        if (typeof cuerpo !== 'object' || cuerpo === null || typeof cuerpo.success !== 'boolean') return NO_DISPONIBLE;
        if (!cuerpo.success) {
          // Un secreto mal puesto no es "la persona falló la verificación": se avisa al dueño y la persona ve un 503.
          const nuestros = codigosNuestros(cuerpo['error-codes']);
          if (nuestros.length === 0) return RECHAZADO;
          logger?.error('turnstile.config', { codigo: nuestros.join(',') });
          return NO_DISPONIBLE;
        }
        // Fuera de localhost, el token debe haberse emitido para este sitio y para este formulario.
        if (config.expectedHostname !== null) {
          if (cuerpo.hostname !== config.expectedHostname || cuerpo.action !== config.expectedAction) return RECHAZADO;
        }
        return { ok: true };
      } catch {
        return NO_DISPONIBLE;
      }
    },
  };
}
