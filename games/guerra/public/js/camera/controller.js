// Controlador de cámara del narrador (diseño D23; NM-4 y NM-6). Lógica PURA: no conoce el lienzo, el DOM ni el reloj de
// pared; el reloj de vista lo pone `update(dt)`. Dibuja `render/frame.js` con lo que devuelve `viewRect()`.
//
// El controlador siempre está en un NIVEL de zoom (`s` = fd en k = 1 y un entero de px de dispositivo por px de mundo
// arriba), salvo en el reposo de la cámara automática. Lo que se dibuja usa `kShown`, que se acerca a `k` en escala
// logarítmica (ease-out, nunca se pasa); durante esa transición `s` puede ser fraccional (NM-6, transiciones exentas).
// El punto del mundo bajo el cursor queda fijo en cada cuadro de la transición.
//
// El narrador manda: cualquier entrada de cámara pasa a manual en el mismo tick y reinicia el contador de inactividad
// (`state.idle`). `lastStreamerInput` es el reloj de vista de la última entrada del narrador; los movimientos
// automáticos no lo tocan (NM-4, NM-8).

import { autoTarget, restScale } from './auto.js';
import { CAMERA_TEXT } from './text.js';

/** El mundo en px (placeholder de 1440×810, CB-15). */
export const WORLD = Object.freeze({ w: 1440, h: 810 });

const LEVEL_EPS = 1e-6;
/** Diferencia logarítmica de k bajo la cual la transición se da por terminada. */
const K_DONE = 5e-4;

/** Escala de ajuste al mapa entero: `fd = min(W/1440, H/810)` (NM-6). */
export function fitScale(W, H) {
  return Math.min(W / WORLD.w, H / WORLD.h);
}

/**
 * Niveles permitidos de `s` (px de dispositivo por px de mundo): `fd` y los enteros mayores que `fd` hasta `kMax·fd`.
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} kMax
 * @returns {number[]} `[fd, enteros…]`, creciente
 */
export function levelsFor(canvasW, canvasH, kMax) {
  const fd = fitScale(canvasW, canvasH);
  const out = [fd];
  const top = kMax * fd + 1e-9;
  for (let n = Math.floor(fd + LEVEL_EPS) + 1; n <= top; n++) out.push(n);
  return out;
}

const clampAxis = (c, v, size) => (v >= size ? size / 2 : Math.min(size - v / 2, Math.max(v / 2, c)));
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const finite = (...ns) => ns.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * @param {{
 *   world?: {w: number, h: number}, canvas: {w: number, h: number},
 *   view: ReturnType<import('./config.js').resolveView>, reducedMotion?: boolean
 * }} o
 */
