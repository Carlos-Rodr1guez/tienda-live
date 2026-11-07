// Rasteriza las llamadas registradas por un contexto 2D falso (fillRect, fillStyle, globalAlpha, translate, scale) en un
// mapa de píxeles: sirve para comparar arte prerenderizado sin DOM.

/**
 * @param {any[][]} calls `ctx.calls` de un contexto falso que registró
 * @param {{w: number, h: number}} size
 * @returns {Map<number, string>} índice (y·w + x) -> "color@alfa"
 */
export function rasterize(calls, { w, h }) {
  const px = new Map();
  let fill = '#000000';
  let alpha = 1;
  let a = 1;
  let d = 1;
  let tx = 0;
  let ty = 0;
  for (const c of calls) {
    switch (c[0]) {
      case 'set:fillStyle':
        fill = String(c[1]).toUpperCase();
        break;
      case 'set:globalAlpha':
        alpha = c[1];
        break;
      case 'translate':
        tx += a * c[1];
        ty += d * c[2];
        break;
      case 'scale':
        a *= c[1];
        d *= c[2];
        break;
      case 'fillRect': {
        let [, x, y, rw, rh] = c;
        let x0 = a * x + tx;
        let x1 = a * (x + rw) + tx;
        if (x1 < x0) [x0, x1] = [x1, x0];
        const y0 = d * y + ty;
        const y1 = d * (y + rh) + ty;
        for (let yy = Math.max(0, Math.round(Math.min(y0, y1))); yy < Math.min(h, Math.round(Math.max(y0, y1))); yy++) {
          for (let xx = Math.max(0, Math.round(x0)); xx < Math.min(w, Math.round(x1)); xx++)
            px.set(yy * w + xx, `${fill}@${alpha}`);
        }
        break;
      }
      default:
        break;
    }
  }
  return px;
}

/** El mismo mapa reflejado en x. */
export function mirror(px, { w }) {
  const out = new Map();
  for (const [i, v] of px) {
    const x = i % w;
    const y = (i - x) / w;
    out.set(y * w + (w - 1 - x), v);
  }
  return out;
}

/** Cuántos píxeles difieren entre dos mapas (pintado distinto o pintado solo en uno) y cuántos pinta el primero. */
export function diff(a, b) {
  let n = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) if (a.get(k) !== b.get(k)) n++;
  return { n, painted: keys.size };
}
