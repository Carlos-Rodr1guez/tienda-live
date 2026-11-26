import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { ROUTER_DEFAULTS, UNIT_KINDS, buildRouter, createAudience } from '../public/js/audience.js';
import { GROUND_KINDS, resolveConfig } from '../public/js/sim/defaults.js';
import { ledger } from '../public/js/sim/credit.js';
import { submitOrder } from '../public/js/sim/queue.js';
import { ANIMATION_STATES, UNIT_TYPES, unitStats } from '../public/js/sim/units.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';

// v2.8 (lote 5): cuatro tipos nuevos (francotirador, blindado, lanzacohetes y el héroe lobo) y una tabla de precios por
// monedas de UN regalo, de 1 a 3000 o más.

const cfg = resolveConfig();
const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };

const ORDEN = ['soldado', 'francotirador', 'jeep', 'blindado', 'tanque', 'lanzacohetes', 'pesado', 'lobo'];

test('el roster de tierra tiene 8 tipos, en el orden de su costo', () => {
  assert.deepEqual([...GROUND_KINDS], ORDEN);
  assert.deepEqual(
    GROUND_KINDS.map((k) => cfg.units[k].c),
    [1, 5, 10, 30, 100, 300, 1000, 3000],
  );
  assert.deepEqual([...UNIT_KINDS].sort(), [...ORDEN, 'avion'].sort());
});

test('regla de stats: hp = 60·c·bonoHP y dps = 6·c·bonoDPS; ninguno trae `dmg` y el daño sale de dps × cadencia', () => {
  for (const k of GROUND_KINDS) {
    const u = cfg.units[k];
    assert.ok(!('dmg' in u), k);
    const s = unitStats(cfg, k);
    assert.equal(s.hp, 60 * u.c * u.bonoHP, k);
    assert.equal(s.dps, 6 * u.c * u.bonoDPS, k);
    assert.equal(s.damage, s.dps * u.cadence, k);
  }
});

test('valores finales de los tipos nuevos', () => {
  const v = (k) => {
    const s = unitStats(cfg, k);
    return { hp: s.hp, dps: s.dps, range: s.range, splash: s.splash, vision: s.vision, spacing: s.spacing };
  };
  assert.deepEqual(v('francotirador'), { hp: 180, dps: 30, range: 170, splash: 0, vision: 230, spacing: 12 });
  assert.deepEqual(v('blindado'), { hp: 2700, dps: 144, range: 90, splash: 0, vision: 240, spacing: 24 });
  assert.deepEqual(v('lanzacohetes'), { hp: 9000, dps: 1800, range: 190, splash: 26, vision: 280, spacing: 32 });
  assert.deepEqual(v('lobo'), { hp: 144000, dps: 16200, range: 24, splash: 22, vision: 240, spacing: 28 });
});

test('el poder por moneda es parecido entre tipos: índice bonoHP × bonoDPS entre 0,5 y 1,6', () => {
  for (const k of GROUND_KINDS) {
    const u = cfg.units[k];
    const idx = u.bonoHP * u.bonoDPS;
    assert.ok(idx >= 0.5 && idx <= 1.6, `${k}: índice ${idx}`);
  }
});

test('el espaciado de los nuevos no pasa de 38: el umbral de la puerta y las ranuras siguen siendo los de siempre', () => {
  for (const k of GROUND_KINDS) assert.ok(cfg.movement.spacing[k] <= 38, k);
  const w = createWorld();
  assert.equal(w.maxSpacing, 38);
});

test('la visión de los nuevos es al menos 1,3 × el alcance y el lobo es cuerpo a cuerpo', () => {
  for (const k of ['francotirador', 'blindado', 'lanzacohetes', 'lobo'])
    assert.ok(cfg.movement.vision[k] >= 1.3 * cfg.units[k].range, k);
  assert.ok(cfg.units.lobo.range <= 24);
  assert.ok(cfg.units.lobo.speed > cfg.units.jeep.speed, 'el lobo es rápido');
  assert.ok(cfg.units.francotirador.speed < cfg.units.soldado.speed, 'el francotirador es lento');
});

