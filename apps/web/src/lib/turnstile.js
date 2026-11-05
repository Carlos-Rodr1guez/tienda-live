// @ts-check
// Turnstile (verificación anti-bots de Cloudflare) para el formulario. Reglas:
//  - api.js se pide UNA sola vez y solo cuando se abre el formulario (modo explícito); nunca por un proxy propio.
//  - Sin clave del sitio se usa la clave de pruebas de Cloudflare (siempre pasa), que solo sirve en local: en producción
//    la API verifica con la clave secreta y rechaza esos tokens.
//  - "compact" por debajo de 340px de ancho: el tamaño "flexible" mide 300px como mínimo y desborda a 320px.
//  - Si api.js no carga, el error se informa y un reintento lo vuelve a pedir.

/** Clave de pruebas de Cloudflare: siempre pasa. */
export const TEST_SITE_KEY = '1x00000000000000000000AA';

/** Script del widget, en modo explícito. */
export const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Pantallas más angostas que 340px. */
export const COMPACT_QUERY = '(max-width: 339px)';

/**
 * @param {((consulta: string) => { matches: boolean }) | undefined} matchMedia
 * @returns {'compact' | 'flexible'}
 */
export function chooseSize(matchMedia) {
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
      script.onload = () => resolver(win.turnstile);
      script.onerror = () => {
        // Se olvida la carga fallida: el siguiente intento agrega un script nuevo
        carga = null;
        rechazar(new Error('no se pudo cargar la verificación'));
      };
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
        size: chooseSize(win.matchMedia),
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
