import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../public/js/sim/grid.js';

// CB-18 (grilla): igual a fuerza bruta en conjuntos sembrados y con costo lineal.

/** Generador sembrado de la prueba (fuera del sim, que no tiene azar). */
function seeded(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cloud = (rnd, n, x0 = 0, x1 = 1440, y0 = 0, y1 = 810) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) }));
const d2 = (a, x, y) => (a.x - x) ** 2 + (a.y - y) ** 2;

test('las consultas por radio dan lo mismo que la fuerza bruta', () => {
  const rnd = seeded(7);
  const g = createGrid({ w: 1440, h: 810 });
  for (let rep = 0; rep < 20; rep++) {
    const pts = cloud(rnd, 150);
    g.rebuild(pts, pts.length);
    for (let q = 0; q < 20; q++) {
      const x = rnd() * 1440;
      const y = rnd() * 810;
      const r = 10 + rnd() * 120;
      const got = [];
      g.forEachInRadius(x, y, r, (p) => got.push(p.id));
      const want = pts.filter((p) => d2(p, x, y) <= r * r).map((p) => p.id);
      assert.deepEqual(
        got.sort((a, b) => a - b),
        want,
      );
    }
  }
});

test('el más cercano en alcance desempata por id y respeta el filtro', () => {
  const rnd = seeded(11);
  const g = createGrid({ w: 1440, h: 810 });
  for (let rep = 0; rep < 20; rep++) {
    const pts = cloud(rnd, 120);
    g.rebuild(pts, pts.length);
    for (let q = 0; q < 20; q++) {
      const x = rnd() * 1440;
      const y = rnd() * 810;
      const r = 20 + rnd() * 100;
      const filtro = q % 2 ? (p) => p.id % 3 !== 0 : undefined;
      let want = null;
      for (const p of pts) {
        if (filtro && !filtro(p)) continue;
        const d = d2(p, x, y);
        if (d > r * r) continue;
        if (!want || d < d2(want, x, y) || (d === d2(want, x, y) && p.id < want.id)) want = p;
      }
      assert.equal(g.nearest(x, y, r, filtro), want);
    }
  }
  // dos puntos a igual distancia: gana el id menor
  const gemelos = [
    { id: 9, x: 110, y: 100 },
    { id: 4, x: 90, y: 100 },
  ];
  g.rebuild(gemelos, 2);
  assert.equal(g.nearest(100, 100, 30).id, 4);
});

test('las cajas dan lo mismo que la fuerza bruta, también en los bordes del mundo', () => {
  const rnd = seeded(3);
  const g = createGrid({ w: 1440, h: 810 });
  const pts = cloud(rnd, 200, -20, 1460, -20, 830);
  g.rebuild(pts, pts.length);
  for (let q = 0; q < 50; q++) {
    const x0 = rnd() * 1400 - 30;
    const y0 = rnd() * 800 - 30;
    const x1 = x0 + rnd() * 200;
    const y1 = y0 + rnd() * 200;
    const got = [];
    g.forEachInBox(x0, y0, x1, y1, (p) => got.push(p.id));
    const want = pts.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id);
    assert.deepEqual(
      got.sort((a, b) => a - b),
      want,
    );
  }
});

test('reconstruir no deja restos y admite más elementos que la reserva inicial', () => {
  const g = createGrid({ w: 1440, h: 810, capacity: 4 });
  const rnd = seeded(5);
  const a = cloud(rnd, 30);
  g.rebuild(a, 30);
  const b = cloud(rnd, 5);
  g.rebuild(b, 5);
  let n = 0;
  g.forEachInBox(-1e9, -1e9, 1e9, 1e9, () => n++);
  assert.equal(n, 5);
  g.rebuild(a, 0);
  assert.equal(g.nearest(10, 10, 1e6), null);
});

test('con 400 elementos repartidos una consulta mide pocas distancias (≤ 40·n en total)', () => {
  const rnd = seeded(21);
  const n = 400;
  const pts = cloud(rnd, n);
  const g = createGrid({ w: 1440, h: 810 });
  g.rebuild(pts, n);
  g.distCalls = 0;
  for (const p of pts) g.nearest(p.x, p.y, 36, (o) => o !== p);
  assert.ok(g.distCalls <= 40 * n, `${g.distCalls} distancias`);
});

