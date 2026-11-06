// Mundo del sim de Batalla: estado de reglas y orden del paso (diseño §7.2). Paso fijo de 30 Hz, reloj de juego
// `step / 30`, ids monótonos por partido. NO hay RNG: ni se importa `rng.js` ni se recibe semilla. El orden del
// paso numera los pasos del diseño; los de los lotes 4c y 4d (comandante, colas, cubo, reunión, partido) se
// enchufan en los huecos marcados.

import { GROUND_KINDS, resolveConfig } from './defaults.js';
import { ATTACK_LANES, corridorOf, createField, laneY } from './field.js';
import { createGrid } from './grid.js';
import { unitStats } from './units.js';
import { createBases, decideTurrets, settleBases } from './base.js';
import { decideUnits, fireAll, processHits, reapUnits } from './combat.js';
import { launchPlane, stepPlanes } from './plane.js';
import {
  addUnit,
  createSquad,
  formationExtent,
  haltDistance,
  laneChangeTick,
  placeOffset,
  stepSquadAnchors,
  stepUnits,
} from './squads.js';

const MAX_EVENTS = 4096;
const COMMANDER_TICK = 15; // 2 Hz

/**
 * Crea un mundo vacío.
 * @param {object} [game] sección `game` de `config.json` (se mezcla con los valores por defecto)
 */
export function createWorld(game = {}) {
  const cfg = resolveConfig(game);
  const field = createField(cfg);
  const stats = {};
  const fondoFull = {};
  const halt = {};
  for (const k of GROUND_KINDS) {
    stats[k] = unitStats(cfg, k);
    fondoFull[k] = formationExtent(cfg, k, cfg.squads.size[k]).fondo;
    halt[k] = haltDistance(cfg, k);
  }
  const world = {
    cfg,
    field,
    stats,
    fondoFull,
    halt,
    step: 0,
    nextId: 0,
    nextSquadId: 0,
    nextHitId: 0,
    units: [],
    squads: [],
    hits: [],
    bombs: [],
    planes: [],
    bases: createBases(cfg, field),
    grids: [
      createGrid({ w: field.w, h: field.h, capacity: 512 }),
      createGrid({ w: field.w, h: field.h, capacity: 512 }),
    ],
    teams: [{ structDamage: 0 }, { structDamage: 0 }],
    lastLaunch: [-1e9, -1e9],
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
function snapshotAndGrid(world) {
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
  if (world.over !== null) return;
  // 1. tick del comandante: aquí solo el cambio de calle (el resto llega en 4c)
  if (world.step % COMMANDER_TICK === 0) laneChangeTick(world);
  // 2. calendario de refuerzos y 3. despliegue desde las colas: lote 4c
  // 4. posiciones previas y grilla
  snapshotAndGrid(world);
  // 5. golpes que vencen
  processHits(world);
  // 6. cubo de la base: lote 4c
  // 7. bajas, bases y torretas
  reapUnits(world);
  settleBases(world);
  // 8. decisión con el estado congelado
  decideUnits(world);
  decideTurrets(world);
  // 9. disparos
  fireAll(world);
  // 10. aviones
  stepPlanes(world);
  // 11. grupos y 12. unidades
  stepSquadAnchors(world);
  stepUnits(world);
  // 13. reunión: lote 4c
  // 14. fin de ronda
  const a = world.bases[0].hp <= 0;
  const b = world.bases[1].hp <= 0;
  if (a || b) world.over = { step: world.step, winner: a && b ? null : a ? 1 : 0, both: a && b };
  world.step++;
}

/**
 * Comandos del mundo, para el log de repetición (`payload` de una entrada `{step, kind, payload}`). En 4b son los
 * de andamiaje: `seedSquad` (un grupo ya formado en su calle) y `launchPlane`. Las entradas reales (regalos,
 * uniones) llegan por las colas en 4c y 4d.
 * @param {any} world
 * @param {{type:string, [k:string]: any}} p
 */
export function applyEvent(world, p) {
  if (p.type === 'seedSquad') return seedSquad(world, p);
  if (p.type === 'launchPlane') return launchPlane(world, p.side, p.owner ?? null);
  return { ok: false, reason: 'unknown' };
}

/**
 * Crea un grupo con sus unidades ya en sus lugares.
 * @param {any} world
 * @param {{side:0|1, kind:string, count?:number, role?:string, state?:string, corridor?:number, lane?:number, x?:number, y?:number}} p
 */
export function seedSquad(world, p) {
  const side = world.field.sides[p.side];
  const corridor = p.corridor ?? corridorOf(world.field, p.y ?? side.gates[1]);
  const lane = p.lane ?? ATTACK_LANES.centro;
  const x = p.x ?? side.exitX + side.dir * 40;
  const y = p.y ?? laneY(world.field, corridor, lane);
  const sq = createSquad(world, {
    side: p.side,
    kind: p.kind,
    role: p.role,
    state: p.state,
    corridor,
    lane,
    x,
    y,
  });
  const n = p.count ?? world.cfg.squads.size[p.kind];
  for (let i = 0; i < n; i++) {
    const off = placeOffset(world.cfg, p.kind, i, n, side.dir);
    addUnit(world, sq, x + off.x, y + off.y);
  }
  return { ok: true, squad: sq };
}
