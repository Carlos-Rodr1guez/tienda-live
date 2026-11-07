// Lienzos y contextos 2D falsos para probar el render sin DOM: la fábrica cuenta cada lienzo que se crea y cada
// contexto cuenta sus llamadas (y las registra si `recording` está en true).

/** @param {{record?: boolean}} [o] */
export function createFakeCtx(o = {}) {
  const ctx = {
    recording: Boolean(o.record),
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
        if (prop === 'measureText') return { width: String(args[0]).length * 5 };
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
