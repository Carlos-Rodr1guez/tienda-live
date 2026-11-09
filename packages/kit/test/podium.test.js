import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { podium, matchMvp, mvp, rankUsers } from '@tienda/kit/sim/podium.js';
import { ANON } from '@tienda/kit/sim/names.js';

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };

const make = (extra = {}) => createRegistry({ teams: [PE, MX], ...extra });

/** Alta de un usuario en un equipo (1 o 2) con monedas y valor destruido; `at` es el reloj del primer XP. */
function add(r, key, team, { coins = 0, value = 0, at = 0, nick = 'N' + key } = {}) {
  r.joinFromChat({ type: 'chat', userId: key, nickname: nick, text: String(team) }, 0, 1);
  if (coins) r.addCoins(key, coins, at);
  if (value) r.addDestroyed(key, value, at);
}
const keys = (list) => list.map((e) => e.key);

test('KIT-24: XP 50/40/40/10/0 da el top 3 sin el 10 y sin el 0', () => {
  const r = make();
  add(r, 'a', 1, { coins: 50 });
  add(r, 'b', 2, { coins: 40, at: 5 });
  add(r, 'c', 1, { coins: 40, at: 9 });
  add(r, 'd', 2, { coins: 10 });
  add(r, 'e', 1); // sin XP
  const top = podium(r);
  assert.deepEqual(
    top.map((e) => e.xp),
    [50, 40, 40],
  );
  // los dos 40 empatan en todo menos en firstXpAt: gana el que ganó XP antes
  assert.deepEqual(keys(top), ['a', 'b', 'c']);
  assert.ok(!keys(top).includes('d') && !keys(top).includes('e'));
  // n menor o mayor
  assert.equal(podium(r, 1).length, 1);
  assert.equal(podium(r, 10).length, 4, 'el de XP 0 nunca entra');
  assert.deepEqual(podium(r, 0), []);
});

test('KIT-24: columnas por país sin relleno', () => {
  const r = make();
  add(r, 'a1', 1, { coins: 50 });
  add(r, 'a2', 1, { coins: 20 });
  add(r, 'b1', 2, { coins: 90 });
  add(r, 'b2', 2, { coins: 30 });
  add(r, 'b3', 2, { coins: 25 });
  add(r, 'b4', 2, { coins: 10 });
  assert.deepEqual(
    podium(r, 3, { team: 2 }).map((e) => e.xp),
    [90, 30, 25],
  );
  assert.deepEqual(
    podium(r, 3, { team: 1 }).map((e) => e.xp),
    [50, 20],
  );
  assert.deepEqual(
    podium(r, 3, { team: 1 }).map((e) => e.team),
    [1, 1],
  );
  assert.deepEqual(podium(r, 3, { team: 7 }), [], 'un equipo que no existe da una lista vacía');
});

test('KIT-24: matchMvp es el de 90 de XP y null sin XP en ningún lado', () => {
  const r = make();
  assert.equal(matchMvp(r), null);
  add(r, 'a1', 1, { coins: 50 });
  add(r, 'b1', 2, { coins: 90 });
  add(r, 'z', 2);
  assert.equal(matchMvp(r).key, 'b1');
  assert.equal(matchMvp(r).xp, 90);
  assert.equal(matchMvp(make()), null);
});

test('KIT-24: cadena de empate XP, monedas, valor destruido, firstXpAt y clave, en cualquier orden de alta', () => {
  // mismo XP (10) con distinto desglose: más monedas va primero
  const build = (order) => {
    const r = make();
    const defs = {
      conMonedas: { coins: 10 },
      conValor: { value: 20 },
    };
    for (const k of order) add(r, k, 1, defs[k]);
    return r;
  };
  for (const order of [
    ['conMonedas', 'conValor'],
    ['conValor', 'conMonedas'],
  ]) {
    assert.deepEqual(keys(podium(build(order))), ['conMonedas', 'conValor'], order.join());
  }

  // mismas monedas y XP, distinto valor destruido: con valueFactor 0 el valor no suma XP pero desempata
  for (const order of [
    ['v0', 'v7'],
    ['v7', 'v0'],
  ]) {
    const r = make({ valueFactor: 0 });
    for (const k of order) {
      add(r, k, 1, { coins: 10 });
      if (k === 'v7') r.addDestroyed(k, 7, 1);
    }
    assert.deepEqual(keys(podium(r)), ['v7', 'v0'], order.join());
  }

  // todo igual salvo firstXpAt: gana el más temprano en ambos órdenes
  for (const order of [
    ['tarde', 'temprano'],
    ['temprano', 'tarde'],
  ]) {
    const r = make();
    const at = { temprano: 10, tarde: 80 };
    for (const k of order) add(r, k, 1, { coins: 10, at: at[k] });
    assert.deepEqual(keys(podium(r)), ['temprano', 'tarde'], order.join());
  }

  // todo igual: por clave en orden de punto de código ("Z" < "a" < "😀")
  for (const order of [
    ['a', 'Z', '😀'],
    ['😀', 'a', 'Z'],
    ['Z', '😀', 'a'],
  ]) {
    const r = make();
    for (const k of order) add(r, k, 1, { coins: 10, at: 5 });
    assert.deepEqual(keys(podium(r)), ['Z', 'a', '😀'], order.join());
  }
});

