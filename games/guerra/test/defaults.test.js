import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { DEFAULTS, GROUND_KINDS, resolveConfig } from '../public/js/sim/defaults.js';

// CB-10, CB-12, CB-19: la config propia de Batalla y su validación al cargar (diseño §7.0).

test('los valores por defecto son los del diseño', () => {
  const c = resolveConfig();
  assert.equal(c.hq.hp, 60000);
  assert.equal(c.turret.hp, 3000);
  assert.equal(c.limits.maxAlivePerSide, 200);
  assert.equal(c.hq.minSeconds, 75);
  assert.equal(c.commander, undefined, 'ya no hay comandante');
  assert.equal(c.squads, undefined, 'ya no hay grupos');
  assert.equal(c.movement.door.y, 448);
  assert.deepEqual(c.movement.door, {
    y: 448,
    slots: [0, 1, -1, 2, -2],
    slotMin: 9,
    slotStep: 0.5,
    freeFactor: 0.9,
    maxWait: 1,
  });
  assert.deepEqual(c.movement.vision, {
    soldado: 200,
    francotirador: 230,
    jeep: 240,
    blindado: 240,
    tanque: 240,
    lanzacohetes: 280,
    pesado: 260,
    lobo: 240,
  });
  assert.equal(c.movement.scanEvery, 4);
  assert.equal(c.movement.jeepMarchCap, null);
  assert.equal(c.movement.spawnShield, 0);
  assert.deepEqual(Object.keys(c.units), [...GROUND_KINDS]);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.units.soldado));
});

test('maxAlivePerSide se recorta a [40, 300]', () => {
  for (const [dado, esperado] of [
    [10, 40],
    [200, 200],
    [1000, 300],
  ]) {
    assert.equal(resolveConfig({ limits: { maxAlivePerSide: dado } }).limits.maxAlivePerSide, esperado);
  }
});

test('turret.hp se recorta a [500, 20000] y debe ser entero', () => {
  for (const [dado, esperado] of [
    [100, 500],
    [3000, 3000],
    [50000, 20000],
  ]) {
    assert.equal(resolveConfig({ turret: { hp: dado } }).turret.hp, esperado);
  }
  assert.throws(() => resolveConfig({ turret: { hp: 3000.5 } }), ConfigError);
});

test('hq.minSeconds se recorta a [60, 600]', () => {
  assert.equal(resolveConfig({ hq: { minSeconds: 5 } }).hq.minSeconds, 60);
  assert.equal(resolveConfig({ hq: { minSeconds: 9999 } }).hq.minSeconds, 600);
  assert.equal(resolveConfig({ hq: { minSeconds: 90 } }).hq.minSeconds, 90);
  assert.equal(resolveConfig({ hq: { minSeconds: 'x' } }).hq.minSeconds, 75);
});

test('movement: los valores positivos, enteros y rangos se validan con ConfigError', () => {
  for (const k of GROUND_KINDS) {
    for (const malo of [0, -1, 'x', NaN]) {
      assert.throws(() => resolveConfig({ movement: { vision: { [k]: malo } } }), ConfigError, `vision.${k}=${malo}`);
      assert.throws(() => resolveConfig({ movement: { spacing: { [k]: malo } } }), ConfigError, `spacing.${k}=${malo}`);
    }
  }
  for (const malo of [0, -1, 1.5, 'x']) {
    assert.throws(() => resolveConfig({ movement: { scanEvery: malo } }), ConfigError, `scanEvery=${malo}`);
  }
  assert.equal(resolveConfig({ movement: { scanEvery: 1 } }).movement.scanEvery, 1);
  assert.throws(() => resolveConfig({ movement: { stickyKeep: 0.9 } }), ConfigError);
  for (const malo of [0, 1.1, -1])
    assert.throws(() => resolveConfig({ movement: { stickySwitch: malo } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { slots: [] } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { slots: [0, 'x'] } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { slotMin: 0 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { slotStep: -1 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { freeFactor: 0 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { maxWait: 0 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { maxWait: 'x' } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { freeFactor: 1.5 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { door: { y: NaN } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { spread: { legX: 0 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { spread: { margin: -1 } } }), ConfigError);
  for (const malo of [0, 1, 2])
    assert.throws(() => resolveConfig({ movement: { spread: { step: malo } } }), ConfigError);
  for (const k of ['accel', 'arrive']) assert.throws(() => resolveConfig({ movement: { [k]: 0 } }), ConfigError, k);
  for (const k of ['sepMaxLateral', 'sepMaxFiring']) {
    for (const malo of [-0.1, 1.1, 'x']) assert.throws(() => resolveConfig({ movement: { [k]: malo } }), ConfigError);
  }
  assert.throws(() => resolveConfig({ movement: { sepGain: -1 } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { enemySpacing: -1 } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { spawnShield: -1 } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { jeepMarchCap: 0 } }), ConfigError);
  assert.equal(resolveConfig({ movement: { jeepMarchCap: 1.25 } }).movement.jeepMarchCap, 1.25);
  assert.doesNotThrow(() => resolveConfig());
});

test('cada units.* tiene c, cadence, range y speed mayores que 0', () => {
  for (const k of ['c', 'cadence', 'range', 'speed']) {
    for (const malo of [0, -3, 'x']) {
      assert.throws(() => resolveConfig({ units: { jeep: { [k]: malo } } }), ConfigError, `${k}=${malo}`);
    }
  }
});

test('no existe la clave dmg en units: el daño sale de dps × cadencia', () => {
  assert.throws(() => resolveConfig({ units: { tanque: { dmg: 999 } } }), ConfigError);
  for (const k of GROUND_KINDS) assert.ok(!('dmg' in DEFAULTS.units[k]));
});

test('resolveConfig no toca los valores por defecto', () => {
  resolveConfig({ hq: { hp: 1 }, units: { soldado: { range: 99 } } });
  assert.equal(DEFAULTS.hq.hp, 60000);
  assert.equal(DEFAULTS.units.soldado.range, 63);
});
