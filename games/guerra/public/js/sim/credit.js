// Crédito continuo y conservación del valor (diseño D17, CB-11, KIT-20). Cada unidad lleva su dueño, su valor al
// nacer y su valor restante (`valueAlive`). En cada golpe efectivo de `d` de daño la porción `valueAlive · d / hp`
// se destruye en ese mismo golpe: si el que pega es un usuario (su unidad o las bombas de su avión) recibe el valor
// y la XP en el acto (`registry.addDestroyed`); si no (torreta, refuerzos, likes, energía), queda destruida sin
// atribuir y cuenta igual para el paso 2 del desempate. La baja va al usuario con más daño (empate: menor
// `cmpCodePoints`). El daño a la base y a las torretas nunca pasa por aquí.

import { cmpCodePoints } from '@tienda/kit/sim/words.js';

export function createCredit() {
  return {
    /** Monedas pagadas que entraron como órdenes (conservación). */
    paid: 0,
    destroyedUser: 0,
    destroyedUnattr: 0,
    retired: 0,
    /** Valor de lo que no entró en la cola llena, por lado. */
    overflow: [0, 0],
    /** Valor destruido por cada equipo en la ronda (paso 2 del desempate), con y sin autor. */
    teamValue: [0, 0],
    /** Monedas pagadas por equipo en la ronda (paso 3 del desempate). */
    teamCoins: [0, 0],
  };
}

/**
 * Golpe efectivo de `d` sobre `u`, cuando `u.hp` ya bajó `d`. `hpBefore` es el HP antes del golpe.
 * @param {any} world
 * @param {any} u unidad golpeada
 * @param {number} d daño efectivo (min(dmg, hp))
 * @param {number} hpBefore
 * @param {{side:0|1, owner?:string|null}} src
 */
export function creditHit(world, u, d, hpBefore, src) {
  const c = world.credit;
  const killed = u.hp <= 0;
  const slice = killed ? u.valueAlive : (u.valueAlive * d) / hpBefore;
  u.valueAlive -= slice;
  if (killed) u.valueAlive = 0;
  const owner = src.owner ?? null;
  if (owner !== null) {
    if (u.dmgBy === null) u.dmgBy = new Map();
    u.dmgBy.set(owner, (u.dmgBy.get(owner) ?? 0) + d);
  }
  if (slice > 0) {
    c.teamValue[src.side] += slice;
    if (owner !== null) {
      c.destroyedUser += slice;
      world.registry?.addDestroyed(owner, slice, world.time);
    } else {
      c.destroyedUnattr += slice;
    }
  }
  if (killed && u.dmgBy !== null) {
    let best = null;
    let bestDmg = -1;
    for (const [k, v] of u.dmgBy) {
      if (v > bestDmg || (v === bestDmg && cmpCodePoints(k, best) < 0)) {
        best = k;
        bestDmg = v;
      }
    }
    if (best !== null) world.registry?.addKill(best);
  }
}

/** Suma lo pagado de una orden aceptada. */
export function addPaid(world, side, value) {
  world.credit.paid += value;
  world.credit.teamCoins[side] += value;
}

/** Valor que sale del mundo sin ser destruido (avión que se va, fin de ronda o de partido). */
export function retire(world, value) {
  if (value > 0) world.credit.retired += value;
}

/** Fin de ronda: el valor restante de todas las unidades vivas (también las que forman) y de los aviones. */
export function retireRound(world) {
  for (const u of world.units) {
    retire(world, u.valueAlive);
    u.valueAlive = 0;
  }
  for (const p of world.planes) {
    retire(world, p.value);
    p.value = 0;
  }
}

/** Fin de partido o aborto: lo que sigue en las colas (sobreviven entre rondas) pasa a retirado. */
export function retireQueues(world) {
  for (const q of world.queues) {
    for (const o of q.ground) retire(world, o.remaining * o.unitValue);
    for (const o of q.air) retire(world, o.remaining * o.unitValue);
    q.ground.length = 0;
    q.air.length = 0;
    q.groundUnits = 0;
  }
}

/**
 * Libro de conservación: `paid = destroyedUser + destroyedUnattr + alive + queued + overflow + retired`.
 * @returns {{paid:number, destroyedUser:number, destroyedUnattr:number, alive:number, queued:number,
 *   overflow:number, retired:number, sum:number}}
 */
export function ledger(world) {
  const c = world.credit;
  let alive = 0;
  for (const u of world.units) alive += u.valueAlive;
  for (const p of world.planes) alive += p.value;
  let queued = 0;
  for (const q of world.queues) {
    for (const o of q.ground) queued += o.remaining * o.unitValue;
    for (const o of q.air) queued += o.remaining * o.unitValue;
  }
  const overflow = c.overflow[0] + c.overflow[1];
  const sum = c.destroyedUser + c.destroyedUnattr + alive + queued + overflow + c.retired;
  return {
    paid: c.paid,
    destroyedUser: c.destroyedUser,
    destroyedUnattr: c.destroyedUnattr,
    alive,
    queued,
    overflow,
    retired: c.retired,
    sum,
  };
}