test('KIT-24: los ocultos y los vetados conservan el lugar con "anónimo"', () => {
  const r = make();
  add(r, 'a', 1, { coins: 50, nick: 'Ana' });
  add(r, 'b', 2, { coins: 40, nick: 'Beto' });
  r.hide('a');
  const top = podium(r);
  assert.deepEqual(keys(top), ['a', 'b']);
  assert.deepEqual(
    top.map((e) => e.name),
    [ANON, 'Beto'],
  );
  r.setAllNamesHidden(true);
  assert.deepEqual(
    podium(r).map((e) => e.name),
    [ANON, ANON],
  );
  assert.equal(matchMvp(r).name, ANON);
  r.setAllNamesHidden(false);
  assert.equal(podium(r)[1].name, 'Beto');
});

test('KIT-24: se ordena por XP de partido, no por monedas solas ni por XP de LIVE', () => {
  const r = make();
  add(r, 'a', 1, { coins: 100 }); // 100 monedas, 100 XP
  add(r, 'b', 2, { coins: 80, value: 60 }); // 110 XP
  assert.deepEqual(keys(podium(r)), ['b', 'a']);
  // partido nuevo: la XP previa queda en LIVE y el podio compara solo lo nuevo
  r.startMatch();
  assert.deepEqual(podium(r), []);
  r.addCoins('a', 10, 3);
  const [first] = podium(r);
  assert.equal(first.key, 'a');
  assert.equal(first.xp, 10);
  assert.equal(r.get('a').xp.live, 110);
});

test('KIT-25: mvp por equipo y por ronda; null si nadie del equipo tiene XP de ronda', () => {
  const r = make();
  add(r, 'A1', 1, { coins: 30 });
  add(r, 'A2', 1, { coins: 10 });
  add(r, 'B1', 2, { coins: 5 });
  assert.equal(mvp(r, 1).key, 'A1');
  assert.equal(mvp(r, 2).key, 'B1');
  // ronda nueva: nadie tiene XP de ronda
  r.startRound(2);
  assert.equal(mvp(r, 1), null);
  assert.equal(mvp(r, 2), null);
  r.addCoins('A2', 4, 7);
  assert.equal(mvp(r, 1).key, 'A2');
  assert.equal(mvp(r, 2), null, 'el equipo 2 no ganó XP en esta ronda');
  // el podio del partido sigue viendo todo
  assert.equal(matchMvp(r).key, 'A1');
});

test('KIT-25: el desempate de ronda usa firstXpAt de ronda, no el del partido', () => {
  const r = make();
  add(r, 'x', 1, { coins: 10, at: 1 });
  add(r, 'y', 1, { coins: 10, at: 2 });
  assert.equal(mvp(r, 1).key, 'x');
  r.startRound(2);
  r.addCoins('y', 10, 30);
  r.addCoins('x', 10, 40);
  assert.equal(mvp(r, 1).key, 'y', 'y ganó XP primero en esta ronda');
  assert.equal(podium(r, 3, { team: 1 })[0].key, 'x', 'en el partido x ganó XP primero');
});

test('rankUsers: alcance, filtro por equipo y entradas con datos para la vista', () => {
  const r = make();
  add(r, 'a', 1, { coins: 30, value: 10, nick: 'Ana' });
  add(r, 'b', 2, { coins: 5, nick: 'Beto' });
  const list = rankUsers(r, 'match');
  assert.deepEqual(list[0], {
    key: 'a',
    name: 'Ana',
    avatar: '',
    team: 1,
    xp: 35,
    coins: 30,
    value: 10,
    kills: 0,
    rank: 2,
  });
  assert.deepEqual(keys(rankUsers(r, 'round', { team: 2 })), ['b']);
  assert.deepEqual(rankUsers(r, 'live').length, 2);
  assert.throws(() => rankUsers(r, 'semana'), TypeError);
});

test('el podio no modifica el registro y no depende del orden de inserción con 1000+ usuarios', () => {
  const ids = Array.from({ length: 1200 }, (_, i) => 'u' + String(i).padStart(4, '0'));
  const fill = (order) => {
    const r = make();
    for (const k of order) add(r, k, 1 + (Number(k.slice(1)) % 2), { coins: 1 + (Number(k.slice(1)) % 7), at: 3 });
    return r;
  };
  const r1 = fill(ids);
  const r2 = fill([...ids].reverse());
  const before = JSON.stringify(r1.users());
  assert.deepEqual(keys(podium(r1, 50)), keys(podium(r2, 50)));
  assert.equal(JSON.stringify(r1.users()), before);
  assert.equal(rankUsers(r1, 'match').length, 1200);
});

