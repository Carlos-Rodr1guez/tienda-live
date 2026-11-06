// Combate (diseño D16, D17, §7.2 pasos 5, 8 y 9): blancos, disparos programados, golpes que vencen y daño.
// Sin azar: el blanco sale de las distancias (desempate por id) y cada disparo es un golpe programado en
// `step + max(1, ceil(dist / velocidad · 30))`. El crédito por golpe (D17) se cuelga de `damageUnit` en el lote 4c.

import { SIM_HZ } from './defaults.js';
import { damageTurret, requestBaseDamage, turretAlive } from './base.js';
import { isFacing } from './steer.js';
import { removeMember, targetX } from './squads.js';

/**
 * Daño a una unidad: efectivo `min(dmg, hp)`, sin sobredaño. Devuelve lo aplicado.
 * @param {any} world
 * @param {any} u
 * @param {number} dmg
 * @param {{side:0|1, owner?:any}} src
 */
export function damageUnit(world, u, dmg, src) {
  if (!u.alive || dmg <= 0) return 0;
  const d = Math.min(dmg, u.hp);
  u.hp -= d;
  if (u.hp <= 0) {
    u.hp = 0;
    u.alive = false;
  }
  world.emit({ type: 'hit', id: u.id, x: u.x, y: u.y, dmg: d, side: src.side });
  return d;
}

/** Golpe de área (obús, bomba, energía): todo enemigo a ≤ radio del punto, torretas y base (por su x). */
export function applyArea(world, h) {
  const e = 1 - h.side;
  world.grids[e].forEachInRadius(h.tx, h.ty, h.splash, (u) => {
    if (u.alive) damageUnit(world, u, h.dmg, h);
  });
  const r2 = h.splash * h.splash;
  for (const t of world.bases[e].turrets) {
    const dx = t.x - h.tx;
    const dy = t.y - h.ty;
    if (turretAlive(t) && dx * dx + dy * dy <= r2) damageTurret(world, t, h.dmg, h);
  }
  const b = world.bases[e];
  if (b.hp > 0 && Math.abs(h.tx - b.frontX) <= h.splash) requestBaseDamage(world, e, h.dmg, h);
}

/** Programa un golpe para el paso `due`. */
export function scheduleHit(world, h) {
  h.id = ++world.nextHitId;
  world.hits.push(h);
  return h;
}

function applyBullet(world, h) {
  const t = h.tgt;
  if (h.tgtKind === 'unit') {
    if (t.alive) damageUnit(world, t, h.dmg, h); // la bala se pierde si el blanco murió
  } else if (h.tgtKind === 'turret') {
    damageTurret(world, t, h.dmg, h);
  } else if (world.bases[t.side].hp > 0) {
    requestBaseDamage(world, t.side, h.dmg, h);
  }
}

const DUE = [];

/** Paso 5: golpes y bombas que vencen, en orden de paso y de id (primero los golpes, luego las bombas). */
export function processHits(world) {
  const step = world.step;
  DUE.length = 0;
  let w = 0;
  for (let i = 0; i < world.hits.length; i++) {
    const h = world.hits[i];
    if (h.due <= step) DUE.push(h);
    else world.hits[w++] = h;
  }
  world.hits.length = w;
  DUE.sort((a, b) => a.due - b.due || a.id - b.id);
  for (const h of DUE) {
    if (h.kind === 'bullet') applyBullet(world, h);
    else applyArea(world, h);
  }
  DUE.length = 0;
  w = 0;
  for (let i = 0; i < world.bombs.length; i++) {
    const b = world.bombs[i];
    if (b.impactStep <= step) DUE.push(b);
    else world.bombs[w++] = b;
  }
  world.bombs.length = w;
  DUE.sort((a, b) => a.impactStep - b.impactStep || a.id - b.id);
  for (const b of DUE) {
    applyArea(world, {
      side: b.side,
      owner: b.owner,
      dmg: world.cfg.plane.bombDmg,
      splash: world.cfg.plane.bombRadius,
      tx: b.tx,
      ty: b.ty,
    });
    world.emit({ type: 'bombImpact', x: b.tx, y: b.ty, side: b.side });
  }
  DUE.length = 0;
}

/**
 * Paso 7 (parte de unidades): quita las muertas. Cambio por el último en su grupo y limpieza de grupos vacíos.
 */
