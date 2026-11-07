// Cámara automática (diseño D23, R6; NM-4): encuadra GRUPOS, no unidades. `autoTarget` es una función del estado del
// sim: sin RNG ni reloj de pared, el mismo estado da el mismo objetivo. Es vista y vive en `camera/`, así que puede
// usar `Math.exp`; la prohibición de trascendentes es solo para `sim/`.
//
// La vista del sim que lee (`sv`) la arma `simViewOf(world, heat)` y SOLO se lee: nada aquí escribe en objetos del sim.
// Los eventos recientes (explosiones, golpes a la base, torretas) llegan por el mismo `world.drain()` por cuadro que
// reparte la escena (`rig.consume`); nunca hay un segundo vaciado.

import { SHARP_BELOW } from '../render/scale.js';

/** Peso de un miembro en el calor de su grupo: soldado 1, jeep 2, tanque 3, pesado 4 (R6). */
export const KIND_WEIGHT = Object.freeze({ soldado: 1, jeep: 2, tanque: 3, pesado: 4 });

/** Duración del calor de un evento, en segundos, y su constante de decaimiento. */
const HEAT_LIFE = 5;
const HEAT_TAU = 2.5;
const SIM_HZ = 30;
/** Un golpe a la base calienta como mucho una vez cada 0,8 s por base. */
const BASE_HIT_GAP = Math.round(0.8 * SIM_HZ);
/** Los eventos de la base van en (60 | 1380, 448), como en el v3. */
const BASE_X = [60, 1380];
const BASE_Y = 448;

/** Cantidad fija de eventos de calor recordados: un anillo, así no se reserva memoria por evento. */
export const HEAT_SLOTS = 256;

/**
 * Calor de eventos recientes. Cada entrada es `{x, y, w, step}`; `w = 0` es una entrada vacía.
 */
export function createHeat() {
  const slots = Array.from({ length: HEAT_SLOTS }, () => ({ x: 0, y: 0, w: 0, step: -1e9 }));
  let head = 0;
  const lastBaseHit = [-1e9, -1e9];
  const heat = {
    slots,
    /** Anota un foco de calor `w` en (x, y) en el paso `step`; si el anillo está lleno pisa el más viejo. */
    add(x, y, w, step) {
      const s = slots[head];
      head = (head + 1) % HEAT_SLOTS;
      s.x = x;
      s.y = y;
      s.w = w;
      s.step = step;
      return s;
    },
    /**
     * Convierte los eventos de UN paso del sim (lo que devolvió `world.drain()`) en calor. Solo lee el mundo.
     * @param {any[]} events
     * @param {any} world
     */
    consume(events, world) {
      const step = world.step;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        switch (e.type) {
          case 'shot': // obús del tanque (2) o del pesado (4), en su blanco
            if (e.kind === 'tanque') heat.add(e.tx, e.ty, 2, step);
            else if (e.kind === 'pesado') heat.add(e.tx, e.ty, 4, step);
            break;
          case 'bombImpact':
            heat.add(e.x, e.y, 2, step);
            break;
          case 'death': {
            const w = e.kind === 'jeep' ? 2 : e.kind === 'tanque' ? 4 : e.kind === 'pesado' ? 8 : 0;
            if (w > 0) heat.add(e.x, e.y, w, step);
            break;
          }
          case 'baseHit':
            if (step - lastBaseHit[e.side] >= BASE_HIT_GAP) {
              lastBaseHit[e.side] = step;
              heat.add(BASE_X[e.side], BASE_Y, 2, step);
            }
            break;
          case 'turretDown': {
            const t = world.bases[e.side].turrets[e.k];
            heat.add(t.x, t.y, 6, step);
            break;
          }
          case 'roundEnd':
            for (let side = 0; side < 2; side++) {
              if (world.bases[side].hp <= 0) heat.add(BASE_X[side], BASE_Y, 14, step);
            }
            break;
          default:
            break;
        }
      }
    },
    /** Una ronda nueva: no queda calor. */
    reset() {
      for (const s of slots) {
        s.w = 0;
        s.step = -1e9;
      }
      lastBaseHit[0] = lastBaseHit[1] = -1e9;
    },
  };
  return heat;
}

const KINDS = ['soldado', 'jeep', 'tanque', 'pesado'];

/**
 * Arma (o actualiza) la vista del sim que lee `autoTarget`: referencias al mundo, sin copiar nada.
 * @param {any} world
 * @param {ReturnType<typeof createHeat>} heat
 * @param {any} [out] se reutiliza
 */
export function simViewOf(world, heat, out = {}) {
  out.step = world.step;
  out.squads = world.squads;
  out.planes = world.planes;
  out.dir ??= [1, -1];
  out.dir[0] = world.field.sides[0].dir;
  out.dir[1] = world.field.sides[1].dir;
  out.range ??= {};
  for (const k of KINDS) out.range[k] = world.cfg.units[k].range;
  out.events = heat.slots;
  return out;
}