test('UNIT_TYPES y ANIMATION_STATES cubren los tipos nuevos', () => {
  for (const k of GROUND_KINDS) {
    assert.ok(UNIT_TYPES[k], `UNIT_TYPES.${k}`);
    assert.ok(ANIMATION_STATES[k], `ANIMATION_STATES.${k}`);
    assert.ok(cfg.projectiles[UNIT_TYPES[k].projectile] > 0, `proyectil de ${k}`);
  }
  assert.deepEqual([...ANIMATION_STATES.francotirador], ['idle', 'walk', 'shoot', 'death']);
  assert.deepEqual([...ANIMATION_STATES.blindado], ['idle', 'walk', 'shoot', 'wreck']);
  assert.deepEqual([...ANIMATION_STATES.lanzacohetes], ['idle', 'walk', 'shoot', 'wreck']);
  assert.deepEqual([...ANIMATION_STATES.lobo], ['idle', 'walk', 'shoot', 'death']);
});

test('validate: faltar un tipo nuevo o subir su alcance sin la visión es un error de config', () => {
  assert.throws(() => resolveConfig({ units: { lobo: { range: 300 } } }), /vision/);
  assert.throws(() => resolveConfig({ units: { francotirador: { range: 190 } } }), /vision/);
});

// ----------------------------------------------------------------------------------------------- precios por monedas

const router = buildRouter({}).router;
const registry = createRegistry({ teams: [PE, MX] });
const audience = createAudience({ registry, router });
const regalo = (coins, count = 1) =>
  audience.translate({ type: 'gift', userId: 'u', uniqueId: 'u', nickname: 'u', giftName: 'X', coins, count });

test('tabla de tramos: monedas de UN regalo → unidad', () => {
  const casos = [
    [1, 'soldado'],
    [4, 'soldado'],
    [5, 'francotirador'],
    [9, 'francotirador'],
    [10, 'jeep'],
    [29, 'jeep'],
    [30, 'blindado'],
    [99, 'blindado'],
    [100, 'tanque'],
    [299, 'tanque'],
    [300, 'lanzacohetes'],
    [499, 'lanzacohetes'],
    [500, 'avion'],
    [999, 'avion'],
    [1000, 'pesado'],
    [2999, 'pesado'],
    [3000, 'lobo'],
    [44999, 'lobo'],
  ];
  for (const [c, kind] of casos) assert.equal(regalo(c).cmd.orders[0].kind, kind, `${c} monedas`);
  assert.deepEqual(
    ROUTER_DEFAULTS.tiers.map((t) => [t.minCoins, t.unit, t.coinsPerUnit]),
    [
      [1, 'soldado', 1],
      [5, 'francotirador', 5],
      [10, 'jeep', 10],
      [30, 'blindado', 30],
      [100, 'tanque', 100],
      [300, 'lanzacohetes', 300],
      [500, 'avion', 500],
      [1000, 'pesado', 1000],
      [3000, 'lobo', 3000],
    ],
  );
});

test('sin recorte: ningún regalo único de 1 a 5000 monedas pasa del tope del tipo ni se recorta (el valor siempre se conserva)', () => {
  for (let c = 1; c <= 5000; c++) {
    const r = regalo(c);
    const o = r.cmd.orders[0];
    assert.equal(r.meta.trimmed, 0, `${c} monedas se recortó`);
    assert.ok(o.count >= 1 && o.count <= (router.eventCaps.get(o.kind) ?? Infinity), `${c}: ${o.count} ${o.kind}`);
    assert.ok(Math.abs(o.count * o.unitValue - c) < 1e-9, `${c}: el valor no se conserva`);
  }
});

test('desperdicio: lo que un regalo paga de más sobre sus unidades es a lo sumo la mitad, salvo desde 3000', () => {
  for (let c = 1; c < 3000; c++) {
    const o = regalo(c).cmd.orders[0];
    const tier = [...router.tiers].reverse().find((t) => c >= t.minCoins);
    const costo = o.count * tier.coinsPerUnit;
    assert.ok(costo >= c / 2, `${c} monedas dan solo ${o.count} × ${tier.unit} (${costo})`);
  }
});

test('combo: un regalo de 5 monedas ×4 da 4 francotiradores; ×99 se recorta al tope del tipo (10) sin perder lo pagado', () => {
  const cuatro = regalo(5, 4);
  assert.deepEqual([cuatro.cmd.orders[0].kind, cuatro.cmd.orders[0].count], ['francotirador', 4]);
  const cien = regalo(5, 99);
  assert.equal(cien.cmd.orders[0].count, 10);
  assert.ok(cien.meta.trimmed > 0);
  assert.ok(Math.abs(cien.cmd.orders[0].count * cien.cmd.orders[0].unitValue - 5 * 99) < 1e-9);
});

