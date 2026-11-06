import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createMatch } from '../public/js/sim/match.js';
import {
  applyPresence,
  createInputFilter,
  createPresenceGuard,
  feedInput,
  isCountedInput,
  resolvePresenceMinutes,
} from '../public/js/sim/presence.js';

// NM-7 (pausa por inactividad), NM-8 (qué cuenta como entrada), NM-9 (pausa de presencia vs manual) y KIT-27 (los
// eventos del simulador no son entrada del narrador). El reloj de pared llega inyectado, en milisegundos.

const SEG = 1000;
const MIN = 60 * SEG;

test('NM-7: los minutos se recortan a [2, 10] y 0, false, null, texto o negativo valen 5; no hay valor que apague la guardia', () => {
  const casos = [
    [1, 2],
    [11, 10],
    [0, 5],
    [false, 5],
    [null, 5],
    ['x', 5],
    [-3, 5],
    [undefined, 5],
    [NaN, 5],
    [Infinity, 5],
    [true, 5],
    [{}, 5],
    [2, 2],
    [10, 10],
    [7, 7],
    [2.5, 2.5],
    [Number.MAX_VALUE, 10],
    [Number.MIN_VALUE, 2],
  ];
  for (const [entrada, minutos] of casos) assert.equal(resolvePresenceMinutes(entrada), minutos, String(entrada));
  for (const v of [1, 11, 0, false, null, 'x']) {
    const g = createPresenceGuard({ minutes: v, now: () => 0 });
    g.update('battle', 0);
    assert.equal(g.active, true);
    assert.equal(g.tick(11 * MIN), 'idle', `valor ${String(v)}`);
  }
});

test('NM-7: con N = 5 y la última entrada en t = 0, a 299 s no pausa y a 300 s pausa', () => {
  let ahora = 0;
  const g = createPresenceGuard({ minutes: 5, now: () => ahora });
  g.update('battle', 0);
  g.input(0);
  assert.equal(g.tick(299 * SEG), 'active');
  assert.equal(g.tick(299999), 'active');
  assert.equal(g.tick(300 * SEG), 'idle');
  // el reloj inyectado vale cuando no se pasa t
  ahora = 299 * SEG;
  assert.equal(g.tick(), 'active');
  ahora = 300 * SEG;
  assert.equal(g.tick(), 'idle');
});

test('NM-7: una entrada reinicia el contador (4 min inactivos y una tecla)', () => {
  const g = createPresenceGuard({ minutes: 5, now: () => 0 });
  g.update('battle', 0);
  assert.equal(g.tick(4 * MIN), 'active');
  g.input(4 * MIN);
  assert.equal(g.tick(8 * MIN + 59 * SEG), 'active');
  assert.equal(g.tick(9 * MIN), 'idle');
});

test('NM-7: la guardia está activa de startMatch a matchEnd, también en las pantallas intermedias', () => {
  const g = createPresenceGuard({ minutes: 2, now: () => 0 });
  const cuando = (estado, t) => {
    g.update(estado, t);
    return g.tick(t);
  };
  assert.equal(cuando('matchup', 0), 'active');
  assert.equal(cuando('matchup', 60 * MIN), 'active', 'sin partido no hay guardia');
  assert.equal(cuando('lobby', 61 * MIN), 'active', 'la sala todavía no es partido');
  assert.equal(cuando('lobby', 100 * MIN), 'active');
  // arranca el partido: el contador empieza ahí
  assert.equal(cuando('intro', 100 * MIN), 'active');
  assert.equal(cuando('battle', 101 * MIN), 'active');
  assert.equal(cuando('roundEnd', 101 * MIN + 59 * SEG), 'active');
  assert.equal(cuando('waitingNextRound', 102 * MIN), 'idle');
  assert.equal(cuando('intro', 102 * MIN), 'idle');
  // el fin del partido la apaga
  assert.equal(cuando('matchEnd', 103 * MIN), 'active');
  assert.equal(g.active, false);
  // y vuelve a empezar de cero en el partido siguiente
  assert.equal(cuando('lobby', 200 * MIN), 'active');
  assert.equal(cuando('intro', 200 * MIN), 'active');
  assert.equal(cuando('battle', 200 * MIN + 119 * SEG), 'active');
  assert.equal(cuando('battle', 202 * MIN), 'idle');
});

