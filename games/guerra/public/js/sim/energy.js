// Golpe de energía de equipo (diseño D19, CB-14, KIT-19 `strike`). Con la barra llena cae sobre el grupo enemigo salido
// de mayor fuerza: 3 impactos de 160 y radio 20 en `ancla + {(0,0), (−dir·12, ∓10)}`, en los pasos +0, +8 y +16, sin
// dueño (el daño no se atribuye: no hay XP ni bajas, pero cuenta en el valor destruido del equipo). Sin grupos
// enemigos, `baseDmg` (600) a la base por el cubo, con un tope por ronda (3600) que cuenta lo pedido. Los impactos que
// caen sobre una torreta la dañan; la base no recibe daño del golpe al grupo.

import { requestBaseDamage } from './base.js';
import { scheduleHit } from './combat.js';
import { squadStrength } from './squads.js';

/** El grupo enemigo salido de mayor fuerza (empate: id menor), o null. */
export function strongestEnemyGroup(world, side) {
  let best = null;
  let bs = -1;
  for (const sq of world.squads) {
    if (sq.side === side || sq.members.length === 0 || sq.state === 'forming') continue;
    const s = squadStrength(sq);
    if (s > bs) {
      best = sq;
      bs = s;
    }
  }
  return best;
}

/**
 * Dispara la energía del equipo `side`. Devuelve qué hizo.
 * @returns {{target:'group', squad:any} | {target:'base', asked:number} | {target:'none'}}
 */
export function fireEnergy(world, side) {
  const { cfg, field } = world;
  const e = cfg.energy;
  const dir = field.sides[side].dir;
  const sq = strongestEnemyGroup(world, side);
  if (sq !== null) {
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
        tx: sq.anchor.x + dx,
        ty: sq.anchor.y + dy,
        noBase: true,
      });
    }
    world.emit({ type: 'energyStrike', side, squad: sq.id, x: sq.anchor.x, y: sq.anchor.y });
    return { target: 'group', squad: sq };
  }
  const t = world.teams[side];
  const asked = Math.max(0, Math.min(e.baseDmg, e.capPerRound - t.energyAsked));
  if (asked <= 0) return { target: 'none' };
  t.energyAsked += asked;
  requestBaseDamage(world, 1 - side, asked, { side, owner: null });
  world.emit({ type: 'energyStrike', side, squad: 0, x: field.sides[1 - side].frontX, y: field.sides[0].gates[1] });
  return { target: 'base', asked };
}
