// Config propia de Batalla (diseño §7.0): valores por defecto, mezcla con `config.json → game` y validación al
// cargar. Un valor inválido lanza `ConfigError`: el juego muestra el detalle y no arranca a medias.

import { ConfigError, clampNumber, deepMerge } from '@tienda/kit/sim/config.js';

/** Pasos por segundo del sim y duración de un paso (D14). */
export const SIM_HZ = 30;
export const DT = 1 / SIM_HZ;

/** Tipos de unidad de tierra, en el orden del roster. */
export const GROUND_KINDS = Object.freeze(['soldado', 'jeep', 'tanque', 'pesado']);

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

export const DEFAULTS = deepFreeze({
  world: { w: 1440, h: 810 },
  round: { seconds: 180, introSeconds: 5, resultsSeconds: 5, winsToMatch: 2 },
  hq: { hp: 60000, minSeconds: 75 },
  turret: { hp: 3000, dmg: 40, cooldown: 0.33, range: 70, arcPx: 4, phaseStep: 0.1 },
  // hp y dps salen de la regla (#327): hp = 60·c·bonoHP, dps = 6·c·bonoDPS, daño = dps × cadencia
  units: {
    soldado: { c: 1, bonoHP: 1, bonoDPS: 1, cadence: 1.0, range: 28, speed: 38.4, splash: 0, foot: [6, 4] },
    jeep: { c: 10, bonoHP: 1, bonoDPS: 1, cadence: 0.7, range: 36, speed: 64, splash: 0, foot: [18, 8] },
    tanque: {
      c: 100,
      bonoHP: 1.25,
      bonoDPS: 1.25,
      cadence: 1.25,
      range: 44,
      speed: 35.2,
      splash: 12.8,
      foot: [24, 10],
    },
    pesado: { c: 1000, bonoHP: 1.5, bonoDPS: 0.5, cadence: 1.5, range: 52, speed: 25.6, splash: 19.2, foot: [34, 14] },
  },
  projectiles: { bullet: 270, shellTanque: 190, shellPesado: 150 },
  plane: {
    speed: 120,
    altitude: 48,
    bombs: 5,
    bombDmg: 900,
    bombRadius: 24,
    gravity: 380,
    dropZ: 44,
    steerEvery: 0.5,
    steerSpeed: 50,
    decisionOffset: 105,
    margin: 44,
  },
  squads: {
    size: { soldado: 10, jeep: 4, tanque: 2, pesado: 1 },
    departSeconds: 6,
    joinMinSeconds: 2,
    // `dx` del tanque y `dy`/`dx` del pesado no están en el diseño (sus grupos por defecto no tienen filas ni
    // columnas de más): valen solo si alguien sube el tamaño del grupo por config.
    formation: {
      soldado: { width: 5, dy: 7, dx: 9, zigzag: 3 },
      jeep: { width: 2, dy: 15, dx: 26 },
      tanque: { width: 2, dy: 16, dx: 32 },
      pesado: { width: 1, dy: 20, dx: 40 },
    },
    anchorSpeedFactor: 0.9,
    anchorAccel: 1.0,
    anchorDecel: 2.0,
    anchorArrive: 2,
    unitArrive: 4,
    unitAccel: 3.0,
    footMargin: 3,
    faceHoldSeconds: 0.3,
    releaseSeconds: 0.5,
    haltSeconds: 0.5,
    slotTolerance: 2,
    snapPx: 0.3,
    followGap: 8,
    slideSpeedFactor: 0.5,
  },
  commander: { bias: 0, interceptRadius: 220, interceptLoseSeconds: 1, postRows: 4, postGap: 46, postFirst: 128 },
  limits: {
    maxAlivePerSide: 200,
    maxPlanesPerTeam: 2,
    planeGapSeconds: 1.5,
    spawnsPerSecond: 8,
    maxQueuedUnits: 4000,
    maxQueuedPlanes: 20,
  },
  baseline: { start: 3, interval: 12, unit: 'soldado', count: 4 },
});

const SEMIALTO_MAX = 18;

/** Semialto de la formación llena de un tipo: (filas de ancho − 1)/2 · dy + mitad de la huella en y. */
function halfHeight(squads, units, kind) {
  const f = squads.formation[kind];
  const per = Math.min(f.width, squads.size[kind]);
  return ((per - 1) / 2) * f.dy + units[kind].foot[1] / 2;
}

function validate(cfg) {
  // límites que se recortan (no son errores)
  cfg.hq.minSeconds = clampNumber(cfg.hq.minSeconds, 60, 600, DEFAULTS.hq.minSeconds);
  cfg.limits.maxAlivePerSide = clampNumber(cfg.limits.maxAlivePerSide, 40, 300, DEFAULTS.limits.maxAlivePerSide);
  if (!Number.isInteger(cfg.turret.hp)) throw new ConfigError('turret.hp debe ser un entero');
  cfg.turret.hp = clampNumber(cfg.turret.hp, 500, 20000, DEFAULTS.turret.hp);
  if (!Number.isInteger(cfg.commander.bias)) throw new ConfigError('commander.bias debe ser un entero');
  for (const k of GROUND_KINDS) {
    const n = cfg.squads.size[k];
    if (!Number.isInteger(n) || n < 1) throw new ConfigError(`squads.size.${k} debe ser un entero mayor o igual a 1`);
    const u = cfg.units[k];
    if (!u) throw new ConfigError(`falta units.${k}`);
    if ('dmg' in u) throw new ConfigError(`units.${k}.dmg no existe: el daño sale de dps × cadencia`);
    for (const key of ['c', 'cadence', 'range', 'speed']) {
      if (!(Number(u[key]) > 0)) throw new ConfigError(`units.${k}.${key} debe ser mayor que 0`);
    }
    // pasos de la formación: cada paso es al menos la huella más el margen, solo donde hay vecinos
    const f = cfg.squads.formation[k];
    const per = Math.min(f.width, n);
    const rows = Math.ceil(n / per);
    const margin = cfg.squads.footMargin;
    if (per > 1 && !(f.dy >= u.foot[1] + margin)) {
      throw new ConfigError(`squads.formation.${k}.dy debe ser al menos la huella (${u.foot[1]}) más ${margin}`);
    }
    if (rows > 1 && !(f.dx >= u.foot[0] + margin)) {
      throw new ConfigError(`squads.formation.${k}.dx debe ser al menos la huella (${u.foot[0]}) más ${margin}`);
    }
    if (halfHeight(cfg.squads, cfg.units, k) > SEMIALTO_MAX) {
      throw new ConfigError(`squads.formation.${k}: el semialto del grupo lleno pasa de ${SEMIALTO_MAX}`);
    }
  }
  return cfg;
}

/**
 * Mezcla `game` (la sección `game` de `config.json`) sobre los valores por defecto y la valida.
 * @param {object} [game]
 * @returns {typeof DEFAULTS}
 */
export function resolveConfig(game = {}) {
  return deepFreeze(validate(deepMerge(structuredClone(DEFAULTS), game)));
}
