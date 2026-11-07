// Config de la cámara (diseño §8.0, `config.json → game.view` y `game.graphics`). Función pura: valida y completa. Los
// valores basura caen al defecto; lo que tiene tope se recorta. `SHARP_BELOW` NO está aquí: es una constante de
// `render/scale.js` (una clave `render.sharpBelow` no tiene efecto).

import { clampNumber, deepMerge } from '@tienda/kit/sim/config.js';

/** Valores por defecto de `view` (diseño §8.0). El techo real de la automática lo pone `minHalf`, no `maxK` (H5). */
export const VIEW_DEFAULTS = Object.freeze({
  kMax: 6,
  idleSeconds: 7,
  panSpeed: 0.6,
  dragThresholdPx: 4,
  dblTapZoom: 1.6,
  keyZoom: 1.25,
  buttonZoom: 1.5,
  wheel: { step: 0.0018, ctrlStep: 0.01, idleResetMs: 300 },
  ease: { preset: 0.08, level: 0.1 },
  auto: {
    enabled: true,
    every: 1.5,
    tau: 1.2,
    maxK: 2,
    heatBox: [135, 83],
    frame: [240, 150],
    minHalf: [220, 124],
    keep: 0.8,
    spread: 0.3,
    hudLift: 0.015,
  },
});

/** Número positivo y finito, recortado a [min, max]; si no lo es, el defecto. */
const pos = (v, dflt, min = 0, max = Infinity) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(max, Math.max(min, n));
};
/** Par de números positivos, o el par por defecto. */
const pair = (v, dflt) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
    ? [v[0], v[1]]
    : [...dflt];

/**
 * Valida y completa `game.view`.
 * @param {object | undefined} view
 */
export function resolveView(view) {
  const d = VIEW_DEFAULTS;
  const v = deepMerge(d, view !== null && typeof view === 'object' ? view : {});
  const kMax = clampNumber(v.kMax, 2, 8, d.kMax);
  const a = v.auto !== null && typeof v.auto === 'object' ? v.auto : {};
  // el encuadre nunca es menor que la caja de calor: si no, el foco elegido podría quedar sin focos que encuadrar
  const heatBox = pair(a.heatBox, d.auto.heatBox);
  const frame = pair(a.frame, d.auto.frame).map((n, i) => Math.max(n, heatBox[i]));
  const w = v.wheel !== null && typeof v.wheel === 'object' ? v.wheel : {};
  const e = v.ease !== null && typeof v.ease === 'object' ? v.ease : {};
  return {
    kMax,
    idleSeconds: pos(v.idleSeconds, d.idleSeconds, 1, 600),
    panSpeed: pos(v.panSpeed, d.panSpeed, 0.05, 3),
    dragThresholdPx: pos(v.dragThresholdPx, d.dragThresholdPx, 1, 40),
    dblTapZoom: pos(v.dblTapZoom, d.dblTapZoom, 1.1, 4),
    keyZoom: pos(v.keyZoom, d.keyZoom, 1.05, 2),
    buttonZoom: pos(v.buttonZoom, d.buttonZoom, 1.1, 3),
    wheel: {
      step: pos(w.step, d.wheel.step, 0.0001, 0.05),
      ctrlStep: pos(w.ctrlStep, d.wheel.ctrlStep, 0.0001, 0.2),
      idleResetMs: pos(w.idleResetMs, d.wheel.idleResetMs, 50, 5000),
    },
    ease: {
      preset: pos(e.preset, d.ease.preset, 0.01, 5),
      level: pos(e.level, d.ease.level, 0.01, 5),
    },
    auto: {
      enabled: a.enabled !== false,
      every: pos(a.every, d.auto.every, 0.1, 30),
      tau: pos(a.tau, d.auto.tau, 0.05, 10),
      maxK: clampNumber(a.maxK, 1, kMax, d.auto.maxK),
      heatBox,
      frame,
      minHalf: pair(a.minHalf, d.auto.minHalf),
      keep: pos(a.keep, d.auto.keep, 0.1, 1),
      spread: pos(a.spread, d.auto.spread, 0.01, 1),
      hudLift: clampNumber(a.hudLift, 0, 0.1, d.auto.hudLift),
    },
  };
}

/**
 * Valida y completa lo que `game.graphics` dice del momento de regalo grande (NM-5). El resto de `graphics`
 * (movimiento reducido, temblor) lo resuelve `render/motion.js`.
 * @param {{bigGiftMoment?: unknown, bigGiftCoins?: unknown, momentQueue?: unknown} | undefined} g
 */
export function resolveMoments(g) {
  const c = g ?? {};
  return {
    enabled: c.bigGiftMoment !== false,
    coins: pos(c.bigGiftCoins, 500, 1, 1e9),
    queue: Math.floor(pos(c.momentQueue, 3, 1, 16)),
  };
}
