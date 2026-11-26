// Estado de la red del chip de conexión (CB-17): traduce lo que informa el puente del kit (`connectBridge` → `onStatus`)
// a los cinco estados que entiende el HUD (`ui/hud.js`): demo, conectando, conectado, reconectando y puente perdido.
// Puro: el reloj llega inyectado (segundos).

/**
 * El estado de la red que corresponde a un estado del puente, o `null` si no lo conocemos (se queda el anterior).
 * `bridge` es el WebSocket abierto: el puente está, falta TikTok.
 * @param {unknown} s lo que informa el puente: `{state: string}`
 * @returns {'demo'|'connecting'|'connected'|'reconnecting'|'lost'|'noUser'|'noDeps'|null}
 */
export function netStateOf(s) {
  const state = s !== null && typeof s === 'object' ? /** @type {any} */ (s).state : undefined;
  switch (state) {
    case 'bridge':
    case 'conectando':
      return 'connecting';
    case 'conectado':
      return 'connected';
    case 'desconectado':
    case 'offline':
    case 'fin':
      return 'reconnecting';
    case 'error':
      // "Falta instalar dependencias" no se arregla solo: se dice qué falló y cómo arreglarlo; los demás errores reintentan
      return /npm install|instalar/i.test(String(/** @type {any} */ (s).message ?? '')) ? 'noDeps' : 'reconnecting';
    case 'bridge-lost':
      return 'lost';
    case 'sin-usuario':
      return 'noUser';
    default:
      return null;
  }
}

/**
 * @param {{demo: boolean, clock: () => number}} o `clock`: segundos
 */
export function createNet({ demo, clock }) {
  let state = demo ? 'demo' : 'connecting';
  let since = clock();
  return {
    /** Una novedad del puente. Un estado desconocido no cambia nada; repetir el mismo no reinicia el contador. */
    set(raw) {
      const n = netStateOf(raw);
      if (n === null || n === state) return;
      state = n;
      since = clock();
    },
    /** `{state, since}` con `since` en segundos desde el último cambio (lo que lee `hudModel`). */
    view() {
      return { state, since: Math.max(0, clock() - since) };
    },
  };
}
