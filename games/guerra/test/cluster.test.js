import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { CLUSTER_RADIUS, fireEnergy, requestStrike, strongestCluster } from '../public/js/sim/energy.js';

// CB-14 (v2.6): la energía cae sobre el RACIMO enemigo más fuerte (radio 40, empate: id menor): 3 golpes de 160 y radio
// 20. Sin enemigos va a la base por el cubo, con tope de 3600 por ronda.

const quieta = (w, side, kind, x, y, hp) => {
  const u = seedUnits(w, { side, kind, x, y, yg: y, pinned: true }).units[0];
  u.cd = 1e9;
  if (hp) u.hp = u.maxHp = hp;
  return u;
};
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const golpes = (w) => w.hits.filter((h) => h.dmg === 160);

test('el radio del racimo es 40', () => {
  assert.equal(CLUSTER_RADIUS, 40);
});

test('el racimo más fuerte es el de mayor Σ c·hp/maxHp en radio 40; las propias y las muertas no cuentan', () => {
  const w = createWorld();
  for (let i = 0; i < 8; i++) quieta(w, 1, 'soldado', 800 + i * 4, 300); // 8 soldados juntos: fuerza 8
  const solo = quieta(w, 1, 'jeep', 900, 600); // un jeep (c 10): fuerza 10
  quieta(w, 0, 'pesado', 500, 448); // propio: nunca cuenta
  assert.equal(strongestCluster(w, 0), solo);
  // el jeep herido a la mitad vale 5: ahora gana el racimo de soldados
  solo.hp = solo.maxHp / 2;
  const c = strongestCluster(w, 0);
  assert.equal(c.kind, 'soldado');
  assert.equal(c.y, 300);
  // fuera de radio no suma: a 41 px un soldado ya no es del racimo del otro
  const w2 = createWorld();
  quieta(w2, 1, 'soldado', 800, 300);
  quieta(w2, 1, 'soldado', 841, 300);
  const a = strongestCluster(w2, 0);
  assert.equal(a.x, 800, 'fuerza 1 cada uno: empate, gana el id menor');
  // a 40 px justos sí suma (≤ radio)
  const w3 = createWorld();
  quieta(w3, 1, 'soldado', 800, 300);
  quieta(w3, 1, 'soldado', 840, 300);
  quieta(w3, 1, 'soldado', 1000, 300);
  assert.equal(
    strongestCluster(w3, 0).x,
    800,
    'el par a 40 px (fuerza 2) gana al solitario; empate de los dos: id menor',
  );
  // sin enemigos vivos: null
  const w4 = createWorld();
  assert.equal(strongestCluster(w4, 0), null);
  const m = quieta(w4, 1, 'soldado', 800, 300);
  m.alive = false;
  assert.equal(strongestCluster(w4, 0), null);
});

test('empate de fuerza: gana el id menor, sin importar la posición', () => {
  const w = createWorld();
  const primera = quieta(w, 1, 'soldado', 1000, 700);
  quieta(w, 1, 'soldado', 300, 200);
  assert.equal(strongestCluster(w, 0), primera);
});

test('la energía: 3 golpes de 160 y radio 20 sobre la unidad central del racimo, en los pasos +0, +8 y +16', () => {
  const w = createWorld({}, { phase: 'battle' });
  quieta(w, 1, 'soldado', 1100, 200);
  const c = quieta(w, 1, 'tanque', 900, 500, 7500);
  const paso = w.step;
  const r = fireEnergy(w, 0);
  assert.equal(r.target, 'group');
  assert.equal(r.unit, c);
  const hs = golpes(w);
  assert.equal(hs.length, 3);
  assert.deepEqual(
    hs.map((h) => [h.due - paso, h.tx, h.ty, h.splash, h.owner, h.kind, h.noBase]),
    [
      [0, 900, 500, 20, null, 'area', true],
      [8, 900 + -1 * 12, 500 - 10, 20, null, 'area', true],
      [16, 900 + -1 * 12, 500 + 10, 20, null, 'area', true],
    ],
  );
  // el lado 1 dispara hacia el otro lado: el desplazamiento de −dir·12 se invierte
  const w2 = createWorld({}, { phase: 'battle' });
  quieta(w2, 0, 'tanque', 600, 400, 7500);
  fireEnergy(w2, 1);
  assert.equal(golpes(w2)[1].tx, 600 + 12);
  // la vista recibe el evento con la posición del racimo
  const ev = w.drain().find((e) => e.type === 'energyStrike');
  assert.deepEqual([ev.side, ev.x, ev.y], [0, 900, 500]);
});

test('el daño real: 160 por golpe a quien está en radio 20; los golpes no dañan a la base cuando hay racimo', () => {
  const w = createWorld();
  const c = quieta(w, 1, 'tanque', 900, 500, 90000);
  const lejos = quieta(w, 1, 'tanque', 900, 535, 90000); // a 35 px del centro: fuera del radio de 20 de todos los golpes
  const hpBase = w.bases[1].hp;
  fireEnergy(w, 0);
  run(w, 20);
  assert.equal(lejos.hp, 90000);
  // el golpe 1 en (900, 500): 160; el 2 en (888, 490): a 15,6 px: 160; el 3 en (888, 510): 160
  assert.equal(c.hp, 90000 - 3 * 160);
  assert.equal(w.bases[1].hp, hpBase);
});

test('sin enemigos la energía va a la base por el cubo: 600 pedidos, y el tope de 3600 por ronda cuenta lo pedido', () => {
  const w = createWorld({ hq: { minSeconds: 60 } });
  const t = w.bases[1];
  t.bucket = 1e9; // que el cubo no limite en este test: se mide el tope de la energía
  const pedidos = [];
  for (let i = 0; i < 8; i++) pedidos.push(fireEnergy(w, 0));
  assert.deepEqual(
    pedidos.map((r) => (r.target === 'base' ? r.asked : r.target)),
    [600, 600, 600, 600, 600, 600, 'none', 'none'],
  );
  assert.equal(60000 - t.hp, 3600);
  assert.equal(w.teams[0].energyAsked, 3600);
});

test('sin enemigos y con el cubo vacío no entra daño: el cubo manda (CB-12)', () => {
  const w = createWorld();
  assert.equal(w.bases[1].bucket, 0);
  fireEnergy(w, 0);
  assert.equal(w.bases[1].hp, 60000);
});

test('en pausa la energía queda pendiente y sale al reanudar sobre el racimo de ese momento', () => {
  const w = createWorld();
  const c = quieta(w, 1, 'soldado', 800, 300);
  w.paused = true;
  assert.deepEqual(requestStrike(w, 0), { target: 'deferred' });
  assert.equal(golpes(w).length, 0);
  w.paused = false;
  assert.equal(w.pendingStrikes[0], 1);
  run(w, 20);
  assert.equal(w.pendingStrikes[0], 0);
  assert.equal(c.alive, false, 'el soldado cayó con los golpes');
});
