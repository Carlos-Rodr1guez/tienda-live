// Grupos en formación (diseño D15, CB-22): lugares fijos respecto del ancla, ancla con aproximación, línea de
// fuego (trabado), bloqueo entre grupos amigos, bloqueo mutuo y cambio de calle. El comandante (lote 4c) decide
// roles, corredores, calles y puestos; aquí está el movimiento. Sin azar: mismo estado, mismo resultado.

import { DT } from './defaults.js';
import { ATTACK_LANES, laneY } from './field.js';
import { arriveVelocity, clampMagnitude, firingDistance, limitDelta, updateFacing } from './steer.js';
import { initialCooldown } from './units.js';

const PLACE = { x: 0, y: 0 };
const BOX_MARGIN = 3; // separación mínima en y entre cajas (footMargin)
const MUTUAL_STEPS = 30; // 1 s frenándose uno al otro

/** Distancia (al cuadrado) a la que el que cierra filas llega a su lugar: la misma tolerancia que la reunión (1 px). */
export const ARRIVE_D2 = 1;

const ORDENES = new Map();

/**
 * Orden lateral de las columnas de una fila de `F` lugares, del centro hacia afuera: `c = ⌊(F − 1)/2⌋`, luego
 * `c − 1`, `c + 1`, `c − 2`, `c + 2`... dentro de `[0, F)`. F=5: 2, 1, 3, 0, 4; F=2: 0, 1; F=1: 0.
 * @returns {number[]}
 */
export function ordenF(F) {
  let o = ORDENES.get(F);
  if (o === undefined) {
    const c = Math.floor((F - 1) / 2);
    o = [c];
    for (let k = 1; o.length < F; k++) {
      if (c - k >= 0) o.push(c - k);
      if (c + k < F) o.push(c + k);
    }
    ORDENES.set(F, o);
  }
  return o;
}

/**
 * Desplazamiento del lugar `slot` respecto del ancla (centro del frente): fila `r = ⌊slot / F⌋`, posición lateral
 * `p = ORDEN_F[slot mod F]`, `(−dir·(r·dx + z), (p − (F − 1)/2)·dy)` con `z` el zigzag de las `p` impares. No depende
 * de cuántos miembros hay: las columnas quedan alineadas y nada se re-centra (enmienda v2.5, CB-21).
 * Devuelve un objeto reutilizado: leerlo enseguida.
 * @returns {{x:number,y:number}}
 */
export function placeOffset(cfg, kind, slot, dir) {
  const f = cfg.squads.formation[kind];
  const F = f.width;
  const r = Math.floor(slot / F);
  const p = ordenF(F)[slot - r * F];
  const z = f.zigzag && p % 2 === 1 ? f.zigzag : 0;
  PLACE.x = -dir * (r * (f.dx || 0) + z) + 0; // + 0 evita el -0
  PLACE.y = (p - (F - 1) / 2) * f.dy;
  return PLACE;
}

/** Fondo (hasta dónde llega el último lugar detrás del ancla) y semialto de un conjunto de lugares. */
function slotsExtent(cfg, kind, slots) {
  const f = cfg.squads.formation[kind];
  const F = f.width;
  const orden = ordenF(F);
  let fondo = 0;
  let hw = 0;
  for (const slot of slots) {
    if (slot < 0) continue;
    const r = Math.floor(slot / F);
    const p = orden[slot - r * F];
    const z = f.zigzag && p % 2 === 1 ? f.zigzag : 0;
    fondo = Math.max(fondo, r * (f.dx || 0) + z);
    hw = Math.max(hw, Math.abs((p - (F - 1) / 2) * f.dy));
  }
  return { fondo, hw: hw + cfg.units[kind].foot[1] / 2 };
}