test('NM-8: solo cuentan keydown, pointerdown (ratón, lápiz, toque y pellizco), wheel y pointermove acumulado de 24 px, con isTrusted', () => {
  for (const type of ['keydown', 'pointerdown', 'wheel']) {
    assert.equal(isCountedInput({ type, isTrusted: true }), true, type);
    assert.equal(isCountedInput({ type, isTrusted: false }), false, `${type} sintético`);
    assert.equal(isCountedInput({ type }), false, `${type} sin isTrusted`);
  }
  for (const pointerType of ['mouse', 'pen', 'touch']) {
    assert.equal(isCountedInput({ type: 'pointerdown', isTrusted: true, pointerType }), true, pointerType);
  }
  // pellizco: el segundo dedo es otro pointerdown
  assert.equal(isCountedInput({ type: 'pointerdown', isTrusted: true, pointerType: 'touch', isPrimary: false }), true);
  // lo que no cuenta
  for (const type of [
    'keyup',
    'click',
    'message',
    'gift',
    'camera-auto',
    'gift-moment',
    'commander',
    'bridge',
    'sim',
  ]) {
    assert.equal(isCountedInput({ type, isTrusted: true }), false, type);
  }
  assert.equal(isCountedInput(null), false);
  assert.equal(isCountedInput(undefined), false);
  assert.equal(isCountedInput({ type: 'keydown', isTrusted: 1 }), false, 'isTrusted debe ser true');
});

test('NM-8: el movimiento del puntero cuenta al acumular 24 px, no antes; el acumulador se vacía al contar', () => {
  const f = createInputFilter();
  const mv = (dx, dy, isTrusted = true) => ({ type: 'pointermove', isTrusted, movementX: dx, movementY: dy });
  assert.equal(f.counts(mv(10, 0)), false);
  assert.equal(f.counts(mv(0, 10)), false); // 20 px
  assert.equal(f.counts(mv(-2, 0)), false); // 22 px
  assert.equal(f.counts(mv(3, 0)), true); // 25 px
  assert.equal(f.counts(mv(5, 0)), false, 'vuelve a empezar de cero');
  // una diagonal de 3-4-5 acumulada: 5 * 5 = 25
  const g = createInputFilter();
  const res = [1, 2, 3, 4, 5].map(() => g.counts(mv(3, 4)));
  assert.deepEqual(res, [false, false, false, false, true]);
  // los sintéticos no suman
  const h = createInputFilter();
  for (let i = 0; i < 20; i++) assert.equal(h.counts(mv(50, 50, false)), false);
  assert.equal(h.counts(mv(23, 0)), false);
  // un salto grande cuenta de una
  assert.equal(createInputFilter().counts(mv(24, 0)), true);
  // sin filtro, isCountedInput evalúa solo ese evento
  assert.equal(isCountedInput(mv(30, 0)), true);
  assert.equal(isCountedInput(mv(10, 0)), false);
  // las demás entradas también pasan por el filtro
  assert.equal(createInputFilter().counts({ type: 'wheel', isTrusted: true }), true);
  // sin datos de movimiento no hay nada que sumar
  assert.equal(createInputFilter().counts({ type: 'pointermove', isTrusted: true }), false);
});

// ---------------------------------------------------------------------------------------------------------------
// NM-9 con el partido

const partido = () =>
  createMatch({
    paises: PAISES,
    game: { round: { seconds: 900, introSeconds: 1, resultsSeconds: 1 } },
    registry: createRegistry({ teams: [PAISES[0], PAISES[1]] }),
  });
const aBatalla = (m) => {
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command({ type: 'startMatch' });
  for (let i = 0; i < 30; i++) m.step();
  assert.equal(m.state, 'battle');
};

