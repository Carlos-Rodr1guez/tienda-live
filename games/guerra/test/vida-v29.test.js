import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, GROUND_KINDS, resolveConfig } from '../public/js/sim/defaults.js';
import { unitStats } from '../public/js/sim/units.js';

// v2.9: las peleas duraban demasiado. Todas las unidades de tierra pierden vida: ×0,6; el tanque y el hombre lobo, ×0,4.
// El daño (dps) no cambia; las torretas, la base y el avión tampoco.

const cfg = resolveConfig();

// vida anterior (v2.8) → vida nueva
const VIDA = {
  soldado: [60, 36],
  francotirador: [180, 108],
  jeep: [600, 360],
  blindado: [2700, 1620],
  tanque: [7500, 3000],
  lanzacohetes: [9000, 5400],
  pesado: [60000, 36000],
  lobo: [144000, 57600],
};
const DPS = {
  soldado: 6,
  francotirador: 30,
  jeep: 60,
  blindado: 144,
  tanque: 750,
  lanzacohetes: 1800,
  pesado: 3000,
  lobo: 16200,
};

test('v2.9: la vida de cada tipo de tierra es la anterior × 0,6 (tanque y lobo × 0,4)', () => {
  for (const k of GROUND_KINDS) {
    const [antes, ahora] = VIDA[k];
    assert.equal(unitStats(cfg, k).hp, ahora, `${k}: ${antes} → ${ahora}`);
    const factor = k === 'tanque' || k === 'lobo' ? 0.4 : 0.6;
    assert.ok(Math.abs(unitStats(cfg, k).hp / antes - factor) < 1e-12, `${k}: ×${factor}`);
  }
});

test('v2.9: el daño por segundo de todos los tipos no cambia', () => {
  for (const k of GROUND_KINDS) assert.equal(unitStats(cfg, k).dps, DPS[k], k);
});

test('v2.9: la regla es hp = 60 · monedas · bonoHP · hpScale y hpScale vive en la config de cada tipo', () => {
  for (const k of GROUND_KINDS) {
    const u = cfg.units[k];
    assert.equal(u.hpScale, k === 'tanque' || k === 'lobo' ? 0.4 : 0.6, `hpScale de ${k}`);
    assert.equal(unitStats(cfg, k).hp, 60 * u.c * u.bonoHP * u.hpScale, k);
  }
});

test('v2.9: torretas, base y avión no cambian', () => {
  assert.equal(cfg.turret.hp, 3000);
  assert.equal(cfg.hq.hp, 60000);
  assert.equal(DEFAULTS.plane.bombDmg, 300);
  assert.equal('hpScale' in cfg.plane, false, 'el avión no tiene vida ni hpScale');
});

test('v2.9: hpScale se puede cambiar por config y debe ser mayor que 0', () => {
  assert.equal(unitStats(resolveConfig({ units: { soldado: { hpScale: 1 } } }), 'soldado').hp, 60);
  for (const malo of [0, -1, NaN, 'x']) {
    assert.throws(() => resolveConfig({ units: { tanque: { hpScale: malo } } }), /hpScale/, `hpScale ${malo}`);
  }
});
