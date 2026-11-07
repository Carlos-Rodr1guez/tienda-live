// Etiquetas de donantes en el mundo (CB-16, diseño D22). Este módulo es PURO: no conoce el lienzo ni el DOM ni ningún
// reloj; el tiempo, la XP y la medición de texto llegan por argumento. Así se prueba en Node con un `measureText` falso.
//
//   selectLabels   qué donantes llevan etiqueta (densidad por el zoom k), en O(n) por cuadro y sin ordenar todo
//   createRanking  la XP de partido por donante, guardada y refrescada a 5 Hz del reloj de vista
//   labelText      "CABO ana_23", "CABO anónimo" o solo el rango
//   fitText        recorte por ancho medido, por grafema, con "…"
//   layoutLabels   colocación: sube hasta 8 veces si pisa otra pastilla o un ícono; descarta lo que no entra
//   hitLabel       qué etiqueta hay bajo un punto de pantalla (el clic y el Alt+clic de NM-11, en el lote 6)
//
// Los nombres que llegan aquí ya vienen saneados y enmascarados por el registro del kit (`displayName`): este módulo
// solo arma texto para dibujarlo con `fillText`, nunca HTML.

/** Una sola instancia: crear un segmentador por nombre sería caro con miles de eventos. */
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Texto visible que pone este módulo (el lote 6 lo mueve a `ui/strings.js`). */
export const LABEL_TEXT = Object.freeze({ anon: 'anónimo' });

/** Config de §8.0 (`labels`). `maxPerFrame` nunca pasa de las 24 etiquetas que reserva el render. */
export const LABEL_DEFAULTS = Object.freeze({ topAtK1: 3, topMid: 6, maxPerFrame: 24, maxWidth: 110, refreshHz: 5 });

const CAP_RENDER = 24;
/** Tolerancia de los umbrales de k: "Ver todo" da k = 1 exacto, y 3 puede llegar con ruido de coma flotante. */
const EPS = 1e-6;
/** A partir de este k se muestran todos los donantes de la vista (hasta el tope por cuadro). */
const K_CLOSE = 3;

const entre = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Config resuelta: valores por defecto y recortes. @param {Partial<typeof LABEL_DEFAULTS>} [cfg] */
export function resolveLabels(cfg) {
  const d = LABEL_DEFAULTS;
  return {
    topAtK1: Math.floor(entre(cfg?.topAtK1, 1, CAP_RENDER, d.topAtK1)),
    topMid: Math.floor(entre(cfg?.topMid, 1, CAP_RENDER, d.topMid)),
    maxPerFrame: Math.floor(entre(cfg?.maxPerFrame, 1, CAP_RENDER, d.maxPerFrame)),
    maxWidth: entre(cfg?.maxWidth, 40, 220, d.maxWidth),
    refreshHz: entre(cfg?.refreshHz, 1, 30, d.refreshHz),
  };
}

