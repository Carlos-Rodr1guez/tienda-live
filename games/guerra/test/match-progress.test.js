import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createMatch, exportProgress, importProgress } from '../public/js/sim/match.js';
import { hashMatch } from '../public/js/sim/hash.js';

// KIT-28 reglas 6 y 7 (lado del partido): `exportProgress` e `importProgress` guardan y restauran SOLO
// `{pair, started, roundsDone, wins}`. Se usan al cargar la página, antes del primer evento. La ronda cortada no vuelve.

const RAPIDO = { round: { seconds: 3, introSeconds: 1, resultsSeconds: 1 } };
const INTRO = 30;
const registro = () => createRegistry({ teams: [PAISES[0], PAISES[1]] });
const partido = (game = RAPIDO) => createMatch({ paises: PAISES, game, registry: registro() });
const run = (m, n) => {
  for (let i = 0; i < n; i++) m.step();
};
const aBatalla = (m, a = 'PE', b = 'MX') => {
  assert.equal(m.command({ type: 'pickPair', a, b }).ok, true);
  assert.equal(m.command({ type: 'startMatch' }).ok, true);
  run(m, INTRO);
  assert.equal(m.state, 'battle');
};
const gana = (m, side) => {
  m.world.bases[1 - side].hp = 0;
  m.step();
};
const siguiente = (m) => {
  run(m, 40);
  assert.equal(m.state, 'waitingNextRound');
  assert.equal(m.command({ type: 'startRound' }).ok, true);
  run(m, INTRO);
  assert.equal(m.state, 'battle');
};
const progreso = (extra = {}) => ({ pair: ['PE', 'MX'], started: true, roundsDone: 1, wins: [1, 0], ...extra });
const viaJson = (x) => JSON.parse(JSON.stringify(x));

test('exportProgress: sin par es null; en el lobby es "sin empezar"; el id de cada país va en orden izquierda-derecha', () => {
  const m = partido();
  assert.equal(exportProgress(m), null);
  m.command({ type: 'pickPair', a: 'MX', b: 'PE' });
  assert.deepEqual(exportProgress(m), { pair: ['MX', 'PE'], started: false, roundsDone: 0, wins: [0, 0] });
});

test('exportProgress: con el partido empezado cuenta solo rondas terminadas; la ronda en juego no entra', () => {
  const m = partido();
  aBatalla(m);
  assert.deepEqual(exportProgress(m), { pair: ['PE', 'MX'], started: true, roundsDone: 0, wins: [0, 0] });
  gana(m, 0);
  assert.equal(m.state, 'roundEnd');
  assert.deepEqual(exportProgress(m), progreso());
  siguiente(m);
  // ronda 2 en pleno juego: sigue contando 1 ronda terminada
  assert.deepEqual(exportProgress(m), progreso());
  gana(m, 1);
  assert.deepEqual(exportProgress(m), progreso({ roundsDone: 2, wins: [1, 1] }));
  siguiente(m);
  gana(m, 0);
  assert.equal(m.state, 'matchEnd');
  assert.deepEqual(exportProgress(m), progreso({ roundsDone: 3, wins: [2, 1] }));
});

test('exportProgress es pura: no cambia el partido, sobrevive a JSON y no comparte el arreglo de victorias', () => {
  const m = partido();
  aBatalla(m);
  gana(m, 0);
  const h = hashMatch(m);
  const p = exportProgress(m);
  assert.equal(hashMatch(m), h);
  assert.deepEqual(viaJson(p), p);
  p.wins[0] = 99;
  assert.equal(m.wins[0], 1);
});

test('importProgress: partido empezado vuelve a waitingNextRound con el par, las rondas terminadas y las victorias', () => {
  const origen = partido();
  aBatalla(origen);
  gana(origen, 1);
  siguiente(origen); // la ronda 2 está en juego y se corta
  const guardado = viaJson(exportProgress(origen));

  const m = partido();
  const r = importProgress(m, guardado);
  assert.deepEqual(r, { ok: true, state: 'waitingNextRound' });
  assert.equal(m.state, 'waitingNextRound');
  assert.deepEqual(
    m.pair.teams.map((t) => t.id),
    ['PE', 'MX'],
  );
  assert.deepEqual(m.wins, [0, 1]);
  assert.equal(m.pause, null);
  assert.deepEqual(exportProgress(m), exportProgress(origen));
  // sin el campo de la ronda cortada: ni unidades, bases enteras y la ronda siguiente es la 2... que arranca desde cero
  assert.equal(m.world.units.length, 0);
  assert.equal(m.world.over, null);
  for (const b of m.world.bases) assert.equal(b.hp, b.maxHp);
  // el narrador sigue desde acá: startRound, intro y batalla
  assert.deepEqual(m.command({ type: 'startRound' }), { ok: true, round: 2 });
  run(m, INTRO);
  assert.equal(m.state, 'battle');
  gana(m, 1);
  assert.equal(m.state, 'matchEnd');
  assert.deepEqual(m.wins, [0, 2]);
});

