// @ts-check
// Verificación de Cloudflare Turnstile en el servidor (WL-3). Se manda { secret, response } por POST a siteverify.
// NO se manda `remoteip`: la API no sabe ni guarda la IP de nadie (WL-12).
//
// Resultados:
//   { ok: true }                      Cloudflare dijo success:true (y, fuera de localhost, hostname y acción coinciden)
//   { ok: false, reason: 'rechazado' }     el token es falso, vencido o ya usado: la persona puede reintentar
//   { ok: false, reason: 'no_disponible' } no se pudo preguntar (sin secreto, red caída, tiempo agotado, respuesta rara)

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TIEMPO_MAXIMO_MS = 5000;

/** @type {import('../ports.js').TurnstileResult} */
const RECHAZADO = { ok: false, reason: 'rechazado' };
/** @type {import('../ports.js').TurnstileResult} */
const NO_DISPONIBLE = { ok: false, reason: 'no_disponible' };

/**
 * @param {import('../ports.js').AppConfig['turnstile']} config
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opciones] Para las pruebas: fetch falso y otro tiempo máximo.
 * @returns {import('../ports.js').TurnstileVerifier}
 */
export function createTurnstileVerifier(
  config,
  { fetch: llamar = globalThis.fetch, timeoutMs = TIEMPO_MAXIMO_MS } = {},
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
        if (!cuerpo.success) return RECHAZADO;
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
