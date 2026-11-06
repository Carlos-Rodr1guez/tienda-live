// Roster y stats de las unidades (diseño D16, CB-9). Regla de stats (#327): hp = 60·c·bonoHP, dps = 6·c·bonoDPS
// y daño por disparo = dps × cadencia. Alcance, velocidad y salpicadura son px (R2).

import { SIM_HZ } from './defaults.js';

/** Tipos de unidad y su id de ataque. El avión no tiene HP ni stats de combate: sus reglas están en plane.js. */
export const UNIT_TYPES = Object.freeze({
  soldado: Object.freeze({ attack: 'fusil', projectile: 'bullet' }),
  jeep: Object.freeze({ attack: 'ametralladora', projectile: 'bullet' }),
  tanque: Object.freeze({ attack: 'canon', projectile: 'shellTanque' }),
  pesado: Object.freeze({ attack: 'canon-doble', projectile: 'shellPesado' }),
  avion: Object.freeze({ attack: 'bombas', projectile: null }),
});

/** Estados de animación que la vista puede pedir por tipo. Los restos de vehículos son una carcasa quemada. */
export const ANIMATION_STATES = Object.freeze({
  soldado: Object.freeze(['idle', 'walk', 'shoot', 'death']),
  jeep: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  tanque: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  pesado: Object.freeze(['idle', 'walk', 'shoot', 'wreck']),
  avion: Object.freeze(['fly']),
});

/**
 * Stats de un tipo de tierra, derivados de la config.
 * @param {any} cfg
 * @param {'soldado'|'jeep'|'tanque'|'pesado'} kind
 */
export function unitStats(cfg, kind) {
  const u = cfg.units[kind];
  const dps = 6 * u.c * u.bonoDPS;
  return {
    kind,
    hp: 60 * u.c * u.bonoHP,
    dps,
    cadence: u.cadence,
    damage: dps * u.cadence,
    cdSteps: Math.round(u.cadence * SIM_HZ),
    range: u.range,
    speed: u.speed,
    splash: u.splash,
    foot: u.foot,
    attack: UNIT_TYPES[kind].attack,
    projectileSpeed: cfg.projectiles[UNIT_TYPES[kind].projectile],
    c: u.c,
  };
}

/** Cooldown inicial de una unidad (en pasos): reparte los disparos sin azar. */
export function initialCooldown(id, cdSteps) {
  const x = id * 0.618034;
  return Math.floor((x - Math.floor(x)) * cdSteps);
}