test('los regalos grandes (lanzacohetes, pesado y lobo) llevan el cartel del donante', () => {
  assert.equal(regalo(300).meta.big, true);
  assert.equal(regalo(3000).meta.big, true);
  assert.equal(regalo(29).meta.big, false);
});

test('un solo lobo por regalo: un combo ×2 pide 2 y el tope del evento es 2', () => {
  assert.equal(regalo(3000).cmd.orders[0].count, 1);
  assert.equal(regalo(9000).cmd.orders[0].count, 1);
  assert.equal(regalo(3000, 2).cmd.orders[0].count, 2);
  assert.equal(regalo(3000, 9).cmd.orders[0].count, 2);
});

// ------------------------------------------------------------------------------------------- lobo: uno vivo por lado

const lobo = (team, count = 1, unitValue = 3000, owner = 'D') => ({
  kind: 'lobo',
  team,
  owner,
  count,
  unitValue,
  source: 'gift',
});
const mundo = (game = {}) => createWorld({ hq: { hp: 1e12 }, ...game }, { phase: 'sandbox' });
const enCola = (w, side, kind) =>
  w.queues[side].ground.filter((o) => o.kind === kind).reduce((a, o) => a + o.remaining, 0);

test('config: como mucho un lobo vivo por lado', () => {
  assert.equal(cfg.limits.maxWolvesPerTeam, 1);
  assert.throws(() => resolveConfig({ limits: { maxWolvesPerTeam: 0 } }), /maxWolvesPerTeam/);
});

test('el primer lobo entra a la cola; el segundo (en cola o vivo) se vuelve 3 pesados del mismo valor y avisa con loboConverted', () => {
  const w = mundo();
  assert.equal(submitOrder(w, lobo(1)), 1);
  assert.equal(enCola(w, 0, 'lobo'), 1);
  const n = submitOrder(w, lobo(1, 1, 3000, 'E'));
  assert.equal(n, 3, 'devuelve lo encolado');
  assert.equal(enCola(w, 0, 'lobo'), 1, 'sigue habiendo un solo lobo');
  assert.equal(enCola(w, 0, 'pesado'), 3);
  const o = w.queues[0].ground.at(-1);
  assert.deepEqual([o.kind, o.owner, o.unitValue], ['pesado', 'E', 1000]);
  const ev = w.drain().find((e) => e.type === 'loboConverted');
  assert.deepEqual(
    [ev.side, ev.owner, ev.lobos, ev.pesados, ev.value],
    [0, 'E', 1, 3, 3000],
    'el evento trae lado, dueño, lobos, pesados y valor',
  );
  assert.equal(w.credit.overflow[0], 0);
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-9, 'el libro cuadra');
});

test('el tope es por lado: el otro lado puede tener su lobo', () => {
  const w = mundo();
  submitOrder(w, lobo(1));
  submitOrder(w, lobo(2));
  assert.equal(enCola(w, 0, 'lobo'), 1);
  assert.equal(enCola(w, 1, 'lobo'), 1);
});

test('un combo ×2 da 1 lobo y 3 pesados; un regalo de 6000 convertido da 6 pesados de 1000', () => {
  const w = mundo();
  assert.equal(submitOrder(w, lobo(1, 2)), 4);
  assert.equal(enCola(w, 0, 'lobo'), 1);
  assert.equal(enCola(w, 0, 'pesado'), 3);
  submitOrder(w, lobo(1, 1, 6000, 'F'));
  assert.equal(enCola(w, 0, 'pesado'), 9);
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-9);
});

test('mientras el lobo vive llegan pesados; al morir se puede pedir otro', () => {
  const w = mundo();
  submitOrder(w, lobo(1));
  for (let i = 0; i < 90; i++) stepWorld(w);
  const vivo = w.units.find((u) => u.kind === 'lobo');
  assert.ok(vivo, 'el lobo salió por la puerta');
  submitOrder(w, lobo(1));
  assert.equal(enCola(w, 0, 'lobo'), 0, 'con el lobo vivo no entra otro');
  assert.equal(enCola(w, 0, 'pesado'), 3);
  vivo.alive = false;
  vivo.hp = 0;
  stepWorld(w);
  submitOrder(w, lobo(1));
  assert.equal(enCola(w, 0, 'lobo'), 1, 'muerto el lobo, entra otro');
});

