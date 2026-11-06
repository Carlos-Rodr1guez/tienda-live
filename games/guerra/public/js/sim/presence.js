// Guardia de presencia (diseño D20, NM-7, NM-8, NM-9, KIT-27). Pura: el reloj de pared llega inyectado (ms) y los
// eventos de entrada los entrega la capa DOM. Si el narrador pasa N minutos sin tocar nada, el partido se pausa; no hay
// valor, bandera ni tecla que apague la guardia. La guardia está activa desde que arranca el partido (`intro`) hasta
// `matchEnd`, con las pantallas intermedias incluidas. Los regalos, la cámara automática, el comandante, el puente y el
// simulador llegan como datos, no como eventos del DOM: nunca son entrada, y por eso no hace falta marcarlos.

/** Minutos por defecto y límites (NM-7). */
export const DEFAULT_PRESENCE_MINUTES = 5;
export const MIN_PRESENCE_MINUTES = 2;
export const MAX_PRESENCE_MINUTES = 10;

/** Movimiento acumulado del puntero que cuenta como entrada (NM-8, valor del diseño). */
export const POINTER_MOVE_PX = 24;

/** Estados del partido con la guardia puesta: de `startMatch` a `matchEnd` (sin incluir la sala ni el fin). */
const GUARDED = new Set(['intro', 'battle', 'roundEnd', 'waitingNextRound']);
const DIRECT = new Set(['keydown', 'pointerdown', 'wheel']);

/**
 * Minutos de inactividad: un número finito recortado a [2, 10]; 0, `false`, `null`, texto, negativos y lo que no sea un
 * número valen 5. Nada apaga la guardia.
 * @param {unknown} v
 * @returns {number}
 */
export function resolvePresenceMinutes(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return DEFAULT_PRESENCE_MINUTES;
  return Math.min(MAX_PRESENCE_MINUTES, Math.max(MIN_PRESENCE_MINUTES, v));
}

/**
 * Filtro de entrada con el acumulador del movimiento del puntero. `counts(evt)` dice si ese evento cuenta.
 * @returns {{counts(evt: any): boolean}}
 */
export function createInputFilter() {
  let moved = 0;
  return {
    counts(evt) {
      if (evt === null || typeof evt !== 'object' || evt.isTrusted !== true) return false;
      if (DIRECT.has(evt.type)) return true;
      if (evt.type !== 'pointermove') return false;
      const dx = Number.isFinite(evt.movementX) ? evt.movementX : 0;
      const dy = Number.isFinite(evt.movementY) ? evt.movementY : 0;
      moved += Math.sqrt(dx * dx + dy * dy);
      if (moved < POINTER_MOVE_PX) return false;
      moved = 0;
      return true;
    },
  };
}

/**
 * ¿Cuenta como entrada del narrador? Solo los eventos de confianza (`isTrusted === true`) de `keydown`, `pointerdown`
 * (ratón, lápiz o toque, también el pellizco), `wheel` y un `pointermove` que junte 24 px. Sin `filter`, el movimiento
 * se evalúa solo por ese evento.
 * @param {any} evt
 * @param {{counts(evt: any): boolean}} [filter]
 */
export function isCountedInput(evt, filter) {
  return (filter ?? createInputFilter()).counts(evt);
}

/**
 * @param {{minutes?: unknown, now?: () => number}} [o] `now`: reloj de pared en ms
 */
export function createPresenceGuard({ minutes, now = () => 0 } = {}) {
  const limit = resolvePresenceMinutes(minutes) * 60000;
  let last = 0;
  let active = false;
  return {
    minutes: limit / 60000,
    get active() {
      return active;
    },
    /** Una entrada de confianza: reinicia el contador. */
    input(t = now()) {
      last = t;
    },
    /** Sigue el estado del partido: se activa al arrancar (contador nuevo) y se apaga al terminar o al volver al selector. */
    update(state, t = now()) {
      const on = GUARDED.has(state);
      if (on && !active) last = t;
      active = on;
    },
    /** `'idle'` cuando hay guardia puesta y pasaron `minutes` sin entrada; si no, `'active'`. */
    tick(t = now()) {
      return active && t - last >= limit ? 'idle' : 'active';
    },
  };
}

/**
 * Un tick de pared: sincroniza la guardia con el partido y, si venció, manda `pause({by:'presence'})`. Una pausa manual
 * se queda como está.
 * @returns {'active'|'idle'}
 */
export function applyPresence(guard, match, t) {
  guard.update(match.state, t);
  const verdict = guard.tick(t);
  if (verdict === 'idle' && match.pause === null) match.command({ type: 'pause', by: 'presence' });
  return verdict;
}

/**
 * Un evento de entrada del DOM. Si cuenta, reinicia la guardia y envía `resume({by:'presence'})`, que levanta una
 * pausa de presencia en ese mismo tick (la manual no se levanta con esto: solo con `resume`).
 * @returns {boolean} si contó como entrada
 */
export function feedInput(guard, match, evt, t, filter) {
  if (!isCountedInput(evt, filter)) return false;
  guard.input(t);
  if (match.pause === 'presence') match.command({ type: 'resume', by: 'presence' });
  return true;
}