const ALL = Object.freeze({ all: true });
const MAX_FOCI = 640;
const FX = new Float64Array(MAX_FOCI);
const FY = new Float64Array(MAX_FOCI);
const FW = new Float64Array(MAX_FOCI);

/**
 * El encuadre que la cámara automática pide, o `{all: true}` para el mapa entero. Es una función del estado.
 *
 * Focos (nunca por unidad): cada grupo TRABADO aporta un punto en su ancla corrido `dir·alcance/2` hacia el enemigo,
 * con el peso de sus miembros; cada evento reciente, `w·exp(−edad/2,5 s)` hasta los 5 s; cada avión, un punto adelante
 * en su ruta con peso 3. El calor de un foco es la suma de pesos dentro de ±135×±83. Gana el de más calor; el actual se
 * conserva mientras tenga ≥ 80 % del mejor. Si el mejor no llega al 30 % del total, o el total es chico, mapa entero.
 *
 * @param {{
 *   step: number, squads: any[], planes: any[], dir: number[], range: Record<string, number>,
 *   events: {x: number, y: number, w: number, step: number}[]
 * }} sv
 * @param {{x: number, y: number} | null | undefined} prev foco elegido la vez anterior
 * @param {ReturnType<import('./config.js').resolveView>['auto']} cfg
 * @returns {{all: true} | {cx: number, cy: number, k: number, focus: {x: number, y: number}}}
 */
export function autoTarget(sv, prev, cfg) {
  let n = 0;
  let groups = 0;
  let total = 0;
  const add = (x, y, w) => {
    if (n >= MAX_FOCI || !(w > 0)) return;
    FX[n] = x;
    FY[n] = y;
    FW[n] = w;
    total += w;
    n++;
  };
  for (const sq of sv.squads) {
    if (!sq.locked || sq.members.length === 0) continue;
    let w = 0;
    for (const m of sq.members) w += KIND_WEIGHT[m.kind] ?? 1;
    add(sq.anchor.x + (sv.dir[sq.side] * (sv.range[sq.kind] ?? 28)) / 2, sq.anchor.y, w);
    groups++;
  }
  for (const e of sv.events) {
    if (!(e.w > 0)) continue;
    const age = (sv.step - e.step) / SIM_HZ;
    if (age < 0 || age > HEAT_LIFE) continue;
    add(e.x, e.y, e.w * Math.exp(-age / HEAT_TAU));
  }
  for (const p of sv.planes) add(p.x + p.vx * 1.2, p.y - p.z / 2, 3);

  if (n === 0 || total < 1.5 || (total < 3 && groups < 2)) return ALL;

  const [winX, winY] = cfg.heatBox;
  const heatAt = (x, y) => {
    let h = 0;
    for (let j = 0; j < n; j++) if (Math.abs(FX[j] - x) <= winX && Math.abs(FY[j] - y) <= winY) h += FW[j];
    return h;
  };
  let best = 0;
  let bestHeat = -1;
  for (let i = 0; i < n; i++) {
    const h = heatAt(FX[i], FY[i]);
    if (h > bestHeat + 1e-12) {
      best = i;
      bestHeat = h;
    }
  }
  if (bestHeat < cfg.spread * total) return ALL;
  let fx = FX[best];
  let fy = FY[best];
  if (prev && heatAt(prev.x, prev.y) >= cfg.keep * bestHeat) {
    fx = prev.x;
    fy = prev.y;
  }

  // encuadre: centro y dispersión ponderados de los focos a ±240×±150 del elegido
  const [frameX, frameY] = cfg.frame;
  let sw = 0;
  let mx = 0;
  let my = 0;
  for (let j = 0; j < n; j++) {
    if (Math.abs(FX[j] - fx) > frameX || Math.abs(FY[j] - fy) > frameY) continue;
    sw += FW[j];
    mx += FW[j] * FX[j];
    my += FW[j] * FY[j];
  }
  if (sw > 0) {
    mx /= sw;
    my /= sw;
  } else {
    // ningún foco cae en el encuadre (el foco previo conservado queda lejos): se centra en el foco y sin dispersión
    sw = 1;
    mx = fx;
    my = fy;
  }
  let vx = 0;
  let vy = 0;
  for (let j = 0; j < n; j++) {
    if (Math.abs(FX[j] - fx) > frameX || Math.abs(FY[j] - fy) > frameY) continue;
    vx += FW[j] * (FX[j] - mx) * (FX[j] - mx);
    vy += FW[j] * (FY[j] - my) * (FY[j] - my);
  }
  const sx = Math.sqrt(vx / sw);
  const sy = Math.sqrt(vy / sw);
  const hx = Math.max(cfg.minHalf[0], 2 * sx + 45);
  const hy = Math.max(cfg.minHalf[1], 2 * sy + 36);
  // 0,6 deja aire para las bandas del HUD; con hy ≥ 124 el último término da como máximo 486/248 = 1,96: la perilla
  // real es minHalf, no maxK (H5)
  const k = Math.max(1, Math.min(cfg.maxK, 1440 / (2 * hx), (0.6 * 810) / (2 * hy)));
  // el campo libre va de y 40 a y 222 de 270 (diseño §10.1): su centro queda 0,015 de la altura por encima del centro
  // de la pantalla, así que el centro de la vista baja 0,015·810/k (+y) y la pelea queda sobre el centro
  return { cx: mx, cy: my + (cfg.hudLift * 810) / k, k, focus: { x: fx, y: fy } };
}

