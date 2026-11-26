import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSend, COOLDOWN_MS, MAX_SENDS, WINDOW_MS } from '../src/waitlist/throttle.js';

const T0 = Date.parse('2026-11-05T12:00:00.000Z');
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

test('throttle: los límites son 10 minutos, 5 envíos y 24 horas', () => {
  assert.equal(COOLDOWN_MS, 10 * MIN);
  assert.equal(MAX_SENDS, 5);
  assert.equal(WINDOW_MS, 24 * 60 * MIN);
});

test('throttle: sin envíos previos se envía y se anota el instante', () => {
  assert.deepEqual(planSend([], T0), { send: true, recentSends: [iso(T0)] });
});

test('throttle: a los 5 minutos del último envío no se envía y la lista no cambia', () => {
  const previos = [iso(T0)];
  assert.deepEqual(planSend(previos, T0 + 5 * MIN), { send: false, recentSends: previos });
});

test('throttle: a los 10 minutos justos sí se envía (el enfriamiento es de al menos 10 minutos); a 9:59 no', () => {
  assert.equal(planSend([iso(T0)], T0 + 10 * MIN - 1).send, false);
  const plan = planSend([iso(T0)], T0 + 10 * MIN);
  assert.equal(plan.send, true);
  assert.deepEqual(plan.recentSends, [iso(T0), iso(T0 + 10 * MIN)]);
});

test('throttle: a los 11 minutos se envía y se conservan los dos instantes', () => {
  assert.deepEqual(planSend([iso(T0)], T0 + 11 * MIN), {
    send: true,
    recentSends: [iso(T0), iso(T0 + 11 * MIN)],
  });
});

test('throttle: con 5 envíos dentro de las últimas 24 horas no se envía, aunque el último sea viejo', () => {
  const previos = [0, 30, 60, 90, 120].map((m) => iso(T0 + m * MIN));
  const ahora = T0 + 120 * MIN + 11 * MIN;
  assert.deepEqual(planSend(previos, ahora), { send: false, recentSends: previos });
});

test('throttle: los envíos de hace más de 24 horas no cuentan y salen de la lista', () => {
  const previos = [0, 1, 2, 3, 4].map((m) => iso(T0 + m * MIN));
  const ahora = T0 + WINDOW_MS + 4 * MIN + 1; // el último (T0+4min) cumplió 24 h hace un instante
  const plan = planSend(previos, ahora);
  assert.equal(plan.send, true);
  assert.deepEqual(plan.recentSends, [iso(ahora)]);
});

test('throttle: justo a las 24 horas el envío más viejo ya no cuenta (ventana abierta)', () => {
  const previos = [iso(T0), iso(T0 + 60 * MIN), iso(T0 + 120 * MIN), iso(T0 + 180 * MIN), iso(T0 + 240 * MIN)];
  assert.equal(planSend(previos, T0 + WINDOW_MS - 1).send, false);
  const plan = planSend(previos, T0 + WINDOW_MS);
  assert.equal(plan.send, true);
  assert.equal(plan.recentSends.length, 5);
  assert.equal(plan.recentSends.at(-1), iso(T0 + WINDOW_MS));
  assert.equal(plan.recentSends[0], iso(T0 + 60 * MIN));
});

test('throttle: la lista guardada nunca pasa de 5 (se queda con los últimos 5)', () => {
  const previos = [60, 120, 180, 240].map((m) => iso(T0 + m * MIN));
  const plan = planSend(previos, T0 + 300 * MIN);
  assert.equal(plan.send, true);
  assert.equal(plan.recentSends.length, 5);
  assert.equal(plan.recentSends.at(-1), iso(T0 + 300 * MIN));
});

test('throttle: no depende del orden de la lista guardada', () => {
  const desordenada = [iso(T0 + 20 * MIN), iso(T0)];
  assert.equal(planSend(desordenada, T0 + 25 * MIN).send, false);
  assert.equal(planSend(desordenada, T0 + 31 * MIN).send, true);
});
