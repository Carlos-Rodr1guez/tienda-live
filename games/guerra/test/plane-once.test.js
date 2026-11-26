import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { SIM_GIFTS, buildRouter, createAudience } from '../public/js/audience.js';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { ledger } from '../public/js/sim/credit.js';
import { submitOrder } from '../public/js/sim/queue.js';
import { createWorld, stepWorld } from '../public/js/sim/world.js';

// v2.8 (lote 1): «un regalo = una intervención». Un avión por unidad de regalo, uno por lado en el aire, 8 s entre
// lanzamientos del mismo lado y cola de aire de 5; lo que no cabe en la cola se vuelve tanques del mismo valor.

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
const INMORTAL = { hq: { hp: 1e12 } };
const mundo = (game = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox' });
const avion = (team, count, unitValue = 500, owner = 'P') => ({
  kind: 'avion',
  team,
  owner,
  count,
  unitValue,
  source: 'gift',
});

test('config: un avión por lado en el aire, 8 s entre lanzamientos y cola de aire de 5', () => {
  const c = resolveConfig();
  assert.equal(c.limits.maxPlanesPerTeam, 1);
  assert.equal(c.limits.planeGapSeconds, 8);
  assert.equal(c.limits.maxQueuedPlanes, 5);
});

test('simulador F1: el Airplane del tráfico automático pesa menos (autoWeight < 1) y sigue siendo un botón manual', () => {
  const g = SIM_GIFTS.find((x) => x.name === 'Airplane');
  assert.ok(g.autoWeight > 0 && g.autoWeight <= 0.25);
  assert.equal(g.coins, 500);
});

test('router: un Airplane x5 da UNA orden de 5 aviones (de a uno) y x99 se recorta a 5 sin perder lo pagado', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  const audience = createAudience({ registry, router: buildRouter({}).router });
  const regalo = (count) =>
    audience.translate({
      type: 'gift',
      userId: 'u',
      uniqueId: 'u',
      nickname: 'u',
      giftName: 'Airplane',
      coins: 500,
      count,
    });
  const uno = regalo(1).cmd.orders[0];
  assert.deepEqual([uno.kind, uno.count], ['avion', 1]);
  const cinco = regalo(5);
  assert.equal(cinco.cmd.orders[0].count, 5);
  assert.equal(cinco.meta.trimmed, 0);
  const cien = regalo(99);
  assert.equal(cien.cmd.orders[0].count, 5);
  assert.equal(cien.meta.trimmed, 94);
  assert.ok(Math.abs(cien.cmd.orders[0].count * cien.cmd.orders[0].unitValue - 500 * 99) < 1e-6);
});

test('un combo de 5 da 5 aviones de a uno, con 8 s o más entre ellos, y nunca 2 del mismo lado en el aire', () => {
  const w = mundo();
  submitOrder(w, avion(1, 5));
  assert.equal(w.queues[0].airUnits, 5);
  const lanzados = [];
  for (let i = 0; i < 30 * 90; i++) {
    stepWorld(w);
    assert.ok(w.planes.filter((p) => p.side === 0).length <= 1, `paso ${i}: dos aviones del mismo lado`);
    for (const p of w.planes)
      if (p.launchStep === w.step - 1 && !lanzados.includes(p.launchStep)) lanzados.push(p.launchStep);
  }
  assert.equal(lanzados.length, 5, 'los cinco despegaron');
  for (let i = 1; i < lanzados.length; i++) assert.ok(lanzados[i] - lanzados[i - 1] >= 8 * 30, `hueco ${i}`);
});

test('barrido de 120 s con aviones de los dos lados cada 1 s: jamás 2 del mismo lado en el aire', () => {
  const w = mundo();
  for (let s = 0; s < 120 * 30; s++) {
    if (s % 30 === 0) {
      submitOrder(w, avion(1, 1));
      submitOrder(w, avion(2, 1));
    }
    stepWorld(w);
    for (const side of [0, 1]) assert.ok(w.planes.filter((p) => p.side === side).length <= 1, `paso ${s}`);
  }
});

test('con la cola de aire llena el avión NO se pierde: su valor sale como tanques del mismo valor (500 → 5)', () => {
  const w = mundo();
  submitOrder(w, avion(1, 5)); // llena la cola (5)
  const antes = w.queues[0].groundUnits;
  const n = submitOrder(w, avion(1, 1, 500, 'Q'));
  assert.equal(w.queues[0].airUnits, 5, 'la cola de aire sigue en 5');
  assert.equal(w.queues[0].groundUnits - antes, 5, '500 monedas = 5 tanques');
  const o = w.queues[0].ground.at(-1);
  assert.equal(o.kind, 'tanque');
  assert.equal(o.owner, 'Q');
  assert.ok(Math.abs(o.remaining * o.unitValue - 500) < 1e-9, 'el valor se conserva');
  assert.equal(w.credit.overflow[0], 0, 'no cae en el desborde');
  assert.equal(n, 5, 'devuelve lo encolado (aire y tierra)');
  const ev = w.drain().find((e) => e.type === 'planeConverted');
  assert.deepEqual([ev.side, ev.planes, ev.tanks], [0, 1, 5]);
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-9, 'el libro cuadra');
});

test('cola llena parcial: lo que cabe vuela y el resto se convierte; un combo x5 con 3 en cola da 2 aviones y 15 tanques (3 convertidos)', () => {
  const w = mundo();
  submitOrder(w, avion(2, 3));
  submitOrder(w, avion(2, 5));
  assert.equal(w.queues[1].airUnits, 5);
  const t = w.queues[1].ground.filter((o) => o.kind === 'tanque').reduce((a, o) => a + o.remaining, 0);
  assert.equal(t, 15, '3 aviones de más = 15 tanques');
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-9);
});

test('una sola pasada: el avión de un combo sale una vez y desaparece, sin volver', () => {
  const w = mundo();
  submitOrder(w, avion(1, 1));
  let salidas = 0;
  let lanz = 0;
  for (let i = 0; i < 30 * 40; i++) {
    stepWorld(w);
    for (const e of w.drain()) {
      if (e.type === 'planeOut') salidas++;
      if (e.type === 'planeLaunch') lanz++;
    }
  }
  assert.deepEqual([lanz, salidas, w.planes.length], [1, 1, 0]);
});
