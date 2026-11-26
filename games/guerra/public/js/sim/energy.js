// Golpe de energía de equipo (diseño D19, CB-14, KIT-19 `strike`). Con la barra llena cae sobre el RACIMO enemigo más
// fuerte (v2.6: ya no hay grupos): 3 impactos de 160 y radio 20 en `posición + {(0,0), (−dir·12, ∓10)}`, en los pasos
// +0, +8 y +16, sin dueño (el daño no se atribuye: no hay XP ni bajas, pero cuenta en el valor destruido del equipo).
// Sin unidades enemigas, `baseDmg` (600) a la base por el cubo, con un tope por ronda (3600) que cuenta lo pedido.
// Los impactos que caen sobre una torreta la dañan; la base no recibe daño del golpe al racimo.

import { requestBaseDamage } from './base.js';
import { scheduleHit } from './combat.js';

/** Radio del racimo: la fuerza de una unidad es la suma de c·hp/maxHp de las enemigas a ≤ este radio. */
export const CLUSTER_RADIUS = 40;

/**
 * La unidad enemiga con mayor Σ c·hp/maxHp en un radio de 40 px (el centro del racimo más fuerte), empate: id menor.
 * `null` si no hay enemigos vivos. Recorre las unidades (no la grilla): vale entre pasos.
 * @returns {any|null}
 */
export function strongestCluster(world, side) {
  const r2 = CLUSTER_RADIUS * CLUSTER_RADIUS;
  const list = world.units;
  let best = null;
  let bs = -1;
  for (const a of list) {
    if (a.side === side || !a.alive) continue;
    let s = 0;
    for (const b of list) {
      if (b.side !== a.side || !b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy <= r2) s += b.stats.c * (b.hp / b.maxHp);
    }
    if (s > bs) {
      best = a;
      bs = s;
    }
  }
  return best;
}

/**
 * Dispara la energía del equipo `side`. Devuelve qué hizo.
 * @returns {{target:'group', unit:any} | {target:'base', asked:number} | {target:'none'}}
 */
export function fireEnergy(world, side) {
  const { cfg, field } = world;
  const e = cfg.energy;
  const dir = field.sides[side].dir;
  const c = strongestCluster(world, side);
  if (c !== null) {
    for (let i = 0; i < e.hits; i++) {
      const dx = i === 0 ? 0 : -dir * 12;
      const dy = i === 0 ? 0 : i % 2 === 1 ? -10 : 10;
      scheduleHit(world, {
        due: world.step + i * e.spacingSteps,
        kind: 'area',
        side,
        owner: null,
        dmg: e.dmg,
        splash: e.radius,
        tx: c.x + dx,
        ty: c.y + dy,
        noBase: true,
      });
    }
    world.emit({ type: 'energyStrike', side, x: c.x, y: c.y });
    return { target: 'group', unit: c };
  }
  const t = world.teams[side];
  const asked = Math.max(0, Math.min(e.baseDmg, e.capPerRound - t.energyAsked));
  if (asked <= 0) return { target: 'none' };
  t.energyAsked += asked;
  requestBaseDamage(world, 1 - side, asked, { side, owner: null });
  world.emit({ type: 'energyStrike', side, x: field.sides[1 - side].frontX, y: field.sides[0].door.y });
  return { target: 'base', asked };
}

/**
 * Pide el golpe de energía de un equipo. En pausa no se dispara (NM-9: el combate se detiene): queda pendiente y sale
 * en el primer paso después de reanudar. Devuelve lo mismo que `fireEnergy`, o `{target:'deferred'}`.
 */
export function requestStrike(world, side) {
  if (world.paused) {
    world.pendingStrikes[side]++;
    return { target: 'deferred' };
  }
  return fireEnergy(world, side);
}

/** Dispara los golpes que quedaron pendientes por una pausa (al empezar el primer paso sin pausa). */
export function flushStrikes(world) {
  for (let side = 0; side < 2; side++) {
    while (world.pendingStrikes[side] > 0) {
      world.pendingStrikes[side]--;
      fireEnergy(world, side);
    }
  }
}
