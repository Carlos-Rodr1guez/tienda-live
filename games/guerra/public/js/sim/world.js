// Mundo del sim de Batalla: estado de reglas y orden del paso (diseño §7.2). Paso fijo de 30 Hz, reloj de juego
// `step / 30`, ids monótonos por partido. NO hay RNG: ni se importa `rng.js` ni se recibe semilla. El orden del
// paso numera los pasos del diseño; el partido (lote 4d) fija `phase`, `round`, `roundStart` y `paused`.

import { GROUND_KINDS, resolveConfig } from './defaults.js';
import { createField } from './field.js';
import { createGrid } from './grid.js';
import { addUnit, targetLane, unitStats } from './units.js';
import { createTeamCounters } from '@tienda/kit/sim/counters.js';
import { createBases, decideTurrets, refillBuckets, resetBase, settleBases } from './base.js';
import { decideUnits, fireAll, processHits, reapUnits } from './combat.js';
import { createCredit, retireRound } from './credit.js';
import { flushStrikes, requestStrike } from './energy.js';
import { stepMarch } from './march.js';
import { launchPlane, stepPlanes } from './plane.js';
import { maxSpacing } from './spacing.js';
import {
  createQueues,
  deployStep,
  stepBaseline,
  submitChat,
  submitGift,
  submitLikes,
  submitOrder,
  submitSocial,
} from './queue.js';

const MAX_EVENTS = 4096;

/**
 * Crea un mundo vacío.
 * @param {object} [game] sección `game` de `config.json` (se mezcla con los valores por defecto)
 * @param {{registry?: any, phase?: string}} [opts] `registry` (el del kit, para XP y bajas) y la fase: `'matchup'`
 *   (los regalos no crean unidades), `'battle'` (refuerzos base y energía) o `'sandbox'` (por defecto: solo andamiaje)
 */
export function createWorld(game = {}, opts = {}) {
  const cfg = resolveConfig(game);
  const field = createField(cfg);
  const stats = {};
  for (const k of GROUND_KINDS) stats[k] = unitStats(cfg, k);
  const world = {
    cfg,
    field,
    stats,
    /** Radio de consulta de la separación (el mayor espaciado). */
    maxSpacing: maxSpacing(cfg),
    step: 0,
    nextId: 0,
    nextHitId: 0,
    /** Contador de salidas por lado: elige la ranura de la puerta y la altura de destino (determinista). */
    doorN: [0, 0],
    units: [],
    hits: [],
    bombs: [],
    planes: [],
    bases: createBases(cfg, field),
    grids: [
      createGrid({ w: field.w, h: field.h, capacity: 512 }),
      createGrid({ w: field.w, h: field.h, capacity: 512 }),
    ],
    teams: [
      { structDamage: 0, energyAsked: 0 },
      { structDamage: 0, energyAsked: 0 },
    ],
    registry: opts.registry ?? null,
    phase: opts.phase ?? 'sandbox',
    paused: false,
    round: 1,
    roundStart: 0,
    queues: createQueues(),
    queueStats: { overflow: 0, forced: 0, waitMax: 0 },
    credit: createCredit(),
    counters: createTeamCounters(2, cfg.social),
    lastLaunch: [-1e9, -1e9],
    /** Golpes de energía pedidos durante una pausa: salen al reanudar. */
    pendingStrikes: [0, 0],
    over: null,
    events: [],
    /** Bandeja para la vista (paso 15): se vacía con `drain()`. */
    emit(evt) {
      if (world.events.length < MAX_EVENTS) world.events.push(evt);
    },
    drain() {
      const out = world.events;
      world.events = [];
      return out;
    },
    /** Reloj de juego en segundos. */
    get time() {
      return world.step / 30;
    },
  };
  return world;
}

const SCRATCH = [[], []];

/** Paso 4: copia de posiciones previas (para interpolar) y reconstrucción de la grilla de cada lado. */
export function snapshotAndGrid(world) {
  SCRATCH[0].length = 0;
  SCRATCH[1].length = 0;
  for (const u of world.units) {
    u.px = u.x;
    u.py = u.y;
    if (u.alive) SCRATCH[u.side].push(u);
  }
  for (const p of world.planes) {
    p.px = p.x;
    p.py = p.y;
  }
  for (let s = 0; s < 2; s++) world.grids[s].rebuild(SCRATCH[s], SCRATCH[s].length);
}

