// Un DOM falso para correr `main.js` sin navegador: lienzo de 1920×1080 con contexto 2D que registra llamadas, botones de
// la barra de cámara, teclado, puntero, un WebSocket falso (el puente del kit), el panel del simulador F1 (elementos
// falsos que aceptan lo que usa `SimulatorPanel`) y un `requestAnimationFrame` que se da a mano. Es el mismo arnés que usa
// `main-camera.test.js`; el lote 5d lo comparte con las pruebas de etiquetas e íconos.
//
// Lote 6b: sin parámetros la página abre el SELECTOR. Para no repetir el recorrido en cada prueba, `arrancar` elige el par
// (`?pair=XX-YY`, o PE-MX) y empieza el partido con Enter, salvo con `{selector: true}` o con `?golden`. Los donantes
// sintéticos ya no son un parámetro de la página: `entorno.donantes()` los manda por el puente falso, el mismo camino que
// el público de verdad (`servidor: true` o `?donantes`, que aquí solo pide ese modo).

import { createFakeCanvasFactory, createFakeCtx } from './fake-canvas.js';

const FRAME_MS = 1000 / 60;
let corridas = 0;

const EMOJI = String.fromCodePoint(0x1f600).repeat(24);
const CJK = '田中太郎さんの動画チャンネル';
const LARGO = 'xX_el_mas_capo_del_live_Xx';
const NOMBRES = [
  ['ana_23', LARGO, EMOJI, CJK, 'Luis', 'María', 'Pepe_2000', 'k', 'Vale', 'Nico', 'Sol', 'Tomás'],
  [CJK, 'bea_77', EMOJI, LARGO, 'Juan', 'Lupe', 'Rodri', 'z', 'Mica', 'Beto', 'Ceci', 'Fede'],
];
/** Config del juego de las pruebas con donantes: un solo tier de soldados y un override para el avión. */
const GAME_DONANTES = {
  tiers: [{ minCoins: 1, unit: 'soldado', coinsPerUnit: 20, maxPerGift: 3 }],
  giftOverrides: { Avión: { unit: 'avion', count: 1 } },
  bigUnits: ['avion'],
  bannerCoins: 100000,
  eventCaps: { soldado: 40 },
};

/** Un elemento falso que registra las escrituras y acepta lo que usa el panel F1 (`SimulatorPanel`). */
function crearElemento(anotar, lista, base = {}) {
  const el = { ...base };
  const oyentes = new Map();
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
  const clases = new Set();
  el.classList = {
    add: (c) => clases.add(c),
    remove: (c) => clases.delete(c),
    contains: (c) => clases.has(c),
    toggle: (c, on) => {
      const quiere = on ?? !clases.has(c);
      if (quiere) clases.add(c);
      else clases.delete(c);
      return quiere;
    },
  };
  el.style = {};
  el.hijos = [];
  el.setAttribute = (n, v) => anotar(`setAttribute:${n}`, v);
  el.append = (...a) => {
    for (const v of a) {
      anotar('append', v?.data ?? v?.textContent ?? '');
      if (v && typeof v === 'object') el.hijos.push(v);
    }
  };
  el.appendChild = (v) => {
    anotar('appendChild', v?.data ?? v);
    return v;
  };
  el.addEventListener = (type, fn) => oyentes.set(type, [...(oyentes.get(type) ?? []), fn]);
  el.removeEventListener = () => {};
  el.click = () => (oyentes.get('click') ?? []).forEach((fn) => fn({ preventDefault() {} }));
  el.remove = () => {};
  lista?.push(el);
  return el;
}

