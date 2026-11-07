// Comandante por lado (diseño D28, CB-21): reglas fijas, sin azar, sin reloj de pared y sin input del narrador.
// Decide el rol, el corredor, la calle y el puesto de cada grupo en su alta; lleva la cuota de DEFENSA, el
// rebalanceo con histéresis de Schmitt, la compactación de puestos y las intercepciones; y gobierna la reunión
// (llegadas, cierres y salidas). Ubica los grupos por ancla y los pesa por SOLDADOS VIVOS (enmienda v2.5, CB-21):
// un grupo pesa `peso × vivos / tamaño`, con peso 2 (tanque, pesado) o 1.
// Todo en enteros: las cuentas van en L-avos de grupo (L = mcm de los tamaños, 20 por defecto) y la cuota en cuartos
// de punto, también escalada por L. Solo el HUD divide por L, para mostrar.

import { DT } from './defaults.js';
import { ATTACK_LANES, corridorOf, laneY } from './field.js';
import { boxOf, laneIsFree, placeOffset, squadBox } from './squads.js';

/** Banda de la histéresis (15 puntos = 60 cuartos por grupo) y separación entre conversiones (4 s). */
export const BAND_QUARTERS = 60;
export const CONVERT_GAP_STEPS = 120;
/** Prueba de lugar libre: 6 px en x y 3 px en y. */
export const SPOT_MARGIN_X = 6;
export const SPOT_MARGIN_Y = 3;
/** Desempate de corredores y sectores: medio > arriba > abajo. */
const TIE_RANK = [1, 0, 2];
/** Calle de ataque propia de cada tipo (`ASUB` del v3). */
const OWN_LANE = Object.freeze({
  soldado: ATTACK_LANES.centro,
  jeep: ATTACK_LANES.jeep,
  tanque: ATTACK_LANES.bajo,
  pesado: ATTACK_LANES.bajo,
});
/** Calle de puestos de la DEFENSA: soldados en A, jeeps en B. Tanques y pesado no defienden. */
const POST_LANE = Object.freeze({ soldado: 'A', jeep: 'B' });

// ---------------------------------------------------------------------------------------------------------------
// Funciones puras (cuota, rol, orden de calles)

/** Peso de un grupo lleno: 2 si es de tanques o del pesado; 1 si no (un grupo de gratis pesa 1). */
export const squadWeight = (sq) => (sq.kind === 'tanque' || sq.kind === 'pesado' ? 2 : 1);

const mcd = (a, b) => (b === 0 ? a : mcd(b, a % b));
const escalas = new WeakMap();

/** `L`: mcm de los tamaños de grupo de la config (20 por defecto). Se calcula una vez por config. */
export function scaleL(cfg) {
  const sizes = cfg.squads.size;
  let L = escalas.get(sizes);
  if (L === undefined) {
    L = 1;
    for (const k of Object.keys(sizes)) L = (L / mcd(L, sizes[k])) * sizes[k];
    escalas.set(sizes, L);
  }
  return L;
}

/** Cuenta de un grupo en L-avos: `vivos × L / tamaño`. Un grupo lleno cuenta L. */
export const cL = (cfg, sq) => sq.members.length * (scaleL(cfg) / cfg.squads.size[sq.kind]);

/** Peso de un grupo en L-avos: `peso × vivos × L / tamaño`. Un grupo lleno pesa `peso × L`. */
export const wL = (cfg, sq) => squadWeight(sq) * cL(cfg, sq);

/**
 * Cuota de DEFENSA en cuartos de punto, escalada por `L`: `60L + 15·min(4L,H) + 30·min(4L,Z) + 4L·bias`, recortada a
 * [0, 340L]. `H` y `Z` vienen en L-avos. Con `L = 1` (por defecto) es la cuota en cuartos sin escalar.
 */
export function quotaQuarters(H, Z, bias = 0, L = 1) {
  const q = 60 * L + 15 * Math.min(4 * L, H) + 30 * Math.min(4 * L, Z) + 4 * L * bias;
  return Math.max(0, Math.min(340 * L, q));
}

/** Cuota de DEFENSA en puntos (15 a 85). */
export const shareQ = (H, Z, bias = 0) => quotaQuarters(H, Z, bias) / 4;