/** Un paso de batalla, sin pausa (§7.2). Después del fin de ronda las reglas quedan congeladas. */
export function stepWorld(world) {
  if (world.over !== null || world.paused) return;
  flushStrikes(world);
  // 1. calendario de refuerzos base y 2. despliegue desde las colas (por la puerta)
  stepBaseline(world);
  deployStep(world);
  // 3. posiciones previas y grilla
  snapshotAndGrid(world);
  // 4. golpes que vencen
  processHits(world);
  // 5. cubo de la base
  refillBuckets(world);
  // 6. bajas, bases y torretas
  reapUnits(world);
  settleBases(world);
  // 7. decisión por alcance con el estado congelado
  decideUnits(world);
  decideTurrets(world);
  // 8. disparos
  fireAll(world);
  // 9. aviones
  stepPlanes(world);
  // 10. marcha: visión escalonada, velocidad deseada, separación e integración
  stepMarch(world);
  // 11. fin de ronda
  const a = world.bases[0].hp <= 0;
  const b = world.bases[1].hp <= 0;
  if (a || b) world.over = { step: world.step, winner: a && b ? null : a ? 1 : 0, both: a && b };
  world.step++;
}

/**
 * Empieza una ronda: el valor de lo que sigue en el campo pasa a retirado, y campo, golpes, bombas, aviones,
 * contadores, cubo y torretas quedan como nuevos. Las colas siguen (sobreviven entre rondas).
 */
export function resetRound(world) {
  retireRound(world);
  world.units.length = 0;
  world.hits.length = 0;
  world.bombs.length = 0;
  world.planes.length = 0;
  for (const b of world.bases) resetBase(b);
  for (const t of world.teams) {
    t.structDamage = 0;
    t.energyAsked = 0;
  }
  world.credit.teamValue = [0, 0];
  world.credit.teamCoins = [0, 0];
  world.doorN = [0, 0];
  world.counters.resetRound();
  world.lastLaunch = [-1e9, -1e9];
  world.pendingStrikes = [0, 0];
  world.over = null;
  world.roundStart = world.step;
}

/**
 * Comandos del mundo, para el log de repetición (`payload` de una entrada `{step, kind, payload}`): `gift` (regalo
 * ya enrutado), `order`, `chat`, `likes`, `follow`, `share`, `strike`, y el andamiaje `seedUnits` y `launchPlane`.
 * Cualquier otro devuelve `{ok:false}` sin cambiar el estado.
 * @param {any} world
 * @param {{type:string, [k:string]: any}} p
 */
export function applyEvent(world, p) {
  switch (p.type) {
    case 'seedUnits':
      return seedUnits(world, p);
    case 'launchPlane':
      return launchPlane(world, p.side, p.owner ?? null, p.value ?? 0);
    case 'order':
      return { ok: true, queued: submitOrder(world, p.order) };
    case 'gift':
      return { ok: true, queued: submitGift(world, p) };
    case 'chat':
      return { ok: true, ...submitChat(world, p.evt) };
    case 'likes':
      return { ok: true, orders: submitLikes(world, p.team, p.count) };
    case 'follow':
    case 'share':
      return { ok: true, queued: submitSocial(world, p.type, p.team, p.owner ?? null) };
    case 'strike': {
      const r = requestStrike(world, p.side);
      return { ok: true, deferred: r.target === 'deferred', ...r };
    }
    default:
      // `spawn`, `damage`, `setScore`, `setScore`, `vote`...: el sim no los acepta (NM-2, CB-21; ya no existen grupos ni roles)
      return { ok: false, reason: 'unknown' };
  }
}

/**
 * Andamiaje (pruebas y repeticiones): crea `count` unidades ya en el campo, la i-ésima en (x + i·dx, y + i·dy). Por
 * defecto salen de la puerta del lado, en fase 'march' hacia su propia altura. Cada una gasta un número de salida del
 * lado (altura de destino) solo si no se pasa `yg`.
 * @param {any} world
 * @param {{side:0|1, kind:string, count?:number, x?:number, y?:number, dx?:number, dy?:number, yg?:number, yoff?:number,
 *   phase?:'leg'|'march', owner?:string|null, value?:number, pinned?:boolean}} p
 * @returns {{ok:true, units:any[]}}
 */
export function seedUnits(world, p) {
  const door = world.field.sides[p.side].door;
  const x = p.x ?? door.x;
  const y = p.y ?? door.y;
  const n = p.count ?? 1;
  const units = [];
  for (let i = 0; i < n; i++) {
    const yi = y + i * (p.dy ?? 0);
    const lane = p.yg === undefined && p.y === undefined ? targetLane(world, world.doorN[p.side]++) : null;
    const yg = p.yg ?? (lane === null ? yi : lane.yg);
    units.push(
      addUnit(world, p.side, p.kind, x + i * (p.dx ?? 0), yi, {
        owner: p.owner ?? null,
        value: p.value ?? 0,
        yg,
        yoff: p.yoff ?? (lane === null ? 0 : lane.off),
        phase: p.phase ?? 'march',
        pinned: p.pinned === true,
      }),
    );
  }
  return { ok: true, units };
}
