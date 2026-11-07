// Minimapa (NM-6): visible solo con k > 1. Su rectángulo es una función del tamaño del lienzo y nunca de k, así que la
// interfaz no escala con el zoom. Aquí vive la geometría pura (rectángulo, visibilidad, clic); el dibujo está en
// `render/minimap.js`. El lote 6 moverá estas medidas a `ui/layout.js` (escala entera de UI, diseño §10.1).

import { WORLD } from './controller.js';

/** Escala entera de la interfaz: 480×270 virtuales como mínimo (diseño §10.1). */
export function uiScale(W, H) {
  return Math.max(1, Math.floor(Math.min(W / 480, H / 270)));
}

/**
 * Rectángulo del minimapa en px de dispositivo: 84 px virtuales de ancho, centrado en la banda inferior (x 198–282 en
 * 480×270) y con la proporción del mundo.
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function minimapRect(W, H) {
  const u = uiScale(W, H);
  const w = 84 * u;
  const h = Math.round((w * WORLD.h) / WORLD.w);
  return { x: Math.round((W - w) / 2), y: H - h - 2 * u, w, h };
}

/** El minimapa se muestra con k > 1 y se oculta en el mapa entero. */
export function minimapVisible(k) {
  return k > 1 + 1e-6;
}

/**
 * Punto del mundo bajo un punto del minimapa, o `null` si cae fuera del rectángulo.
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @returns {{wx: number, wy: number} | null}
 */
export function minimapHit(rect, px, py) {
  if (px < rect.x || py < rect.y || px > rect.x + rect.w || py > rect.y + rect.h) return null;
  return { wx: ((px - rect.x) / rect.w) * WORLD.w, wy: ((py - rect.y) / rect.h) * WORLD.h };
}

/**
 * Rectángulo de lo que se ve ahora, dentro del minimapa (para dibujar el marco de la vista).
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @param {{x0: number, y0: number, w: number, h: number}} view `viewRect()` del controlador
 */
export function minimapView(rect, view) {
  const sx = rect.w / WORLD.w;
  const sy = rect.h / WORLD.h;
  const x0 = Math.max(0, view.x0);
  const y0 = Math.max(0, view.y0);
  const x1 = Math.min(WORLD.w, view.x0 + view.w);
  const y1 = Math.min(WORLD.h, view.y0 + view.h);
  return { x: rect.x + x0 * sx, y: rect.y + y0 * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy };
}