/**
 * Rol de un grupo nuevo. Tanques y pesado, siempre ATAQUE. Soldados y jeeps van a DEFENSA si
 * `400·L·(D + L) ≤ q·(S + L)` (enteros; `S` y `D` en L-avos, `q` en cuartos escalados por `L`) y su calle de puestos
 * tiene un puesto alcanzable. El grupo nuevo se planea sin miembros y cuenta completo: suma `+L`.
 * @param {{kind:string, S:number, D:number, q:number, postReachable:boolean, L?:number}} o
 * @returns {'ataque'|'defensa'}
 */
export function roleFor({ kind, S, D, q, postReachable, L = 1 }) {
  if (kind !== 'soldado' && kind !== 'jeep') return 'ataque';
  return postReachable && 400 * L * (D + L) <= q * (S + L) ? 'defensa' : 'ataque';
}

/** Calles de ataque en el orden de prueba: la de su tipo, centro, jeep, bajo, sin repetir. */
export function laneOrder(kind) {
  const own = OWN_LANE[kind];
  return [own, ...[ATTACK_LANES.centro, ATTACK_LANES.jeep, ATTACK_LANES.bajo].filter((l) => l !== own)];
}

export const postLaneOf = (kind) => POST_LANE[kind] ?? null;

/** Índices 0..2 ordenados por costo ascendente y, a igual costo, medio > arriba > abajo. */
function orderByCost(costs) {
  return [0, 1, 2].sort((a, b) => costs[a] - costs[b] || TIE_RANK[a] - TIE_RANK[b]);
}

// ---------------------------------------------------------------------------------------------------------------
// Lectura del mundo

const live = (sq) => sq.members.length > 0;

/** Grupos de un lado con miembros. */
function squadsOf(world, side) {
  const out = [];
  for (const sq of world.squads) if (sq.side === side && live(sq)) out.push(sq);
  return out;
}

/** `H` y `Z` en L-avos: peso (por vivos) de los grupos enemigos con el ancla en la mitad propia y en la zona de defensa propia. */
export function pressure(world, side) {
  const { field } = world;
  const own = field.sides[side];
  let H = 0;
  let Z = 0;
  for (const e of world.squads) {
    if (e.side === side || !live(e)) continue;
    const x = e.anchor.x;
    if ((x - field.midX) * own.dir < 0) {
      const w = wL(world.cfg, e);
      H += w;
      if (x >= own.defenseZone[0] && x <= own.defenseZone[1]) Z += w;
    }
  }
  return { H, Z };
}

/** Cuota actual del lado, en cuartos de punto escalados por `L`. */
export function currentQuota(world, side) {
  const { H, Z } = pressure(world, side);
  return quotaQuarters(H, Z, world.cfg.commander.bias, scaleL(world.cfg));
}

/** Costo de cada corredor (L-avos) para un grupo de ATAQUE nuevo: Σw enemigos con el ancla en la franja + Σw propios de ATAQUE ahí. */
function corridorCosts(world, side) {
  const costs = [0, 0, 0];
  for (const sq of world.squads) {
    if (!live(sq)) continue;
    if (sq.side !== side) costs[corridorOf(world.field, sq.anchor.y)] += wL(world.cfg, sq);
    else if (sq.role === 'ataque') costs[sq.corridor] += wL(world.cfg, sq);
  }
  return costs;
}

/** Corredores en el orden en que los prueba un grupo de ATAQUE nuevo. */
export const corridorOrder = (world, side) => orderByCost(corridorCosts(world, side));

/** Costo de cada sector para la DEFENSA: Σw propios de DEFENSA ahí − Σw enemigos en la mitad propia y la franja − L si la torreta cayó (en L-avos). */
function sectorCosts(world, side) {
  const { field } = world;
  const own = field.sides[side];
  const costs = [0, 0, 0];
  for (const sq of world.squads) {
    if (!live(sq)) continue;
    if (sq.side === side) {
      if (sq.role === 'defensa' && sq.sector >= 0) costs[sq.sector] += wL(world.cfg, sq);
    } else if ((sq.anchor.x - field.midX) * own.dir < 0) {
      costs[corridorOf(field, sq.anchor.y)] -= wL(world.cfg, sq);
    }
  }
  const turrets = world.bases[side].turrets;
  const L = scaleL(world.cfg);
  for (let c = 0; c < 3; c++) if (turrets[c].hp <= 0) costs[c] -= L;
  return costs;
}

