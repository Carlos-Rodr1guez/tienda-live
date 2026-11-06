import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamCounters } from '@tienda/kit/sim/counters.js';
import { compileRouter, likeOrders } from '@tienda/kit/sim/router.js';

const LIKES = { perReinforcement: 300, unit: 'soldado', count: 4 };
const ENERGY = { enabled: true, perCharge: 3, userCooldown: 3 };
const make = (extra = {}) => createTeamCounters(2, { likes: LIKES, energy: ENERGY, ...extra });

test('KIT-19: 290 likes + 20 emiten un refuerzo del dueño "Likes" (valor 0) y quedan 10', () => {
  const c = make();
  assert.equal(c.addLikes(1, 290), 0);
  assert.equal(c.likeProgress(1), 290 / 300);
  const n = c.addLikes(1, 20);
  assert.equal(n, 1);
  assert.ok(Math.abs(c.likeProgress(1) - 10 / 300) < 1e-12);
  const { router } = compileRouter(
    { tiers: [{ minCoins: 1, unit: 'soldado', coinsPerUnit: 1, maxPerGift: 9 }], likes: LIKES },
    ['soldado'],
  );
  const orders = likeOrders(router, 1, n);
  assert.deepEqual(orders, [{ kind: 'soldado', team: 1, owner: null, count: 4, unitValue: 0, source: 'likes' }]);
  // cada equipo lleva su cuenta
  assert.equal(c.likeProgress(2), 0);
  assert.equal(c.addLikes(2, 650), 2);
});

test('KIT-19: energía: dos comentarios en 1 s con userCooldown=3 suman una sola carga', () => {
  const c = make();
  assert.equal(c.chargeEnergy(1, 'a', 10, true), false);
  assert.equal(c.chargeEnergy(1, 'a', 11, true), false);
  assert.equal(c.energyProgress(1), 1 / 3);
  // pasado el cooldown vuelve a sumar
  c.chargeEnergy(1, 'a', 13.5, true);
  assert.equal(c.energyProgress(1), 2 / 3);
});

test('KIT-19: la barra llena da strike y se vacía; cada equipo tiene la suya', () => {
  const c = make();
  assert.equal(c.chargeEnergy(1, 'a', 0, true), false);
  assert.equal(c.chargeEnergy(1, 'b', 0, true), false);
  assert.equal(c.chargeEnergy(2, 'c', 0, true), false);
  assert.equal(c.chargeEnergy(1, 'd', 0, true), true);
  assert.equal(c.energyProgress(1), 0);
  assert.equal(c.energyProgress(2), 1 / 3);
});

test('KIT-19: la energía solo cuenta con equipo y en batalla', () => {
  const c = make();
  assert.equal(c.chargeEnergy(null, 'a', 0, true), false);
  assert.equal(c.chargeEnergy(1, 'a', 0, false), false);
  assert.equal(c.energyProgress(1), 0);
  assert.equal(c.chargeEnergy(1, 'a', 1, true), false);
  assert.equal(c.energyProgress(1), 1 / 3);
  // energía apagada
  const off = make({ energy: { ...ENERGY, enabled: false } });
  off.chargeEnergy(1, 'a', 0, true);
  assert.equal(off.energyProgress(1), 0);
});

test('KIT-19: resetRound reinicia likes, energía y cooldowns', () => {
  const c = make();
  c.addLikes(1, 100);
  c.chargeEnergy(1, 'a', 0, true);
  c.resetRound();
  assert.equal(c.likeProgress(1), 0);
  assert.equal(c.energyProgress(1), 0);
  c.chargeEnergy(1, 'a', 0.5, true);
  assert.equal(c.energyProgress(1), 1 / 3);
});

test('KIT-9: likes y energía de un usuario sin equipo no cambian nada', () => {
  const c = make();
  assert.equal(c.addLikes(null, 300), 0);
  assert.equal(c.addLikes(undefined, 300), 0);
  assert.equal(c.addLikes(3, 300), 0);
  assert.equal(c.chargeEnergy(null, 'a', 0, true), false);
  assert.equal(c.likeProgress(1), 0);
  assert.equal(c.likeProgress(2), 0);
  assert.equal(c.energyProgress(1), 0);
  assert.equal(c.energyProgress(2), 0);
  // tras unirse (ya con equipo) cuentan solo los nuevos
  c.addLikes(2, 10);
  assert.equal(c.likeProgress(2), 10 / 300);
});

test('KIT-19: sin configuración de likes no hay refuerzos', () => {
  const c = createTeamCounters(2, {});
  assert.equal(c.addLikes(1, 1e6), 0);
  assert.equal(c.chargeEnergy(1, 'a', 0, true), false);
  assert.equal(c.likeProgress(1), 0);
  assert.equal(c.energyProgress(1), 0);
});
