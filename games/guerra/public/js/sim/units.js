// Roster y stats de las unidades (diseño D16, CB-9). Regla de stats (#327): hp = 60·c·bonoHP·hpScale (v2.9: `hpScale`
// acorta las peleas), dps = 6·c·bonoDPS y daño por disparo = dps × cadencia. Alcance, velocidad y salpicadura son px (R2).

import { SIM_HZ } from './defaults.js';

/** Tipos de unidad y su id de ataque. El avión no tiene HP ni stats de combate: sus reglas están en plane.js. */
export const UNIT_TYPES = Object.freeze({
  soldado: Object.freeze({ attack: 'fusil', projectile: 'bullet' }),
  francotirador: Object.freeze({ attack: 'rifle-largo', projectile: 'sniper' }),
  jeep: Object.freeze({ attack: 'ametralladora', projectile: 'bullet' }),
  blindado: Object.freeze({ attack: 'ametralladora-pesada', projectile: 'bullet' }),
  tanque: Object.freeze({ attack: 'canon', projectile: 'shellTanque' }),
  lanzacohetes: Object.freeze({ attack: 'cohetes', projectile: 'rocket' }),
  pesado: Object.freeze({ attack: 'canon-doble', projectile: 'shellPesado' }),
  lobo: Object.freeze({ attack: 'zarpazo', projectile: 'claw' }),
  avion: Object.freeze({ attack: 'bombas', projectile: null }),
});

/** Estados de animación que la vista puede pedir por tipo. Los restos de vehículos son una carcasa quemada. */
export const ANIMATION_STATES = Object.freeze({
  soldado: Object.freeze(['idle', 'walk', 'shoot', 'death']),
  francotirador: Object.freeze(['idle', 'walk', 'shoot', 'death']),
  jeep: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  blindado: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  tanque: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  lanzacohetes: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  pesado: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  lobo: Object.freeze(['idle', 'walk', 'shoot', 'death']),
  avion: Object.freeze(['fly']),
});

/**
 * Stats de un tipo de tierra, derivados de la config.
 * @param {any} cfg
 * @param {typeof import('./defaults.js').GROUND_KINDS[number]} kind
 */
export function unitStats(cfg, kind) {
  const u = cfg.units[kind];
  const dps = 6 * u.c * u.bonoDPS;
  return {
    kind,
    hp: 60 * u.c * u.bonoHP * u.hpScale,
    dps,
    cadence: u.cadence,
    damage: dps * u.cadence,
    cdSteps: Math.round(u.cadence * SIM_HZ),
    range: u.range,
    speed: u.speed,
    splash: u.splash,
    foot: u.foot,
    vision: cfg.movement.vision[kind],
    spacing: cfg.movement.spacing[kind],
    // distancia de parada: la unidad se detiene a `alcance − haltMargin` de su blanco
    halt: u.range - cfg.movement.haltMargin,
    attack: UNIT_TYPES[kind].attack,
    projectileSpeed: cfg.projectiles[UNIT_TYPES[kind].projectile],
    c: u.c,
  };
}

/** Cooldown inicial de una unidad (en pasos): reparte los disparos sin azar. */
export function initialCooldown(id, cdSteps) {
  return Math.floor(frac(id, 0.618034) * cdSteps);
}

/** Fracción de `n · step` (sin azar): reparte las alturas de destino y los cooldowns de forma uniforme. */
export const frac = (n, step) => {
  const x = n * step;
  return x - Math.floor(x);
};

/**
 * Camino de la unidad de salida número `n` de un lado (v2.7): rota por los `lanes.fractions` (arriba, medio, abajo: n mod 3)
 * y dentro de su camino se dispersa ±`halfWidth` con `frac(⌊n/3⌋·paso)`, el mismo recurso sin azar de los cooldowns, así
 * no es una fila india. Devuelve la altura de destino `yg` (acotada al suelo menos el margen) y su desvío `off` respecto
 * del centro del camino, que es el que se conserva al converger sobre el centro de la base enemiga.
 * @returns {{yg:number, off:number, lane:number}}
 */
export function targetLane(world, n) {
  const { lanes, spread } = world.cfg.movement;
  const [g0, g1] = world.field.ground;
  const k = lanes.fractions.length;
  const lane = n % k;
  const centro = g0 + lanes.fractions[lane] * (g1 - g0);
  const bruto = centro + (frac((n - lane) / k, spread.step) * 2 - 1) * lanes.halfWidth;
  const yg = Math.min(g1 - spread.margin, Math.max(g0 + spread.margin, bruto));
  return { yg, off: yg - centro, lane };
}

/** Altura de destino `yg` de la salida número `n` (ver `targetLane`). */
export const targetHeight = (world, n) => targetLane(world, n).yg;

/**
 * Crea una unidad terrestre y la agrega al mundo. `o.owner` es la clave del usuario (o null), `o.value` su valor al
 * nacer (`unitValue`; 0 para las gratis), `o.pinned` la deja quieta (solo pruebas), `o.yg` su altura de destino, `o.yoff` su
 * desvío dentro del camino y `o.phase` 'leg' (va a la puerta de reparto) o 'march' (ya va a la base enemiga).
 * @returns {any} la unidad
 */
export function addUnit(world, side, kind, x, y, o = {}) {
  const stats = world.stats[kind];
  const id = ++world.nextId;
  const sh = world.cfg.movement.spawnShield;
  const u = {
    id,
    side,
    kind,
    stats,
    hp: stats.hp,
    maxHp: stats.hp,
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    dir: world.field.sides[side].dir,
    faceSteps: 0,
    cd: initialCooldown(id, stats.cdSteps),
    tgt: null,
    tgtKind: '',
    alive: true,
    owner: o.owner ?? null,
    unitValue: o.value ?? 0,
    valueAlive: o.value ?? 0,
    dmgBy: null,
    phase: o.phase ?? 'leg',
    yg: o.yg ?? y,
    // desvío dentro de su camino: al converger sobre la base enemiga termina a `puerta.y + yoff`
    yoff: o.yoff ?? 0,
    seek: null,
    pinned: o.pinned === true, // andamiaje de pruebas: la unidad no se mueve
    shieldUntil: sh > 0 ? world.step + Math.round(sh * SIM_HZ) : 0,
    // velocidad deseada de este paso, sin y con separación (la prueba de «la separación nunca frena» los lee)
    dvx: 0,
    dvy: 0,
    wx: 0,
    wy: 0,
  };
  world.units.push(u);
  return u;
}
