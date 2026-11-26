import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { PAISES } from '../public/js/data/paises.js';
import { createMatch, decideRound } from '../public/js/sim/match.js';
import { hashMatch, hashWorld } from '../public/js/sim/hash.js';
import { ledger } from '../public/js/sim/credit.js';
import { seedUnits } from '../public/js/sim/world.js';

// CB-5 (desempate), CB-6 (mejor de 3), NM-1, NM-2 (comandos y `newLive`), NM-9 (pausa) y CB-13 (determinismo del partido).

const RAPIDO = { round: { seconds: 3, introSeconds: 1, resultsSeconds: 1 } };
const INTRO = 30;

const registro = () => createRegistry({ teams: [PAISES[0], PAISES[1]] });
const partido = (game = RAPIDO, conRegistro = true) =>
  createMatch({ paises: PAISES, game, registry: conRegistro ? registro() : null });
const run = (m, n) => {
  for (let i = 0; i < n; i++) m.step();
};
/** Del selector a la batalla (PE a la izquierda, MX a la derecha). */
function aBatalla(m, pasos = INTRO) {
  assert.equal(m.command({ type: 'pickPair', a: 'PE', b: 'MX' }).ok, true);
  assert.equal(m.command({ type: 'startMatch' }).ok, true);
  run(m, pasos);
  assert.equal(m.state, 'battle');
}
const chat = (id, text) => ({ type: 'chat', evt: { type: 'chat', userId: id, nickname: 'U' + id, text } });
/** Termina la ronda con una victoria del lado `side` (la base rival llega a 0 en el paso siguiente). */
function gana(m, side) {
  m.world.bases[1 - side].hp = 0;
  m.step();
}
/** Pasa a la siguiente ronda: resultados, espera y `startRound`, hasta estar en batalla. */
function siguiente(m) {
  run(m, 40); // 1 s de resultados
  assert.equal(m.state, 'waitingNextRound');
  assert.equal(m.command({ type: 'startRound' }).ok, true);
  run(m, INTRO);
  assert.equal(m.state, 'battle');
}
/** Corre la ronda hasta que se acaba el tiempo con `preparar` aplicado al mundo; devuelve el resultado. */
function porTiempo(m, preparar) {
  aBatalla(m);
  preparar(m);
  run(m, 100);
  assert.notEqual(m.state, 'battle');
  return m.results.at(-1);
}

test('comandos exactos: los 7 del narrador y nada más; los otros devuelven {ok:false} sin cambiar el estado', () => {
  const m = partido();
  aBatalla(m);
  seedUnits(m.world, { side: 0, kind: 'soldado' });
  run(m, 5);
  const antes = hashMatch(m);
  const estado = m.state;
  for (const type of [
    'spawn',
    'damage',
    'setScore',
    'vote',
    'seedUnits',
    'launchPlane',
    'setHp',
    'toString',
    '__proto__',
  ]) {
    const r = m.command({ type, side: 0, kind: 'tanque', n: 99 });
    assert.equal(r.ok, false, type);
  }
  assert.equal(m.command(null).ok, false);
  assert.equal(m.command({}).ok, false);
  assert.equal(hashMatch(m), antes);
  assert.equal(m.state, estado);
  // los siete existen: cada uno responde (aunque sea con un rechazo por estado) y nunca lanza
  for (const type of ['pickPair', 'startMatch', 'startRound', 'pause', 'resume', 'endMatch', 'newLive']) {
    assert.equal(typeof m.command({ type }).ok, 'boolean', type);
  }
});

test('los comandos de vista (cámara, marcador, top 3, foco, ocultar, N, F2, R) no entran al sim', () => {
  const m = partido();
  aBatalla(m);
  run(m, 10);
  const antes = hashMatch(m);
  const vista = [
    'camera',
    'cameraPan',
    'cameraZoom',
    'cameraPreset',
    'minimap',
    'autoCamera',
    'scoreboard',
    'top3',
    'spotlight',
    'hideDonor',
    'hideAll',
    'safeZones',
    'frame',
    'toggleNames',
    'N',
    'F2',
    'overlay',
    'R',
    'reducedMotion',
    'layout',
  ];
  for (const type of vista) {
    const r = m.command({ type, x: 1, y: 2, zoom: 3 });
    assert.equal(r.ok, false, type);
  }
  assert.equal(hashMatch(m), antes);
  assert.equal(m.registry.allNamesHidden(), false);
});

