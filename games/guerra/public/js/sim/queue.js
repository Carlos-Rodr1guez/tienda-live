// Colas de refuerzos (diseño D19, §7.2 pasos 2 y 3; CB-7, CB-8, CB-10, CB-14). TODO entra por la cola de su lado: los
// regalos, la unión, los likes, el follow, el share y los refuerzos base. Cola de tierra FIFO por orden de llegada, con
// 8 apariciones por segundo por lado, un tope de unidades vivas y la cabeza que espera solo por saturación; cola de
// aire aparte (≤ 20, ≤ 2 aviones vivos, ≥ 1,5 s entre lanzamientos). Nada se pierde: lo que no entra en la cola llena
// va al cubo de desborde y el valor se conserva. Sin azar: el punto de aparición es función de la salida y del lugar.

import { freeOrder, likeOrders, socialOrder } from '@tienda/kit/sim/router.js';
import { SIM_HZ } from './defaults.js';
import { acceptsMember, findOpen, planAlta } from './commander.js';
import { addPaid } from './credit.js';
import { requestStrike } from './energy.js';
import { canLaunchPlane, launchPlane } from './plane.js';
import { addUnit, createSquad, freeSlot, placeOffset } from './squads.js';

/** Segundos de reloj de juego entre dos avisos de cola llena. */
const WARN_EVERY_STEPS = 10 * SIM_HZ;

/** Colas de los dos lados: fichas de aparición llenas al empezar (la primera unidad sale sin esperar). */
export const createQueues = () =>
  [0, 1].map(() => ({ ground: [], air: [], groundUnits: 0, airUnits: 0, tokens: SIM_HZ, warnStep: -1e9 }));

/**
 * Acepta una orden del router (`{kind, team, owner, count, unitValue, source}`; `team` 1..2). En `matchup` no hace
 * nada (no crea ni encola unidades). Devuelve cuántas unidades quedaron encoladas.
 * @param {any} world
 * @param {{kind:string, team:number, owner:string|null, count:number, unitValue:number, source:string}} order
 */
export function submitOrder(world, order) {
  if (world.phase === 'matchup') return 0;
  const side = order.team - 1;
  if (side !== 0 && side !== 1) return 0;
  const count = Math.floor(order.count);
  if (!(count >= 1)) return 0;
  const q = world.queues[side];
  const lim = world.cfg.limits;
  const air = order.kind === 'avion';
  const room = air ? lim.maxQueuedPlanes - q.airUnits : lim.maxQueuedUnits - q.groundUnits;
  const fits = Math.max(0, Math.min(count, room));
  addPaid(world, side, count * order.unitValue);
  if (fits < count) {
    world.credit.overflow[side] += (count - fits) * order.unitValue;
    world.queueStats.overflow++;
    if (world.step - q.warnStep >= WARN_EVERY_STEPS) {
      q.warnStep = world.step;
      world.emit({ type: 'warn', code: 'queueFull', side });
    }
  }
  if (fits > 0) {
    const o = {
      kind: order.kind,
      owner: order.owner ?? null,
      remaining: fits,
      unitValue: order.unitValue,
      source: order.source,
    };
    if (air) {
      q.air.push(o);
      q.airUnits += fits;
    } else {
      q.ground.push(o);
      q.groundUnits += fits;
    }
  }
  return fits;
}

/**
 * Un regalo ya enrutado: acredita monedas y XP de LIVE de inmediato (también en pausa y en `matchup`) y encola sus
 * órdenes. En `matchup` solo muestra el agradecimiento.
 * @param {any} world
 * @param {{owner:string|null, coins:number, orders:any[]}} g
 */
export function submitGift(world, g) {
  if (g.owner && g.coins > 0) world.registry?.addCoins(g.owner, g.coins, world.time);
  if (world.phase === 'matchup') {
    world.emit({ type: 'thanks', owner: g.owner, coins: g.coins });
    return 0;
  }
  let n = 0;
  for (const o of g.orders) n += submitOrder(world, o);
  return n;
}

/** Likes de un usuario con equipo: cada `perReinforcement` da un refuerzo de valor 0 (dueño "Likes"). */
export function submitLikes(world, team, count) {
  const refs = world.counters.addLikes(team, count);
  const orders = likeOrders({ likes: world.cfg.social.likes }, team, refs);
  for (const o of orders) submitOrder(world, o);
  return orders.length;
}

/** Follow o share de un usuario con equipo. */
export function submitSocial(world, type, team, owner) {
  const o = socialOrder({ follow: world.cfg.social.follow, share: world.cfg.social.share }, type, team, owner);
  return o ? submitOrder(world, o) : 0;
}

const keyOf = (evt) => String(evt?.userId || evt?.uniqueId || evt?.nickname || 'anon');