/** Justo debajo de SHARP_BELOW (1,9 − 0,01): ahí reposa una automática que pidió una `s` en [1,9, 2). */
const JUST_BELOW = 1.89;

/**
 * Escala a la que reposa la cámara automática (NM-6 v2.3). Con `s` < 1,9 reposa en esa `s` fraccional y se dibuja con el
 * modo que la tabla da para ella (nítido; suave con marcas bajo 1); en [1,9, 2) se recorta a 1,89, donde el vecino más
 * cercano se vería desparejo; desde 2 baja al entero. Nunca baja de la escala de ajuste `fd`.
 * @param {number} s escala pedida (k·fd)
 * @param {number} fd escala de ajuste al mapa entero
 */
export function restScale(s, fd) {
  let r = s;
  if (s >= 2 - 1e-9) r = Math.floor(s + 1e-9);
  else if (s >= SHARP_BELOW) r = JUST_BELOW;
  return Math.max(fd, r);
}

// ---------------------------------------------------------------------------------------------------------------
// Momento de regalo grande (NM-5)

/** Peso del foco de un momento de regalo grande; decae como cualquier otro evento (2,5 s, hasta los 5 s). */
const MOMENT_WEIGHT = 6;

/**
 * Cola de momentos de regalo grande. Un momento SIEMPRE da su banner (lo vacía el lote 6 con `drainBanners`); además,
 * si está activado y no hay movimiento reducido, suma un foco de peso 6 que decae al calor de la cámara automática.
 * No toma el control de la cámara: solo la automática lo ve, y solo si está encendida y lleva `idleSeconds` sin entrada.
 * La cola de focos tiene un máximo (`limit`): al pasarse sale el más viejo. Un momento vencido (5 s) no cuenta.
 *
 * @param {{heat: ReturnType<typeof createHeat>, enabled?: boolean, limit?: number, coins?: number}} o
 *   `coins`: desde cuántas monedas un regalo es "grande" (`graphics.bigGiftCoins`)
 */
export function createMoments({ heat, enabled = true, limit = 3, coins = 500 }) {
  /** @type {{slot: {x: number, y: number, w: number, step: number}, step: number, x: number, y: number}[]} */
  const queue = [];
  /** @type {{kind: string, x: number, y: number, coins: number, owner: string | null, slide: boolean}[]} */
  let banners = [];
  const prune = (step) => {
    while (queue.length > 0 && step - queue[0].step > HEAT_LIFE * SIM_HZ) queue.shift();
  };
  const moments = {
    /**
     * @param {{kind: string, x: number, y: number, coins?: number, owner?: string | null}} m
     * @param {{step: number, reduced: boolean}} ctx `reduced`: movimiento reducido (banner sin deslizar, sin cámara)
     * @returns {{banner: true, camera: boolean}}
     */
    push(m, { step, reduced }) {
      banners.push({ kind: m.kind, x: m.x, y: m.y, coins: m.coins ?? 0, owner: m.owner ?? null, slide: !reduced });
      if (!enabled || reduced) return { banner: true, camera: false };
      prune(step);
      queue.push({ slot: heat.add(m.x, m.y, MOMENT_WEIGHT, step), step, x: m.x, y: m.y });
      while (queue.length > limit) {
        const old = queue.shift();
        // el anillo de calor puede haber reciclado la entrada: solo se apaga si sigue siendo la suya
        if (old.slot.step === old.step && old.slot.x === old.x && old.slot.y === old.y) old.slot.w = 0;
      }
      return { banner: true, camera: true };
    },
    /** Un regalo del público: es momento si llega al umbral de monedas (`null` si no). */
    gift(g, ctx) {
      if (!(g.coins >= coins)) return null;
      return moments.push({ ...g, kind: 'gift' }, ctx);
    },
    /** Momentos con foco todavía vivo. */
    active(step) {
      prune(step);
      return queue.length;
    },
    /** Los banners pendientes, en orden; el consumidor (lote 6) los muestra con su cola y su ritmo. */
    drainBanners() {
      const out = banners;
      banners = [];
      return out;
    },
    reset() {
      queue.length = 0;
      banners = [];
    },
  };
  return moments;
}
