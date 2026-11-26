// Mapa de teclas del narrador (diseño D25, NM-3): UN solo lugar. `resolveKey` dice qué acción es una tecla; la ayuda H se
// arma de este mismo mapa (rótulos aquí y descripciones en `ui/strings.js`), sin repetir la lista. Puro: no escucha nada
// (eso es `ui/input.js`) ni sabe qué hace cada acción (eso es `ui/shortcuts.js`).
//
// Reglas: ninguna tecla se repite; `Tab` queda libre para el foco; las del navegador (con Ctrl o Meta) no se tocan; `Alt` solo
// vale con `Z`. `Shift+N` y `N` se distinguen por `e.shiftKey` y no por la mayúscula de `e.key` (H25): con Bloq Mayús la
// tecla dice "N" sin Shift y sigue siendo `N` (ocultar nombres). Lo mismo con `S` y `Shift+S`.

import { S } from './strings.js';

/**
 * `keys` son valores de `e.key` (sin distinguir mayúsculas); `mod` es `'shift'` o `'alt'` cuando la acción exige ese modificador;
 * `label` es la tecla como se lee en la ayuda.
 */
export const KEYMAP = Object.freeze(
  [
    { id: 'advance', keys: ['Enter'], label: S.keys.enter },
    { id: 'pause', keys: ['p'], label: 'P' },
    { id: 'endMatch', keys: ['Escape'], label: S.keys.escTwice },
    { id: 'scoreboard', keys: ['g'], label: 'G' },
    { id: 'top3', keys: ['t'], label: 'T' },
    { id: 'followNext', keys: ['s'], label: 'S' },
    { id: 'followStop', keys: ['s'], mod: 'shift', label: S.keys.shiftS },
    { id: 'autoCam', keys: ['a'], label: 'A' },
    { id: 'viewAll', keys: ['v'], label: 'V' },
    { id: 'base1', keys: ['1'], label: '1' },
    { id: 'base2', keys: ['2'], label: '2' },
    { id: 'hottest', keys: [' '], label: S.keys.space },
    { id: 'pan', keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], label: S.keys.arrows },
    { id: 'zoomIn', keys: ['+', '='], label: S.keys.zoomIn },
    { id: 'zoomOut', keys: ['-', '_'], label: S.keys.zoomOut },
    { id: 'frame', keys: ['c'], label: 'C' },
    { id: 'reduced', keys: ['r'], label: 'R' },
    { id: 'help', keys: ['h'], label: 'H' },
    { id: 'undo', keys: ['z'], mod: 'alt', label: S.keys.altZ },
    { id: 'newLive', keys: ['n'], mod: 'shift', label: S.keys.shiftNTwice },
    { id: 'names', keys: ['n'], label: 'N' },
    { id: 'mute', keys: ['m'], label: 'M' },
    { id: 'sim', keys: ['F1'], label: 'F1' },
    { id: 'perf', keys: ['F2'], label: 'F2' },
    { id: 'safe', keys: ['F3'], label: 'F3' },
  ].map((a) => Object.freeze(a)),
);

/** Teclas reservadas por el diseño: simulador, rendimiento, zonas seguras, ocultar nombres y sonido. */
export const RESERVED = Object.freeze(['F1', 'F2', 'F3', 'n', 'm']);

// tablas de búsqueda, armadas una vez a partir del mapa
const PLAIN = new Map();
const SHIFTED = new Map();
for (const a of KEYMAP) {
  if (a.mod === 'alt') continue;
  for (const k of a.keys) (a.mod === 'shift' ? SHIFTED : PLAIN).set(k.toLowerCase(), a.id);
}
const ALT = KEYMAP.find((a) => a.mod === 'alt');

/**
 * La acción de una tecla, o `null`.
 * @param {{key?: string, code?: string, shiftKey?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean}} e
 * @returns {string | null}
 */
export function resolveKey(e) {
  if (e.ctrlKey || e.metaKey || typeof e.key !== 'string') return null;
  const key = e.key.toLowerCase();
  if (e.altKey) return ALT && (key === ALT.keys[0] || e.code === 'KeyZ') ? ALT.id : null;
  if (e.shiftKey && SHIFTED.has(key)) return /** @type {string} */ (SHIFTED.get(key));
  return PLAIN.get(key) ?? null;
}

const EDITABLES = new Set(['TEXTAREA', 'SELECT']);
/** Tipos de `<input>` en que se escribe texto; un checkbox, un radio o un botón no bloquean los atajos. */
const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'number', 'password', 'url', 'tel']);
/** ¿El foco está en un campo de texto? Ahí las teclas son de quien escribe, no del narrador. */
export function isEditing(t) {
  if (!t) return false;
  if (t.tagName === 'INPUT') return TEXT_INPUTS.has(String(t.type ?? '').toLowerCase());
  return EDITABLES.has(t.tagName) || t.isContentEditable === true;
}

/**
 * Seguimiento de "dos veces en N ms" (Esc ×2, Shift+N ×2): la segunda pulsación dentro de la ventana confirma y vuelve a
 * empezar; fuera de la ventana, la pulsación es una primera.
 * @param {number} windowMs
 */
export function createDouble(windowMs) {
  let last = -Infinity;
  return {
    /** @param {number} now ms */
    press(now) {
      if (now - last <= windowMs) {
        last = -Infinity;
        return 'confirm';
      }
      last = now;
      return 'first';
    },
  };
}

/** Las líneas de la ayuda H: la tecla (del mapa) y lo que hace (de `S.help`). */
export function helpLines() {
  return [
    ...KEYMAP.map((a) => ({ id: a.id, keys: a.label, text: S.help[a.id] })),
    { id: 'click', keys: S.keys.click, text: S.help.click },
    { id: 'altClick', keys: S.keys.altClick, text: S.help.altClick },
  ];
}