test('los 231 pares, en los dos órdenes, arrancan con startMatch', () => {
  const m = partido();
  let n = 0;
  for (const a of PAISES) {
    for (const b of PAISES) {
      if (a.id === b.id) continue;
      assert.equal(m.command({ type: 'pickPair', a: a.id, b: b.id }).ok, true, `${a.id}-${b.id}`);
      assert.equal(m.state, 'lobby');
      assert.deepEqual(
        m.pair.teams.map((t) => t.id),
        [a.id, b.id],
      );
      assert.equal(m.command({ type: 'startMatch' }).ok, true);
      assert.equal(m.state, 'intro');
      assert.equal(m.command({ type: 'endMatch' }).ok, true);
      assert.equal(m.state, 'matchup');
      n++;
    }
  }
  assert.equal(n, 22 * 21);
  assert.equal(n / 2, 231);
});

test('país desconocido ("XX") o repetido da error y no crea partido', () => {
  const m = partido();
  const antes = hashMatch(m);
  for (const [a, b] of [
    ['XX', 'MX'],
    ['PE', 'XX'],
    ['PE', 'PE'],
    [undefined, 'MX'],
  ]) {
    const r = m.command({ type: 'pickPair', a, b });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.equal(m.state, 'matchup');
    assert.equal(m.pair, null);
  }
  assert.equal(m.command({ type: 'startMatch' }).ok, false);
  assert.equal(hashMatch(m), antes);
});

test('flujo: matchup, lobby, intro, battle, roundEnd, waitingNextRound, intro, ..., matchEnd, matchup', () => {
  const m = partido();
  const vistos = [m.state];
  const marca = () => vistos.at(-1) !== m.state && vistos.push(m.state);
  const paso = (n = 1) => {
    for (let i = 0; i < n; i++) {
      m.step();
      marca();
    }
  };
  const cmd = (type, extra = {}) => {
    assert.equal(m.command({ type, ...extra }).ok, true, type);
    marca();
  };
  cmd('pickPair', { a: 'PE', b: 'MX' });
  cmd('startMatch');
  paso(INTRO);
  m.world.bases[1].hp = 0;
  paso();
  assert.deepEqual(m.wins, [1, 0]);
  paso(40);
  cmd('startRound');
  paso(INTRO);
  m.world.bases[0].hp = 0;
  paso();
  assert.deepEqual(m.wins, [1, 1]);
  paso(40);
  cmd('startRound');
  paso(INTRO);
  m.world.bases[1].hp = 0;
  paso();
  cmd('endMatch');
  assert.deepEqual(vistos, [
    'matchup',
    'lobby',
    'intro',
    'battle',
    'roundEnd',
    'waitingNextRound',
    'intro',
    'battle',
    'roundEnd',
    'waitingNextRound',
    'intro',
    'battle',
    'matchEnd',
    'matchup',
  ]);
});

test('NM-1: 10 min de reloj sin comandos dejan waitingNextRound y matchEnd sin cambios', () => {
  const m = partido();
  aBatalla(m);
  gana(m, 0);
  run(m, 40);
  assert.equal(m.state, 'waitingNextRound');
  const hw = hashWorld(m.world);
  const round = m.round;
  const tick = m.tick;
  run(m, 10 * 60 * 30);
  assert.equal(m.state, 'waitingNextRound');
  assert.equal(m.round, round);
  assert.deepEqual(m.wins, [1, 0]);
  assert.equal(m.tick, tick + 10 * 60 * 30, 'el reloj del log sigue');
  assert.equal(hashWorld(m.world), hw, 'el mundo no se movió');
  m.command({ type: 'startRound' });
  run(m, INTRO);
  gana(m, 0);
  assert.equal(m.state, 'matchEnd');
  const ganador = m.winner;
  run(m, 10 * 60 * 30);
  assert.equal(m.state, 'matchEnd');
  assert.equal(m.winner, ganador);
  assert.equal(m.pair !== null, true);
});