/** 200 unidades por lado repartidas por todo el campo, sin azar (la fracción de n·paso reparte x e y). */
function repartidas(createWorld, seedUnits, game = {}) {
  const w = createWorld({ limits: { maxAlivePerSide: 300 }, hq: { hp: 1e12 }, ...game });
  const frac = (n, p) => n * p - Math.floor(n * p);
  const tipos = ['soldado', 'soldado', 'soldado', 'jeep', 'tanque', 'soldado', 'soldado', 'pesado'];
  for (let i = 0; i < 200; i++) {
    const kind = tipos[i % tipos.length];
    const y = 158 + frac(i, 0.618034) * 580;
    seedUnits(w, { side: 0, kind, x: 200 + frac(i, 0.754877) * 500, y, yg: y, phase: 'march' });
    seedUnits(w, {
      side: 1,
      kind,
      x: 1240 - frac(i, 0.754877) * 500,
      y: 158 + frac(i + 0.5, 0.618034) * 580,
      phase: 'march',
    });
  }
  return w;
}

// CB-18 (v2.6): la visión escalonada cada 4 pasos y la separación miden pares por la grilla; el costo es lineal. El
// contador pasa a medir POR PASO y por unidad: el techo sigue siendo 40 distancias por unidad (la visión a 200–260 px
// con consulta cada 4 pasos más la separación a ~20 px promedian unas 20 con 400 unidades repartidas).
test('en el mundo, un paso con 400 unidades repartidas por el campo mide ≤ 40·n distancias entre las dos grillas', async () => {
  const { createWorld, seedUnits, stepWorld } = await import('../public/js/sim/world.js');
  const w = repartidas(createWorld, seedUnits);
  assert.equal(w.units.length, 400);
  let total = 0;
  for (let i = 0; i < 60; i++) {
    w.grids[0].distCalls = 0;
    w.grids[1].distCalls = 0;
    stepWorld(w);
    const calls = w.grids[0].distCalls + w.grids[1].distCalls;
    total += calls / w.units.length;
    assert.ok(calls <= 40 * w.units.length, `${calls} distancias con ${w.units.length} unidades`);
  }
  assert.ok(total / 60 <= 25, `promedio de ${total / 60} distancias por unidad y por paso`);
});

test('en el mundo, 400 unidades en una franja densa de 120×580 miden ≤ 120·n distancias por paso (el peor paso)', async () => {
  const { createWorld, seedUnits, stepWorld } = await import('../public/js/sim/world.js');
  const w = createWorld({ limits: { maxAlivePerSide: 300 }, hq: { hp: 1e12 } });
  // 200 por lado mezclados en una franja de 120 px de ancho por todo el suelo: la pelea más apretada que arma la marcha
  const f = (n, p) => n * p - Math.floor(n * p);
  for (let i = 0; i < 200; i++) {
    for (const side of [0, 1]) {
      const y = 158 + f(i + side * 0.37, 0.56984) * 580;
      seedUnits(w, { side, kind: 'soldado', x: 660 + f(i + side * 0.21, 0.754877) * 120, y, yg: y, phase: 'march' });
    }
  }
  assert.equal(w.units.length, 400);
  let peor = 0;
  for (let i = 0; i < 300; i++) {
    w.grids[0].distCalls = 0;
    w.grids[1].distCalls = 0;
    stepWorld(w);
    peor = Math.max(peor, (w.grids[0].distCalls + w.grids[1].distCalls) / w.units.length);
  }
  // medido ~74 con la visión escalonada, ~85 con el alcance ×1,5 (v2.7) y ~103 con el segundo ×1,5 (v2.8: el radio de la
  // consulta por alcance crece): el techo de 40·n de CB-18 vale para unidades repartidas; en la franja más densa posible
  // se sube a 120·n (el costo de pared se mide en stall.test.js y en la prueba de rendimiento: ≤ 0,5 ms por paso)
  assert.ok(peor <= 120, `${peor} distancias por unidad`);
});
