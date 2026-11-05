// @ts-check
// Turnstile (verificación anti-bots de Cloudflare) para el formulario. Reglas:
//  - api.js se pide UNA sola vez y solo cuando se abre el formulario (modo explícito); nunca por un proxy propio.
//  - Sin clave del sitio se usa la clave de pruebas de Cloudflare (siempre pasa), que solo sirve en local: en producción
//    la API verifica con la clave secreta y rechaza esos tokens.
//  - El tamaño se elige al pintar, midiendo la ranura: "flexible" necesita 300px como mínimo y la ranura mide 80px menos
//    que la pantalla (280px a 360px de pantalla, 295px a 375px), así que por debajo de 300px va "compact". Si la ranura no
//    se puede medir (todavía sin tamaño), decide la pantalla: "compact" por debajo de 380px.
//  - Si api.js no carga (o carga sin dejar `window.turnstile`), el error se informa, se olvida esa carga y un reintento
//    la vuelve a pedir.

/** Clave de pruebas de Cloudflare: siempre pasa. */
export const TEST_SITE_KEY = '1x00000000000000000000AA';

/** Script del widget, en modo explícito. */
export const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Ancho mínimo, en píxeles, que necesita el tamaño "flexible". */
export const FLEXIBLE_MIN_WIDTH = 300;

/** Respaldo cuando no se puede medir la ranura: pantallas más angostas que 380px (la ranura queda por debajo de 300px). */
export const COMPACT_QUERY = '(max-width: 379px)';

/**
 * @param {{
 *   slot?: { getBoundingClientRect?: () => { width: number } } | null,
 *   matchMedia?: ((consulta: string) => { matches: boolean }) | undefined,
 * }} entrada  `slot`: la ranura donde se pinta el widget; `matchMedia`: el respaldo si no se puede medir
 * @returns {'compact' | 'flexible'}
 */
export function chooseSize({ slot, matchMedia } = {}) {
  const ancho = typeof slot?.getBoundingClientRect === 'function' ? slot.getBoundingClientRect().width : Number.NaN;
  if (Number.isFinite(ancho) && ancho > 0) return ancho < FLEXIBLE_MIN_WIDTH ? 'compact' : 'flexible';
  return typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches ? 'compact' : 'flexible';
}

/**
 * @param {unknown} valor  la clave que trae la construcción (puede faltar)
 * @returns {string}
 */
export function resolveSiteKey(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : TEST_SITE_KEY;
}

/**
 * @typedef {object} ManejadoresWidget
 * @property {(token: string) => void} onToken
 * @property {() => void} onExpire
 * @property {() => void} onError
 */

/**
 * @param {{
 *   doc: { createElement: (etiqueta: string) => any, head: { appendChild: (el: any) => unknown } },
 *   win: { turnstile?: any, matchMedia?: (consulta: string) => { matches: boolean } },
 *   siteKey: unknown,
 * }} entrada
 */
export function createTurnstile({ doc, win, siteKey }) {
  /** @type {Promise<any> | null} */
  let carga = null;

  function cargar() {
    if (win.turnstile) return Promise.resolve(win.turnstile);
    if (carga) return carga;
    carga = new Promise((resolver, rechazar) => {
      const script = doc.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      /** Se olvida la carga fallida (y su script): el siguiente intento agrega uno nuevo. */
      const fallar = () => {
        carga = null;
        script.remove?.();
        rechazar(new Error('no se pudo cargar la verificación'));
      };
      script.onload = () => {
        // api.js puede cargar sin dejar `window.turnstile` (bloqueado, respuesta rara): sin él no hay widget que pintar
        if (win.turnstile) resolver(win.turnstile);
        else fallar();
      };
      script.onerror = fallar;
      doc.head.appendChild(script);
    });
    return carga;
  }

  return {
    /**
     * Pinta el widget en `contenedor` y devuelve su id.
     * @param {unknown} contenedor
     * @param {ManejadoresWidget} manejadores
     * @returns {Promise<string>}
     */
    async render(contenedor, { onToken, onExpire, onError }) {
      const turnstile = await cargar();
      return turnstile.render(contenedor, {
        sitekey: resolveSiteKey(siteKey),
        action: 'waitlist',
        theme: 'dark',
        size: chooseSize({
          slot: /** @type {{ getBoundingClientRect?: () => { width: number } }} */ (contenedor),
          matchMedia: win.matchMedia,
        }),
        'response-field': false,
        callback: onToken,
        'expired-callback': onExpire,
        'error-callback': onError,
      });
    },

    /** Pide un token nuevo (el anterior se gasta con cada envío). @param {string | null | undefined} id */
    reset(id) {
      if (id && win.turnstile) win.turnstile.reset(id);
    },
  };
}