/** Rango en x y semialto de una caja `b` con el ancla en `x`. */
function boxAt(b, x, dir) {
  return dir > 0 ? { lo: x - b.rear, hi: x + b.front, hw: b.hw } : { lo: x - b.front, hi: x + b.rear, hw: b.hw };
}

/**
 * ¿Está libre el lugar de espera (x, y)? Ningún grupo propio encima: los rangos en x se solapan con 6 px de margen y
 * `|dy| < hw_a + hw_b + 3`. La caja del grupo nuevo es la del grupo lleno de su tipo.
 */
export function spotFree(world, side, kind, x, y) {
  const dir = world.field.sides[side].dir;
  const c = boxAt(boxOf(world.cfg, kind, world.cfg.squads.size[kind]), x, dir);
  for (const o of world.squads) {
    if (o.side !== side || !live(o)) continue;
    const b = boxAt(squadBox(world.cfg, o), o.anchor.x, dir);
    const enX = b.hi + SPOT_MARGIN_X > c.lo && b.lo - SPOT_MARGIN_X < c.hi;
    if (enX && Math.abs(o.anchor.y - y) < c.hw + b.hw + SPOT_MARGIN_Y) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Puestos

/** Puestos ocupados por los grupos de DEFENSA de un sector y una calle. */
function occupiedPosts(world, side, sector, lane, except = null) {
  const set = new Set();
  for (const sq of world.squads) {
    if (sq === except || sq.side !== side || !live(sq) || sq.role !== 'defensa') continue;
    if (sq.sector === sector && sq.postLane === lane && sq.post >= 0) set.add(sq.post);
  }
  return set;
}

/**
 * Primer puesto libre y alcanzable (índice 0 = el más adelantado), o -1. Alcanzable: ningún puesto ocupado entre él y
 * la puerta, o sea ningún ocupado de índice mayor.
 */
export function reachablePost(world, side, sector, lane, except = null) {
  const rows = world.cfg.commander.postRows;
  const occ = occupiedPosts(world, side, sector, lane, except);
  let maxOcc = -1;
  for (const p of occ) if (p > maxOcc) maxOcc = p;
  for (let i = 0; i < rows; i++) if (!occ.has(i) && i > maxOcc) return i;
  return -1;
}

const postPosition = (world, side, sector, lane, idx) => {
  const p = world.field.sides[side].sectors[sector].posts[lane][idx];
  return { x: p.x, y: p.y };
};

/** Sectores con puesto alcanzable en la calle del tipo, por costo (empate medio > arriba > abajo). */
function sectorOrder(world, side, kind, except = null) {
  const lane = postLaneOf(kind);
  if (lane === null) return [];
  const costs = sectorCosts(world, side);
  return orderByCost(costs).filter((s) => reachablePost(world, side, s, lane, except) >= 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Alta: rol, corredor/sector, calle y puesto de un grupo nuevo

function attackSpot(world, side, kind) {
  const s = world.field.sides[side];
  for (const c of corridorOrder(world, side)) {
    for (const lane of laneOrder(kind)) {
      const y = s.gates[c] + s.subLanes[lane];
      if (spotFree(world, side, kind, s.gateX[kind], y)) return { corridor: c, lane, x: s.gateX[kind], y };
    }
  }
  return null;
}

function defenseSpot(world, side, kind) {
  const s = world.field.sides[side];
  const lane = postLaneOf(kind);
  if (lane === null) return null;
  for (const sector of sectorOrder(world, side, kind)) {
    const y = s.sectors[sector].y + s.postLanes[lane];
    if (spotFree(world, side, kind, s.gateX[kind], y)) return { sector, x: s.gateX[kind], y };
  }
  return null;
}

/**
 * Plan del alta de un grupo nuevo de `kind`: rol, corredor, calle, sector, puesto y lugar de espera; o `null` si no hay
 * ningún lugar libre (saturación: la cabeza de la cola espera). No cambia el estado.
 * @returns {null | {role:'ataque'|'defensa', corridor:number, lane:number, sector:number, postLane:string|null,
 *   post:number, x:number, y:number, postPos:{x:number,y:number}|null}}
 */
export function planAlta(world, side, kind) {
  const s = world.field.sides[side];
  const squads = squadsOf(world, side);
  let S = 0;
  let D = 0;
  for (const sq of squads) {
    const c = cL(world.cfg, sq);
    S += c;
    if (sq.role === 'defensa') D += c;
  }
  const pl = postLaneOf(kind);
  const order = sectorOrder(world, side, kind);
  const role = roleFor({
    kind,
    S,
    D,
    q: currentQuota(world, side),
    postReachable: order.length > 0,
    L: scaleL(world.cfg),
  });
  if (role === 'ataque') {
    const spot = attackSpot(world, side, kind);
    if (spot) {
      const { corridor, lane, x, y } = spot;
      return { role, corridor, lane, sector: -1, postLane: null, post: -1, x, y, postPos: null };
    }
    // respaldo: solo soldados y jeeps con algún lugar libre de DEFENSA; el bloqueo general lo frena detrás
    if (pl !== null && defenseSpot(world, side, kind) !== null) {
      const corridor = corridorOrder(world, side)[0];
      const lane = OWN_LANE[kind];
      const y = s.gates[corridor] + s.subLanes[lane];
      return { role, corridor, lane, sector: -1, postLane: null, post: -1, x: s.gateX[kind], y, postPos: null };
    }
    return null;
  }
  const spot = defenseSpot(world, side, kind);
  if (!spot && attackSpot(world, side, kind) === null) return null;
  const sector = spot ? spot.sector : order[0];
  const post = reachablePost(world, side, sector, pl);
  return {
    role,
    corridor: sector,
    lane: ATTACK_LANES.centro,
    sector,
    postLane: pl,
    post,
    x: s.gateX[kind],
    y: spot ? spot.y : s.sectors[sector].y + s.postLanes[pl],
    postPos: postPosition(world, side, sector, pl, post),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reunión: llegadas, cierres y salidas (paso 13)

/** ¿Acepta miembros? Tiene un lugar libre y le quedan ≥ `joinMinSeconds` antes de salir por tiempo. */
export function acceptsMember(world, sq) {
  const sc = world.cfg.squads;
  if (sq.state !== 'forming' || sq.members.length >= sc.size[sq.kind]) return false;
  if (sq.firstArrivalStep < 0) return true;
  return world.step - sq.firstArrivalStep < Math.round((sc.departSeconds - sc.joinMinSeconds) / DT);
}

/** El grupo abierto de un tipo y lado (a lo sumo uno), o null. */
export function findOpen(world, side, kind) {
  for (const sq of world.squads) {
    if (sq.side === side && sq.kind === kind && live(sq) && acceptsMember(world, sq)) return sq;
  }
  return null;
}

function depart(world, sq) {
  sq.open = false;
  sq.assembly = null;
  sq.departStep = world.step;
  sq.state = sq.role === 'defensa' ? 'toPost' : 'advance';
  world.emit({ type: 'squadDepart', id: sq.id, side: sq.side, role: sq.role, kind: sq.kind, n: sq.members.length });
}

/** Paso 13: marca las llegadas (a ≤ 1 px del lugar), cierra los grupos y manda a salir a los que cumplen. */
export function stepAssembly(world) {
  const sc = world.cfg.squads;
  const departSteps = Math.round(sc.departSeconds / DT);
  for (const sq of world.squads) {
    if (sq.state !== 'forming' || !live(sq)) {
      sq.open = false;
      continue;
    }
    const n = sq.members.length;
    const dir = world.field.sides[sq.side].dir;
    let arrived = 0;
    for (let i = 0; i < n; i++) {
      const u = sq.members[i];
      if (!u.arrived) {
        const off = placeOffset(world.cfg, sq.kind, u.slot, dir);
        const dx = sq.anchor.x + off.x - u.x;
        const dy = sq.anchor.y + off.y - u.y;
        if (dx * dx + dy * dy <= 1) u.arrived = true;
      }
      if (u.arrived) arrived++;
    }
    if (arrived > 0 && sq.firstArrivalStep < 0) sq.firstArrivalStep = world.step;
    const full = n >= sc.size[sq.kind];
    const timeUp = sq.firstArrivalStep >= 0 && world.step - sq.firstArrivalStep >= departSteps;
    if ((full && arrived === n) || timeUp) depart(world, sq);
    else sq.open = acceptsMember(world, sq);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tick del comandante (2 Hz): H, Z, cuota, rebalanceo, compactación de puestos, intercepciones

function setPost(world, sq, post) {
  sq.post = post;
  sq.postPos = postPosition(world, sq.side, sq.sector, sq.postLane, post);
  if (sq.state === 'holding') sq.state = 'toPost';
}

/** En cada tick, un grupo en su puesto avanza a la fila libre que tenga delante: la calle queda contigua desde adelante. */
function compactPosts(world, side) {
  for (let sector = 0; sector < 3; sector++) {
    for (const lane of ['A', 'B']) {
      const list = [];
      for (const sq of world.squads) {
        if (sq.side !== side || !live(sq) || sq.role !== 'defensa') continue;
        if (sq.sector === sector && sq.postLane === lane && sq.post >= 0) list.push(sq);
      }
      if (list.length === 0) continue;
      list.sort((a, b) => a.post - b.post || a.id - b.id);
      for (let k = 0; k < list.length; k++) if (list[k].post !== k) setPost(world, list[k], k);
    }
  }
}

/** DEFENSA en su puesto: sale a interceptar al grupo enemigo más cercano dentro de la zona y del radio; vuelve al perderlo. */
function interceptions(world, side) {
  const { field, cfg } = world;
  const s = field.sides[side];
  const r2 = cfg.commander.interceptRadius * cfg.commander.interceptRadius;
  const lose = Math.round(cfg.commander.interceptLoseSeconds / DT);
  const [zlo, zhi] = s.defenseZone;
  for (const sq of world.squads) {
    if (sq.side !== side || !live(sq) || sq.role !== 'defensa' || !sq.postPos) continue;
    if (sq.state !== 'holding' && sq.state !== 'intercept') continue;
    let best = null;
    let bd = Infinity;
    for (const e of world.squads) {
      if (e.side === side || !live(e) || e.state === 'forming') continue;
      if (e.anchor.x < zlo || e.anchor.x > zhi) continue;
      const dx = e.anchor.x - sq.postPos.x;
      const dy = e.anchor.y - sq.postPos.y;
      const d = dx * dx + dy * dy;
      if (d <= r2 && d < bd) {
        best = e;
        bd = d;
      }
    }
    if (best !== null) {
      const gx = best.anchor.x - s.dir * world.halt[sq.kind];
      sq.interceptGoal = { x: Math.max(zlo, Math.min(zhi, gx)), y: best.anchor.y };
      sq.interceptSeen = world.step;
      sq.state = 'intercept';
    } else if (sq.state === 'intercept' && world.step - sq.interceptSeen >= lose) {
      sq.interceptGoal = null;
      sq.state = 'toPost';
    }
  }
}

function startConvert(world, sq, y, afterState, nextLane, side) {
  sq.state = 'converting';
  sq.slideY = y;
  sq.nextLane = nextLane;
  sq.afterConvert = afterState;
  world.cmd[side].lastConvert = world.step;
  world.emit({ type: 'convert', id: sq.id, side, role: sq.role });
}

/**
 * Hacia DEFENSA: el grupo de ataque (soldados o jeeps) salido más cercano a la base propia que tenga un puesto delante
 * y cuyo deslizamiento hasta la calle del puesto esté libre (empate: id menor). Sin ninguno elegible no convierte.
 */
function convertToDefense(world, side) {
  const s = world.field.sides[side];
  let best = null;
  let bd = Infinity;
  for (const sq of world.squads) {
    if (sq.side !== side || !live(sq) || sq.role !== 'ataque' || sq.state !== 'advance' || sq.pinned) continue;
    const lane = postLaneOf(sq.kind);
    if (lane === null) continue;
    // elegible: con un puesto delante y con el deslizamiento hasta la calle del puesto libre (DV25-8, CB-22)
    const sectors = sectorOrder(world, side, sq.kind, sq).filter((c) => {
      const p = reachablePost(world, side, c, lane, sq);
      const pos = postPosition(world, side, c, lane, p);
      return (pos.x - sq.anchor.x) * s.dir >= 0 && laneIsFree(world, sq, pos.y);
    });
    if (sectors.length === 0) continue;
    const d = Math.abs(sq.anchor.x - s.frontX);
    if (d < bd || (d === bd && sq.id < best.sq.id)) {
      best = { sq, sector: sectors[0], lane };
      bd = d;
    }
  }
  if (best === null) return false;
  const { sq, sector, lane } = best;
  const post = reachablePost(world, side, sector, lane, sq);
  sq.role = 'defensa';
  sq.sector = sector;
  sq.corridor = sector;
  sq.postLane = lane;
  sq.post = post;
  sq.postPos = postPosition(world, side, sector, lane, post);
  startConvert(world, sq, sq.postPos.y, 'toPost', sq.lane, side);
  return true;
}

/** Primera calle de ataque libre de `laneOrder` para el grupo de DEFENSA `sq` (o -1 si no hay ninguna). */
function freeAttackLane(world, sq) {
  for (const l of laneOrder(sq.kind)) if (laneIsFree(world, sq, laneY(world.field, sq.sector, l))) return l;
  return -1;
}

/**
 * Hacia ATAQUE: el grupo de DEFENSA salido con más miembros vivos (empate: id menor) entre los que tienen alguna calle
 * de ataque libre; conserva el corredor y toma la primera calle libre. Sin ninguno elegible no convierte: no hay
 * respaldo a una calle ocupada (DV25-8, CB-22).
 */
function convertToAttack(world, side) {
  let best = null;
  let bestLane = -1;
  for (const sq of world.squads) {
    if (sq.side !== side || !live(sq) || sq.role !== 'defensa' || sq.pinned) continue;
    if (sq.state !== 'toPost' && sq.state !== 'holding' && sq.state !== 'intercept') continue;
    if (best !== null && sq.members.length <= best.members.length) continue;
    const l = freeAttackLane(world, sq);
    if (l < 0) continue;
    best = sq;
    bestLane = l;
  }
  if (best === null) return false;
  const sq = best;
  const lane = bestLane;
  sq.role = 'ataque';
  sq.corridor = sq.sector;
  sq.sector = -1;
  sq.postLane = null;
  sq.post = -1;
  sq.postPos = null;
  sq.interceptGoal = null;
  startConvert(world, sq, laneY(world.field, sq.corridor, lane), 'advance', lane, side);
  return true;
}

/** Rebalanceo con histéresis de Schmitt, sin rearme por flanco (D28 §5). */
function rebalance(world, side) {
  const cmd = world.cmd[side];
  const squads = squadsOf(world, side);
  const L = scaleL(world.cfg);
  let S = 0;
  let D = 0;
  for (const sq of squads) {
    const c = cL(world.cfg, sq);
    S += c;
    if (sq.role === 'defensa') D += c;
  }
  if (S === 0) {
    cmd.rebal = 0;
    return;
  }
  const val = 400 * L * D - cmd.q * S;
  let justOff = false;
  if (cmd.rebal !== 0 && ((cmd.rebal < 0 && val >= 0) || (cmd.rebal > 0 && val <= 0))) {
    cmd.rebal = 0;
    justOff = true;
  }
  if (cmd.rebal === 0 && !justOff && Math.abs(val) > BAND_QUARTERS * L * S) cmd.rebal = val < 0 ? -1 : 1;
  if (cmd.rebal === 0 || world.step - cmd.lastConvert < CONVERT_GAP_STEPS) return;
  if (cmd.rebal < 0) convertToDefense(world, side);
  else convertToAttack(world, side);
}

/** Paso 1 del orden: el tick del comandante de los dos lados (si `step % 15 === 0`, lo decide quien llama). */
export function commanderTick(world) {
  const L = scaleL(world.cfg);
  for (let side = 0; side < 2; side++) {
    const cmd = world.cmd[side];
    const { H, Z } = pressure(world, side);
    cmd.H = H;
    cmd.Z = Z;
    cmd.q = quotaQuarters(H, Z, world.cfg.commander.bias, L);
    rebalance(world, side);
    compactPosts(world, side);
    interceptions(world, side);
    let defensa = 0;
    let ataque = 0;
    let forming = 0;
    for (const sq of world.squads) {
      if (sq.side !== side || !live(sq)) continue;
      if (sq.state === 'forming') forming++;
      else if (sq.role === 'defensa') defensa++;
      else ataque++;
    }
    cmd.hud = { defensa, ataque, forming, H: H / L, Z: Z / L, q: cmd.q / (4 * L) };
  }
}

/** Estado inicial del comandante de un lado. */
export const createCommanderState = () => ({
  H: 0,
  Z: 0,
  q: 60,
  rebal: 0,
  lastConvert: -1e9,
  hud: { defensa: 0, ataque: 0, forming: 0, H: 0, Z: 0, q: 15 },
});
