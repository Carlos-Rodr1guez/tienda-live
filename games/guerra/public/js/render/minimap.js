// Dibujo del minimapa (NM-6), en espacio de pantalla: no escala con k. Muestra cada UNIDAD como un punto del color de
// su equipo (v2.6: ya no hay grupos), las dos bases y el marco de lo que se ve. La geometría (rectángulo, clic) es de
// `camera/minimap.js`; el lote 6 lo integrará al HUD. Texto de canvas: este módulo no escribe ningún texto.

import { minimapView } from '../camera/minimap.js';

const INK = '#0B0F17';
const CLARO = '#F4F7FF';

/**
 * @param {any} ctx contexto 2D del canvas principal
 * @param {{x: number, y: number, w: number, h: number}} rect `minimapRect(W, H)`
 * @param {{
 *   view: {x0: number, y0: number, w: number, h: number}, units: {side: number, x: number, y: number}[],
 *   teamHex: [string, string], u: number
 * }} o `u`: px de dispositivo por px de interfaz
 */
export function drawMinimap(ctx, rect, { view, units, teamHex, u }) {
  const sx = rect.w / 1440;
  const sy = rect.h / 810;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(11,15,23,0.78)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  // las dos bases en los extremos
  for (let side = 0; side < 2; side++) {
    ctx.fillStyle = teamHex[side];
    const w = Math.max(2, Math.round(2 * u));
    ctx.fillRect(side === 0 ? rect.x : rect.x + rect.w - w, rect.y + rect.h * 0.1, w, rect.h * 0.8);
  }
  // un punto por unidad (un píxel de interfaz)
  const d = Math.max(1, Math.round(u));
  for (const o of units) {
    ctx.fillStyle = teamHex[o.side];
    ctx.fillRect(Math.round(rect.x + o.x * sx - d / 2), Math.round(rect.y + o.y * sy - d / 2), d, d);
  }
  // el marco de la vista y el borde del minimapa
  const f = minimapView(rect, view);
  ctx.lineWidth = Math.max(1, Math.round(u / 2));
  ctx.strokeStyle = CLARO;
  ctx.strokeRect(f.x, f.y, f.w, f.h);
  ctx.strokeStyle = INK;
  ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
}
