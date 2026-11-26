import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { damageUnit } from '../public/js/sim/combat.js';
import { damageTurret, requestBaseDamage } from '../public/js/sim/base.js';
import { addPaid, ledger, retireQueues, retireRound } from '../public/js/sim/credit.js';
import { launchPlane } from '../public/js/sim/plane.js';
import { submitOrder } from '../public/js/sim/queue.js';

// CB-11, KIT-20: crédito continuo por golpe efectivo, bajas, valor retirado y conservación.

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };

function mundo(extra = {}) {
  const registry = createRegistry({ teams: [PE, MX], ...extra });
  const w = createWorld({}, { registry, phase: 'battle' });
  for (const k of ['A', 'B', 'P']) registry.touch({ userId: k, nickname: k });
  return { w, registry };
}

/** Una unidad suelta, quieta, con dueño y valor. */
function suelta(w, side, kind, x, y, o = {}) {
  const u = seedUnits(w, { side, kind, x, y, yg: y, pinned: true, owner: o.owner, value: o.value }).units[0];
  if (o.value) addPaid(w, side, o.value);
  return u;
}

const xp = (reg, k) => reg.get(k).xp.live;
const cerca = (a, b) => Math.abs(a - b) < 1e-9;

test('75 % y 25 % sobre valor 100 dan 37,5 y 12,5 XP; A tiene la baja', () => {
  const { w, registry } = mundo();
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 100 });
  assert.equal(u.hp, 60);
  damageUnit(w, u, 45, { side: 0, owner: 'A' }); // 75 % del HP
  assert.ok(cerca(xp(registry, 'A'), 37.5));
  assert.ok(u.alive);
  damageUnit(w, u, 999, { side: 0, owner: 'B' }); // sin sobredaño: 15 de 60
  assert.ok(cerca(xp(registry, 'B'), 12.5));
  assert.ok(cerca(xp(registry, 'A'), 37.5));
  assert.equal(registry.get('A').kills.live, 1);
  assert.equal(registry.get('B').kills.live, 0);
  assert.ok(cerca(registry.get('A').value.live, 75));
  assert.ok(cerca(registry.get('B').value.live, 25));
  assert.ok(cerca(w.credit.teamValue[0], 100));
});

test('la baja va al de mayor daño y, a igual daño, al de menor clave por code point', () => {
  const { w, registry } = mundo();
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 10 });
  damageUnit(w, u, 30, { side: 0, owner: 'B' });
  damageUnit(w, u, 30, { side: 0, owner: 'A' });
  assert.equal(registry.get('A').kills.live, 1, 'empate de daño: gana "A" sobre "B"');
  assert.equal(registry.get('B').kills.live, 0);
});

test('una bomba de P que mata una unidad de valor 40 le da 20 XP y la baja', () => {
  const { w, registry } = mundo();
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 40 });
  // misma ruta que la bomba: golpe de área con el dueño del avión
  damageUnit(w, u, 900, { side: 0, owner: 'P' });
  assert.ok(cerca(xp(registry, 'P'), 20));
  assert.equal(registry.get('P').kills.live, 1);
});

test('el superviviente al 10 % que se retira da 45 XP, sin baja, y 10 pasan a retirado', () => {
  const { w, registry } = mundo();
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 100 });
  damageUnit(w, u, 30, { side: 0, owner: 'A' });
  damageUnit(w, u, 24, { side: 0, owner: 'A' });
  assert.ok(u.alive);
  assert.ok(cerca(xp(registry, 'A'), 45));
  assert.equal(registry.get('A').kills.live, 0);
  retireRound(w);
  assert.ok(cerca(w.credit.retired, 10));
  assert.ok(cerca(xp(registry, 'A'), 45), 'retirar no quita lo ya acreditado');
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6);
});

test('el rankUp sale en el golpe que cruza el umbral, no en la muerte', () => {
  const { w, registry } = mundo();
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 100 });
  registry.drain();
  damageUnit(w, u, 30, { side: 0, owner: 'A' }); // slice 50 → 25 XP = umbral de Cabo
  assert.ok(u.alive, 'la unidad sigue viva');
  const ev = registry.drain();
  assert.equal(ev.filter((e) => e.type === 'rankUp' && e.key === 'A').length, 1);
});

