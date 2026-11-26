import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRouter, routeGift, freeOrder, socialOrder, likeOrders } from '@tienda/kit/sim/router.js';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { createNormalizer } from '@tienda/kit/server';

const KINDS = ['A', 'B', 'soldado', 'jeep', 'tanque', 'avion'];
const TIERS = [
  { minCoins: 1, unit: 'A', coinsPerUnit: 1, maxPerGift: 10 },
  { minCoins: 10, unit: 'B', coinsPerUnit: 10, maxPerGift: 5 },
];
const gift = (coins, count = 1, extra = {}) => ({
  type: 'gift',
  giftName: 'Regalo',
  giftId: '1',
  coins,
  count,
  ...extra,
});
const build = (cfg = {}, kinds = KINDS) => compileRouter({ tiers: TIERS, ...cfg }, kinds);
const total = (route) => route.orders.reduce((n, o) => n + o.count, 0);

test('KIT-15: compileRouter rechaza tiers no ascendentes o con coinsPerUnit <= 0', () => {
  const bad = (tiers) => () => compileRouter({ tiers }, KINDS);
  assert.throws(bad([TIERS[1], TIERS[0]]), ConfigError);
  assert.throws(bad([TIERS[0], TIERS[0]]), ConfigError);
  assert.throws(bad([{ ...TIERS[0], coinsPerUnit: 0 }]), ConfigError);
  assert.throws(bad([{ ...TIERS[0], coinsPerUnit: -1 }]), ConfigError);
  assert.throws(bad([]), ConfigError);
  assert.throws(bad(undefined), ConfigError);
  assert.throws(bad([{ ...TIERS[0], unit: 'ovni' }]), ConfigError);
  assert.throws(() => build({ eventCaps: { A: 0 } }), ConfigError);
  assert.throws(() => build({ maxPerEvent: 0 }), ConfigError);
});

test('KIT-15: tier proporcional, con piso y mínimo', () => {
  const { router } = build();
  const r30 = routeGift(gift(30), 1, 'u', router);
  assert.deepEqual(
    r30.orders.map((o) => [o.kind, o.count]),
    [['B', 3]],
  );
  const r1 = routeGift(gift(1), 1, 'u', router);
  assert.deepEqual(
    r1.orders.map((o) => [o.kind, o.count]),
    [['A', 1]],
  );
  const r15 = routeGift(gift(15), 1, 'u', router);
  assert.deepEqual(
    r15.orders.map((o) => [o.kind, o.count]),
    [['B', 1]],
  );
  // maxPerGift limita las unidades de UN regalo; el total es unidades por regalo x count
  assert.equal(total(routeGift(gift(1000), 1, 'u', router)), 5);
  assert.equal(total(routeGift(gift(30, 3), 1, 'u', router)), 9);
  // un regalo de monedas inválidas cuenta como 1 moneda
  assert.equal(total(routeGift(gift(0), 1, 'u', router)), 1);
});

test('KIT-14: es puro, determinista y sin azar', () => {
  const { router } = build();
  const evt = gift(30, 2);
  const a = routeGift(evt, 2, 'u', router);
  const b = routeGift(evt, 2, 'u', router);
  assert.deepEqual(a, b);
  const sellado = JSON.stringify(evt);
  assert.equal(JSON.stringify(evt), sellado);
  assert.deepEqual(Object.keys(a).sort(), ['big', 'coins', 'giftName', 'orders', 'trimmed']);
  assert.deepEqual(a.orders[0], { kind: 'B', team: 2, owner: 'u', count: 6, unitValue: 60 / 6, source: 'gift' });
});

test('KIT-14: la unidad puede ser el avión', () => {
  const { router } = build({ tiers: [{ minCoins: 1, unit: 'avion', coinsPerUnit: 500, maxPerGift: 1 }] });
  assert.equal(routeGift(gift(600), 1, 'u', router).orders[0].kind, 'avion');
});

