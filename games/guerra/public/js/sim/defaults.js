// Config propia de Batalla (diseño §7.0): valores por defecto, mezcla con `config.json → game` y validación al
// cargar. Un valor inválido lanza `ConfigError`: el juego muestra el detalle y no arranca a medias.

import { ConfigError, clampNumber, deepMerge } from '@tienda/kit/sim/config.js';

/** Pasos por segundo del sim y duración de un paso (D14). */
export const SIM_HZ = 30;
export const DT = 1 / SIM_HZ;

/** Tipos de unidad de tierra, en el orden del roster. */
export const GROUND_KINDS = Object.freeze([
  'soldado',
  'francotirador',
  'jeep',
  'blindado',
  'tanque',
  'lanzacohetes',
  'pesado',
  'lobo',
]);

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
  turret: { hp: 3000, dmg: 40, cooldown: 0.33, range: 105, arcPx: 4, phaseStep: 0.1 },
  // v2.9 (las peleas duraban demasiado): `hpScale` multiplica la vida, hp = 60·c·bonoHP·hpScale. Todas las unidades de
  // tierra × 0,6 y el tanque y el hombre lobo × 0,4; el daño (dps) no cambia, ni las torretas, la base y el avión.
  // Vida anterior → nueva: soldado 60 → 36, francotirador 180 → 108, jeep 600 → 360, blindado 2 700 → 1 620,
  // tanque 7 500 → 3 000 (×0,4), lanzacohetes 9 000 → 5 400, pesado 60 000 → 36 000, lobo 144 000 → 57 600 (×0,4).
  // `bonoHP` y el índice de poder (bonoHP × bonoDPS) quedan como estaban: `hpScale` es la perilla de la duración de las peleas.
  //
  // hp y dps salen de la regla (#327): hp = 60·c·bonoHP, dps = 6·c·bonoDPS, daño = dps × cadencia. v2.7: el pesado pierde
  // un tercio de vida (bonoHP 1,5 → 1: 90 000 → 60 000 de HP, −33,3 %). v2.8: el alcance de tierra sube ×1,5 otra vez
  // (42/54/66/78 → 63/81/99/117) y las torretas a 105 (siguen sin alcanzar la zona de asalto desde las laterales: la
  // esquina de la cara queda a 106,5 px). La visión (200/240/240/260) debe ser al menos 1,3 × el alcance (validate).
  //
  // Tipos nuevos (v2.8, lote 5), cada uno al costo en monedas de su tramo (`audience.js`): el poder es proporcional al
  // costo y los caros ganan una ventaja chica. Índice de poder por moneda = bonoHP × bonoDPS.
  //  · francotirador (5): 180 HP y 30 dps (disparo de 75 cada 2,5 s), alcance 170; lento y frágil. Índice 0,6. Con 120 HP y 60 dps
  //    (índice 0,8) ganaba a tanques y pesados del mismo valor: rompía la escalera de tramos; ver la tabla de balance del README.
  //  · blindado (30): 2 700 HP y 144 dps, alcance 90; un tanque ligero con ametralladora pesada. Índice 1,2.
  //  · lanzacohetes (300): 9 000 HP y 1 800 dps, alcance 190 y salpicadura 26; artillería frágil. Índice 0,5.
  //  · lobo (3 000, héroe): 144 000 HP y 16 200 dps, cuerpo a cuerpo (24) con zarpazo en área (22); rápido. Índice 0,72.
  units: {
    soldado: {
      c: 1,
      bonoHP: 1,
      hpScale: 0.6,
      bonoDPS: 1,
      cadence: 1.0,
      range: 63,
      speed: 38.4,
      splash: 0,
      foot: [6, 4],
    },
    francotirador: {
      c: 5,
      bonoHP: 0.6,
      hpScale: 0.6,
      bonoDPS: 1,
      cadence: 2.5,
      range: 170,
      speed: 30,
      splash: 0,
      foot: [6, 4],
    },
    jeep: {
      c: 10,
      bonoHP: 1,
      hpScale: 0.6,
      bonoDPS: 1,
      cadence: 0.7,
      range: 81,
      speed: 64,
      splash: 0,
      foot: [18, 8],
    },
    blindado: {
      c: 30,
      bonoHP: 1.5,
      hpScale: 0.6,
      bonoDPS: 0.8,
      cadence: 0.5,
      range: 90,
      speed: 48,
      splash: 0,
      foot: [20, 9],
    },
    tanque: {
      c: 100,
      bonoHP: 1.25,
      hpScale: 0.4,
      bonoDPS: 1.25,
      cadence: 1.25,
      range: 99,
      speed: 35.2,
      splash: 12.8,
      foot: [24, 10],
    },
    lanzacohetes: {
      c: 300,
      bonoHP: 0.5,
      hpScale: 0.6,
      bonoDPS: 1,
      cadence: 2.5,
      range: 190,
      speed: 30,
      splash: 26,
      foot: [26, 10],
    },
    pesado: {
      c: 1000,
      bonoHP: 1,
      hpScale: 0.6,
      bonoDPS: 0.5,
      cadence: 1.5,
      range: 117,
      speed: 25.6,
      splash: 19.2,
      foot: [34, 14],
    },
    lobo: {
      c: 3000,
      bonoHP: 0.8,
      hpScale: 0.4,
      bonoDPS: 0.9,
      cadence: 0.6,
      range: 24,
      speed: 80,
      splash: 22,
      foot: [16, 10],
    },
  },
  // velocidades de vuelo (px/s): la bala de los francotiradores es más rápida, el cohete más lento que un obús de tanque
  // y el zarpazo del lobo llega en un paso
  projectiles: { bullet: 270, shellTanque: 190, shellPesado: 150, sniper: 450, rocket: 230, claw: 600 },
  // Bombardero (v2.6, D-R3/D-R5): vuela RECTO a velocidad constante por la `y` de la banda de `band` px con más fuerza
  // enemiga y suelta una alfombra: una bomba cada `bombSpacing` px de impacto, desde el frente propio (`dropFrom`)
  // hasta el borde enemigo. Con los valores por defecto son 34 bombas de `bombDmg` y radio `bombRadius`.
  // v2.9: el radio de cada bomba sube ×1,6 (24 → 38,4 px) y la explosión de la vista se dibuja de ese tamaño real. Con la
  // separación de 40 px, cada unidad de la franja queda ahora al alcance de casi 2 bombas de la alfombra (antes, de 1,2).
  plane: {
    speed: 120,
    altitude: 48,
    bombDmg: 300,
    bombRadius: 38.4,
    bombSpacing: 40,
    dropFrom: 'ownFront',
    band: 48,
    gravity: 380,
    dropZ: 44,
    margin: 44,
  },
  // Movimiento individual (v2.6, D29): sin grupos ni roles. Cada unidad sale por la puerta de su lado, se reparte a
  // una altura `yg`, ve enemigos a `vision` px, va hacia ellos y marcha a la base enemiga. La separación entre amigos
  // es obligatoria pero nunca frena (D-R8).
  movement: {
    vision: {
      soldado: 200,
      francotirador: 230,
      jeep: 240,
      blindado: 240,
      tanque: 240,
      lanzacohetes: 280,
      pesado: 260,
      lobo: 240,
    },
    scanEvery: 4,
    stickyKeep: 1.25,
    stickySwitch: 0.75,
    // Puerta única (D30): cinco ranuras a múltiplos `slots` del paso `d = máx(slotMin, slotStep × espaciado del tipo)`
    // (soldado 9, jeep 10, tanque 14, pesado 19 px; ancho máximo ±2d = ±38; el mínimo 9 = el espaciado del soldado
    // evita que las ranuras vecinas se bloqueen entre sí y los soldados sigan saliendo a 8/s). Sale por la primera ranura libre: sin
    // amigo vivo a menos de `freeFactor` × el espaciado del par; si ninguna lo está, la cola espera, como mucho `maxWait`
    // segundos: pasado ese plazo la cabeza sale igual por la ranura con más holgura (seguro, no debería dispararse).
    door: { y: 448, slots: [0, 1, -1, 2, -2], slotMin: 9, slotStep: 0.5, freeFactor: 0.9, maxWait: 1 },
    spread: { legX: 300, margin: 20, step: 0.618034 },
    // Tres caminos (v2.7): arriba, medio y abajo, a 1/6, 3/6 y 5/6 del alto útil del suelo (y 241, 448 y 655). La salida
    // número n toma el camino `fractions[n mod 3]` (sin azar) y su altura se dispersa ±`halfWidth` px alrededor de su centro.
    // El orden de la rotación es medio → abajo → arriba. Se eligió midiendo las seis rotaciones posibles con el
    // escenario simétrico de 200 por lado y con ráfagas de 40 tanques y 40 pesados: con arriba → medio → abajo (el orden
    // «natural») salían 4 de 40 pesados por el seguro de espera (y se rompía el 0,9 del espaciado en la puerta) y esta es
    // la única donde, además, el solape p95 por tipo y en el tramo `leg` queda por debajo del 40 % sin ninguna salida forzada.
    lanes: { fractions: [3 / 6, 5 / 6, 1 / 6], halfWidth: 40 },
    // Convergencia: la ruta se cierra desde el camino hacia el centro de la base enemiga a lo largo de `fraction` del ancho
    // del mundo (18 %, ≈ 259 px) antes del punto de parada; la unidad apunta `lookahead` px por delante sobre esa ruta
    // (si no, quedaría a la zaga), así que empieza a doblar ≈ 339 px antes: el último 24 % del ancho.
    converge: { fraction: 0.18, lookahead: 80 },
    // Zona de asalto (v2.7): solo se ataca la base en el tramo central del frente, `halfY` px a cada lado de la puerta.
    // Las torretas de arriba y de abajo quedan fuera: nadie las toma de blanco (ellas siguen disparando). Al converger,
    // el desvío de cada unidad dentro de su camino (±`lanes.halfWidth`) se reescala a `spread × halfY`, así el frente de
    // asalto se abre a lo ancho de la zona en vez de apilarse en un solo punto. Con 100 px las unidades de la zona quedan
    // fuera del alcance (70) de las torretas laterales, que están a 206 del centro. Medido en el asedio S1 el solape de la zona
    // es p50 40 % / p95 66 % (con 60 px: 77 % de p95) y en el simétrico de 200 por lado p95 43 %; el resto es estructural: quien
    // llega detrás atraviesa a los que ya disparan porque la separación nunca frena (D-R8).
    assault: { halfY: 100, spread: 0.9 },
    accel: 3.0,
    arrive: 4,
    faceHoldSeconds: 0.3,
    haltMargin: 3,
    jeepMarchCap: null,
    spawnShield: 0,
    // v2.8: los tipos nuevos quedan por debajo del pesado (38), así `maxSpacing`, las ranuras y el umbral de la puerta no
    // cambian; el lobo y el lanzacohetes ocupan lo de un vehículo grande
    spacing: {
      soldado: 9,
      francotirador: 12,
      jeep: 20,
      blindado: 24,
      tanque: 28,
      lanzacohetes: 32,
      pesado: 38,
      lobo: 28,
    },
    sepGain: 6,
    sepMaxLateral: 0.6,
    // 0,4 y no 0,25 (#586): con 0,25 la corrida de inundación de 120 s dio solape p95 42 % (> 40 %); con 0,4, 34 %
    sepMaxFiring: 0.4,
    enemySpacing: 0,
  },
  limits: {
    maxAlivePerSide: 200,
    // v2.8, «un regalo = una intervención»: un solo avión por lado en el aire, 8 s como mínimo entre dos lanzamientos del
    // mismo lado y cola de aire de 5. Lo que llega con la cola llena se vuelve tanques del mismo valor (queue.js).
    maxPlanesPerTeam: 1,
    planeGapSeconds: 8,
    spawnsPerSecond: 8,
    maxQueuedUnits: 4000,
    maxQueuedPlanes: 5,
    // v2.8: el héroe lobo, como mucho uno vivo (o en cola) por lado; otro que llegue se vuelve pesados del mismo valor
    maxWolvesPerTeam: 1,
  },
  baseline: { start: 3, interval: 12, unit: 'soldado', count: 4 },
  // Energía (CB-14, D19): 3 golpes de 160 y radio 20 sobre el racimo enemigo más fuerte, con 8 pasos entre golpes;
  // sin enemigos, `baseDmg` a la base por el cubo, con un tope de `capPerRound` por ronda.
  energy: { hits: 3, dmg: 160, radius: 20, spacingSteps: 8, baseDmg: 600, capPerRound: 3600 },
  // Contadores sociales (KIT-19, CB-14): lo que dan likes, follow y share (valor 0) y la barra de energía.
  social: {
    likes: { perReinforcement: 300, unit: 'soldado', count: 4 },
    follow: { unit: 'jeep', count: 1 },
    share: { unit: 'soldado', count: 3 },
    energy: { enabled: true, perCharge: 15, userCooldown: 3 },
  },
});