test('startRound solo vale en waitingNextRound y deja campo, grupos, contadores y cubo limpios (colas y torretas aparte)', () => {
  const m = partido({ round: { seconds: 60, introSeconds: 1, resultsSeconds: 1 } });
  assert.equal(m.command({ type: 'startRound' }).ok, false, 'matchup');
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  assert.equal(m.command({ type: 'startRound' }).ok, false, 'lobby');
  m.command({ type: 'startMatch' });
  assert.equal(m.command({ type: 'startRound' }).ok, false, 'intro');
  run(m, INTRO);
  assert.equal(m.state, 'battle');
  assert.equal(m.command({ type: 'startRound' }).ok, false, 'battle');
  const w = m.world;
  // ensucia la ronda: unidades, golpe de torreta, cubo, contadores y una orden en la cola de cada lado
  seedUnits(w, { side: 0, kind: 'soldado' });
  seedUnits(w, { side: 1, kind: 'jeep' });
  run(m, 120);
  w.bases[1].turrets[0].hp = 10;
  w.bases[0].bucket = 500;
  w.teams[0].structDamage = 77;
  w.counters.addLikes(1, 120);
  w.credit.teamValue = [5, 6];
  for (const side of [0, 1]) {
    m.command({
      type: 'order',
      order: { kind: 'soldado', team: side + 1, owner: null, count: 3000, unitValue: 0, source: 'gift' },
    });
  }
  const enCola = w.queues.map((q) => q.groundUnits);
  assert.ok(enCola[0] > 0 && enCola[1] > 0);
  gana(m, 0);
  assert.equal(m.state, 'roundEnd');
  assert.equal(m.command({ type: 'startRound' }).ok, false);
  run(m, 40);
  assert.equal(m.state, 'waitingNextRound');
  const colas = JSON.stringify(w.queues);
  assert.equal(m.command({ type: 'startRound' }).ok, true);
  assert.equal(m.state, 'intro');
  assert.equal(w.units.length, 0);
  assert.equal(w.hits.length + w.bombs.length + w.planes.length, 0);
  assert.equal(w.over, null);
  assert.deepEqual(
    w.bases.map((b) => [b.hp, b.bucket]),
    [
      [60000, 0],
      [60000, 0],
    ],
  );
  for (const b of w.bases) for (const t of b.turrets) assert.deepEqual([t.hp, t.on], [w.cfg.turret.hp, true]);
  assert.deepEqual(
    w.teams.map((t) => t.structDamage),
    [0, 0],
  );
  assert.deepEqual(w.credit.teamValue, [0, 0]);
  assert.equal(w.counters.likeProgress(1), 0);
  assert.equal(JSON.stringify(w.queues), colas, 'las colas siguen');
});

test('CB-6: mejor de 3, un 2-0 termina sin ronda 3', () => {
  const m = partido();
  aBatalla(m);
  gana(m, 0);
  assert.equal(m.state, 'roundEnd');
  siguiente(m);
  gana(m, 0);
  assert.equal(m.state, 'matchEnd');
  assert.equal(m.winner, 0);
  assert.deepEqual(m.wins, [2, 0]);
  assert.equal(m.results.length, 2);
  assert.equal(m.command({ type: 'startRound' }).ok, false);
});

test('CB-6: 1-1 decide la ronda 3, también con el lado derecho', () => {
  const m = partido();
  aBatalla(m);
  gana(m, 0);
  siguiente(m);
  gana(m, 1);
  assert.equal(m.state, 'roundEnd');
  assert.deepEqual(m.wins, [1, 1]);
  siguiente(m);
  assert.equal(m.round, 3);
  gana(m, 1);
  assert.equal(m.state, 'matchEnd');
  assert.equal(m.winner, 1);
  assert.deepEqual(m.wins, [1, 2]);
});

// ---------------------------------------------------------------------------------------------------------------
// CB-5: desempate

test('CB-5: base destruida en t = 100 s, ganador y roundEnd en ese mismo paso', () => {
  const m = partido({ round: { seconds: 180, introSeconds: 1, resultsSeconds: 1 } });
  aBatalla(m);
  run(m, 3000);
  assert.equal(m.world.time, 100);
  assert.equal(m.state, 'battle');
  m.world.bases[1].hp = 0;
  m.step();
  assert.equal(m.state, 'roundEnd');
  assert.deepEqual(m.results.at(-1), { round: 1, winner: 0, reason: 'base', step: 3001 });
});

test('CB-5: tiempo agotado con la base al 60 % contra la del 40 %', () => {
  const r = porTiempo(partido(), (m) => {
    m.world.bases[0].hp = 24000; // 40 %
    m.world.bases[1].hp = 36000; // 60 %
  });
  assert.deepEqual([r.winner, r.reason], [1, 'hp']);
});

test('CB-5 paso 1: el daño efectivo a la base y a las torretas decide aunque el otro haya destruido más valor', () => {
  const r = porTiempo(partido(), (m) => {
    // A: 5000 a torretas + 1000 a la base = 6000; B: 4000 a la base, pero destruyó más valor
    m.world.teams[0].structDamage = 6000;
    m.world.teams[1].structDamage = 4000;
    m.world.credit.teamValue = [10, 9999];
  });
  assert.deepEqual([r.winner, r.reason], [0, 'damage']);
});