test('NM-8/KIT-27: el juego se pausa a los 5 min aunque lleguen regalos continuamente y la automática mueva la cámara', () => {
  const m = partido();
  aBatalla(m);
  m.registry.touch({ userId: 'sim1', nickname: 'Sim' });
  const g = createPresenceGuard({ minutes: 5, now: () => 0 });
  const f = createInputFilter();
  let pausadoEn = null;
  for (let i = 0; i < 9000 + 90; i++) {
    const t = Math.round((i * SEG) / 30); // ms de pared; el reloj arranca en la batalla
    if (i === 0) applyPresence(g, m, 0);
    m.step();
    if (i % 30 === 0) {
      m.command({
        type: 'gift',
        owner: 'sim1',
        coins: 1,
        orders: [{ kind: 'soldado', team: 1, owner: 'sim1', count: 1, unitValue: 1, source: 'gift' }],
      });
      // la cámara automática y el simulador no son entrada: no hay bandera "simulated" que mirar
      assert.equal(feedInput(g, m, { type: 'camera-auto', isTrusted: false, dx: 500 }, t, f), false);
      assert.equal(
        feedInput(g, m, { type: 'pointermove', isTrusted: false, movementX: 99, movementY: 0 }, t, f),
        false,
      );
    }
    applyPresence(g, m, t);
    if (m.pause !== null && pausadoEn === null) pausadoEn = t;
  }
  assert.equal(m.pause, 'presence');
  assert.ok(pausadoEn >= 300 * SEG && pausadoEn < 300 * SEG + 100, `pausó a ${pausadoEn} ms`);
  assert.equal(m.world.paused, true);
  // el reloj de juego quedó quieto desde la pausa
  const quieto = m.world.step;
  for (let i = 0; i < 100; i++) m.step();
  assert.equal(m.world.step, quieto);
});

test('NM-9: una pausa de presencia la levanta cualquier entrada de confianza en ese tick; la manual solo `resume`', () => {
  const m = partido();
  aBatalla(m);
  const g = createPresenceGuard({ minutes: 2, now: () => 0 });
  const f = createInputFilter();
  applyPresence(g, m, 0);
  applyPresence(g, m, 2 * MIN);
  assert.equal(m.pause, 'presence');
  // una tecla sintética no la levanta
  assert.equal(feedInput(g, m, { type: 'keydown', isTrusted: false }, 2 * MIN + 1, f), false);
  assert.equal(m.pause, 'presence');
  // una de confianza, sí, en ese mismo tick; y el contador arranca de cero
  assert.equal(feedInput(g, m, { type: 'keydown', isTrusted: true }, 2 * MIN + 5, f), true);
  assert.equal(m.pause, null);
  applyPresence(g, m, 4 * MIN + 4);
  assert.equal(m.pause, null);
  applyPresence(g, m, 4 * MIN + 5);
  assert.equal(m.pause, 'presence');
  // con la pausa manual (P) los clics, la rueda y las teclas no la levantan, ni la guardia que vence la cambia
  feedInput(g, m, { type: 'wheel', isTrusted: true }, 4 * MIN + 6, f);
  assert.equal(m.pause, null);
  m.command({ type: 'pause' });
  assert.equal(m.pause, 'manual');
  for (const e of [
    { type: 'keydown', isTrusted: true },
    { type: 'pointerdown', isTrusted: true, pointerType: 'mouse' },
    { type: 'wheel', isTrusted: true },
    { type: 'pointerdown', isTrusted: true, pointerType: 'touch' },
  ]) {
    assert.equal(feedInput(g, m, e, 5 * MIN, f), true, 'sigue contando como entrada');
    assert.equal(m.pause, 'manual');
  }
  applyPresence(g, m, 20 * MIN);
  assert.equal(m.pause, 'manual');
  m.command({ type: 'resume' });
  assert.equal(m.pause, null);
});

test('NM-7: la guardia no manda pausa fuera del partido y se apaga con matchEnd', () => {
  const m = partido();
  const g = createPresenceGuard({ minutes: 2, now: () => 0 });
  applyPresence(g, m, 0);
  applyPresence(g, m, 60 * MIN);
  assert.equal(m.pause, null);
  aBatalla(m);
  applyPresence(g, m, 61 * MIN); // la intro y la batalla empezaron: contador nuevo
  assert.equal(m.pause, null);
  applyPresence(g, m, 63 * MIN);
  assert.equal(m.pause, 'presence');
  m.command({ type: 'resume' });
  m.world.bases[1].hp = 0;
  m.step();
  m.step();
  assert.equal(m.state, 'roundEnd');
  for (let i = 0; i < 30; i++) m.step();
  assert.equal(m.command({ type: 'startRound' }).ok, true);
  for (let i = 0; i < 30; i++) m.step();
  m.world.bases[1].hp = 0;
  m.step();
  assert.equal(m.state, 'matchEnd');
  applyPresence(g, m, 100 * MIN);
  assert.equal(m.pause, null);
});
