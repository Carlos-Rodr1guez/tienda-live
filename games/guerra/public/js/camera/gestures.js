// Reconocedor de gestos de puntero (NM-4, NM-6; diseño D23). Lógica pura: recibe eventos ya normalizados y se los pasa
// al controlador como entradas del narrador. El DOM (`pointerdown`, `pointermove`…) lo conecta `main.js`.
//
//   - pointer-down toma el control en el mismo tick, antes de que el dedo se mueva (respuesta inmediata);
//   - arrastre: umbral de 4 px y después 1:1 con el dedo (se aplica lo recorrido desde el pointer-down);
//   - doble toque o doble clic: ×1,6 si son < 320 ms y < 30 px entre los dos toques; un arrastre no es un toque;
//   - pellizco: la distancia entre dos dedos suma intención logarítmica, anclada en el punto medio;
//   - tocar o arrastrar sobre el minimapa visible centra la vista en vez de panear.

import { minimapHit } from './minimap.js';

const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 30;

/**
 * @param {{
 *   controller: ReturnType<import('./controller.js').createCameraController>,
 *   minimap?: () => ({x: number, y: number, w: number, h: number} | null)
 * }} o `minimap` da el rectángulo del minimapa si está visible, o `null`
 */
export function createGestures({ controller, minimap = () => null }) {
  const threshold = controller.cfg.dragThresholdPx;
  /** @type {Map<number, {x: number, y: number, x0: number, y0: number, t0: number, drag: boolean, map: boolean, ghost: boolean}>} */
  const ptrs = new Map();
  let lastTap = /** @type {{x: number, y: number, t: number} | null} */ (null);
  let pinch = /** @type {{a: number, b: number, d: number, mx: number, my: number} | null} */ (null);

  const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
  function onMap(p, x, y) {
    const r = minimap();
    if (!r) return false;
    const dentro = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (!dentro && !p.map) return false;
    // arrastrando sobre el minimapa, un dedo que se sale se recorta al borde del rectángulo
    const hit = minimapHit(r, Math.min(r.x + r.w, Math.max(r.x, x)), Math.min(r.y + r.h, Math.max(r.y, y)));
    if (!hit) return false;
    controller.input('minimap', hit);
    return true;
  }

  return {
    down(e) {
      controller.input('press', {});
      const p = { x: e.x, y: e.y, x0: e.x, y0: e.y, t0: e.t, drag: false, map: false, ghost: false };
      ptrs.set(e.id, p);
      if (ptrs.size === 2 && !pinch) {
        const [a, b] = [...ptrs.keys()];
        const pa = ptrs.get(a);
        const pb = ptrs.get(b);
        pinch = {
          a,
          b,
          d: dist(pa.x, pa.y, pb.x, pb.y),
          mx: (pa.x + pb.x) / 2,
          my: (pa.y + pb.y) / 2,
        };
        lastTap = null;
        return;
      }
      if (ptrs.size === 1) p.map = onMap(p, e.x, e.y);
    },
    move(e) {
      const p = ptrs.get(e.id);
      if (!p) return;
      p.x = e.x;
      p.y = e.y;
      if (pinch) {
        if (e.id !== pinch.a && e.id !== pinch.b) return;
        const pa = ptrs.get(pinch.a);
        const pb = ptrs.get(pinch.b);
        const d = dist(pa.x, pa.y, pb.x, pb.y);
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        if (d > 0 && pinch.d > 0) controller.input('intent', { ln: Math.log(d / pinch.d), x: mx, y: my });
        controller.input('drag', { dx: mx - pinch.mx, dy: my - pinch.my });
        pinch.d = d;
        pinch.mx = mx;
        pinch.my = my;
        return;
      }
      if (p.ghost) return;
      if (p.map) {
        onMap(p, e.x, e.y);
        return;
      }
      if (!p.drag) {
        if (dist(p.x0, p.y0, e.x, e.y) < threshold) return;
        p.drag = true;
        // lo recorrido desde el pointer-down se aplica entero: el mundo sigue al dedo sin perder los primeros píxeles
        controller.input('drag', { dx: e.x - p.x0, dy: e.y - p.y0 });
        p.x0 = e.x;
        p.y0 = e.y;
        return;
      }
      controller.input('drag', { dx: e.x - p.x0, dy: e.y - p.y0 });
      p.x0 = e.x;
      p.y0 = e.y;
    },
    up(e) {
      const p = ptrs.get(e.id);
      if (!p) return;
      ptrs.delete(e.id);
      if (pinch) {
        // al levantar un dedo termina el pellizco y el otro no deja un arrastre fantasma
        pinch = null;
        for (const q of ptrs.values()) q.ghost = true;
        return;
      }
      if (p.ghost || p.map || p.drag) return;
      const prev = lastTap;
      if (prev && p.t0 - prev.t < DOUBLE_TAP_MS && dist(prev.x, prev.y, p.x, p.y) < DOUBLE_TAP_PX) {
        controller.input('factor', { f: controller.cfg.dblTapZoom, x: p.x, y: p.y });
        lastTap = null;
      } else lastTap = { x: p.x, y: p.y, t: p.t0 };
    },
    cancel(e) {
      if (!ptrs.delete(e.id)) return;
      if (pinch && (e.id === pinch.a || e.id === pinch.b)) {
        pinch = null;
        for (const q of ptrs.values()) q.ghost = true;
      }
    },
    wheel(e) {
      controller.input('wheel', e);
    },
  };
}