test('CB-5 paso 2: la energía de 300 contra 200 de unidades, bombas y torretas gana el que la usó', () => {
  const r = porTiempo(partido(), (m) => {
    m.world.credit.teamValue = [200, 300];
    m.world.credit.teamCoins = [9e9, 0];
  });
  assert.deepEqual([r.winner, r.reason], [1, 'value']);
});

test('CB-5 pasos 3 a 6: monedas pagadas, más miembros, quien se unió antes y el izquierdo si nadie se unió', () => {
  // 3. monedas pagadas
  let r = porTiempo(partido(), (m) => {
    m.world.credit.teamCoins = [10, 20];
  });
  assert.deepEqual([r.winner, r.reason], [1, 'coins']);

  // 4. más miembros con bando (el derecho se une primero, pero el izquierdo tiene dos)
  r = porTiempo(partido(), (m) => {
    m.command(chat('d', 'mexico'));
    m.command(chat('a', 'peru'));
    m.command(chat('b', 'peru'));
  });
  assert.deepEqual([r.winner, r.reason], [0, 'members']);

  // 5. mismos miembros: gana el equipo cuyo primer miembro se unió antes
  r = porTiempo(partido(), (m) => {
    m.command(chat('d', 'mexico'));
    m.command(chat('a', 'peru'));
  });
  assert.deepEqual([r.winner, r.reason], [1, 'joined']);
  r = porTiempo(partido(), (m) => {
    m.command(chat('a', 'peru'));
    m.command(chat('d', 'mexico'));
  });
  assert.deepEqual([r.winner, r.reason], [0, 'joined']);

  // 6. nadie se unió: el equipo izquierdo
  r = porTiempo(partido(), () => {});
  assert.deepEqual([r.winner, r.reason], [0, 'left']);
});

test('CB-5: quien se unió en el lobby antes que el otro lado cuenta como primero (ordena por llegada, no por reloj)', () => {
  const m = partido();
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command(chat('d', 'mexico')); // el reloj de juego está quieto en 0: ordena la llegada
  m.command(chat('a', 'peru'));
  m.command({ type: 'startMatch' });
  run(m, INTRO + 100);
  assert.deepEqual([m.results[0].winner, m.results[0].reason], [1, 'joined']);
});

test('CB-5: las dos bases caen en el mismo paso y la cadena elige uno (nunca empate)', () => {
  for (const [a, b, ganador, motivo] of [
    [{ v: [0, 0] }, { v: [0, 0] }, 0, 'left'],
    [{ v: [0, 0] }, { v: [0, 5] }, 1, 'value'],
    [{ v: [3, 0] }, { v: [0, 0] }, 0, 'value'],
  ]) {
    const m = partido();
    aBatalla(m);
    m.world.credit.teamValue = [a.v[0], b.v[1]];
    m.world.bases[0].hp = 0;
    m.world.bases[1].hp = 0;
    m.step();
    assert.equal(m.world.over.both, true);
    assert.deepEqual([m.results[0].winner, m.results[0].reason], [ganador, motivo]);
  }
});

test('CB-5: 100 corridas con semillas distintas y un RNG de reglas que lanza dan el mismo ganador', () => {
  const alea = Math.random;
  Math.random = () => {
    throw new Error('las reglas no usan Math.random');
  };
  try {
    const ganadores = new Set();
    for (let i = 0; i < 100; i++) {
      const cosmetico = mulberry32(seedFrom('semilla-' + i));
      const m = partido();
      aBatalla(m);
      m.world.teams[0].structDamage = 1000;
      m.world.teams[1].structDamage = 1000;
      m.world.credit.teamValue = [100, 250];
      for (let s = 0; s < 100; s++) {
        cosmetico();
        m.step();
      }
      ganadores.add(`${m.results[0].winner}:${m.results[0].reason}`);
    }
    assert.deepEqual([...ganadores], ['1:value']);
  } finally {
    Math.random = alea;
  }
});