/** La visión de cada tipo, como mínimo, este múltiplo de su alcance (v2.8). */
const VISION_MIN_RATIO = 1.3;

const mustPos = (v, name) => {
  if (!(Number.isFinite(v) && v > 0)) throw new ConfigError(`${name} debe ser mayor que 0`);
};

function validateMovement(cfg) {
  const m = cfg.movement;
  for (const k of GROUND_KINDS) {
    mustPos(m.vision[k], `movement.vision.${k}`);
    mustPos(m.spacing[k], `movement.spacing.${k}`);
  }
  if (!Number.isInteger(m.scanEvery) || m.scanEvery < 1)
    throw new ConfigError('movement.scanEvery debe ser un entero mayor o igual a 1');
  if (!(m.stickyKeep >= 1)) throw new ConfigError('movement.stickyKeep debe ser al menos 1');
  if (!(m.stickySwitch > 0 && m.stickySwitch <= 1)) throw new ConfigError('movement.stickySwitch debe estar en (0, 1]');
  if (!Number.isFinite(m.door.y)) throw new ConfigError('movement.door.y debe ser un número');
  if (!Array.isArray(m.door.slots) || m.door.slots.length < 1 || !m.door.slots.every(Number.isFinite)) {
    throw new ConfigError('movement.door.slots debe ser una lista no vacía de múltiplos (números)');
  }
  mustPos(m.door.slotMin, 'movement.door.slotMin');
  mustPos(m.door.slotStep, 'movement.door.slotStep');
  if (!(m.door.freeFactor > 0 && m.door.freeFactor <= 1))
    throw new ConfigError('movement.door.freeFactor debe estar en (0, 1]');
  mustPos(m.door.maxWait, 'movement.door.maxWait');
  if (
    !Array.isArray(m.lanes.fractions) ||
    m.lanes.fractions.length < 1 ||
    !m.lanes.fractions.every((f) => f > 0 && f < 1)
  )
    throw new ConfigError('movement.lanes.fractions debe ser una lista no vacía de números entre 0 y 1');
  if (!(Number.isFinite(m.lanes.halfWidth) && m.lanes.halfWidth >= 0))
    throw new ConfigError('movement.lanes.halfWidth debe ser 0 o más');
  if (!(m.converge.fraction > 0 && m.converge.fraction <= 1))
    throw new ConfigError('movement.converge.fraction debe estar en (0, 1]');
  mustPos(m.converge.lookahead, 'movement.converge.lookahead');
  mustPos(m.assault.halfY, 'movement.assault.halfY');
  if (!(m.assault.spread > 0 && m.assault.spread <= 1))
    throw new ConfigError('movement.assault.spread debe estar en (0, 1]');
  mustPos(m.spread.legX, 'movement.spread.legX');
  if (!(Number.isFinite(m.spread.margin) && m.spread.margin >= 0))
    throw new ConfigError('movement.spread.margin debe ser 0 o más');
  if (!(m.spread.step > 0 && m.spread.step < 1)) throw new ConfigError('movement.spread.step debe estar en (0, 1)');
  mustPos(m.accel, 'movement.accel');
  mustPos(m.arrive, 'movement.arrive');
  if (!(Number.isFinite(m.faceHoldSeconds) && m.faceHoldSeconds >= 0))
    throw new ConfigError('movement.faceHoldSeconds debe ser 0 o más');
  if (!(Number.isFinite(m.haltMargin) && m.haltMargin >= 0))
    throw new ConfigError('movement.haltMargin debe ser 0 o más');
  if (m.jeepMarchCap !== null) mustPos(m.jeepMarchCap, 'movement.jeepMarchCap');
  if (!(Number.isFinite(m.spawnShield) && m.spawnShield >= 0))
    throw new ConfigError('movement.spawnShield debe ser 0 o más');
  if (!(Number.isFinite(m.sepGain) && m.sepGain >= 0)) throw new ConfigError('movement.sepGain debe ser 0 o más');
  for (const key of ['sepMaxLateral', 'sepMaxFiring']) {
    if (!(m[key] >= 0 && m[key] <= 1)) throw new ConfigError(`movement.${key} debe estar entre 0 y 1`);
  }
  if (!(Number.isFinite(m.enemySpacing) && m.enemySpacing >= 0))
    throw new ConfigError('movement.enemySpacing debe ser 0 o más');
}

