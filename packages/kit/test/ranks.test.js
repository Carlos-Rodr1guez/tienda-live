import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileLadder, rankAt, DEFAULT_LADDER } from '@tienda/kit/sim/ranks.js';
import { ConfigError } from '@tienda/kit/sim/config.js';

const small = [
  { id: 'recluta', label: 'Recluta', xp: 0 },
  { id: 'soldado', label: 'Soldado', xp: 10 },
  { id: 'cabo', label: 'Cabo', xp: 25 },
];

test('KIT-22: umbrales 9, 10 y 11 dan Recluta, Soldado, Soldado', () => {
  const ladder = compileLadder({ ladder: small });
  assert.deepEqual(
    [9, 10, 11].map((xp) => ladder[rankAt(ladder, xp)].label),
    ['Recluta', 'Soldado', 'Soldado'],
  );
});

test('KIT-22: una escalera que se repite lanza ConfigError y nombra el umbral repetido', () => {
  const bad = [
    { id: 'a', label: 'A', xp: 0 },
    { id: 'b', label: 'B', xp: 50 },
    { id: 'c', label: 'C', xp: 50 },
  ];
  assert.throws(
    () => compileLadder({ ladder: bad }),
    (e) => e instanceof ConfigError && /50/.test(e.message) && /repet/.test(e.message),
  );
});

test('KIT-22: una escalera que baja, que no empieza en 0 o mal formada se rechaza', () => {
  const r = (xp) => ({ id: 'r' + xp, label: 'R' + xp, xp });
  assert.throws(() => compileLadder({ ladder: [r(0), r(50), r(20)] }), ConfigError);
  assert.throws(
    () => compileLadder({ ladder: [r(1), r(5)] }),
    (e) => e instanceof ConfigError && /0/.test(e.message),
  );
  assert.throws(() => compileLadder({ ladder: [] }), ConfigError);
  assert.throws(() => compileLadder({}), ConfigError);
  assert.throws(() => compileLadder({ ladder: [r(0), { id: 'x', label: 'X', xp: Number.NaN }] }), ConfigError);
  assert.throws(() => compileLadder({ ladder: [r(0), { id: 'x', label: '', xp: 5 }] }), ConfigError);
  assert.throws(() => compileLadder({ ladder: 'no' }), ConfigError);
});

test('KIT-22: la tabla por defecto es la del diseño y rankAt busca el mayor umbral <= XP', () => {
  const ladder = compileLadder({ ladder: DEFAULT_LADDER });
  assert.deepEqual(
    ladder.map((r) => r.xp),
    [0, 1, 25, 75, 200, 500, 1200, 3000, 7500],
  );
  assert.deepEqual(
    ladder.map((r) => r.label),
    ['Recluta', 'Soldado', 'Cabo', 'Sargento', 'Teniente', 'Capitán', 'Mayor', 'Coronel', 'General'],
  );
  const at = (xp) => rankAt(ladder, xp);
  assert.deepEqual(
    [0, 0.5, 1, 24.9, 25, 74, 75, 199, 200, 499, 500, 1199, 1200, 2999, 3000, 7499, 7500].map(at),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8],
  );
  // casos raros: XP negativa, NaN o enorme
  assert.equal(at(-5), 0);
  assert.equal(at(Number.NaN), 0);
  assert.equal(at(1e12), 8);
});

test('KIT-22: sin General, con más XP que Coronel el rango sigue Coronel', () => {
  const ladder = compileLadder({ ladder: DEFAULT_LADDER, general: false });
  assert.equal(ladder.length, 8);
  assert.equal(ladder[rankAt(ladder, 99999)].label, 'Coronel');
  // General activo por defecto
  assert.equal(compileLadder({ ladder: DEFAULT_LADDER }).length, 9);
  assert.equal(compileLadder({ ladder: DEFAULT_LADDER, general: true }).length, 9);
});

test('KIT-22: compilar no toca la entrada y devuelve una escalera congelada', () => {
  const copy = JSON.parse(JSON.stringify(DEFAULT_LADDER));
  const ladder = compileLadder({ ladder: copy, general: false });
  assert.deepEqual(copy, DEFAULT_LADDER);
  assert.ok(Object.isFrozen(ladder));
  assert.throws(() => ladder.push({ id: 'x', label: 'X', xp: 1e9 }), TypeError);
});

test('KIT-22: rankAt es de búsqueda binaria, con una escalera larga da lo mismo que un recorrido lineal', () => {
  const big = Array.from({ length: 1000 }, (_, i) => ({ id: 'r' + i, label: 'R' + i, xp: i * 7 }));
  const ladder = compileLadder({ ladder: big });
  for (const xp of [0, 6, 7, 8, 3500, 6992, 6993, 7000, 99999]) {
    let want = 0;
    for (let i = 0; i < ladder.length; i++) if (ladder[i].xp <= xp) want = i;
    assert.equal(rankAt(ladder, xp), want, `xp ${xp}`);
  }
});