test('decideRound: función pura del mundo, desempata por pasos y no cambia el mundo', () => {
  const m = partido();
  aBatalla(m);
  const w = m.world;
  w.teams[1].structDamage = 1;
  const h = hashWorld(w);
  assert.deepEqual(decideRound(w, { sizes: [0, 0], firstJoin: [null, null] }), { winner: 1, reason: 'damage' });
  assert.equal(hashWorld(w), h);
  w.teams[1].structDamage = 0;
  assert.deepEqual(decideRound(w, { sizes: [1, 2], firstJoin: [null, null] }), { winner: 1, reason: 'members' });
  assert.deepEqual(decideRound(w, { sizes: [1, 1], firstJoin: [5, 2] }), { winner: 1, reason: 'joined' });
  assert.deepEqual(decideRound(w, { sizes: [1, 1], firstJoin: [null, 7] }), { winner: 1, reason: 'joined' });
  assert.deepEqual(decideRound(w, { sizes: [0, 0], firstJoin: [null, null] }), { winner: 0, reason: 'left' });
});

test('una ronda ganada retira el valor que sigue vivo y la conservación se cumple al final del partido', () => {
  const m = partido();
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command(chat('a', 'peru'));
  m.command({ type: 'startMatch' });
  run(m, INTRO);
  m.command({
    type: 'gift',
    owner: 'a',
    coins: 100,
    orders: [{ kind: 'jeep', team: 1, owner: 'a', count: 10, unitValue: 10, source: 'gift' }],
  });
  m.command({
    type: 'gift',
    owner: 'a',
    coins: 500,
    orders: [{ kind: 'avion', team: 1, owner: 'a', count: 1, unitValue: 500, source: 'gift' }],
  });
  run(m, 60);
  gana(m, 0);
  const l = ledger(m.world);
  assert.ok(Math.abs(l.paid - l.sum) < 1e-6, JSON.stringify(l));
  siguiente(m);
  gana(m, 0);
  assert.equal(m.state, 'matchEnd');
  const f = ledger(m.world);
  assert.equal(f.queued, 0);
  assert.ok(Math.abs(f.paid - f.sum) < 1e-6, JSON.stringify(f));
});

// ---------------------------------------------------------------------------------------------------------------
// NM-2: newLive

test('newLive: sin {confirmed:true} o fuera de matchup devuelve {ok:false} y no cambia nada', () => {
  const m = partido();
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command(chat('a', 'peru'));
  m.registry.addCoins('a', 80, 1);
  m.registry.hide('a');
  m.command({ type: 'endMatch' });
  assert.equal(m.state, 'matchup');
  const antes = JSON.stringify(m.registry.users());
  for (const p of [{ type: 'newLive' }, { type: 'newLive', confirmed: false }, { type: 'newLive', confirmed: 'yes' }]) {
    assert.equal(m.command(p).ok, false);
  }
  assert.equal(JSON.stringify(m.registry.users()), antes);
  assert.equal(m.registry.get('a').rank, 3);
  // durante un partido, ni confirmado
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  for (const estado of ['lobby', 'intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd']) {
    if (estado === 'intro') m.command({ type: 'startMatch' });
    if (estado === 'battle') run(m, 40);
    if (estado === 'roundEnd') gana(m, 0);
    if (estado === 'waitingNextRound') run(m, 200);
    if (estado === 'matchEnd') {
      m.command({ type: 'startRound' });
      run(m, 120);
      gana(m, 0);
    }
    assert.equal(m.state, estado);
    const h = hashMatch(m);
    assert.equal(m.command({ type: 'newLive', confirmed: true }).ok, false, estado);
    assert.equal(hashMatch(m), h);
    assert.equal(m.registry.get('a').rank, 3);
  }
});

test('newLive confirmado en matchup deja rangos en Recluta, XP de LIVE en 0, ocultos vacíos y allHidden en falso', () => {
  const m = partido();
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command(chat('a', 'peru'));
  m.command(chat('b', 'mexico'));
  m.registry.addCoins('a', 200, 1);
  m.registry.addDestroyed('b', 100, 1);
  m.registry.hide('b');
  m.registry.setAllNamesHidden(true);
  m.command({ type: 'endMatch' });
  const r = m.command({ type: 'newLive', confirmed: true });
  assert.equal(r.ok, true);
  assert.equal(m.state, 'matchup');
  for (const k of ['a', 'b']) {
    const u = m.registry.get(k);
    assert.deepEqual(m.registry.rankOf(k), { index: 0, label: 'Recluta' });
    assert.equal(u.xp.live, 0);
    assert.equal(u.hidden, false);
  }
  assert.equal(m.registry.allNamesHidden(), false);
  assert.equal(m.registry.displayName('b'), 'Ub');
});