test('importProgress deja el mundo en la ronda siguiente, igual que cuando una ronda termina de verdad', () => {
  const origen = partido();
  aBatalla(origen);
  gana(origen, 0);
  assert.equal(origen.state, 'roundEnd');
  const m = partido();
  importProgress(m, exportProgress(origen));
  // lo que llega ahora (un soldado gratis por usuario y ronda) cuenta para la ronda que viene
  assert.equal(m.world.round, origen.world.round);
  assert.equal(m.world.round, 2);
  assert.equal(m.round, origen.round);
});

test('importProgress: partido empezado sin rondas terminadas también vuelve a waitingNextRound y arranca la ronda 1', () => {
  const m = partido();
  assert.deepEqual(importProgress(m, progreso({ roundsDone: 0, wins: [0, 0] })), {
    ok: true,
    state: 'waitingNextRound',
  });
  assert.deepEqual(m.wins, [0, 0]);
  assert.deepEqual(m.command({ type: 'startRound' }), { ok: true, round: 1 });
});

test('importProgress: par sin partido empezado va al lobby', () => {
  const m = partido();
  assert.deepEqual(importProgress(m, { pair: ['AR', 'PE'], started: false, roundsDone: 0, wins: [0, 0] }), {
    ok: true,
    state: 'lobby',
  });
  assert.equal(m.state, 'lobby');
  assert.deepEqual(
    m.pair.teams.map((t) => t.id),
    ['AR', 'PE'],
  );
  assert.equal(m.command({ type: 'startMatch' }).ok, true);
});

test('importProgress: un partido ya decidido vuelve al lobby con el par y las victorias en cero (decisión documentada)', () => {
  for (const [wins, roundsDone] of [
    [[2, 0], 2],
    [[0, 2], 2],
    [[2, 1], 3],
    [[1, 2], 3],
  ]) {
    const m = partido();
    assert.deepEqual(importProgress(m, progreso({ wins, roundsDone })), { ok: true, state: 'lobby', decided: true });
    assert.equal(m.state, 'lobby');
    assert.deepEqual(m.wins, [0, 0]);
    assert.deepEqual(
      m.pair.teams.map((t) => t.id),
      ['PE', 'MX'],
    );
  }
});

test('importProgress: un progreso inválido o incoherente se descarta y todo queda en el selector, sin efectos', () => {
  const malos = [
    progreso({ pair: ['XX', 'MX'] }),
    progreso({ pair: ['PE', 'XX'] }),
    progreso({ pair: ['PE', 'PE'] }),
    progreso({ pair: ['PE'] }),
    progreso({ pair: ['PE', 'MX', 'AR'] }),
    progreso({ pair: 'PE-MX' }),
    progreso({ pair: [1, 2] }),
    progreso({ pair: [null, null] }),
    progreso({ pair: ['pe', 'mx'] }),
    progreso({ started: 'si' }),
    progreso({ started: 1 }),
    progreso({ started: undefined }),
    progreso({ roundsDone: 2 }), // no cierra con las victorias
    progreso({ roundsDone: 0 }),
    progreso({ roundsDone: -1, wins: [0, 0] }),
    progreso({ roundsDone: 1.5, wins: [1, 0] }),
    progreso({ roundsDone: '1' }),
    progreso({ roundsDone: 4, wins: [2, 2] }), // los dos ganaron el partido
    progreso({ wins: [3, 0], roundsDone: 3 }), // más victorias de las posibles
    progreso({ wins: [-1, 2], roundsDone: 1 }),
    progreso({ wins: [1.5, 0.5], roundsDone: 2 }),
    progreso({ wins: [NaN, 0] }),
    progreso({ wins: [Infinity, 0], roundsDone: Infinity }),
    progreso({ wins: [1] }),
    progreso({ wins: [1, 0, 0] }),
    progreso({ wins: '10' }),
    progreso({ wins: ['1', '0'] }),
    progreso({ wins: undefined }),
    progreso({ started: false }), // sin empezar pero con victorias
    { pair: ['PE', 'MX'], started: false, roundsDone: 1, wins: [0, 0] },
    [],
    'texto',
    42,
    true,
    {},
  ];
  for (const p of malos) {
    const m = partido();
    const h = hashMatch(m);
    const tamaños = m.registry.teamSizes();
    const r = importProgress(m, p);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.equal(r.reason, 'invalid', JSON.stringify(p));
    assert.equal(m.state, 'matchup', JSON.stringify(p));
    assert.equal(m.pair, null);
    assert.equal(hashMatch(m), h);
    assert.deepEqual(m.wins, [0, 0]);
    assert.deepEqual(m.registry.teamSizes(), tamaños);
    // el registro conserva los equipos de antes: un alias del par descartado no los cambia
    assert.equal(m.registry.joinFromChat({ userId: 'u', nickname: 'U', text: PAISES[0].aliases[0] }, 0, 1)?.team, 1);
  }
});

