// Fuentes locales (6.9, DOC-2): Pixelify Sans 600 para el texto y Silkscreen 700 para los títulos, servidas por el propio
// servidor (`/fonts/*.woff2`, licencia OFL junto a los archivos). Nada se pide a terceros. Se cargan con `FontFace` y
// `document.fonts.load`, con un tope de 1,5 s: si no llegan, el juego sigue con la pila de respaldo (`system-ui, sans-serif`)
// y los anchos se vuelven a medir cuando lleguen (`onLoaded`). Sin DOM propio: `FontFace`, `fonts` y los temporizadores
// llegan por argumento.

/** Las dos caras, con la misma familia y peso que usa `ui/theme.js` (`FONTS`). */
export const FONT_FACES = Object.freeze([
  Object.freeze({ family: 'Pixelify Sans', weight: '600', file: '/fonts/pixelify-sans-600.woff2' }),
  Object.freeze({ family: 'Silkscreen', weight: '700', file: '/fonts/silkscreen-700.woff2' }),
]);

/** Cuánto espera el arranque a las fuentes antes de seguir con la del sistema. */
export const FONT_TIMEOUT_MS = 1500;

/**
 * Carga las fuentes. Resuelve cuando llegaron todas, cuando falló alguna o al cumplirse el tope; las que llegan después del
 * tope igual se agregan y avisan. `onLoaded` se llama cada vez que llega una cara: es el aviso para invalidar las cachés de
 * anchos del texto (`ui.invalidate()`).
 * @param {{
 *   FontFace?: new (family: string, source: string, desc: object) => {family: string, load: () => Promise<any>},
 *   fonts?: {add: (f: any) => void, load: (spec: string) => Promise<any>} | null,
 *   setTimer: (fn: () => void, ms: number) => any, clearTimer: (id: any) => void, onLoaded?: (family: string) => void,
 *   timeoutMs?: number
 * }} o
 * @returns {Promise<{loaded: string[], failed: string[], timedOut: boolean}>}
 */
export function loadFonts({ FontFace, fonts, setTimer, clearTimer, onLoaded, timeoutMs = FONT_TIMEOUT_MS }) {
  const result = { loaded: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]), timedOut: false };
  if (typeof FontFace !== 'function' || !fonts) {
    result.failed = FONT_FACES.map((f) => f.family);
    return Promise.resolve(result);
  }
  return new Promise((resolve) => {
    let hecho = false;
    let pendientes = FONT_FACES.length;
    const timer = setTimer(() => {
      result.timedOut = true;
      fin();
    }, timeoutMs);
    function fin() {
      if (hecho) return;
      hecho = true;
      clearTimer(timer);
      resolve({ loaded: [...result.loaded], failed: [...result.failed], timedOut: result.timedOut });
    }
    for (const f of FONT_FACES) {
      (async () => {
        try {
          const cara = new FontFace(f.family, `url(${f.file})`, { weight: f.weight });
          await cara.load();
          fonts.add(cara);
          await fonts.load(`${f.weight} 14px "${f.family}"`);
          if (!hecho) result.loaded.push(f.family);
          onLoaded?.(f.family);
        } catch {
          // un archivo que falta (404) no rompe nada: queda la fuente del sistema
          if (!hecho) result.failed.push(f.family);
        } finally {
          if (--pendientes === 0) fin();
        }
      })();
    }
  });
}