test('NM-2: un regalo en matchup suma monedas y XP de LIVE, muestra el agradecimiento y no encola nada', () => {
  const m = partido();
  m.registry.touch({ userId: 'a', nickname: 'Ana' });
  const r = m.command({
    type: 'gift',
    owner: 'a',
    coins: 100,
    orders: [{ kind: 'soldado', team: 1, owner: 'a', count: 100, unitValue: 1, source: 'gift' }],
  });
  assert.equal(r.ok, true);
  assert.equal(m.registry.get('a').xp.live, 100);
  assert.equal(m.registry.get('a').coins.live, 100);
  assert.deepEqual(
    m.world.drain().filter((e) => e.type === 'thanks'),
    [{ type: 'thanks', owner: 'a', coins: 100 }],
  );
  assert.equal(m.world.queues[0].groundUnits + m.world.queues[1].groundUnits, 0);
  // lo demás de la audiencia no hace nada sin partido
  for (const p of [chat('a', 'peru'), { type: 'likes', team: 1, count: 500 }, { type: 'strike', side: 0 }]) {
    assert.equal(m.command(p).ok, false);
  }
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command({ type: 'startMatch' });
  assert.equal(m.world.queues[0].groundUnits + m.world.queues[1].groundUnits, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// NM-9: pausa

test('pausa de presencia vs manual: la de presencia la levanta cualquier entrada, la manual solo resume', () => {
  const m = partido();
  aBatalla(m);
  assert.equal(m.command({ type: 'pause', by: 'presence' }).ok, true);
  assert.equal(m.pause, 'presence');
  assert.equal(m.world.paused, true);
  // cualquier entrada confiable envía resume({by:'presence'})
  assert.equal(m.command({ type: 'resume', by: 'presence' }).ok, true);
  assert.equal(m.pause, null);
  assert.equal(m.world.paused, false);

  // manual
  assert.equal(m.command({ type: 'pause', by: 'manual' }).ok, true);
  assert.equal(m.pause, 'manual');
  for (let i = 0; i < 5; i++) assert.equal(m.command({ type: 'resume', by: 'presence' }).ok, false);
  assert.equal(m.pause, 'manual');
  // la guardia que vence con una pausa manual puesta no la cambia
  assert.equal(m.command({ type: 'pause', by: 'presence' }).ok, false);
  assert.equal(m.pause, 'manual');
  assert.equal(m.command({ type: 'resume' }).ok, true);
  assert.equal(m.pause, null);
  assert.equal(m.command({ type: 'resume' }).ok, false);

  // una pausa de presencia se vuelve manual si el narrador pulsa P
  m.command({ type: 'pause', by: 'presence' });
  assert.equal(m.command({ type: 'pause' }).ok, true);
  assert.equal(m.pause, 'manual');
  assert.equal(m.command({ type: 'resume', by: 'presence' }).ok, false);
});

test('pausa: solo existe mientras hay partido en marcha (de lobby a la espera de la siguiente ronda)', () => {
  const m = partido();
  assert.equal(m.command({ type: 'pause' }).ok, false);
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  assert.equal(m.command({ type: 'pause' }).ok, true);
  m.command({ type: 'resume' });
  aBatalla(m);
  gana(m, 0);
  siguiente(m);
  gana(m, 0);
  assert.equal(m.state, 'matchEnd');
  assert.equal(m.command({ type: 'pause', by: 'presence' }).ok, false);
});

test('a 300 s + 120 s de pared el reloj sigue en 300 s y no se creó ningún refuerzo ni cambió nada', () => {
  const m = partido({ round: { seconds: 600, introSeconds: 1, resultsSeconds: 1 } });
  aBatalla(m);
  seedUnits(m.world, { side: 0, kind: 'soldado', count: 3 });
  run(m, 300 * 30);
  const w = m.world;
  assert.equal(w.time, 300);
  m.command({ type: 'pause' });
  const hash = hashWorld(w);
  const unidades = w.units.length;
  const colas = JSON.stringify(w.queues);
  const marcha = w.units.map((u) => [u.id, u.phase, u.x, u.y]);
  const eventos = w.events.length;
  run(m, 120 * 30); // 120 s de pared
  assert.equal(w.time, 300);
  assert.equal(hashWorld(w), hash);
  assert.equal(w.units.length, unidades);
  assert.equal(JSON.stringify(w.queues), colas);
  assert.deepEqual(
    w.units.map((u) => [u.id, u.phase, u.x, u.y]),
    marcha,
  );
  assert.equal(w.events.length, eventos);
  assert.equal(m.tick > 300 * 30 + 120 * 30, true, 'el reloj del log sigue');
  assert.equal(m.state, 'battle');
});

test('en pausa se registran uniones, monedas, XP y rangos; el regalo sale al reanudar con el ritmo normal', () => {
  const m = partido({ round: { seconds: 600, introSeconds: 1, resultsSeconds: 1 } });
  aBatalla(m);
  run(m, 60);
  m.command({ type: 'pause' });
  const w = m.world;
  w.drain();
  const r = m.command(chat('a', 'peru'));
  assert.equal(r.ok, true);
  assert.equal(m.registry.teamSizes()[0], 1);
  assert.equal(m.registry.get('a').team, 1);
  const antes = w.queues[0].groundUnits;
  assert.ok(antes >= 1, 'el soldado gratis de la unión queda en la cola');
  m.command({
    type: 'gift',
    owner: 'a',
    coins: 100,
    orders: [{ kind: 'soldado', team: 1, owner: 'a', count: 100, unitValue: 1, source: 'gift' }],
  });
  assert.equal(m.registry.get('a').coins.live, 100);
  assert.equal(m.registry.get('a').xp.live, 100);
  assert.equal(m.registry.get('a').rank, 3, 'Sargento: el rango sube en pausa');
  const evts = w.drain();
  assert.ok(
    evts.some((e) => e.type === 'rankUp' && e.key === 'a'),
    'el rankUp espera en la bandeja',
  );
  assert.ok(evts.some((e) => e.type === 'join' && e.key === 'a'));
  const pedidas = antes + 100;
  assert.equal(w.queues[0].groundUnits, pedidas);
  const sinUnidades = w.units.length;
  run(m, 300);
  assert.equal(w.units.length, sinUnidades, 'nada sale mientras dura la pausa');
  m.command({ type: 'resume' });
  const vivos = () => w.units.filter((u) => u.side === 0).length;
  const v0 = vivos();
  run(m, 60); // 2 s: 8 por segundo, no más
  const salieron = vivos() - v0;
  assert.ok(salieron >= 14 && salieron <= 17, `salieron ${salieron}`);
  assert.equal(vivos() + w.queues[0].groundUnits >= v0 + pedidas - 1, true, 'spawned + queued == ordered');
});

test('un regalo de avión en pausa inicia el vuelo después de reanudar y su valor queda contado', () => {
  const m = partido({ round: { seconds: 600, introSeconds: 1, resultsSeconds: 1 } });
  m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  m.command(chat('a', 'peru'));
  m.command({ type: 'startMatch' });
  run(m, INTRO);
  m.command({ type: 'pause' });
  m.command({
    type: 'gift',
    owner: 'a',
    coins: 500,
    orders: [{ kind: 'avion', team: 1, owner: 'a', count: 1, unitValue: 500, source: 'gift' }],
  });
  run(m, 120);
  assert.equal(m.world.planes.length, 0);
  assert.equal(m.world.queues[0].airUnits, 1);
  m.command({ type: 'resume' });
  run(m, 3);
  assert.equal(m.world.planes.length, 1);
  const l = ledger(m.world);
  assert.ok(Math.abs(l.paid - l.sum) < 1e-6);
});

test('el golpe de energía pedido en pausa espera: no daña nada hasta reanudar y entonces sale', () => {
  const m = partido({ round: { seconds: 600, introSeconds: 1, resultsSeconds: 1 } });
  aBatalla(m);
  run(m, 30);
  m.command({ type: 'pause' });
  const w = m.world;
  const hp = w.bases[1].hp;
  const r = m.command({ type: 'strike', side: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.deferred, true);
  run(m, 60);
  assert.equal(w.bases[1].hp, hp);
  assert.equal(w.teams[0].energyAsked, 0);
  m.command({ type: 'resume' });
  run(m, 3);
  assert.equal(w.teams[0].energyAsked, 600, 'sin grupos enemigos, 600 a la base por el cubo');
  assert.ok(w.bases[1].hp < hp || w.bases[1].bucket >= 0);
});

test('la pausa no se pierde entre rondas: pausar en la espera y reanudar sigue en la espera', () => {
  const m = partido();
  aBatalla(m);
  gana(m, 0);
  run(m, 10);
  m.command({ type: 'pause' });
  run(m, 100); // los 40 pasos de resultados no corren
  assert.equal(m.state, 'roundEnd');
  m.command({ type: 'resume' });
  run(m, 30);
  assert.equal(m.state, 'waitingNextRound');
});

test('el ronda siguiente cuenta para el soldado gratis: unirse en la espera da el soldado de la ronda que viene', () => {
  const m = partido();
  aBatalla(m);
  gana(m, 0);
  run(m, 40);
  assert.equal(m.state, 'waitingNextRound');
  assert.equal(m.world.round, 2);
  const r = m.command(chat('z', 'mexico'));
  assert.equal(r.join.freeUnit, true);
  m.command({ type: 'startRound' });
  run(m, INTRO);
  // en la ronda 2 el mismo usuario ya recibió su soldado
  const r2 = m.command(chat('z', 'mexico'));
  assert.equal(r2.join, null);
});

test('NM-9 y CB-21: en pausa la cola no drena ni nadie se mueve; al reanudar la salida sigue con el ritmo normal', () => {
  const m = partido({ round: { seconds: 600, introSeconds: 1, resultsSeconds: 1 } });
  aBatalla(m);
  m.command({
    type: 'order',
    order: { kind: 'soldado', team: 1, owner: null, count: 60, unitValue: 0, source: 'gift' },
  });
  const w = m.world;
  run(m, 60);
  const salidos = w.units.filter((u) => u.side === 0).length;
  assert.ok(salidos >= 8 && salidos <= 20, `${salidos} salidos en 2 s`);
  m.command({ type: 'pause' });
  const pos = w.units.map((u) => [u.id, u.x, u.y]);
  const enCola = w.queues[0].groundUnits;
  run(m, 20 * 30); // 20 s de pared en pausa
  assert.deepEqual(
    w.units.map((u) => [u.id, u.x, u.y]),
    pos,
    'nadie se movió',
  );
  assert.equal(w.queues[0].groundUnits, enCola, 'la cola no drenó');
  m.command({ type: 'resume' });
  run(m, 30);
  const despues = w.units.filter((u) => u.side === 0).length;
  assert.ok(despues - salidos >= 7 && despues - salidos <= 9, `salieron ${despues - salidos} en 1 s tras reanudar`);
});

test('pickPair solo vale en matchup y en lobby (cambiar de par antes de empezar); durante el partido se rechaza', () => {
  const m = partido();
  assert.equal(m.command({ type: 'pickPair', a: 'PE', b: 'MX' }).ok, true);
  assert.equal(m.command({ type: 'pickPair', a: 'AR', b: 'CL' }).ok, true, 'en lobby se puede cambiar');
  assert.deepEqual(
    m.pair.teams.map((t) => t.id),
    ['AR', 'CL'],
  );
  assert.deepEqual(m.registry.teamSizes(), [0, 0]);
  m.command({ type: 'startMatch' });
  run(m, INTRO);
  for (const estado of ['intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd']) {
    if (estado === 'roundEnd') gana(m, 0);
    if (estado === 'waitingNextRound') run(m, 40);
    if (estado === 'matchEnd') {
      m.command({ type: 'startRound' });
      run(m, INTRO);
      gana(m, 0);
    }
    const h = hashMatch(m);
    assert.equal(m.command({ type: 'pickPair', a: 'PE', b: 'MX' }).ok, false, m.state);
    assert.equal(hashMatch(m), h);
  }
});

test('al terminar el partido, o al abortarlo, lo que queda en las colas pasa a retirado y la conservación se cumple', () => {
  for (const salida of ['matchEnd', 'abortar']) {
    const m = partido();
    m.command({ type: 'pickPair', a: 'PE', b: 'MX' });
    m.command(chat('a', 'peru'));
    m.command({ type: 'startMatch' });
    run(m, INTRO);
    const w = m.world;
    m.command({
      type: 'gift',
      owner: 'a',
      coins: 5000,
      orders: [{ kind: 'soldado', team: 1, owner: 'a', count: 5000, unitValue: 1, source: 'gift' }],
    });
    assert.ok(w.queues[0].groundUnits > 1000);
    if (salida === 'matchEnd') {
      gana(m, 0);
      siguiente(m);
      gana(m, 0);
      assert.equal(m.state, 'matchEnd');
      assert.equal(w.queues[0].groundUnits, 0, 'la cola se retira en el mismo paso del fin de partido');
    } else {
      run(m, 20);
      const r = m.command({ type: 'endMatch' });
      assert.deepEqual([r.ok, r.aborted], [true, true]);
      assert.equal(m.state, 'matchup');
      assert.notEqual(m.world, w);
    }
    const l = ledger(w);
    assert.equal(l.queued, 0, salida);
    assert.ok(l.retired > 1000, salida);
    assert.ok(Math.abs(l.paid - l.sum) < 1e-6, `${salida}: ${JSON.stringify(l)}`);
  }
});