/** Los lugares `0..n−1`. */
function firstSlots(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/**
 * Fondo y semialto de la formación NOMINAL de `n` miembros (los lugares `0..n−1`): el grupo candidato y `haltDistance`.
 * El semialto incluye la mitad de la huella en y.
 */
export function formationExtent(cfg, kind, n) {
  return slotsExtent(cfg, kind, firstSlots(n));
}

function boxFrom(cfg, kind, { fondo, hw }) {
  const half = cfg.units[kind].foot[0] / 2;
  return { front: half, rear: fondo + half, hw, fondo };
}

/** Caja nominal de un grupo de `n` miembros (lugares `0..n−1`): cuánto sobresale delante y detrás del ancla, y su semialto. */
export function boxOf(cfg, kind, n) {
  return boxFrom(cfg, kind, formationExtent(cfg, kind, n));
}

/**
 * Caja de un grupo existente: sale de los lugares OCUPADOS y, para los que cierran filas, también de su lugar de
 * partida (`fromSlot`), así siempre contiene al que todavía camina desde atrás. Se achica si una columna se acorta.
 */
export function squadBox(cfg, sq) {
  const slots = [];
  for (const u of sq.members) {
    slots.push(u.slot);
    if (u.fromSlot >= 0) slots.push(u.fromSlot);
  }
  return boxFrom(cfg, sq.kind, slotsExtent(cfg, sq.kind, slots));
}

/** El lugar libre de índice más bajo del grupo (sin contar el `fromSlot` de quien cierra filas). */
export function freeSlot(sq) {
  for (let slot = 0; ; slot++) {
    let usado = false;
    for (const u of sq.members) {
      if (u.slot === slot) {
        usado = true;
        break;
      }
    }
    if (!usado) return slot;
  }
}

/** Distancia de la posición de tiro: la fila de atrás queda a `alcance − 3` del blanco (soldado 13, jeep 7, ...). */
export function haltDistance(cfg, kind) {
  return cfg.units[kind].range - formationExtent(cfg, kind, cfg.squads.size[kind]).fondo - 3;
}

/** Fuerza de un grupo: Σ c·hp/maxHp (la usan el avión y la energía). */
export function squadStrength(sq) {
  let s = 0;
  for (const u of sq.members) s += u.stats.c * (u.hp / u.maxHp);
  return s;
}

/**
 * Crea un grupo vacío. Las unidades se agregan con `addUnit`.
 * @param {any} world
 * @param {{side:0|1, kind:string, role?:string, state?:string, corridor?:number, lane?:number, x:number, y:number,
 *   owner?:any, sector?:number, post?:number, postLane?:string|null, assembly?:object|null, postPos?:object|null,
 *   pinned?:boolean}} o
 */
export function createSquad(world, o) {
  const sq = {
    id: ++world.nextSquadId,
    side: o.side,
    kind: o.kind,
    role: o.role ?? 'ataque',
    state: o.state ?? 'advance',
    open: false,
    members: [],
    anchor: { x: o.x, y: o.y, vx: 0, vy: 0 },
    corridor: o.corridor ?? 1,
    lane: o.lane ?? ATTACK_LANES.centro,
    sector: o.sector ?? -1,
    post: o.post ?? -1,
    postLane: o.postLane ?? null,
    firstArrivalStep: -1,
    departStep: -1,
    interceptSeen: 0,
    afterConvert: null,
    pinned: o.pinned ?? false,
    engagedSteps: 0,
    idleSteps: 0,
    locked: false,
    // destinos que fija el comandante (lote 4c)
    assembly: o.assembly ?? null,
    postPos: o.postPos ?? null,
    interceptGoal: null,
    // bloqueo y deslizamientos
    blockedBy: 0,
    blockedSteps: 0,
    lastBlocker: 0,
    sideStep: 0,
    slideY: 0,
    nextLane: o.lane ?? ATTACK_LANES.centro,
    // caja actual (se recalcula en cada paso)
    blo: 0,
    bhi: 0,
    hw: 0,
    wvx: 0,
    wvy: 0,
    dFreno: 0,
    owner: o.owner ?? null,
    formationWidth: world.cfg.squads.formation[o.kind].width,
  };
  world.squads.push(sq);
  return sq;
}

/**
 * Agrega una unidad al grupo en el lugar libre de índice más bajo (`u.slot`) y la pone en (x, y). `o.owner` es la
 * clave del usuario (o null) y `o.value` su valor al nacer (`unitValue`; 0 para las gratis).
 * @returns {any} la unidad
 */
export function addUnit(world, sq, x, y, o = {}) {
  const stats = world.stats[sq.kind];
  const id = ++world.nextId;
  const dir = world.field.sides[sq.side].dir;
  const u = {
    id,
    side: sq.side,
    kind: sq.kind,
    squad: sq,
    stats,
    hp: stats.hp,
    maxHp: stats.hp,
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    dir,
    faceSteps: 0,
    cd: initialCooldown(id, stats.cdSteps),
    tgt: null,
    tgtKind: '',
    alive: true,
    owner: o.owner ?? null,
    unitValue: o.value ?? 0,
    valueAlive: o.value ?? 0,
    dmgBy: null,
    arrived: false,
    slot: freeSlot(sq),
    fromSlot: -1,
  };
  sq.members.push(u);
  world.units.push(u);
  return u;
}

/**
 * Quita del grupo a una unidad muerta y cierra filas (enmienda v2.5, CB-21): sale de `members` con `splice` (los demás
 * conservan su orden) y cada miembro de SU MISMA COLUMNA que estaba detrás avanza un lugar (`slot -= F`). El lugar
 * vacío queda al fondo de esa columna; nadie de otra columna cambia ni se re-centra. Quien avanza anota de dónde sale
 * en `fromSlot` (si ya caminaba, conserva el original) hasta que llega.
 */
export function removeMember(sq, u) {
  const i = sq.members.indexOf(u);
  if (i < 0) return;
  sq.members.splice(i, 1);
  const F = sq.formationWidth;
  const s = u.slot;
  for (const v of sq.members) {
    if (v.slot > s && v.slot % F === s % F) {
      if (v.fromSlot < 0) v.fromSlot = v.slot;
      v.slot -= F;
      if (sq.state === 'forming') v.arrived = false; // la reunión espera a que llegue a su lugar nuevo
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Paso de los grupos (pasos 11 y 12 del orden de §7.2)

function updateBox(world, sq) {
  const b = squadBox(world.cfg, sq);
  const a = sq.anchor;
  if (world.field.sides[sq.side].dir > 0) {
    sq.blo = a.x - b.rear;
    sq.bhi = a.x + b.front;
  } else {
    sq.blo = a.x - b.front;
    sq.bhi = a.x + b.rear;
  }
  sq.hw = b.hw;
}

/**
 * ¿La caja de `sq`, extendida `pLo` hacia atrás y `pHi` hacia adelante en x, toca la de `o`? Un grupo que se desliza
 * de calle (`converting`) también ocupa su calle de destino: así quien viene detrás frena antes de que el deslizado
 * le caiga encima.
 */
function touches(sq, o, pLo, pHi) {
  if (!(sq.bhi + pHi > o.blo && sq.blo - pLo < o.bhi)) return false;
  const sep = sq.hw + o.hw + BOX_MARGIN;
  return (
    Math.abs(sq.anchor.y - o.anchor.y) < sep || (o.state === 'converting' && Math.abs(sq.anchor.y - o.slideY) < sep)
  );
}

/** Objetivo del ancla de un grupo de ataque: posición de tiro a la torreta o al frente, o al enemigo que viene. */
function advanceGoal(world, sq, out) {
  const { field } = world;
  const side = field.sides[sq.side];
  const e = 1 - sq.side;
  const dir = side.dir;
  const a = sq.anchor;
  const ly = laneY(field, sq.corridor, sq.lane);
  const st = sq.stats ?? (sq.stats = world.stats[sq.kind]);
  const fondo = world.fondoFull[sq.kind];
  const halt = world.halt[sq.kind];
  out.y = ly;
  const eb = world.bases[e];
  if (eb.hp <= 0) {
    out.x = a.x; // la base cayó: la ronda termina, el grupo se queda
    return;
  }
  let gx;
  const turret = eb.turrets[sq.corridor];
  if (turret.hp > 0) {
    const fd = firingDistance(st.range, fondo, turret.y - ly);
    if (fd >= 0) gx = turret.x - dir * fd;
  }
  if (gx === undefined) gx = field.sides[e].frontX - dir * halt;
  // frenado anticipado: un enemigo de tierra delante a ≤ haltD + dFreno pasa a ser el objetivo
  const reach = halt + sq.dFreno;
  const bw = sq.hw + 10;
  const n = world.grids[e].nearest(a.x, a.y, reach + bw, (o) => (o.x - a.x) * dir > -6 && Math.abs(o.y - a.y) < bw);
  if (n !== null && (n.x - a.x) * dir <= reach) {
    const fd = firingDistance(st.range, fondo, n.y - ly);
    if (fd >= 0) {
      const gx2 = n.x - dir * fd;
      gx = dir > 0 ? Math.min(gx, gx2) : Math.max(gx, gx2);
    }
  }
  out.x = gx;
}

const GOAL = { x: 0, y: 0 };

/** Paso 11: línea de fuego, objetivo, bloqueo y movimiento del ancla de cada grupo. */
export function stepSquadAnchors(world) {
  const { cfg, squads } = world;
  const sc = cfg.squads;
  const release = Math.round(sc.releaseSeconds / DT);

  // pasada 1: trabado o libre y velocidad deseada
  for (const sq of squads) {
    sq.stats = world.stats[sq.kind];
    const a = sq.anchor;
    const sp = sq.stats.speed;
    const vmaxA = sc.anchorSpeedFactor * sp;
    let engaged = false;
    for (let i = 0; i < sq.members.length; i++) {
      if (sq.members[i].tgt !== null) {
        engaged = true;
        break;
      }
    }
    if (engaged) {
      sq.engagedSteps++;
      sq.idleSteps = 0;
      sq.locked = true;
    } else {
      sq.idleSteps++;
      if (sq.locked && sq.idleSteps >= release) sq.locked = false;
    }
    const v2 = a.vx * a.vx + a.vy * a.vy;
    sq.dFreno = v2 / (2 * sc.anchorDecel * vmaxA);
    updateBox(world, sq);

    let wx = 0;
    let wy = 0;
    if (sq.sideStep !== 0) {
      wy = sq.sideStep * sc.slideSpeedFactor * sp;
    } else if (sq.state === 'converting') {
      const dy = sq.slideY - a.y;
      if (Math.abs(dy) < 0.05) {
        a.y = sq.slideY;
        a.vy = 0;
        sq.lane = sq.nextLane;
        sq.state = sq.afterConvert ?? 'advance';
        sq.afterConvert = null;
      } else {
        wy = Math.sign(dy) * Math.min(sc.slideSpeedFactor * sp, sc.anchorArrive * Math.abs(dy));
      }
    }
    if (sq.sideStep === 0 && sq.state !== 'converting') {
      let gx = a.x;
      let gy = a.y;
      if (sq.state === 'advance') {
        advanceGoal(world, sq, GOAL);
        gx = GOAL.x;
        gy = GOAL.y;
      } else if (sq.state === 'forming' && sq.assembly) {
        gx = sq.assembly.x;
        gy = sq.assembly.y;
      } else if ((sq.state === 'toPost' || sq.state === 'holding') && sq.postPos) {
        gx = sq.postPos.x;
        gy = sq.postPos.y;
      } else if (sq.state === 'intercept' && sq.interceptGoal) {
        gx = sq.interceptGoal.x;
        gy = sq.interceptGoal.y;
      }
      if (!sq.locked) {
        const w = arriveVelocity(gx - a.x, gy - a.y, vmaxA, sc.anchorArrive);
        wx = w.x;
        wy = w.y;
      }
      if (sq.state === 'toPost') {
        const ex = gx - a.x;
        const ey = gy - a.y;
        const quieto = a.vx * a.vx + a.vy * a.vy < 0.01;
        // llegó, o quedó frenado detrás del grupo del puesto de adelante (los puestos de jeeps están a 46 px)
        if ((Math.abs(ex) < 1 && Math.abs(ey) < 1) || (sq.blockedBy !== 0 && quieto && ex * ex + ey * ey <= 144)) {
          sq.state = 'holding';
        }
      }
    }
    sq.wvx = wx;
    sq.wvy = wy;
  }

  // pasada 2: bloqueo general con las cajas congeladas de la pasada 1
  for (const sq of squads) {
    sq.blockedBy = 0;
    if (sq.sideStep !== 0) {
      let libre = true;
      for (const o of squads) {
        if (o === sq || o.side !== sq.side || o.members.length === 0) continue;
        if (touches(sq, o, 0, 0)) {
          libre = false;
          break;
        }
      }
      if (libre) sq.sideStep = 0;
      continue;
    }
    if (sq.members.length === 0) continue;
    const a = sq.anchor;
    const proj = Math.max(Math.abs(a.vx), Math.abs(sq.wvx)) * DT + sq.dFreno + sc.followGap;
    const mv = sq.wvx !== 0 ? Math.sign(sq.wvx) : Math.sign(a.vx);
    const pLo = mv < 0 ? proj : 0;
    const pHi = mv > 0 ? proj : 0;
    if (mv === 0) continue;
    for (const o of squads) {
      if (o === sq || o.side !== sq.side || o.members.length === 0) continue;
      if (touches(sq, o, pLo, pHi)) {
        sq.blockedBy = o.id;
        break;
      }
    }
  }
  for (const sq of squads) {
    if (sq.blockedBy !== 0) {
      sq.blockedSteps = sq.blockedSteps > 0 && sq.lastBlocker === sq.blockedBy ? sq.blockedSteps + 1 : 1;
      sq.lastBlocker = sq.blockedBy;
    } else {
      sq.blockedSteps = 0;
      sq.lastBlocker = 0;
    }
  }
  // bloqueo mutuo: durante 1 s se frenan uno al otro; el de id mayor se corre de costado hasta despejar
  for (const sq of squads) {
    if (sq.blockedBy === 0 || sq.blockedSteps < MUTUAL_STEPS) continue;
    const o = squads.find((x) => x.id === sq.blockedBy);
    if (o && o.blockedBy === sq.id && o.blockedSteps >= MUTUAL_STEPS && sq.id > o.id) {
      sq.sideStep = sq.anchor.y >= o.anchor.y ? 1 : -1;
    }
  }

  // pasada 3: integra el ancla
  for (const sq of squads) {
    const a = sq.anchor;
    const sp = sq.stats.speed;
    const vmaxA = sc.anchorSpeedFactor * sp;
    let wx = sq.wvx;
    let wy = sq.wvy;
    if (sq.blockedBy !== 0 && sq.sideStep === 0) {
      wx = 0;
      wy = sq.state === 'converting' ? wy : 0;
    }
    const accelUp = wx * wx + wy * wy >= a.vx * a.vx + a.vy * a.vy;
    const lim = (accelUp ? sc.anchorAccel : sc.anchorDecel) * vmaxA * DT;
    const v = limitDelta(a.vx, a.vy, wx, wy, lim);
    a.vx = v.x;
    a.vy = v.y;
    a.x += a.vx * DT;
    a.y += a.vy * DT;
    const g = world.field.ground;
    const lo = g[0] + sq.hw;
    const hi = g[1] - sq.hw;
    if (a.y < lo) {
      a.y = lo;
      a.vy = 0;
    } else if (a.y > hi) {
      a.y = hi;
      a.vy = 0;
    }
  }
}

/** Paso 12: aproximación de cada unidad a su lugar, orientación y recorte al suelo. */
export function stepUnits(world) {
  const { cfg, field } = world;
  const sc = cfg.squads;
  const hold = Math.round(sc.faceHoldSeconds / DT);
  const g = field.ground;
  for (const sq of world.squads) {
    const a = sq.anchor;
    const dir = field.sides[sq.side].dir;
    const n = sq.members.length;
    const still = Math.abs(a.vx) + Math.abs(a.vy) < 0.05;
    // mientras marcha en formación, el desvío lateral no pasa del avance (CB-22)
    const latCap = sq.state !== 'converting' && sq.sideStep === 0 && Math.abs(a.vx) > 1e-9 ? Math.abs(a.vx) : -1;
    for (let i = 0; i < n; i++) {
      const u = sq.members[i];
      const vmax = u.stats.speed;
      const off = placeOffset(cfg, sq.kind, u.slot, dir);
      const sx = a.x + off.x;
      const sy = a.y + off.y;
      const ex = sx - u.x;
      const ey = sy - u.y;
      // el ancla ya se movió en este paso: el error que corrige la unidad es el de antes de ese movimiento
      const cx = ex - a.vx * DT;
      const cy = ey - a.vy * DT;
      // el ajuste final a 0 solo vale si el salto de velocidad cabe en el límite de aceleración (|Δv| ≤ aMax·DT)
      const vel = Math.abs(u.vx) + Math.abs(u.vy);
      if (still && Math.abs(ex) <= sc.snapPx && Math.abs(ey) <= sc.snapPx && vel <= sc.unitAccel * vmax * DT) {
        u.x = sx;
        u.y = sy;
        u.vx = 0;
        u.vy = 0;
      } else {
        let dvx = a.vx + sc.unitArrive * cx;
        let dvy = a.vy + sc.unitArrive * cy;
        if (latCap >= 0 && Math.abs(dvy) > latCap) dvy = Math.sign(dvy) * latCap;
        const c = clampMagnitude(dvx, dvy, vmax);
        dvx = c.x;
        dvy = c.y;
        const v = limitDelta(u.vx, u.vy, dvx, dvy, sc.unitAccel * vmax * DT);
        u.vx = v.x;
        u.vy = v.y;
        u.x += u.vx * DT;
        u.y += u.vy * DT;
        if (u.y < g[0]) {
          u.y = g[0];
          u.vy = 0;
        } else if (u.y > g[1]) {
          u.y = g[1];
          u.vy = 0;
        }
      }
      if (u.fromSlot >= 0) {
        // cierra filas: llegó cuando está a ≤ 1 px de su lugar nuevo
        const rx = sx - u.x;
        const ry = sy - u.y;
        if (rx * rx + ry * ry <= ARRIVE_D2) u.fromSlot = -1;
      }
      updateFacing(u, u.tgt === null ? null : targetX(u) - u.x, vmax, hold);
    }
  }
}

/** x del blanco de una unidad: la unidad o torreta, o el frente de la base. */
export function targetX(u) {
  return u.tgtKind === 'base' ? u.tgt.frontX : u.tgt.x;
}

// ---------------------------------------------------------------------------------------------------------------
// Cambio de calle (en el tick del comandante)

/**
 * Un grupo de ataque frenado por otro que está trabado o va a < 0,9 de su velocidad, a menos de 24 px, pasa a la
 * primera calle de ataque libre de su corredor (centro > jeep > bajo, sin contar la actual), con caja libre a lo
 * largo de ±64 px. Se desliza a ≤ 0,5·vmax; si no hay ninguna libre, espera detrás.
 */
export function laneChangeTick(world) {
  const { cfg, squads } = world;
  const sp = cfg.squads;
  for (const sq of squads) {
    if (sq.role !== 'ataque' || sq.state !== 'advance' || sq.blockedBy === 0 || sq.sideStep !== 0) continue;
    const o = squads.find((x) => x.id === sq.blockedBy);
    if (!o) continue;
    const dir = world.field.sides[sq.side].dir;
    const gap = dir > 0 ? o.blo - sq.bhi : sq.blo - o.bhi;
    if (gap >= 24) continue;
    const slow = Math.abs(o.anchor.vx) < 0.9 * sp.anchorSpeedFactor * sq.stats.speed;
    if (!(o.locked || slow)) continue;
    for (const lane of [ATTACK_LANES.centro, ATTACK_LANES.jeep, ATTACK_LANES.bajo]) {
      if (lane === sq.lane) continue;
      const y = laneY(world.field, sq.corridor, lane);
      if (laneIsFree(world, sq, y)) {
        sq.state = 'converting';
        sq.slideY = y;
        sq.nextLane = lane;
        break;
      }
    }
  }
}

/**
 * ¿Está libre la calle de altura `y` para `sq`? Ningún grupo amigo (ni su destino, si se desliza) ocupa, a lo largo
 * de ±64 px de la caja de `sq`, la calle ni las alturas que cruza al deslizarse (prueba de caja libre de D15 y D28).
 */
export function laneIsFree(world, sq, y) {
  const y0 = sq.anchor.y;
  const sgn = y >= y0 ? 1 : -1;
  for (const q of world.squads) {
    if (q === sq || q.side !== sq.side || q.members.length === 0) continue;
    const dx = q.bhi > sq.blo - 64 && q.blo < sq.bhi + 64;
    if (!dx) continue;
    const sep = q.hw + sq.hw + BOX_MARGIN;
    // el deslizamiento barre las alturas entre la salida de su propia banda y el destino: ninguna caja amiga en medio
    const a = sgn > 0 ? Math.min(y0 + sep, y) : Math.max(y0 - sep, y);
    const lo = Math.min(a, y) - sep;
    const hi = Math.max(a, y) + sep;
    // el que ya se desliza ocupa también su calle de destino
    const dest = q.state === 'converting' ? q.slideY : q.anchor.y;
    if ((q.anchor.y > lo && q.anchor.y < hi) || (dest > lo && dest < hi)) return false;
  }
  return true;
}