test('nombres de caso extremo: largos, emoji, otros alfabetos y sin XP', () => {
  const r = make();
  add(r, 'a', 1, { coins: 10, nick: 'x'.repeat(500) });
  add(r, 'b', 2, { coins: 9, nick: '👨‍👩‍👧‍👦'.repeat(30) });
  add(r, 'c', 1, { coins: 8, nick: 'Привет мир' });
  add(r, 'd', 2, { coins: 7, nick: '‮​' });
  const names = podium(r, 4).map((e) => e.name);
  assert.ok([...new Intl.Segmenter().segment(names[0])].length <= 16);
  assert.ok([...new Intl.Segmenter().segment(names[1])].length <= 16);
  assert.equal(names[2], 'Привет мир');
  assert.equal(names[3], ANON);
});

// C22: topUsers es una sola pasada con los N mejores y la MISMA cadena de desempate que rankUsers.
test('topUsers: igual que rankUsers(...).slice(0, n) con empates, al azar y en el peor caso (todos iguales)', async () => {
  const { createRegistry } = await import('@tienda/kit/sim/registry.js');
  const { mulberry32 } = await import('@tienda/kit/sim/rng.js');
  const { rankUsers, topUsers } = await import('@tienda/kit/sim/podium.js');
  const A = { id: 'a', name: 'A', iso: 'AA', aliases: ['aa'] };
  const B = { id: 'b', name: 'B', iso: 'BB', aliases: ['bb'] };
  for (const [semilla, modo] of [
    [1, 'azar'],
    [2, 'azar'],
    [3, 'iguales'],
    [4, 'pocos-valores'],
  ]) {
    const rnd = mulberry32(semilla);
    const r = createRegistry({ teams: [A, B] });
    r.startMatch();
    for (let i = 0; i < 400; i++) {
      const key = `u${Math.floor(rnd() * 1e6)}`;
      r.touch({ userId: key, nickname: key });
      r.joinFromChat({ userId: key, nickname: key, text: String(1 + (i % 2)) }, 0, 0);
      const coins =
        modo === 'iguales' ? 5 : modo === 'pocos-valores' ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 500);
      r.addCoins(key, coins, Math.floor(rnd() * 20));
      if (rnd() < 0.3) r.addDestroyed(key, Math.floor(rnd() * 50), 1);
    }
    for (const scope of ['live', 'match', 'round']) {
      for (const team of [undefined, 1, 2]) {
        const todos = rankUsers(r, scope, { team });
        for (const n of [1, 3, 10, 400, 1000]) {
          assert.deepEqual(topUsers(r, scope, n, { team }), todos.slice(0, n), `${modo} ${scope} team ${team} n ${n}`);
        }
      }
    }
    const par = (u) => u.key.length % 2 === 0;
    assert.deepEqual(
      topUsers(r, 'match', 5, { filter: par }).map((e) => e.key),
      rankUsers(r, 'match')
        .filter((e) => e.key.length % 2 === 0)
        .slice(0, 5)
        .map((e) => e.key),
    );
  }
  assert.deepEqual(topUsers(createRegistry({ teams: [A, B] }), 'match', 0), []);
  assert.throws(() => topUsers(createRegistry({ teams: [A, B] }), 'otro', 3), TypeError);
});

test('topUsers con 20 000 usuarios: una sola pasada, bastante menos de lo que cuesta ordenar a todos', async () => {
  const { createRegistry } = await import('@tienda/kit/sim/registry.js');
  const { rankUsers, topUsers } = await import('@tienda/kit/sim/podium.js');
  const r = createRegistry({
    teams: [
      { id: 'a', name: 'A', iso: 'AA', aliases: ['aa'] },
      { id: 'b', name: 'B', iso: 'BB', aliases: ['bb'] },
    ],
  });
  r.startMatch();
  for (let i = 0; i < 20000; i++) {
    r.touch({ userId: `u${i}`, nickname: `u${i}` });
    r.addCoins(`u${i}`, 1 + (i % 97), i % 13);
  }
  topUsers(r, 'match', 3); // calienta
  let rapido = Infinity;
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    topUsers(r, 'match', 3);
    rapido = Math.min(rapido, performance.now() - t0);
  }
  const t1 = performance.now();
  rankUsers(r, 'match');
  const lento = performance.now() - t1;
  assert.ok(rapido < lento, `${rapido.toFixed(2)} ms contra ${lento.toFixed(2)} ms`);
  assert.ok(rapido < 6, `${rapido.toFixed(2)} ms con 20 000 usuarios`);
});