export function createCameraController({ canvas, view: cfg, reducedMotion = false }) {
  let W = canvas.w;
  let H = canvas.h;
  let fd = fitScale(W, H);
  let lv = levelsFor(W, H, cfg.kMax);

  /** Reloj de vista, en segundos: lo avanza `update`. */
  let t = 0;
  let tauK = cfg.ease.level;
  let tauP = cfg.ease.preset;
  /** Último momento (reloj de vista) en que el narrador tocó la cámara. */
  let lastInput = 0;
  /** Punto del mundo que debe seguir bajo la fracción (fx, fy) del lienzo durante un zoom. */
  let anchor = /** @type {{wx: number, wy: number, fx: number, fy: number} | null} */ (null);
  let follower = /** @type {(() => ({x: number, y: number} | null | undefined)) | null} */ (null);
  /** Flechas sostenidas (-1, 0, 1). */
  const keys = { x: 0, y: 0 };
  /** Intención logarítmica de zoom (rueda y pellizco) y el reloj de su último evento. */
  let intent = 0;
  let intentT = -1e9;
  /** Cámara automática: ¿está manejando ahora?, cuándo reevalúa y el último foco elegido (histéresis). */
  let autoActive = false;
  let nextEval = 0;
  let prevFocus = /** @type {{x: number, y: number} | null} */ (null);
  /** Último estado de movimiento reducido que vio `syncReduced`. */
  let reducedPrev = Boolean(reducedMotion);

  const state = {
    /** Centro mostrado, en px de mundo. */
    cx: WORLD.w / 2,
    cy: WORLD.h / 2,
    /** Centro al que va. */
    tx: WORLD.w / 2,
    ty: WORLD.h / 2,
    /** k al que va y k mostrado. */
    k: 1,
    kShown: 1,
    /** Índice del nivel de reposo, o -1 si reposa entre niveles (solo la cámara automática). */
    level: 0,
    mode: /** @type {'manual'|'auto'|'preset'|'follow'} */ ('manual'),
    /** Segundos de reloj de vista sin entrada de cámara del narrador (arranca la automática a `idleSeconds`). */
    idle: 0,
    /** ¿Está encendida la cámara automática? Con movimiento reducido arranca apagada. */
    autoEnabled: cfg.auto.enabled && !reducedMotion,
  };

  const indexOfLevel = (s) => {
    for (let i = 0; i < lv.length; i++) if (Math.abs(lv[i] - s) < LEVEL_EPS) return i;
    return -1;
  };
  /** Nivel más cercano a `s` en escala logarítmica; si empatan, el menor. */
  const nearestIndex = (s) => {
    let best = 0;
    let bestD = Infinity;
    const ls = Math.log(Math.max(s, 1e-9));
    for (let i = 0; i < lv.length; i++) {
      const d = Math.abs(Math.log(lv[i]) - ls);
      if (d < bestD - 1e-12) {
        best = i;
        bestD = d;
      }
    }
    return best;
  };

  /** Centro que deja `anchor` en su lugar con el k dado, recortado al mundo. */
  function centerFromAnchor(k) {
    const s = k * fd;
    const vw = W / s;
    const vh = H / s;
    return [
      clampAxis(anchor.wx - (anchor.fx - 0.5) * vw, vw, WORLD.w),
      clampAxis(anchor.wy - (anchor.fy - 0.5) * vh, vh, WORLD.h),
    ];
  }
  /** Fija la meta de zoom a la escala `sNew` y arma el ancla (si hay cursor) con la vista MOSTRADA. */
  function zoomTo(sNew, fx, fy, tau) {
    const s = state.kShown * fd;
    const vw = W / s;
    const vh = H / s;
    anchor = { wx: state.cx - vw / 2 + fx * vw, wy: state.cy - vh / 2 + fy * vh, fx, fy };
    state.k = sNew / fd;
    state.level = indexOfLevel(sNew);
    tauK = tau;
    [state.tx, state.ty] = centerFromAnchor(state.k);
  }
  /** Centro y zoom del ancla en este cuadro (con el k mostrado). */
  function applyAnchor() {
    if (!anchor) return;
    [state.cx, state.cy] = centerFromAnchor(state.kShown);
    if (state.kShown === state.k) {
      anchor = null;
      state.cx = state.tx;
      state.cy = state.ty;
    }
  }
  const clampShown = () => {
    const s = state.kShown * fd;
    state.cx = clampAxis(state.cx, W / s, WORLD.w);
    state.cy = clampAxis(state.cy, H / s, WORLD.h);
  };
  /** Meta de centro recortada con el k de reposo. */
  function setTarget(x, y) {
    const s = state.k * fd;
    state.tx = clampAxis(x, W / s, WORLD.w);
    state.ty = clampAxis(y, H / s, WORLD.h);
  }
  /** Nivel más alto con k ≤ 2,25 (las bases y el seguimiento). */
  const closeLevel = () => {
    let best = 0;
    for (let i = 0; i < lv.length; i++) if (lv[i] / fd <= 2.25 + LEVEL_EPS) best = i;
    return best;
  };

  /** Una entrada del narrador: marca el reloj y reinicia el contador de inactividad. */
  function touch() {
    lastInput = t;
    state.idle = 0;
  }
  /** El narrador manda: cancela la automática y el seguimiento y pasa a manual en este mismo tick. */
  function takeControl() {
    touch();
    if (autoActive) stopAuto();
    follower = null;
    state.mode = 'manual';
  }
  /**
   * La automática deja de manejar y la vista se queda donde está (cancela cualquier movimiento automático). Si estaba
   * a mitad de una transición, el controlador no puede quedar en una escala cualquiera (NM-6, diseño §9): termina en el
   * nivel más cercano a la escala mostrada, con τ de los niveles y anclado al centro de la vista (instantáneo con
   * movimiento reducido). Si ya estaba en reposo, ese reposo (fraccional o no) es válido y se queda.
   */
  function stopAuto() {
    autoActive = false;
    anchor = null;
    state.tx = state.cx;
    state.ty = state.cy;
    if (state.mode === 'auto') state.mode = 'manual';
    if (state.kShown === state.k) {
      state.level = indexOfLevel(state.k * fd);
      return;
    }
    zoomTo(lv[nearestIndex(state.kShown * fd)], 0.5, 0.5, cfg.ease.level);
    if (reducedPrev) {
      state.kShown = state.k;
      applyAnchor();
    }
  }
  /** Reevalúa el objetivo de la automática con el estado del sim y arma la meta (ease-out lento, τ de la automática). */
  function evaluateAuto(sv) {
    const r = autoTarget(sv, prevFocus, cfg.auto);
    anchor = null;
    tauK = tauP = cfg.auto.tau;
    if (r.all) {
      prevFocus = null;
      state.k = 1;
      state.level = 0;
      setTarget(WORLD.w / 2, WORLD.h / 2);
      return;
    }
    prevFocus = r.focus;
    const rest = restScale(r.k * fd, fd);
    state.k = rest / fd;
    state.level = indexOfLevel(rest);
    setTarget(r.cx, r.cy);
  }
  /** Tras un reposo entre niveles (cámara automática), el paneo pasa al nivel más cercano con τ 0,1 s. */
  function snapToLevel() {
    if (state.level >= 0) return;
    zoomTo(lv[nearestIndex(state.k * fd)], 0.5, 0.5, cfg.ease.level);
  }
  /** Arrastre sin tomar el control (lo usan las flechas sostenidas y `panBy`). */
  function pan(dx, dy) {
    snapToLevel();
    const s = state.kShown * fd;
    if (anchor) {
      anchor.wx -= dx / s;
      anchor.wy -= dy / s;
      [state.tx, state.ty] = centerFromAnchor(state.k);
      applyAnchor();
    } else {
      state.cx -= dx / s;
      state.cy -= dy / s;
      clampShown();
      state.tx = state.cx;
      state.ty = state.cy;
    }
  }
  function center(wx, wy) {
    snapToLevel();
    anchor = { wx, wy, fx: 0.5, fy: 0.5 };
    [state.tx, state.ty] = centerFromAnchor(state.k);
    applyAnchor();
    if (anchor) return;
    state.tx = state.cx;
    state.ty = state.cy;
  }
  /** Ver todo, sin tocar el reloj de entrada. */
  function viewAllNow(instant) {
    anchor = null;
    follower = null;
    state.k = 1;
    state.level = 0;
    state.tx = WORLD.w / 2;
    state.ty = WORLD.h / 2;
    tauK = tauP = cfg.ease.preset;
    if (instant) {
      state.kShown = 1;
      state.cx = state.tx;
      state.cy = state.ty;
      state.mode = 'manual';
    } else state.mode = 'preset';
  }

  /** Suma intención logarítmica de zoom (rueda o pellizco) y cambia de nivel al pasar el punto medio geométrico. */
  function applyIntent(ln, px, py) {
    takeControl();
    if (!finite(ln, px, py) || ln === 0) return;
    if (t - intentT > cfg.wheel.idleResetMs / 1000) intent = 0; // el resto se descarta tras 300 ms sin eventos
    intentT = t;
    intent += ln;
    if (intent === 0) return;
    const sCur = state.k * fd;
    const sStar = sCur * Math.exp(intent);
    let idx = -1;
    if (intent > 0) {
      const up = lv.findIndex((s) => s > sCur * (1 + LEVEL_EPS));
      if (up < 0) {
        intent = 0; // contra el tope no se acumula
        return;
      }
      if (sStar >= Math.sqrt(sCur * lv[up])) idx = Math.max(up, nearestIndex(sStar));
    } else {
      let dn = -1;
      for (let i = 0; i < lv.length; i++) if (lv[i] < sCur * (1 - LEVEL_EPS)) dn = i;
      if (dn < 0) {
        intent = 0;
        return;
      }
      if (sStar <= Math.sqrt(sCur * lv[dn])) idx = Math.min(dn, nearestIndex(sStar));
    }
    if (idx < 0) return;
    zoomTo(lv[idx], clamp01(px / W), clamp01(py / H), cfg.ease.level);
    intent = Math.log(sStar / lv[idx]); // lo que sobró cuenta para el gesto siguiente
  }
  /** Factor de zoom (doble toque, +/−, botones): al nivel más cercano a s·factor y como mínimo al vecino. */
  function applyFactor(f, px, py) {
    takeControl();
    if (!finite(f) || f <= 0 || f === 1) return;
    const sCur = state.k * fd;
    let idx = nearestIndex(sCur * f);
    if (f > 1) {
      const up = lv.findIndex((s) => s > sCur * (1 + LEVEL_EPS));
      if (up < 0) return;
      idx = Math.max(idx, up);
    } else {
      let dn = -1;
      for (let i = 0; i < lv.length; i++) if (lv[i] < sCur * (1 - LEVEL_EPS)) dn = i;
      if (dn < 0) return;
      idx = Math.min(idx, dn);
    }
    zoomTo(lv[idx], finite(px) ? clamp01(px / W) : 0.5, finite(py) ? clamp01(py / H) : 0.5, cfg.ease.level);
  }

  const ctl = {
    state,
    cfg,
    levels: () => lv,
    get fd() {
      return fd;
    },
    /** Reloj de vista en segundos. */
    get clock() {
      return t;
    },
    /** Texto del estado visible en batalla: "CÁMARA AUTO" mientras la automática maneja, y si no "CÁMARA MANUAL". */
    status() {
      return state.mode === 'auto' ? CAMERA_TEXT.auto : CAMERA_TEXT.manual;
    },
    /**
     * La tecla `A` y el botón: enciende o apaga la automática. Alternarla no es mover la cámara, así que no reinicia el
     * contador de inactividad. Apagarla en pleno movimiento deja la vista donde está.
     * @returns {{on: boolean, notice: string}}
     */
    toggleAuto() {
      state.autoEnabled = !state.autoEnabled;
      if (!state.autoEnabled && autoActive) stopAuto();
      return { on: state.autoEnabled, notice: state.autoEnabled ? CAMERA_TEXT.autoOn : CAMERA_TEXT.autoOff };
    },
    /**
     * El movimiento reducido cambió (`R`, el sistema o la config). Al ENCENDERSE apaga la automática y devuelve el aviso
     * "Cámara automática: desactivada" (solo si estaba encendida); al apagarse deja `A` como estaba.
     * @param {boolean} reduced
     * @returns {string | null}
     */
    syncReduced(reduced) {
      const now = Boolean(reduced);
      const was = reducedPrev;
      reducedPrev = now;
      if (now && !was && state.autoEnabled) {
        state.autoEnabled = false;
        if (autoActive) stopAuto();
        return CAMERA_TEXT.autoOff;
      }
      return null;
    },
    /** Reloj de vista de la última entrada de cámara del narrador (los movimientos automáticos no lo cambian). */
    get lastStreamerInput() {
      return lastInput;
    },

    /**
     * Entradas del narrador. Todas toman el control en el mismo tick. Posiciones en px de dispositivo del lienzo.
     *   wheel   {dy, deltaMode, ctrl, x, y}   rueda por intención (con Ctrl el paso grande; líneas ×16, páginas ×300)
     *   intent  {ln, x, y}                    pellizco: intención logarítmica de zoom con ancla en el punto medio
     *   factor  {f, x?, y?}                   doble toque, +/− y botones
     *   press   {}                            pointer-down: solo toma el control
     *   drag    {dx, dy}                      arrastre 1:1
     *   keys    {x, y}                        flechas sostenidas (-1, 0, 1)
     *   minimap {wx, wy}                      centra la vista en un punto del mundo
     * @param {string} kind
     * @param {any} p
     */
    input(kind, p = {}) {
      switch (kind) {
        case 'wheel': {
          const mult = p.deltaMode === 1 ? 16 : p.deltaMode === 2 ? 300 : 1;
          const step = p.ctrl ? cfg.wheel.ctrlStep : cfg.wheel.step;
          applyIntent(-p.dy * mult * step, finite(p.x) ? p.x : W / 2, finite(p.y) ? p.y : H / 2);
          break;
        }
        case 'intent':
          applyIntent(p.ln, finite(p.x) ? p.x : W / 2, finite(p.y) ? p.y : H / 2);
          break;
        case 'factor':
          applyFactor(p.f, p.x, p.y);
          break;
        case 'press':
          takeControl();
          break;
        case 'drag':
          takeControl();
          if (finite(p.dx, p.dy)) pan(p.dx, p.dy);
          break;
        case 'keys':
          takeControl();
          keys.x = Math.sign(Number(p.x)) || 0;
          keys.y = Math.sign(Number(p.y)) || 0;
          break;
        case 'minimap':
          takeControl();
          if (finite(p.wx, p.wy)) center(p.wx, p.wy);
          break;
        default:
          break;
      }
    },

    /** Escala (nivel) `i`, manteniendo bajo el cursor (fracción `fx`, `fy` del lienzo) el punto del mundo que ya estaba. */
    zoomToLevel(i, fx = 0.5, fy = 0.5) {
      takeControl();
      const idx = Math.max(0, Math.min(lv.length - 1, Math.trunc(i)));
      zoomTo(lv[idx], clamp01(fx), clamp01(fy), cfg.ease.level);
    },
    /** Arrastre 1:1 en px de dispositivo (el mundo sigue al dedo). */
    panBy(dx, dy) {
      takeControl();
      pan(dx, dy);
    },
    /** Minimapa: centra la vista en un punto del mundo (recortado). */
    centerOn(wx, wy) {
      takeControl();
      center(wx, wy);
    },
    /** Ver todo: k = 1 centrado, con transición. */
    viewAll() {
      takeControl();
      viewAllNow(false);
    },
    /** Cada ronda empieza con el mapa entero, instantáneo; no es entrada del narrador (solo reinicia el contador). */
    newRound() {
      autoActive = false;
      prevFocus = null;
      viewAllNow(true);
      keys.x = keys.y = 0;
      intent = 0;
      state.idle = 0;
    },
    /**
     * Espacio: la pelea más caliente en este momento, UNA vez (no deja la automática manejando). Va a un nivel entero:
     * el más alto con `s` ≤ la que pide el encuadre; si la acción está repartida, al mapa entero.
     * @param {Parameters<typeof autoTarget>[0]} sv vista del sim
     */
    hottest(sv) {
      takeControl();
      anchor = null;
      tauK = tauP = cfg.ease.preset;
      const r = autoTarget(sv, null, cfg.auto);
      if (r.all) {
        state.k = 1;
        state.level = 0;
        setTarget(WORLD.w / 2, WORLD.h / 2);
      } else {
        let i = 0;
        for (let j = 0; j < lv.length; j++) if (lv[j] <= r.k * fd * (1 + LEVEL_EPS)) i = j;
        state.k = lv[i] / fd;
        state.level = i;
        setTarget(r.cx, r.cy);
      }
      state.mode = 'preset';
    },
    /**
     * Vista manual inicial e instantánea (los parámetros de desarrollo `?k`, `?cx` y `?cy`): el nivel más cercano a
     * `k` y el centro dado, recortado. Cuenta como entrada del narrador.
     * @param {{k?: number, cx?: number, cy?: number}} [o]
     */
    jumpTo({ k = 1, cx = WORLD.w / 2, cy = WORLD.h / 2 } = {}) {
      takeControl();
      anchor = null;
      const i = !finite(k) || k <= 1 ? 0 : nearestIndex(k * fd);
      state.k = state.kShown = lv[i] / fd;
      state.level = i;
      setTarget(finite(cx) ? cx : WORLD.w / 2, finite(cy) ? cy : WORLD.h / 2);
      state.cx = state.tx;
      state.cy = state.ty;
    },
    /** Base izquierda (0) o derecha (1), en el nivel más alto con k ≤ 2,25. */
    focusBase(side) {
      takeControl();
      anchor = null;
      const i = closeLevel();
      state.k = lv[i] / fd;
      state.level = i;
      tauK = tauP = cfg.ease.preset;
      setTarget(side === 0 ? 100 : 1340, WORLD.h / 2);
      state.mode = 'preset';
    },
    /** Sigue a alguien: `getPoint()` da su posición en el mundo en cada cuadro (se recorta al mundo). */
    follow(getPoint) {
      takeControl();
      snapToLevel(); // desde un reposo fraccional heredado de la automática se sigue en un nivel
      anchor = null;
      follower = getPoint;
      tauK = tauP = cfg.ease.preset;
      if (state.level === 0 && state.k === 1) {
        const i = closeLevel();
        state.k = lv[i] / fd;
        state.level = i;
      }
      state.mode = 'follow';
    },
    /**
     * Dejar de seguir (Shift+S, lote 6) es una entrada del narrador: reinicia el contador de inactividad (NM-4). El
     * soltado automático cuando la unidad seguida desaparece (lote 6) NO es una entrada y no debe pasar por aquí.
     */
    stopFollow() {
      touch();
      follower = null;
      state.tx = state.cx;
      state.ty = state.cy;
      if (state.mode === 'follow') state.mode = 'manual';
    },
    /** El lienzo cambió de tamaño: los niveles se recalculan y la vista queda en el más cercano. */
    resize(w2, h2) {
      const k = state.k;
      W = w2;
      H = h2;
      fd = fitScale(W, H);
      lv = levelsFor(W, H, cfg.kMax);
      const i = k === 1 ? 0 : nearestIndex(k * fd);
      state.level = i;
      state.k = state.kShown = lv[i] / fd;
      anchor = null;
      clampShown();
      setTarget(state.cx, state.cy);
    },

    /**
     * Avanza el reloj de vista `dt` segundos: contador de inactividad, flechas, automática, zoom logarítmico, centro y
     * seguimiento. `sv` es la vista del sim (`simViewOf`) mientras haya batalla; sin ella la automática no corre.
     * @param {number} dt
     * @param {Parameters<typeof autoTarget>[0] | null} [sv]
     */
    update(dt, sv = null) {
      if (!(dt > 0)) return;
      t += dt;
      state.idle += dt;
      if (keys.x !== 0 || keys.y !== 0) {
        // flechas sostenidas: 0,6 vistas por segundo a velocidad plena desde el primer cuadro, sin suavizado
        touch();
        pan(-keys.x * cfg.panSpeed * W * dt, -keys.y * cfg.panSpeed * H * dt);
      }
      if (follower) {
        const p = follower();
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) setTarget(p.x, p.y);
      }
      // la automática toma el control tras `idleSeconds` sin entrada del narrador y reevalúa cada `every` segundos
      if (state.autoEnabled && sv && !follower && state.idle >= cfg.idleSeconds) {
        if (!autoActive) {
          autoActive = true;
          nextEval = t;
        }
        state.mode = 'auto';
        if (t >= nextEval) {
          nextEval = t + cfg.auto.every;
          evaluateAuto(sv);
        }
      } else if (autoActive) stopAuto();
      if (state.kShown !== state.k) {
        const lk = Math.log(state.kShown);
        const d = Math.log(state.k) - lk;
        state.kShown = Math.abs(d) < K_DONE || tauK <= 0 ? state.k : Math.exp(lk + d * (1 - Math.exp(-dt / tauK)));
      }
      if (anchor) applyAnchor();
      else {
        const a = 1 - Math.exp(-dt / tauP);
        const dx = state.tx - state.cx;
        const dy = state.ty - state.cy;
        state.cx = Math.abs(dx) < 0.01 ? state.tx : state.cx + dx * a;
        state.cy = Math.abs(dy) < 0.01 ? state.ty : state.cy + dy * a;
      }
      clampShown();
      if (state.mode === 'preset' && state.kShown === state.k && state.cx === state.tx && state.cy === state.ty) {
        state.mode = 'manual';
      }
    },

    /**
     * La vista para dibujar: esquina `(x0, y0)` en px de mundo y escala mostrada `s`, con la esquina en px ENTEROS de
     * dispositivo (el paneo avanza de a 1 px) y dentro del mundo. Si el mundo cabe en la vista (k = 1), va centrado.
     * @param {{x0?: number, y0?: number, s?: number, w?: number, h?: number, k?: number}} [out] se reutiliza
     */
    viewRect(out = {}) {
      const s = state.kShown * fd;
      const vw = W / s;
      const vh = H / s;
      const axis = (c, v, size, dev) => {
        const span = size * s - dev; // px de dispositivo de mundo que sobran de la vista
        if (span <= 0) return Math.round(span / 2) + 0;
        const o = Math.round((c - v / 2) * s);
        return Math.min(Math.floor(span + 1e-9), Math.max(0, o)) + 0;
      };
      out.x0 = axis(state.cx, vw, WORLD.w, W) / s;
      out.y0 = axis(state.cy, vh, WORLD.h, H) / s;
      out.s = s;
      out.w = vw;
      out.h = vh;
      out.k = state.kShown;
      return out;
    },
  };
  return ctl;
}