test('baja de torreta o de energía: sin XP a nadie, valor sin atribuir que cuenta para el paso 2', () => {
  const { w, registry } = mundo();
  const a = suelta(w, 1, 'soldado', 800, 448, { value: 80 });
  damageUnit(w, a, 999, { side: 0, owner: null }); // la energía no tiene dueño
  for (const k of ['A', 'B', 'P']) {
    assert.equal(xp(registry, k), 0);
    assert.equal(registry.get(k).kills.live, 0);
  }
  assert.ok(cerca(w.credit.destroyedUnattr, 80));
  assert.ok(cerca(w.credit.teamValue[0], 80), 'cuenta en el valor destruido del equipo que golpeó');
  assert.equal(w.credit.destroyedUser, 0);
});

test('daño a la base y a las torretas no da XP, valor ni bajas', () => {
  const { w, registry } = mundo();
  w.bases[1].bucket = 1e9;
  requestBaseDamage(w, 1, 500, { side: 0, owner: 'A' });
  damageTurret(w, w.bases[1].turrets[0], 5000, { side: 0, owner: 'A' });
  assert.equal(xp(registry, 'A'), 0);
  assert.equal(registry.get('A').kills.live, 0);
  assert.equal(registry.get('A').value.live, 0);
  assert.equal(w.credit.teamValue[0], 0);
  assert.ok(w.teams[0].structDamage > 0, 'sí suma al daño efectivo del paso 1');
});

test('una unidad gratis da 0 XP al que la mata', () => {
  const { w, registry } = mundo();
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 0 });
  damageUnit(w, u, 999, { side: 0, owner: 'A' });
  assert.equal(xp(registry, 'A'), 0);
  assert.equal(registry.get('A').kills.live, 1, 'la baja sí cuenta');
});

test('un avión que sale ileso pasa su valor a retirado y no da XP', () => {
  const { w, registry } = mundo();
  addPaid(w, 0, 500);
  assert.ok(launchPlane(w, 0, 'P', 500).ok);
  let n = 0;
  while (w.planes.length > 0 && n++ < 3000) stepWorld(w);
  assert.equal(w.planes.length, 0);
  assert.ok(cerca(w.credit.retired, 500));
  assert.equal(xp(registry, 'P'), 0);
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6);
});

test('fin de ronda: el valor de las unidades vivas y de los aviones pasa a retirado', () => {
  const { w } = mundo();
  suelta(w, 0, 'soldado', 300, 448, { value: 30 });
  suelta(w, 1, 'soldado', 800, 448, { value: 20 });
  addPaid(w, 0, 100);
  launchPlane(w, 0, 'P', 100);
  retireRound(w);
  assert.ok(cerca(w.credit.retired, 150));
  assert.ok(w.units.every((u) => u.valueAlive === 0));
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6);
});

test('fin de partido: lo que sigue en las colas pasa a retirado', () => {
  const { w } = mundo();
  submitOrder(w, { kind: 'soldado', team: 1, owner: 'A', count: 10, unitValue: 3, source: 'gift' });
  submitOrder(w, { kind: 'avion', team: 2, owner: 'B', count: 2, unitValue: 250, source: 'gift' });
  assert.ok(cerca(ledger(w).queued, 30 + 500));
  retireQueues(w);
  const l = ledger(w);
  assert.equal(l.queued, 0);
  assert.ok(cerca(l.retired, 530));
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6);
});

test('sin registro el crédito igual lleva el libro (el sim no depende del kit para conservar)', () => {
  const w = createWorld({}, { phase: 'battle' });
  const u = suelta(w, 1, 'soldado', 800, 448, { value: 10 });
  damageUnit(w, u, 30, { side: 0, owner: 'A' });
  assert.ok(cerca(w.credit.destroyedUser, 5));
});