test('importProgress: los límites dependen de winsToMatch (mejor de 3 y mejor de 5)', () => {
  // dos victorias de cada lado en un mejor de 3: los dos ganaron, y además no cabe una ronda 4
  const m = partido();
  assert.deepEqual(importProgress(m, progreso({ wins: [2, 2], roundsDone: 4 })), { ok: false, reason: 'invalid' });
  // cuatro rondas terminadas con 3 victorias contadas no cierran
  assert.equal(importProgress(partido(), progreso({ wins: [2, 1], roundsDone: 4 })).reason, 'invalid');
  assert.equal(importProgress(partido(), progreso({ wins: [1, 1], roundsDone: 3 })).reason, 'invalid');
  // más rondas de las que caben en un mejor de 3 aunque cada lado no llegue a ganar
  const largo = partido({ round: { seconds: 3, introSeconds: 1, resultsSeconds: 1, winsToMatch: 3 } });
  assert.equal(importProgress(largo, progreso({ wins: [2, 2], roundsDone: 4 })).state, 'waitingNextRound');
  assert.equal(
    importProgress(partido({ round: { winsToMatch: 3 } }), progreso({ wins: [3, 3], roundsDone: 6 })).reason,
    'invalid',
  );
});

test('importProgress: sin progreso (null o undefined) no hace nada', () => {
  for (const p of [null, undefined]) {
    const m = partido();
    assert.deepEqual(importProgress(m, p), { ok: false, reason: 'none' });
    assert.equal(m.state, 'matchup');
  }
});

test('importProgress solo vale al cargar: con un par elegido, partido en marcha o pasos dados devuelve {ok:false}', () => {
  const a = partido();
  a.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  const h = hashMatch(a);
  assert.deepEqual(importProgress(a, progreso()), { ok: false, reason: 'state' });
  assert.equal(hashMatch(a), h);
  const b = partido();
  aBatalla(b);
  assert.equal(importProgress(b, progreso()).reason, 'state');
  assert.equal(b.state, 'battle');
  const c = partido();
  c.step(); // ya pasó un tick del reloj del log
  assert.equal(importProgress(c, progreso()).reason, 'state');
  const d = partido();
  assert.equal(importProgress(d, progreso()).ok, true);
  assert.equal(importProgress(d, progreso()).reason, 'state', 'una segunda vez no');
});

test('importProgress: campos de más y __proto__ en el JSON se ignoran y no contaminan nada', () => {
  const texto =
    '{"pair":["PE","MX"],"started":true,"roundsDone":1,"wins":[1,0],"__proto__":{"polluted":1},"constructor":{"x":1},"extra":"y"}';
  const m = partido();
  assert.equal(importProgress(m, JSON.parse(texto)).ok, true);
  assert.equal({}.polluted, undefined);
  assert.equal(m.polluted, undefined);
  assert.equal(m.extra, undefined);
});

test('importProgress no agrega campos al partido ni al mundo (el hash dorado no los ve)', () => {
  const base = partido();
  const claves = Object.keys(base).sort();
  const clavesMundo = Object.keys(base.world).sort();
  const m = partido();
  importProgress(m, progreso());
  assert.deepEqual(Object.keys(m).sort(), claves);
  assert.deepEqual(Object.keys(m.world).sort(), clavesMundo);
});

test('el registro queda con el par restaurado: los usuarios restaurados conservan equipo y se puede seguir uniendo gente', () => {
  const m = partido();
  assert.equal(importProgress(m, { pair: ['AR', 'PE'], started: true, roundsDone: 1, wins: [0, 1] }).ok, true);
  const copia = {
    v: 1,
    clock: 0,
    allHidden: false,
    hidden: [],
    match: null,
    users: [
      {
        key: 'a',
        name: 'Ana',
        team: 1,
        lastSwitch: -1e9,
        coins: { live: 5, match: 5 },
        value: { live: 0, match: 0 },
        xp: { live: 5, match: 5 },
        kills: { live: 0, match: 0 },
        firstXpAt: 0,
      },
      {
        key: 'b',
        name: 'Beto',
        team: 2,
        lastSwitch: -1e9,
        coins: { live: 0, match: 0 },
        value: { live: 0, match: 0 },
        xp: { live: 0, match: 0 },
        kills: { live: 0, match: 0 },
        firstXpAt: null,
      },
    ],
  };
  m.registry.importLive(copia);
  assert.deepEqual(m.registry.teamSizes(), [1, 1]);
  // los alias son los del par restaurado y no los del par de arranque
  assert.equal(m.registry.joinFromChat({ userId: 'c', nickname: 'C', text: 'peru' }, 0, 1)?.team, 2);
  assert.equal(m.registry.joinFromChat({ userId: 'd', nickname: 'D', text: 'argentina' }, 0, 1)?.team, 1);
});

test('NM-2: newLive confirmado reinicia el registro (la página manda DELETE a partir de esta respuesta ok)', () => {
  const m = partido();
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command({ type: 'endMatch' });
  assert.deepEqual(m.command({ type: 'newLive', confirmed: true }), { ok: true });
  assert.equal(m.command({ type: 'newLive' }).ok, false);
});