function validatePlane(cfg) {
  const p = cfg.plane;
  for (const k of ['speed', 'altitude', 'bombDmg', 'bombRadius', 'bombSpacing', 'band', 'gravity', 'dropZ']) {
    mustPos(p[k], `plane.${k}`);
  }
  if (!(Number.isFinite(p.margin) && p.margin >= 0)) throw new ConfigError('plane.margin debe ser 0 o más');
  if (p.dropFrom !== 'ownFront') throw new ConfigError("plane.dropFrom debe ser 'ownFront'");
}

function validate(cfg) {
  // límites que se recortan (no son errores)
  cfg.hq.minSeconds = clampNumber(cfg.hq.minSeconds, 60, 600, DEFAULTS.hq.minSeconds);
  cfg.limits.maxAlivePerSide = clampNumber(cfg.limits.maxAlivePerSide, 40, 300, DEFAULTS.limits.maxAlivePerSide);
  if (!Number.isInteger(cfg.turret.hp)) throw new ConfigError('turret.hp debe ser un entero');
  cfg.turret.hp = clampNumber(cfg.turret.hp, 500, 20000, DEFAULTS.turret.hp);
  for (const k of GROUND_KINDS) {
    const u = cfg.units[k];
    if (!u) throw new ConfigError(`falta units.${k}`);
    if ('dmg' in u) throw new ConfigError(`units.${k}.dmg no existe: el daño sale de dps × cadencia`);
    for (const key of ['c', 'cadence', 'range', 'speed', 'hpScale']) {
      if (!(Number(u[key]) > 0)) throw new ConfigError(`units.${k}.${key} debe ser mayor que 0`);
    }
  }
  if (!Number.isInteger(cfg.limits.maxWolvesPerTeam) || cfg.limits.maxWolvesPerTeam < 1)
    throw new ConfigError('limits.maxWolvesPerTeam debe ser un entero mayor o igual a 1');
  validateMovement(cfg);
  // v2.8: ver lo que se alcanza con margen; una visión menor haría que la unidad solo vea el blanco al tenerlo encima
  for (const k of GROUND_KINDS) {
    if (!(cfg.movement.vision[k] >= VISION_MIN_RATIO * cfg.units[k].range))
      throw new ConfigError(`movement.vision.${k} debe ser al menos ${VISION_MIN_RATIO} × units.${k}.range`);
  }
  validatePlane(cfg);
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
