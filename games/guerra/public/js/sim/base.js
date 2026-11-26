// Bases y torretas (diseño D16, CB-19). Tres torretas idénticas por base, con HP, que solo daña lo enemigo.
// El daño efectivo a la base y a las torretas se suma por equipo (paso 1 del desempate de CB-5). Todo daño a la
// base pasa por el cubo (D18, CB-12): arranca vacío en cada ronda y se llena a `hp / minSeconds` por segundo, con
// esa misma capacidad. Las torretas no pasan por el cubo (D17) y no dan XP, valor ni bajas.

import { DT } from './defaults.js';

/** Un hp que queda por debajo de esto es 0: evita que la suma de fracciones del cubo deje una base viva por 1e-12. */
const HP_EPS = 1e-6;

/** Crea las dos bases con sus tres torretas. Fase de disparo de cada torreta: `3·k` pasos (función solo del id). */
export function createBases(cfg, field) {
  return field.sides.map((s, side) => ({
    side,
    frontX: s.frontX,
    // el hangar (v2.8): el rectángulo que es la base; `frontX` es su cara frontal
    hangar: s.hangar,
    hp: cfg.hq.hp,
    maxHp: cfg.hq.hp,
    fell: false,
    bucket: 0,
    cap: cfg.hq.hp / cfg.hq.minSeconds,
    turrets: s.turrets.map((t, k) => ({
      k,
      side,
      x: t.x,
      y: t.y,
      hp: cfg.turret.hp,
      maxHp: cfg.turret.hp,
      on: true,
      cd: 3 * k,
      tgt: null,
    })),
  }));
}

/** Una torreta dispara y es blanco solo mientras está encendida y con HP. */
export const turretAlive = (t) => t.on && t.hp > 0;

/** Paso 6: el cubo de cada base se llena `cap · DT` por paso, con tope `cap`. */
export function refillBuckets(world) {
  for (const b of world.bases) b.bucket = Math.min(b.cap, b.bucket + b.cap * DT);
}

/** Deja la base y sus torretas como al empezar una ronda: HP completo, cubo vacío y las tres torretas en pie. */
export function resetBase(b) {
  b.hp = b.maxHp;
  b.fell = false;
  b.bucket = 0;
  for (const t of b.turrets) {
    t.hp = t.maxHp;
    t.on = true;
    t.tgt = null;
  }
}

/**
 * Daño a la base: `aplicado = min(pedido, cubo, hp)`. Devuelve lo aplicado, que es lo que suma al daño efectivo del
 * equipo atacante (paso 1 del desempate); lo que el cubo absorbe no suma.
 * @param {any} world
 * @param {0|1} baseSide base dañada
 * @param {number} dmg pedido
 * @param {{side:0|1, owner?:any}} src
 */
export function requestBaseDamage(world, baseSide, dmg, src) {
  const b = world.bases[baseSide];
  if (b.hp <= 0 || dmg <= 0) return 0;
  let applied = Math.min(dmg, b.bucket, b.hp);
  if (b.hp - applied <= HP_EPS) applied = b.hp;
  b.bucket = Math.max(0, b.bucket - applied);
  b.hp -= applied;
  if (b.hp <= HP_EPS) b.hp = 0;
  world.teams[src.side].structDamage += applied;
  world.emit({ type: 'baseHit', side: baseSide, dmg: applied, absorbed: dmg - applied });
  return applied;
}

/**
 * Daño a una torreta: efectivo `min(dmg, hp)`. No pasa por el cubo ni da XP, valor ni bajas.
 * @returns {number} lo aplicado
 */
export function damageTurret(world, t, dmg, src) {
  if (!turretAlive(t) || dmg <= 0) return 0;
  const applied = Math.min(dmg, t.hp);
  t.hp -= applied;
  world.teams[src.side].structDamage += applied;
  if (t.hp <= 0) {
    t.hp = 0;
    t.on = false;
    t.tgt = null;
    world.emit({ type: 'turretDown', side: t.side, k: t.k });
  }
  return applied;
}

/** Paso 7: una base en 0 se marca y apaga sus torretas en ese mismo paso. */
export function settleBases(world) {
  for (const b of world.bases) {
    if (b.hp <= 0 && !b.fell) {
      b.fell = true;
      b.hp = 0;
      for (const t of b.turrets) {
        t.on = false;
        t.tgt = null;
      }
    }
  }
}

/** Paso 8: el blanco de cada torreta es la unidad de tierra enemiga más cercana (d²; id menor), nunca un avión. */
export function decideTurrets(world) {
  const { cfg, field } = world;
  const r = cfg.turret.range;
  for (const b of world.bases) {
    const e = 1 - b.side;
    const dir = field.sides[b.side].dir;
    for (const t of b.turrets) {
      t.tgt = null;
      if (!turretAlive(t)) continue;
      t.tgt = world.grids[e].nearest(t.x, t.y, r, (u) => u.alive && (u.x - t.x) * dir >= -cfg.turret.arcPx);
    }
  }
}