/**
 * Un comentario: pide equipo (la unión da 1 soldado gratis por usuario y ronda; el registro decide) y carga la barra
 * de energía de quien ya tiene equipo (una carga cada `userCooldown`, solo en batalla).
 * @returns {{join: any, strike: boolean}}
 */
export function submitChat(world, evt) {
  const reg = world.registry;
  if (!reg) return { join: null, strike: false };
  const join = reg.joinFromChat(evt, world.time, world.round);
  if (join !== null && join.freeUnit) submitOrder(world, freeOrder('soldado', join.team, join.key, 1, 'join'));
  const u = reg.get(keyOf(evt));
  let strike = false;
  if (u && u.team && world.counters.chargeEnergy(u.team, u.key, world.time, world.phase === 'battle')) {
    requestStrike(world, u.team - 1);
    strike = true;
  }
  return { join, strike };
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 2: refuerzos base

/** Refuerzos base: desde t = `start` y cada `interval` s del reloj de la ronda, la misma orden para los dos lados. */
export function stepBaseline(world) {
  if (world.phase !== 'battle') return;
  const b = world.cfg.baseline;
  const t = world.step - world.roundStart;
  const start = Math.round(b.start * SIM_HZ);
  const every = Math.round(b.interval * SIM_HZ);
  if (t < start || (t - start) % every !== 0) return;
  for (const team of [1, 2]) submitOrder(world, freeOrder(b.unit, team, null, b.count, 'baseline'));
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 3: despliegue desde las colas

function aliveGround(world, side) {
  let n = 0;
  for (const u of world.units) if (u.side === side) n++;
  return n;
}

/** ¿Está libre el punto de aparición? Ninguna unidad amiga de OTRO grupo a menos de huella + 3 px. */
function spawnFree(world, side, kind, x, y, sq) {
  const [fw, fh] = world.cfg.units[kind].foot;
  for (const u of world.units) {
    if (u.side !== side || u.squad === sq) continue;
    if (Math.abs(u.x - x) < fw + 3 && Math.abs(u.y - y) < fh + 3) return false;
  }
  return true;
}

/** Alta de un grupo nuevo con el plan del comandante: rol, corredor, calle, sector y puesto quedan fijos desde aquí. */
export function createFromPlan(world, side, kind, plan) {
  const sq = createSquad(world, {
    side,
    kind,
    role: plan.role,
    state: 'forming',
    corridor: plan.corridor,
    lane: plan.lane,
    sector: plan.sector,
    post: plan.post,
    postLane: plan.postLane,
    assembly: { x: plan.x, y: plan.y },
    postPos: plan.postPos,
    x: plan.x,
    y: plan.y,
  });
  sq.open = true;
  world.emit({ type: 'squadNew', id: sq.id, side, role: sq.role, kind });
  return sq;
}

function deployGround(world, side, q) {
  const o = q.ground[0];
  if (o === undefined || q.tokens < SIM_HZ) return;
  if (aliveGround(world, side) >= world.cfg.limits.maxAlivePerSide) return;
  const { cfg, field } = world;
  const s = field.sides[side];
  let sq = findOpen(world, side, o.kind);
  let plan = null;
  if (sq === null) {
    plan = planAlta(world, side, o.kind);
    if (plan === null) return; // saturación: la cabeza espera y nadie se adelanta
  }
  const baseY = sq === null ? plan.y : sq.anchor.y;
  const off = placeOffset(cfg, o.kind, sq === null ? 0 : freeSlot(sq), s.dir);
  const x = s.exitX;
  const y = baseY + off.y;
  if (!spawnFree(world, side, o.kind, x, y, sq)) return;
  if (sq === null) sq = createFromPlan(world, side, o.kind, plan);
  const u = addUnit(world, sq, x, y, { owner: o.owner, value: o.unitValue });
  q.tokens -= SIM_HZ;
  o.remaining--;
  q.groundUnits--;
  if (o.remaining === 0) q.ground.shift();
  sq.open = acceptsMember(world, sq);
  world.emit({ type: 'spawn', id: u.id, side, kind: o.kind, x, y });
}

function deployAir(world, side, q) {
  const o = q.air[0];
  if (o === undefined || !canLaunchPlane(world, side).ok) return;
  launchPlane(world, side, o.owner, o.unitValue);
  o.remaining--;
  q.airUnits--;
  if (o.remaining === 0) q.air.shift();
}

/** Paso 3: una unidad por ficha y por lado (8 por segundo), en orden estricto de llegada; y la cola de aire. */
export function deployStep(world) {
  const rate = world.cfg.limits.spawnsPerSecond;
  for (let side = 0; side < 2; side++) {
    const q = world.queues[side];
    q.tokens += rate;
    deployGround(world, side, q);
    deployAir(world, side, q);
    // capacidad 1 ficha: lo que sobra de una ficha entera se pierde, pero el resto fraccionario se conserva
    q.tokens = Math.min(SIM_HZ, q.tokens);
  }
}
