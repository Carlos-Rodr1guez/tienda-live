// Bases y torretas (diseño D16, CB-19). Tres torretas idénticas por base, con HP, que solo daña lo enemigo.
// El daño efectivo a la base y a las torretas se suma por equipo (paso 1 del desempate de CB-5). El cubo de la
// base (D18) y el crédito (D17) llegan en el lote 4c: aquí `requestBaseDamage` aplica el pedido tal cual.

/** Crea las dos bases con sus tres torretas. Fase de disparo de cada torreta: `3·k` pasos (función solo del id). */
export function createBases(cfg, field) {
  return field.sides.map((s, side) => ({
    side,
    frontX: s.frontX,
    hp: cfg.hq.hp,
    maxHp: cfg.hq.hp,
    fell: false,
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

/**
 * Daño a la base. Devuelve lo aplicado (4c: tras el cubo). Suma al daño efectivo del equipo atacante.
 * @param {any} world
 * @param {0|1} baseSide base dañada
 * @param {number} dmg pedido
 * @param {{side:0|1, owner?:any}} src
 */
export function requestBaseDamage(world, baseSide, dmg, src) {
  const b = world.bases[baseSide];
  if (b.hp <= 0 || dmg <= 0) return 0;
  const applied = Math.min(dmg, b.hp);
  b.hp -= applied;
  world.teams[src.side].structDamage += applied;
  world.emit({ type: 'baseHit', side: baseSide, dmg: applied });
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
