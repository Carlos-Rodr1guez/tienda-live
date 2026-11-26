import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { GROUND_KINDS, resolveConfig } from '../public/js/sim/defaults.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';

// v2.8 (lote 4): el alcance de las unidades de tierra vuelve a ×1,5 (42/54/66/78 → 63/81/99/117), las torretas suben a
// 105 y la visión debe ser al menos 1,3 × el alcance.

const cfg = resolveConfig();

test('alcances ×1,5: soldado 63, jeep 81, tanque 99, pesado 117; torretas a 105', () => {
  assert.deepEqual(
    ['soldado', 'jeep', 'tanque', 'pesado'].map((k) => cfg.units[k].range),
    [63, 81, 99, 117],
  );
  assert.equal(cfg.turret.range, 105);
});

test('la visión es al menos 1,3 × el alcance en cada tipo, y la validación lo exige', () => {
  for (const k of GROUND_KINDS) {
    assert.ok(cfg.movement.vision[k] >= 1.3 * cfg.units[k].range, `${k}: visión ${cfg.movement.vision[k]}`);
  }
  assert.throws(() => resolveConfig({ movement: { vision: { pesado: 140 } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { vision: { pesado: 140 } } }), /vision/);
  // justo en el límite pasa (117 × 1,3 = 152,1)
  assert.doesNotThrow(() => resolveConfig({ movement: { vision: { pesado: 153 } } }));
  assert.throws(
    () => resolveConfig({ units: { soldado: { range: 160 } } }),
    /vision/,
    'subir el alcance sin la visión falla',
  );
});

test('las torretas laterales siguen fuera de alcance de toda la zona de asalto (y 348–548, desde la cara hacia fuera)', () => {
  const w = createWorld();
  const r = w.cfg.turret.range;
  for (const side of [0, 1]) {
    const f = w.field.sides[side];
    const lateral = f.turrets.filter((t) => t.y !== f.door.y);
    assert.equal(lateral.length, 2);
    for (const t of lateral) {
      // el punto de la zona más cercano a la torreta: la esquina de la cara (x = cara, y = borde de la franja)
      const y = t.y < f.door.y ? f.hangar.y0 : f.hangar.y1;
      const d = Math.hypot(t.x - f.hangar.faceX, t.y - y);
      assert.ok(d > r, `torreta (${t.x}, ${t.y}) a ${d.toFixed(1)} px de la esquina, alcance ${r}`);
    }
  }
});

test('el alcance nuevo en combate: el pesado dispara al hangar desde 117 px de su cara y no desde 118', () => {
  const objetivo = (kind, dx) => {
    const w = createWorld({ hq: { hp: 1e12 } });
    for (const t of w.bases[1].turrets) {
      t.hp = 0;
      t.on = false;
    }
    const u = seedUnits(w, { side: 0, kind, x: 1350 - dx, y: 448, yg: 448, pinned: true }).units[0];
    stepWorld(w);
    return u.tgtKind;
  };
  assert.equal(objetivo('pesado', 117), 'base');
  assert.equal(objetivo('pesado', 118), '');
  assert.equal(objetivo('tanque', 99), 'base');
  assert.equal(objetivo('jeep', 81), 'base');
  assert.equal(objetivo('soldado', 63), 'base');
  assert.equal(objetivo('soldado', 64), '');
});

test('las unidades se plantan a alcance − 3 de la cara del hangar (60/78/96/114 px)', () => {
  for (const [kind, halt] of [
    ['soldado', 60],
    ['jeep', 78],
    ['tanque', 96],
    ['pesado', 114],
  ]) {
    const w = createWorld({ hq: { hp: 1e12 } });
    for (const t of w.bases[1].turrets) {
      t.hp = 0;
      t.on = false;
    }
    const u = seedUnits(w, { side: 0, kind, x: 1000, y: 448, yg: 448, phase: 'march' }).units[0];
    for (let i = 0; i < 900; i++) stepWorld(w);
    assert.ok(Math.abs(u.x - (1350 - halt)) < 1.5, `${kind} se plantó en x ${u.x.toFixed(1)}, esperado ${1350 - halt}`);
  }
});