test('KIT-16: override por nombre normalizado ("rosa", "ROSA ", "Rosa" x3 dan 6 tanques)', () => {
  const { router, warnings } = build({ giftOverrides: { Rosa: { unit: 'tanque', count: 2 } } });
  assert.deepEqual(warnings, []);
  for (const name of ['rosa', 'ROSA ', 'Rosa']) {
    const r = routeGift(gift(1, 3, { giftName: name }), 1, 'u', router);
    assert.deepEqual(
      r.orders.map((o) => [o.kind, o.count]),
      [['tanque', 6]],
      name,
    );
  }
});

test('KIT-16: id:<giftId> gana sobre el nombre', () => {
  const { router } = build({
    giftOverrides: { 'id:5655': { unit: 'tanque', count: 2 }, Rose: { unit: 'jeep', count: 9 } },
  });
  const r = routeGift(gift(1, 1, { giftId: 5655, giftName: 'Rose' }), 1, 'u', router);
  assert.deepEqual(
    r.orders.map((o) => [o.kind, o.count]),
    [['tanque', 2]],
  );
  // otro id con el mismo nombre cae al override por nombre
  const r2 = routeGift(gift(1, 1, { giftId: '1', giftName: 'Rose' }), 1, 'u', router);
  assert.deepEqual(
    r2.orders.map((o) => [o.kind, o.count]),
    [['jeep', 9]],
  );
});

test('KIT-16: una unidad desconocida se ignora con warning y cae a los tiers', () => {
  const { router, warnings } = build({ giftOverrides: { Galaxy: { unit: 'ovni', count: 1 } } });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Galaxy/);
  assert.match(warnings[0], /ovni/);
  const r = routeGift(gift(30, 1, { giftName: 'Galaxy' }), 1, 'u', router);
  assert.deepEqual(
    r.orders.map((o) => [o.kind, o.count]),
    [['B', 3]],
  );
});

test('KIT-16: el override respeta los topes', () => {
  const { router } = build({ giftOverrides: { Rosa: { unit: 'tanque', count: 4 } }, eventCaps: { tanque: 5 } });
  const r = routeGift(gift(1, 3, { giftName: 'Rosa' }), 1, 'u', router);
  assert.equal(r.orders[0].count, 5);
  assert.equal(r.trimmed, 7);
});

test('KIT-17: maxPerEvent recorta, informa lo recortado y las monedas reales', () => {
  const { router } = build({
    tiers: [{ minCoins: 1, unit: 'A', coinsPerUnit: 1, maxPerGift: 200 }],
    maxPerEvent: 50,
  });
  const r = routeGift(gift(200), 1, 'u', router);
  assert.equal(r.orders[0].count, 50);
  assert.equal(r.trimmed, 150);
  assert.equal(r.coins, 200);
});

test('KIT-17: eventCaps por tipo', () => {
  const { router } = build({ eventCaps: { B: 2 } });
  const r = routeGift(gift(30, 2), 1, 'u', router);
  assert.equal(r.orders[0].count, 2);
  assert.equal(r.trimmed, 4);
});

test('KIT-18: unitValue = pagado / generado y la suma conserva las monedas', () => {
  const { router } = build({ giftOverrides: { Rosa: { unit: 'tanque', count: 2 } } });
  const rosa = routeGift(gift(1, 1, { giftName: 'Rosa' }), 1, 'u', router);
  assert.equal(rosa.orders[0].unitValue, 0.5);
  assert.equal(rosa.orders[0].count * rosa.orders[0].unitValue, 1);
  const recorte = build({ tiers: [{ minCoins: 1, unit: 'A', coinsPerUnit: 1, maxPerGift: 200 }], maxPerEvent: 50 });
  const r = routeGift(gift(200), 1, 'u', recorte.router);
  assert.equal(r.orders[0].unitValue, 4);
  assert.equal(r.orders[0].count * r.orders[0].unitValue, r.coins);
  for (const coins of [1, 7, 15, 30, 999]) {
    const x = routeGift(gift(coins, 3), 1, 'u', router);
    const suma = x.orders.reduce((n, o) => n + o.count * o.unitValue, 0);
    assert.ok(Math.abs(suma - coins * 3) < 1e-9, String(coins));
  }
});