export function reapUnits(world) {
  let dead = 0;
  for (const u of world.units) if (!u.alive) dead++;
  if (dead === 0) return;
  let w = 0;
  for (let i = 0; i < world.units.length; i++) {
    const u = world.units[i];
    if (u.alive) {
      world.units[w++] = u;
    } else {
      removeMember(u.squad, u);
      u.tgt = null;
      world.emit({ type: 'death', id: u.id, kind: u.kind, side: u.side, x: u.x, y: u.y });
    }
  }
  world.units.length = w;
  let s = 0;
  for (let i = 0; i < world.squads.length; i++) {
    const sq = world.squads[i];
    if (sq.members.length > 0) world.squads[s++] = sq;
  }
  world.squads.length = s;
}

/** Paso 8: el blanco de cada unidad con el estado congelado: unidad > torreta > base (esta, solo en ataque). */
export function decideUnits(world) {
  for (const u of world.units) {
    u.tgt = null;
    u.tgtKind = '';
    if (!u.alive) continue;
    const e = 1 - u.side;
    const range = u.stats.range;
    const enemy = world.grids[e].nearest(u.x, u.y, range, (o) => o.alive);
    if (enemy !== null) {
      u.tgt = enemy;
      u.tgtKind = 'unit';
      continue;
    }
    const b = world.bases[e];
    let best = null;
    let bd = range * range;
    for (const t of b.turrets) {
      if (!turretAlive(t)) continue;
      const dx = t.x - u.x;
      const dy = t.y - u.y;
      const d = dx * dx + dy * dy;
      if (d <= bd && (best === null || d < bd)) {
        best = t;
        bd = d;
      }
    }
    if (best !== null) {
      u.tgt = best;
      u.tgtKind = 'turret';
      continue;
    }
    if (u.squad.role === 'ataque' && b.hp > 0 && Math.abs(b.frontX - u.x) <= range) {
      u.tgt = b;
      u.tgtKind = 'base';
    }
  }
}

function aimPoint(u) {
  return u.tgtKind === 'base' ? { x: u.tgt.frontX, y: u.y } : u.tgt;
}

/** Paso 9: disparan solo las unidades que miran a su blanco; las torretas disparan al suyo. */
export function fireAll(world) {
  const step = world.step;
  for (const u of world.units) {
    if (u.cd > 0) u.cd--;
    if (!u.alive || u.tgt === null || u.cd > 0) continue;
    if (!isFacing(u.dir, targetX(u) - u.x)) continue;
    const p = aimPoint(u);
    const dx = p.x - u.x;
    const dy = p.y - u.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const st = u.stats;
    const flight = Math.max(1, Math.ceil((dist / st.projectileSpeed) * SIM_HZ));
    scheduleHit(world, {
      due: step + flight,
      kind: st.splash > 0 ? 'shell' : 'bullet',
      side: u.side,
      owner: u.owner,
      dmg: st.damage,
      splash: st.splash,
      tx: p.x,
      ty: p.y,
      tgt: u.tgt,
      tgtKind: u.tgtKind,
    });
    u.cd = st.cdSteps;
    world.emit({ type: 'shot', id: u.id, kind: u.kind, x: u.x, y: u.y, tx: p.x, ty: p.y });
  }
  const cfg = world.cfg;
  const cdSteps = Math.round(cfg.turret.cooldown * SIM_HZ);
  for (const b of world.bases) {
    for (const t of b.turrets) {
      if (t.cd > 0) t.cd--;
      if (!turretAlive(t) || t.tgt === null || t.cd > 0) continue;
      const dx = t.tgt.x - t.x;
      const dy = t.tgt.y - t.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      scheduleHit(world, {
        due: step + Math.max(1, Math.ceil((dist / cfg.projectiles.bullet) * SIM_HZ)),
        kind: 'bullet',
        side: b.side,
        owner: null,
        dmg: cfg.turret.dmg,
        splash: 0,
        tx: t.tgt.x,
        ty: t.tgt.y,
        tgt: t.tgt,
        tgtKind: 'unit',
      });
      t.cd = cdSteps;
      world.emit({ type: 'turretShot', side: b.side, k: t.k, tx: t.tgt.x, ty: t.tgt.y });
    }
  }
}
