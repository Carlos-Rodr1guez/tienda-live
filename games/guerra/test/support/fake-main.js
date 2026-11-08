// Un DOM falso para correr `main.js` sin navegador: lienzo de 1920×1080 con contexto 2D que registra llamadas, botones de
// la barra de cámara, teclado, puntero y un `requestAnimationFrame` que se da a mano. Es el mismo arnés que usa
// `main-camera.test.js`; el lote 5d lo comparte con las pruebas de etiquetas e íconos.

import { createFakeCanvasFactory, createFakeCtx } from './fake-canvas.js';

const FRAME_MS = 1000 / 60;
let corridas = 0;

/** Un `import` nuevo de main.js para la URL dada (`search`), con el DOM falso ya instalado. */
export async function arrancar(search, { reducido = false, fetch = async () => ({ ok: false }) } = {}) {
  const { createCanvas } = createFakeCanvasFactory();
  const ctx = createFakeCtx({ record: true });
  const oyentes = { window: new Map(), canvas: new Map() };
  const agregar = (mapa) => (type, fn) => {
    if (!mapa.has(type)) mapa.set(type, []);
    mapa.get(type).push(fn);
  };
  const lanzar = (mapa, type, e = {}) => {
    const ev = { preventDefault() {}, isTrusted: true, ...e };
    for (const fn of mapa.get(type) ?? []) fn(ev);
    return ev;
  };
  const canvas = {
    width: 1920,
    height: 1080,
    clientWidth: 1920,
    clientHeight: 1080,
    getContext: () => ctx,
    addEventListener: agregar(oyentes.canvas),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  /** Todo lo que el juego escribe en el DOM falso: [propiedad, valor]. Los nombres de donantes nunca deben aparecer. */
  const escrituras = [];
  const anotar = (prop, v) => escrituras.push([prop, String(v)]);
  /** Un elemento falso que registra cada escritura de texto o de HTML. */
  const elemento = (base) => {
    const el = { ...base };
    for (const prop of ['textContent', 'innerHTML', 'innerText', 'outerHTML', 'value']) {
      let guardado = el[prop] ?? '';
      Object.defineProperty(el, prop, {
        get: () => guardado,
        set: (v) => {
          guardado = v;
          anotar(prop, v);
        },
        enumerable: true,
      });
    }
    el.setAttribute = (n, v) => anotar(`setAttribute:${n}`, v);
    el.append = (...a) => a.forEach((v) => anotar('append', v));
    el.appendChild = (v) => {
      anotar('appendChild', v?.data ?? v);
      return v;
    };
    return el;
  };
  const botones = {};
  const boton = (id) => {
    botones[id] = elemento({ id, disabled: false, addEventListener() {} });
  };
  /** `document.fonts` falso: guarda los oyentes (p. ej. `loadingdone`) para dispararlos desde la prueba. */
  const fuentes = { oyentes: [], addEventListener: (type, fn) => fuentes.oyentes.push([type, fn]) };
  for (const id of ['cam-bar', 'cam-all', 'cam-in', 'cam-out', 'cam-auto']) boton(id);
  let raf = null;
  Object.assign(globalThis, {
    window: globalThis,
    location: { search },
    document: {
      getElementById: (id) => (id === 'game' ? canvas : (botones[id] ?? null)),
      createElement: () => elemento(createCanvas(1, 1)),
      createTextNode: (data) => {
        anotar('createTextNode', data);
        return { data };
      },
      body: elemento({}),
      fonts: fuentes,
    },
    matchMedia: () => ({ matches: reducido, addEventListener() {} }),
    ResizeObserver: class {
      observe() {}
    },
    requestAnimationFrame: (cb) => {
      raf = cb;
      return 1;
    },
    addEventListener: agregar(oyentes.window),
    fetch,
  });
  globalThis.devicePixelRatio = 1;
  await import(`../../public/js/main.js?caso=${search}&n=${corridas++}`);
  let ts = 0;
  const entorno = {
    canvas,
    ctx,
    escrituras,
    fuentes,
    /** Da `n` cuadros de `ms` milisegundos. */
    cuadros(n = 1, ms = FRAME_MS) {
      for (let i = 0; i < n; i++) {
        ts += ms;
        ctx.reset();
        const cb = raf;
        raf = null;
        cb(ts);
      }
    },
    tecla: (key, extra = {}) => lanzar(oyentes.window, 'keydown', { key, ...extra }),
    /** Un evento de la ventana (por ejemplo `pagehide`). */
    evento: (type, extra = {}) => lanzar(oyentes.window, type, extra),
    /** Lo que dibujó el último cuadro. */
    textos: () => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]),
    f2() {
      const t = entorno.textos();
      const out = {};
      for (let i = t.indexOf('cuadros por segundo'); i >= 0 && i + 1 < t.length; i += 2) out[t[i]] = t[i + 1];
      return out;
    },
  };
  entorno.cuadros(6);
  return entorno;
}