/** Un `import` nuevo de main.js para la URL dada (`search`), con el DOM falso ya instalado. */
export async function arrancar(
  search,
  {
    reducido = false,
    fetch = null,
    servidor = false,
    selector = false,
    game = null,
    antes = null,
    FontFace = undefined,
    sesion = false,
    crudo = false,
    fontScale = 0,
  } = {},
) {
  const params = new URLSearchParams(search);
  // `crudo`: la página recibe la URL tal cual (para probar que ?donantes y ?avion ya no hacen nada)
  const quiereDonantes = params.has('donantes') && !crudo;
  const quiereAvion = params.has('avion') && !crudo;
  if (!crudo) {
    params.delete('donantes');
    params.delete('avion');
  }
  const sinDonantes = params.toString() ? `?${params.toString()}` : '';
  const golden = params.has('golden');
  const modoServidor = servidor || (quiereDonantes && !golden);
  const autoEmpezar = !selector && !golden;
  const url = autoEmpezar && !params.has('pair') ? `${sinDonantes}${sinDonantes ? '&' : '?'}pair=PE-MX` : sinDonantes;
  const { createCanvas } = createFakeCanvasFactory();
  // `fontScale` (p. ej. 0,6): ancho de letra realista, para las pruebas de solapes; por defecto 5 px por carácter
  const ctx = createFakeCtx({ record: true, fontScale });
  const oyentes = { window: new Map(), canvas: new Map() };
  const agregar = (mapa) => (type, fn) => {
    if (!mapa.has(type)) mapa.set(type, []);
    mapa.get(type).push(fn);
  };
  const lanzar = (mapa, type, e = {}) => {
    const ev = {
      type,
      isTrusted: true,
      ...e,
      preventDefault() {
        ev.evitado = true;
      },
    };
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
  const elementos = [];
  const elemento = (base) => crearElemento(anotar, null, base);
  const botones = {};
  const boton = (id) => {
    botones[id] = elemento({ id, disabled: false });
  };
  /** `document.fonts` falso: guarda los oyentes (p. ej. `loadingdone`) y lo que se carga. */
  const fuentes = {
    oyentes: [],
    cargadas: [],
    pedidas: [],
    addEventListener: (type, fn) => fuentes.oyentes.push([type, fn]),
    add: (f) => fuentes.cargadas.push(f.family),
    load: async (spec) => fuentes.pedidas.push(spec),
  };
  for (const id of ['cam-bar', 'cam-all', 'cam-in', 'cam-out', 'cam-auto']) boton(id);
  const panelSim = crearElemento(anotar, null, { id: 'sim' });
  // WebSocket falso: el puente del kit (connectBridge) lo abre y recibe de él
  const ws = {
    instancias: [],
    ultimo: () => ws.instancias.at(-1),
    abrir: () => ws.ultimo()?.onopen?.(),
    recibir: (evt) => ws.ultimo()?.onmessage?.({ data: JSON.stringify(evt) }),
    estado: (s) => ws.recibir({ type: 'status', ...s }),
    cerrar: () => ws.ultimo()?.onclose?.(),
  };
  const fetches = [];
  const baseFetch = fetch ?? (async () => ({ ok: false }));
  // con servidor, `/api/config` lo contesta la prueba (su `fetch`) o, si no lo hace, un servidor del kit sintético; las pruebas que
  // traen su propio `fetch` es porque prueban la sesión, así que el servidor sintético la tiene prendida
  const fetchFalso = async (u, init) => {
    fetches.push({ url: String(u), method: init?.method ?? 'GET', body: init?.body });
    const respuesta = await baseFetch(u, init);
    if (modoServidor && String(u) === '/api/config' && !respuesta?.ok) {
      return {
        ok: true,
        json: async () => ({
          game: game ?? (quiereDonantes ? GAME_DONANTES : {}),
          serverMode: true,
          tiktokUsername: 'x',
          // con `sesion: true` el servidor tiene prendida la sesión de la transmisión y la página pide la copia (GET) al cargar
          ...(sesion || fetch !== null ? { session: { maxBytes: 1048576 } } : {}),
        }),
      };
    }
    return respuesta;
  };
  let raf = null;
  Object.assign(globalThis, {
    window: globalThis,
    location: { search: url, protocol: 'http:', host: 'localhost:3100' },
    document: {
      getElementById: (id) => (id === 'game' ? canvas : id === 'sim' ? panelSim : (botones[id] ?? null)),
      createElement: (tag) => (tag === 'canvas' ? elemento(createCanvas(1, 1)) : crearElemento(anotar, elementos, {})),
      createTextNode: (data) => {
        anotar('createTextNode', data);
        return { data };
      },
      addEventListener() {},
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
    fetch: fetchFalso,
    WebSocket: class {
      constructor(u) {
        this.url = u;
        ws.instancias.push(this);
      }
      close() {
        this.cerrado = true;
      }
    },
  });
  if (FontFace === undefined) delete globalThis.FontFace;
  else globalThis.FontFace = FontFace;
  globalThis.devicePixelRatio = 1;
  let ts = 0;
  const entorno = {
    canvas,
    ctx,
    escrituras,
    fuentes,
    ws,
    fetches,
    /** Los botones de la barra de cámara (DOM falso). */
    botones,
    /** El elemento del panel del simulador y los elementos que creó el panel (botones, títulos…). */
    panelSim,
    elementos,
    /** Clic en el botón del panel F1 con ese texto exacto. */
    clicPanel(texto) {
      const b = elementos.find((e) => e.textContent === texto || e.hijos?.some?.((h) => h.data === texto));
      if (!b) throw new Error(`no hay botón "${texto}" en el panel`);
      b.click();
    },
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
    tecla: (key, extra = {}) => lanzar(oyentes.window, 'keydown', { key, target: { tagName: 'BODY' }, ...extra }),
    /** Un evento de puntero sobre el lienzo (`pointerdown`, `pointermove`, `pointerup`…), en px de CSS del lienzo. */
    puntero: (type, extra = {}) =>
      lanzar(oyentes.canvas, type, {
        pointerType: 'mouse',
        button: 0,
        pointerId: 1,
        timeStamp: 0,
        clientX: 0,
        clientY: 0,
        ...extra,
      }),
    /** Un evento de la ventana (por ejemplo `pagehide` o `beforeunload`). */
    evento: (type, extra = {}) => lanzar(oyentes.window, type, extra),
    /** Lo que dibujó el último cuadro. */
    textos: () => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]),
    f2() {
      const t = entorno.textos();
      const out = {};
      for (let i = t.indexOf('cuadros por segundo'); i >= 0 && i + 1 < t.length; i += 2) out[t[i]] = t[i + 1];
      return out;
    },
    /** Los donantes sintéticos (el peor caso de nombres) entran por el puente, como el público: una unión y un regalo cada uno. */
    donantes({ avion = false } = {}) {
      if (!ws.ultimo()) throw new Error('donantes() necesita servidor: true (o ?donantes)');
      ws.abrir();
      for (const team of [1, 2]) {
        NOMBRES[team - 1].forEach((nickname, i) => {
          const u = { userId: `sint-${team}-${i}`, uniqueId: `sint-${team}-${i}`, nickname, avatar: '' };
          ws.recibir({ type: 'chat', ...u, text: String(team) });
          const coins = (12 - i) * 80 + team * 7;
          const esAvion = avion && i === 1;
          ws.recibir({
            type: 'gift',
            ...u,
            giftId: esAvion ? 'avion' : 'rosa',
            giftName: esAvion ? 'Avión' : 'Rose',
            coins: esAvion ? 600 : coins,
            count: 1,
            image: '',
          });
        });
      }
    },
  };
  antes?.(entorno);
  await import(`../../public/js/main.js?caso=${url}&n=${corridas++}`);
  entorno.cuadros(6);
  if (autoEmpezar) {
    entorno.tecla('Enter'); // elige el par
    entorno.cuadros(2);
    entorno.tecla('Enter'); // empieza el partido
    entorno.cuadros(2);
  }
  // con `selector: true` el juego se queda donde está (p. ej. una sesión restaurada): los donantes se piden a mano
  if (quiereDonantes && autoEmpezar) entorno.donantes({ avion: quiereAvion });
  return entorno;
}
