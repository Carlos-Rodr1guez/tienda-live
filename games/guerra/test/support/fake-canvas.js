// Lienzos y contextos 2D falsos para probar el render sin DOM: la fábrica cuenta cada lienzo que se crea y cada
// contexto cuenta sus llamadas (y las registra si `recording` está en true).

/** @param {{record?: boolean, fontScale?: number}} [o] `fontScale`: ancho por carácter en em (0,6 ≈ una fuente proporcional) */
export function createFakeCtx(o = {}) {
  const ctx = {
    recording: Boolean(o.record),
    fontScale: Number(o.fontScale) || 0,
    count: 0,
    /** Cada llamada: [nombre, ...args]; cada asignación: ['set:propiedad', valor]. */
    calls: [],
    byName: Object.create(null),
    reset() {
      ctx.count = 0;
      ctx.calls.length = 0;
      ctx.byName = Object.create(null);
    },
  };
  const proxy = new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      if (prop in target.state) return target.state[prop];
      return (...args) => {
        target.count++;
        target.byName[prop] = (target.byName[prop] ?? 0) + 1;
        if (target.recording) target.calls.push([prop, ...args]);
        if (prop === 'measureText') {
          // con `fontScale` el ancho depende del tamaño de `ctx.font` (px × factor por carácter), como en un navegador;
          // sin él son 5 px por carácter, como siempre (las pruebas viejas no cambian)
          const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.state.font ?? ''))?.[1]);
          // los títulos (Silkscreen) miden más ancho que el cuerpo: 0,75 a 0,82 em (se usa 0,85) contra 0,48 a 0,56 em (medido en Chromium)
          const factor = /Silkscreen/.test(String(target.state.font ?? ''))
            ? Math.max(target.fontScale, 0.85)
            : target.fontScale;
          return { width: String(args[0]).length * (target.fontScale && px ? px * factor : 5) };
        }
        return undefined;
      };
    },
    set(target, prop, value) {
      if (prop === 'recording') {
        target.recording = value;
        return true;
      }
      target.state[prop] = value;
      if (target.recording) target.calls.push([`set:${String(prop)}`, value]);
      return true;
    },
  });
  ctx.state = Object.create(null);
  return proxy;
}

/** Fábrica de lienzos falsos que cuenta lo que crea. */
export function createFakeCanvasFactory(o = {}) {
  const created = [];
  const createCanvas = (width, height) => {
    const ctx = createFakeCtx({ record: o.record });
    const canvas = { width, height, ctx, getContext: () => ctx };
    created.push(canvas);
    return canvas;
  };
  return { createCanvas, created };
}

/** Lienzo principal falso (el de pantalla). */
export function createFakeMain(width = 1920, height = 1080) {
  const ctx = createFakeCtx({ record: true });
  return { width, height, ctx, getContext: () => ctx };
}

/**
 * Auditoría de dibujo: recorre `ctx.calls` EN ORDEN y devuelve cada `fillText` y cada `fillRect` con su caja en pantalla (con
 * la transformación de `translate` y `scale` aplicada, `save` y `restore` incluidos) y su lugar en el orden de dibujo. Lo que
 * se dibuja después queda ENCIMA: sirve para ver textos tapados por un panel translúcido que se pintó después de ellos.
 * @param {any[][]} calls
 * @param {number} fontScale mismo factor del contexto (el ancho de un texto es largo × px × factor; Silkscreen más ancho)
 * @returns {{i: number, kind: 'text' | 'rect', x: number, y: number, w: number, h: number, text?: string}[]}
 */
export function auditLog(calls, fontScale = 0.6) {
  const out = [];
  let m = { sx: 1, sy: 1, tx: 0, ty: 0 };
  const pila = [];
  let font = '';
  let align = 'left';
  calls.forEach((c, i) => {
    const [n, a, b, d, e] = c;
    if (n === 'save') pila.push({ ...m });
    else if (n === 'restore') m = pila.pop() ?? m;
    else if (n === 'setTransform') m = { sx: a, sy: e, tx: b === undefined ? 0 : c[5], ty: c[6] };
    else if (n === 'translate') {
      m.tx += a * m.sx;
      m.ty += b * m.sy;
    } else if (n === 'scale') {
      m.sx *= a;
      m.sy *= b;
    } else if (n === 'set:font') font = String(a);
    else if (n === 'set:textAlign') align = String(a);
    else if (n === 'fillRect')
      out.push({ i, kind: 'rect', x: m.tx + a * m.sx, y: m.ty + b * m.sy, w: d * m.sx, h: e * m.sy });
    else if (n === 'fillText') {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1]) || 7;
      const factor = /Silkscreen/.test(font) ? Math.max(fontScale, 0.85) : fontScale;
      const w = String(a).length * px * factor * m.sx;
      const x = m.tx + b * m.sx;
      const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      const h = px * m.sy;
      out.push({ i, kind: 'text', text: String(a), x: x0, y: m.ty + d * m.sy - h / 2, w, h });
    }
  });
  return out;
}