test('KIT-18: unión, likes, follow, share y la orden libre valen 0', () => {
  const { router } = build({
    likes: { perReinforcement: 300, unit: 'soldado', count: 4 },
    follow: { unit: 'jeep', count: 1 },
    share: { unit: 'soldado', count: 3 },
  });
  const join = freeOrder('soldado', 1, 'u', 1, 'join');
  assert.deepEqual(join, { kind: 'soldado', team: 1, owner: 'u', count: 1, unitValue: 0, source: 'join' });
  assert.equal(freeOrder('soldado', 2, null, 3, 'baseline').unitValue, 0);
  const follow = socialOrder(router, 'follow', 2, 'u');
  assert.deepEqual(follow, { kind: 'jeep', team: 2, owner: 'u', count: 1, unitValue: 0, source: 'follow' });
  assert.deepEqual(socialOrder(router, 'share', 1, 'u'), {
    kind: 'soldado',
    team: 1,
    owner: 'u',
    count: 3,
    unitValue: 0,
    source: 'share',
  });
  const likes = likeOrders(router, 2, 2);
  assert.equal(likes.length, 2);
  for (const o of likes) {
    assert.deepEqual(o, { kind: 'soldado', team: 2, owner: null, count: 4, unitValue: 0, source: 'likes' });
  }
  assert.deepEqual(likeOrders(router, 2, 0), []);
});

test('KIT-9: follow y share de un usuario sin equipo no piden nada', () => {
  const { router } = build({ follow: { unit: 'jeep', count: 1 }, share: { unit: 'soldado', count: 3 } });
  assert.equal(socialOrder(router, 'follow', null, 'u'), null);
  assert.equal(socialOrder(router, 'share', null, 'u'), null);
  assert.equal(socialOrder(router, 'follow', 1, 'u').count, 1);
  // sin configuración no hay orden
  assert.equal(socialOrder(build().router, 'follow', 1, 'u'), null);
});

test('KIT-16/18: banner con unidad grande o con monedas altas', () => {
  const { router } = build({ bigUnits: ['B'], bannerCoins: 500 });
  assert.equal(routeGift(gift(30), 1, 'u', router).big, true);
  assert.equal(routeGift(gift(1), 1, 'u', router).big, false);
  const { router: r2 } = build({ bannerCoins: 5 });
  assert.equal(routeGift(gift(5), 1, 'u', r2).big, true);
  assert.equal(routeGift(gift(1, 4), 1, 'u', r2).big, false);
  assert.equal(routeGift(gift(1, 5), 1, 'u', r2).big, true);
  assert.equal(routeGift(gift(1, 1, { giftName: '' }), 1, 'u', r2).giftName, 'Regalo');
});

test('KIT-2: una racha cuenta una sola vez (1, 2 y nada) y el registro acredita 3 monedas, no 7', () => {
  const norm = createNormalizer();
  const base = {
    user: { id: '1', displayId: 'a', nickname: 'A' },
    giftId: '5655',
    gift: { name: 'Rose', diamondCount: 1, type: 1 },
  };
  const { router } = build();
  const reg = createRegistry({
    teams: [
      { id: 'pe', name: 'Perú', aliases: ['peru'] },
      { id: 'mx', name: 'México', aliases: ['mexico'] },
    ],
  });
  const deltas = [];
  for (const msg of [
    { ...base, repeatCount: 1, repeatEnd: 0 },
    { ...base, repeatCount: 3, repeatEnd: 0 },
    { ...base, repeatCount: 3, repeatEnd: 1 },
  ]) {
    const events = norm.gift(msg);
    deltas.push(events.length ? events[0].count : 0);
    for (const evt of events) {
      const u = reg.touch(evt);
      const route = routeGift(evt, reg.ensureTeam(u), u.key, router);
      reg.addCoins(u.key, route.coins, 0);
    }
  }
  assert.deepEqual(deltas, [1, 2, 0]);
  assert.equal(reg.get('1').coins.live, 3);
});