test('la cola de tierra llena no pierde valor al convertir un lobo (lo que no cabe va al desborde)', () => {
  const w = mundo({ limits: { maxQueuedUnits: 2 } });
  submitOrder(w, lobo(1));
  submitOrder(w, lobo(1, 1, 3000, 'G'));
  assert.equal(enCola(w, 0, 'pesado'), 1, 'solo cabe 1 en la cola');
  assert.ok(w.credit.overflow[0] > 1999 && w.credit.overflow[0] < 2001, `desborde ${w.credit.overflow[0]}`);
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-9);
});

// ----------------------------------------------------------------------------------------------------- alcance real

const sinTorretas = (w) => {
  for (const b of w.bases)
    for (const t of b.turrets) {
      t.hp = 0;
      t.on = false;
    }
};

test('francotirador: toma de blanco a un soldado a 170 px y no a 171', () => {
  const blanco = (dx) => {
    const w = mundo();
    const a = seedUnits(w, { side: 0, kind: 'francotirador', x: 600, y: 300, yg: 300, pinned: true }).units[0];
    seedUnits(w, { side: 1, kind: 'soldado', x: 600 + dx, y: 300, yg: 300, pinned: true });
    stepWorld(w);
    return a.tgtKind;
  };
  assert.equal(blanco(170), 'unit');
  assert.equal(blanco(171), '');
});

test('lanzacohetes: dispara al hangar desde 190 px y no desde 191; blindado desde 90', () => {
  const objetivo = (kind, dx) => {
    const w = mundo();
    sinTorretas(w);
    const u = seedUnits(w, { side: 0, kind, x: 1350 - dx, y: 448, yg: 448, pinned: true }).units[0];
    stepWorld(w);
    return u.tgtKind;
  };
  assert.equal(objetivo('lanzacohetes', 190), 'base');
  assert.equal(objetivo('lanzacohetes', 191), '');
  assert.equal(objetivo('blindado', 90), 'base');
  assert.equal(objetivo('blindado', 91), '');
  assert.equal(objetivo('francotirador', 170), 'base');
});

test('lobo: cuerpo a cuerpo, solo ataca el hangar a ≤ 24 px de su cara', () => {
  const objetivo = (dx) => {
    const w = mundo();
    sinTorretas(w);
    const u = seedUnits(w, { side: 0, kind: 'lobo', x: 1350 - dx, y: 448, yg: 448, pinned: true }).units[0];
    stepWorld(w);
    return u.tgtKind;
  };
  assert.equal(objetivo(24), 'base');
  assert.equal(objetivo(25), '');
});

test('lobo: el zarpazo es en área, golpea a todos los enemigos a ≤ 22 px del blanco', () => {
  const w = mundo();
  const l = seedUnits(w, { side: 0, kind: 'lobo', x: 600, y: 300, yg: 300, pinned: true }).units[0];
  const a = seedUnits(w, { side: 1, kind: 'soldado', x: 620, y: 300, yg: 300, pinned: true }).units[0];
  const b = seedUnits(w, { side: 1, kind: 'soldado', x: 632, y: 300, yg: 300, pinned: true }).units[0];
  const lejos = seedUnits(w, { side: 1, kind: 'soldado', x: 660, y: 300, yg: 300, pinned: true }).units[0];
  for (let i = 0; i < 20; i++) stepWorld(w);
  assert.equal(l.alive, true);
  assert.equal(a.alive, false, 'el blanco muere');
  assert.equal(b.alive, false, 'el de al lado (12 px) también');
  assert.equal(lejos.alive, true, 'el de 40 px queda fuera del zarpazo');
});

test('el lobo sale de la puerta, camina y llega a la base enemiga a su alcance (21 px de la cara)', () => {
  const w = mundo();
  sinTorretas(w);
  const u = seedUnits(w, { side: 0, kind: 'lobo', x: 700, y: 448, yg: 448, phase: 'march' }).units[0];
  for (let i = 0; i < 900; i++) stepWorld(w);
  assert.ok(Math.abs(u.x - (1350 - 21)) < 1.5, `se plantó en x ${u.x.toFixed(1)}`);
  assert.equal(u.tgtKind, 'base');
});
