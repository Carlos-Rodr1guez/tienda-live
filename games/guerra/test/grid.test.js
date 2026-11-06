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

test('en el mundo, un paso con 400 unidades repartidas mide ≤ 40·n distancias entre las dos grillas', async () => {
  const { createWorld, seedSquad, stepWorld } = await import('../public/js/sim/world.js');
  const w = createWorld({ limits: { maxAlivePerSide: 300 } });
  // 20 grupos de soldados por lado (10 cada uno): 400 unidades repartidas en los tres corredores y las tres calles
  for (let i = 0; i < 20; i++) {
    const corridor = i % 3;
    const lane = Math.floor(i / 3) % 3;
    const x = 200 + (i % 7) * 70;
    seedSquad(w, { side: 0, kind: 'soldado', corridor, lane, x });
    seedSquad(w, { side: 1, kind: 'soldado', corridor, lane, x: 1440 - x });
  }
  assert.equal(w.units.length, 400);
  for (let i = 0; i < 5; i++) {
    w.grids[0].distCalls = 0;
    w.grids[1].distCalls = 0;
    stepWorld(w);
    const calls = w.grids[0].distCalls + w.grids[1].distCalls;
    assert.ok(calls <= 40 * w.units.length, `${calls} distancias con ${w.units.length} unidades`);
  }
});