/** Cuántos donantes por equipo según k; 0 significa "todos los de la vista". */
export function perTeamFor(k, cfg) {
  if (k < 1 + EPS) return cfg.topAtK1;
  if (k < K_CLOSE - EPS) return cfg.topMid;
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// ranking a 5 Hz

/**
 * La XP de partido de cada donante con unidades, guardada y refrescada como mucho `refreshHz` veces por segundo del
 * reloj de vista. El orden se deduce de esta copia en cada cuadro, así que entre dos refrescos no cambia.
 * @param {{xpOf: (key: string) => number, refreshHz?: number}} o `xpOf` lee la XP de partido (API pública del registro)
 */
export function createRanking({ xpOf, refreshHz = LABEL_DEFAULTS.refreshHz }) {
  /** @type {Map<string, number>} */
  const xp = new Map();
  const period = 1 / refreshHz;
  let last = -Infinity;
  const api = {
    refreshes: 0,
    /** XP guardada del donante (0 si todavía no estaba en la última copia). */
    get: (key) => xp.get(key) ?? 0,
    /**
     * @param {number} now segundos del reloj de vista
     * @param {ArrayLike<{owner?: string | null, alive?: boolean}>} units
     * @returns {boolean} ¿refrescó?
     */
    update(now, units) {
      if (now >= last && now - last < period - 1e-9) return false;
      last = now;
      api.refreshes++;
      xp.clear();
      for (let i = 0; i < units.length; i++) {
        const o = units[i].owner;
        if (o === null || o === undefined || xp.has(o)) continue;
        const v = Number(xpOf(o));
        xp.set(o, Number.isFinite(v) ? v : 0);
      }
      return true;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// selección

/** Entrada de la lista de selección (se reutiliza entre cuadros). */
const nuevaEntrada = () => ({ key: '', id: 0, side: 0, kind: '', x: 0, y: 0, xp: 0, value: 0, spot: false });

/** Memoria reutilizable de `selectLabels`: nada se reserva por cuadro salvo cuando crece el número de donantes. */
export function createSelectorScratch() {
  return {
    pool: /** @type {ReturnType<typeof nuevaEntrada>[]} */ ([]),
    byDonor: /** @type {Map<string, ReturnType<typeof nuevaEntrada>>} */ (new Map()),
    tops: /** @type {any[][]} */ ([[], []]),
    all: /** @type {any[]} */ ([]),
    out: /** @type {any[]} */ ([]),
  };
}

/** ¿`a` va antes que `b`? XP del donante, después valor de la unidad, después id. */
function mejor(a, b) {
  if (a.xp !== b.xp) return a.xp > b.xp;
  if (a.value !== b.value) return a.value > b.value;
  return a.id < b.id;
}

/** Inserta `e` en la lista ordenada `list` de a lo sumo `cap` elementos (inserción, sin ordenar nada más). */
function insertarTop(list, cap, e) {
  let n = list.length;
  if (n >= cap) {
    if (!mejor(e, list[cap - 1])) return;
    n = cap - 1;
  } else list.length = n + 1;
  let i = n;
  while (i > 0 && mejor(e, list[i - 1])) {
    list[i] = list[i - 1];
    i--;
  }
  list[i] = e;
}

/**
 * Qué donantes llevan etiqueta (CB-16): una por donante, sobre su unidad de tierra viva y visible de más valor.
 *  - k = 1: los `topAtK1` (3) mejores de cada equipo; 1 < k < 3: los `topMid` (6); k ≥ 3: todos los de la vista hasta
 *    `maxPerFrame` (24), por XP del donante > valor de la unidad > id.
 *  - El donante en foco (`spotlight`) siempre aparece y va primero; la lista nunca pasa de `maxPerFrame`.
 *  - Solo cuentan unidades con `owner` (una clave de donante). Las gratis, las de base y las de likes no llevan.
 * Cuesta O(n) por cuadro y no ordena todas las unidades: mantiene listas acotadas por inserción.
 * La lista devuelta (y sus entradas) es la memoria de `scratch`: se lee antes del cuadro siguiente.
 * @param {{
 *   units: ArrayLike<any>, k: number, view: {x0: number, y0: number, x1: number, y1: number}, alpha: number,
 *   spotlight?: string | null, ranking: {get: (key: string) => number}, cfg?: ReturnType<typeof resolveLabels>
 * }} a
 * @param {ReturnType<typeof createSelectorScratch>} [scratch]
 */
export function selectLabels({ units, k, view, alpha, spotlight = null, ranking, cfg = resolveLabels() }, scratch) {
  const sc = scratch ?? createSelectorScratch();
  const { pool, byDonor, tops, all, out } = sc;
  byDonor.clear();
  let usadas = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const owner = u.owner;
    if (!u.alive || owner === null || owner === undefined) continue;
    const px = u.px ?? u.x;
    const py = u.py ?? u.y;
    const x = px + (u.x - px) * alpha;
    const y = py + (u.y - py) * alpha;
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    const value = u.unitValue ?? 0;
    let e = byDonor.get(owner);
    if (e === undefined) {
      e = pool[usadas] ?? (pool[usadas] = nuevaEntrada());
      usadas++;
      byDonor.set(owner, e);
    } else if (!(value > e.value || (value === e.value && u.id < e.id))) continue;
    e.key = owner;
    e.id = u.id;
    e.side = u.side;
    e.kind = u.kind;
    e.x = x;
    e.y = y;
    e.value = value;
    e.spot = false;
  }

  const porEquipo = perTeamFor(k, cfg);
  const cap = cfg.maxPerFrame;
  tops[0].length = 0;
  tops[1].length = 0;
  all.length = 0;
  let foco = null;
  for (const e of byDonor.values()) {
    e.xp = ranking.get(e.key) ?? 0;
    if (e.key === spotlight) foco = e;
    if (porEquipo > 0) insertarTop(tops[e.side === 0 ? 0 : 1], porEquipo, e);
    else insertarTop(all, cap, e);
  }

  out.length = 0;
  if (porEquipo > 0) {
    // mezcla de las dos listas ya ordenadas, sin ordenar nada más
    let a = 0;
    let b = 0;
    while (a < tops[0].length || b < tops[1].length) {
      if (b >= tops[1].length || (a < tops[0].length && mejor(tops[0][a], tops[1][b]))) out.push(tops[0][a++]);
      else out.push(tops[1][b++]);
    }
    if (out.length > cap) out.length = cap;
  } else {
    for (let i = 0; i < all.length; i++) out.push(all[i]);
  }

  if (foco !== null) {
    const i = out.indexOf(foco);
    if (i >= 0) out.splice(i, 1);
    else if (out.length >= cap) out.length = cap - 1;
    foco.spot = true;
    out.unshift(foco);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// texto

/**
 * El texto de una etiqueta. `hidden` pone "anónimo" en lugar del nombre; `onlyRank` (la tecla N) deja solo el rango.
 * @param {{rank: string, name: string, hidden?: boolean, onlyRank?: boolean}} o
 */
export function labelText({ rank, name, hidden = false, onlyRank = false }) {
  const r = String(rank ?? '').toLocaleUpperCase('es');
  if (onlyRank) return r;
  return `${r} ${hidden || !name ? LABEL_TEXT.anon : name}`;
}

/**
 * Recorta por ancho medido y por grafemas: el prefijo (el rango) nunca se corta, y al recortar el nombre termina en "…".
 * Emoji y escrituras no latinas se miden como los medirá el navegador con la fuente de respaldo; nada lanza.
 * @param {{prefix: string, name: string, maxWidth: number, measure: (t: string) => number}} o
 * @returns {{text: string, width: number, cut: boolean}}
 */
export function fitText({ prefix, name, maxWidth, measure }) {
  const full = `${prefix}${name}`.trimEnd();
  const wFull = measure(full);
  if (wFull <= maxWidth) return { text: full, width: wFull, cut: false };
  const segs = [];
  for (const { segment } of SEGMENTER.segment(name)) segs.push(segment);
  for (let n = segs.length - 1; n >= 0; n--) {
    const resto = segs.slice(0, n).join('').trimEnd();
    // sin ningún grafema del nombre queda "CABO…", sin espacio antes de los puntos suspensivos
    const text = resto === '' ? `${prefix.trimEnd()}…` : `${prefix}${resto}…`;
    const width = measure(text);
    if (width <= maxWidth) return { text, width, cut: true };
  }
  const text = `${prefix.trimEnd()}…`;
  return { text, width: measure(text), cut: true };
}

// ---------------------------------------------------------------------------------------------------------------
// colocación

/** Memoria reutilizable de `layoutLabels`. */
export function createLayoutScratch() {
  return { rects: /** @type {any[]} */ ([]), pool: /** @type {any[]} */ ([]) };
}

const choca = (x, y, w, h, r) => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h;

/**
 * Coloca las pastillas en orden de prioridad (la primera es la más importante). Cada una se ancla centrada sobre su
 * unidad con el borde inferior en `bottom`; si pisa otra ya puesta o el ícono de un grupo, sube un alto y un hueco, hasta
 * `maxRaises` (8) veces, y si no entra se descarta. Ninguna queda por encima de `bandTop` (la banda del HUD, 40
 * virtuales por la escala de la interfaz): la que caería dentro, al ponerla o al subirla, se descarta (D22). Todas se
 * corren para quedar enteras dentro del lienzo.
 * @param {{key: string, cx: number, bottom: number, w: number, h: number}[]} items px de dispositivo
 * @param {{W: number, H: number, bandTop: number, obstacles: {x: number, y: number, w: number, h: number}[],
 *   maxRaises?: number, gap?: number, scratch?: ReturnType<typeof createLayoutScratch>}} o
 */
export function layoutLabels(items, { W, H, bandTop, obstacles, maxRaises = 8, gap = 2, scratch }) {
  const sc = scratch ?? createLayoutScratch();
  const rects = sc.rects;
  rects.length = 0;
  let dropped = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const { w, h } = it;
    const x = Math.max(0, Math.min(Math.round(it.cx - w / 2), W - w));
    let y = it.bottom - h;
    if (y + h > H) y = H - h;
    if (y < bandTop) {
      // D22: nunca pasa por encima de la banda del HUD; si no entra, se descarta (no se baja hasta su borde)
      dropped++;
      continue;
    }
    let puesta = false;
    for (let intento = 0; intento <= maxRaises; intento++) {
      let libre = true;
      for (let j = 0; j < rects.length && libre; j++) if (choca(x, y, w, h, rects[j])) libre = false;
      for (let j = 0; j < obstacles.length && libre; j++) if (choca(x, y, w, h, obstacles[j])) libre = false;
      if (libre) {
        puesta = true;
        break;
      }
      y -= h + gap;
      if (y < bandTop) break;
    }
    if (!puesta) {
      dropped++;
      continue;
    }
    const r = sc.pool[rects.length] ?? (sc.pool[rects.length] = { key: '', x: 0, y: 0, w: 0, h: 0 });
    r.key = it.key;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    rects.push(r);
  }
  return { rects, dropped };
}

/**
 * La etiqueta bajo un punto de pantalla, o `null`. Borde izquierdo y superior incluidos; derecho e inferior no.
 * @param {{key: string, x: number, y: number, w: number, h: number}[]} rects
 */
export function hitLabel(rects, { x, y }) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.key;
  }
  return null;
}
