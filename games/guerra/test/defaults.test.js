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
  assert.equal(c.commander.bias, 0);
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

test('commander.bias debe ser entero', () => {
  assert.equal(resolveConfig({ commander: { bias: -20 } }).commander.bias, -20);
  assert.throws(() => resolveConfig({ commander: { bias: 1.5 } }), ConfigError);
});

test('squads.size.* son enteros mayores o iguales a 1', () => {
  for (const malo of [0, -1, 2.5, 'x']) {
    assert.throws(() => resolveConfig({ squads: { size: { soldado: malo } } }), ConfigError, String(malo));
  }
  assert.equal(resolveConfig({ squads: { size: { soldado: 1 } } }).squads.size.soldado, 1);
});

test('cada paso de formación es al menos la huella más footMargin y el semialto del grupo lleno no pasa de 18', () => {
  assert.throws(() => resolveConfig({ squads: { formation: { soldado: { dy: 6 } } } }), ConfigError); // 4 + 3 = 7
  assert.throws(() => resolveConfig({ squads: { formation: { soldado: { dx: 8 } } } }), ConfigError); // 6 + 3 = 9
  assert.throws(() => resolveConfig({ squads: { formation: { jeep: { dy: 10 } } } }), ConfigError); // 8 + 3 = 11
  // semialto: (5 - 1)/2 · 9 + 2 = 20 > 18
  assert.throws(() => resolveConfig({ squads: { formation: { soldado: { dy: 9 } } } }), ConfigError);
  // justo en el borde pasa: 7 y 9
  assert.doesNotThrow(() => resolveConfig({ squads: { formation: { soldado: { dy: 7, dx: 9 } } } }));
  // los valores por defecto cumplen su propia regla
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
  assert.equal(DEFAULTS.units.soldado.range, 28);
});
