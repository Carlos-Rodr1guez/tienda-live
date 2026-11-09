import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createLiveSession } from '../public/js/live-session.js';
import { S } from '../public/js/ui/strings.js';
import { findForbidden } from './support/forbidden-words.js';
import { createMatch } from '../public/js/sim/match.js';
import { createFakeSessionServer } from './support/fake-session-server.js';

// KIT-28 reglas 1, 4, 6 y 7 del lado de la página: restaurar al cargar, marcar la copia sucia con el contador de versión
// del registro, enviar como mucho una vez por segundo con el reloj de vista, `newLive` manda DELETE y F2 cuenta lo que
// quedó afuera. El servidor es el almacén real del kit detrás de un `fetch` falso.

const RAPIDO = { round: { seconds: 3, introSeconds: 1, resultsSeconds: 1 } };
const INTRO = 30;

/** Una página: registro, partido y sesión contra un servidor falso (el mismo para simular recargas). */
function pagina(servidor, { maxBytes, fetch, game = RAPIDO } = {}) {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game, registry });
  const oyentes = new Map();
  const sesion = createLiveSession({
    registry,
    match,
    fetch: fetch ?? servidor.fetch,
    addEventListener: (type, fn) => oyentes.set(type, fn),
    maxBytes,
  });
  const p = { registry, match, sesion, oyentes, t: 0 };
  /** Da un cuadro `dt` segundos después y espera el pedido, si lo hubo. */
  p.cuadro = async (dt = 0) => {
    p.t += dt;
    await sesion.frame(p.t);
  };
  return p;
}
const run = (m, n) => {
  for (let i = 0; i < n; i++) m.step();
};
const chat = (id, text, nick = 'U' + id) => ({ userId: id, nickname: nick, text });
const copiaGuardada = (s) => (s.store.get() === null ? null : JSON.parse(s.store.get()));
const puts = (s) => s.sessionCalls().filter((c) => c.method === 'PUT');
const deletes = (s) => s.sessionCalls().filter((c) => c.method === 'DELETE');

/** Una sesión con historia: PE vs MX, ronda 1 ganada por la izquierda, Ana con rango, Beto oculto. */
async function conHistoria(s) {
  const p = pagina(s);
  await p.sesion.restore();
  const { match, registry } = p;
  match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  match.command({ type: 'startMatch' });
  registry.joinFromChat(chat('a', 'peru', 'Ana'), 1, 1);
  registry.joinFromChat(chat('b', 'mexico', 'Beto'), 2, 1);
  registry.addCoins('a', 200, 3);
  registry.addDestroyed('b', 10, 4);
  registry.hide('b');
  run(match, INTRO);
  match.world.bases[1].hp = 0;
  match.step();
  await p.cuadro(5);
  await p.sesion.client.settle();
  return p;
}

test('recarga con partido empezado: rangos y ocultos siguen y el juego vuelve a waitingNextRound con sus victorias', async () => {
  const s = createFakeSessionServer();
  const antes = await conHistoria(s);
  assert.equal(antes.match.state, 'roundEnd');
  assert.ok(copiaGuardada(s), 'la copia está en el servidor');

  const p = pagina(s);
  const info = await p.sesion.restore();
  assert.equal(info.status, 'restored');
  assert.equal(info.users, 2);
  assert.equal(info.state, 'waitingNextRound');
  assert.equal(p.match.state, 'waitingNextRound');
  assert.deepEqual(
    p.match.pair.teams.map((t) => t.id),
    ['PE', 'MX'],
  );
  assert.deepEqual(p.match.wins, [1, 0]);
  assert.deepEqual(p.registry.rankOf('a'), antes.registry.rankOf('a'));
  assert.equal(p.registry.rankOf('a').label, 'Teniente');
  assert.equal(p.registry.get('a').xp.live, 200);
  assert.equal(p.registry.displayName('b'), 'anónimo');
  assert.equal(p.registry.displayName('a'), 'Ana');
  assert.deepEqual(p.registry.teamSizes(), [1, 1]);
  assert.deepEqual(p.registry.drain(), [], 'restaurar no genera avisos de ascenso');
  // la ronda cortada no vuelve: mundo nuevo
  assert.equal(p.match.world.units.length, 0);
  assert.deepEqual(p.match.command({ type: 'startRound' }), { ok: true, round: 2 });
});

test('recarga sin par elegido: vuelve al selector con rangos y ocultos restaurados', async () => {
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  a.registry.touch({ userId: 'a', nickname: 'Ana' });
  a.registry.addCoins('a', 80, 0);
  a.registry.hide('a');
  await a.cuadro(1);
  await a.sesion.client.settle();
  assert.equal(copiaGuardada(s).match, null);

  const p = pagina(s);
  const info = await p.sesion.restore();
  assert.equal(info.state, 'selector');
  assert.equal(p.match.state, 'matchup');
  assert.equal(p.match.pair, null);
  assert.equal(p.registry.rankOf('a').label, 'Sargento');
  assert.equal(p.registry.displayName('a'), 'anónimo');
});

test('recarga con un par sin partido empezado: al lobby con el par', async () => {
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  a.match.command({ type: 'pickPair', a: 'AR', b: 'PE' });
  await a.cuadro(1);
  await a.sesion.client.settle();
  const p = pagina(s);
  assert.equal((await p.sesion.restore()).state, 'lobby');
  assert.equal(p.match.state, 'lobby');
  assert.deepEqual(
    p.match.pair.teams.map((t) => t.id),
    ['AR', 'PE'],
  );
});

test('un progreso inválido guardado se descarta: selector, con los rangos y los ocultos restaurados', async () => {
  const s = createFakeSessionServer();
  const copia = {
    v: 1,
    clock: 0,
    allHidden: false,
    hidden: ['b'],
    match: { pair: ['XX', 'YY'], started: true, roundsDone: 1, wins: [1, 0] },
    users: [
      {
        key: 'a',
        name: 'Ana',
        team: 1,
        lastSwitch: 0,
        coins: { live: 80, match: 80 },
        value: { live: 0, match: 0 },
        xp: { live: 80, match: 80 },
        kills: { live: 0, match: 0 },
        firstXpAt: 0,
      },
    ],
  };
  await s.fetch('/api/session', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(copia),
  });
  const p = pagina(s);
  const info = await p.sesion.restore();
  assert.equal(info.status, 'restored');
  assert.equal(info.state, 'selector');
  assert.equal(p.match.state, 'matchup');
  assert.equal(p.match.pair, null);
  assert.equal(p.registry.rankOf('a').label, 'Sargento');
  p.registry.touch({ userId: 'b', nickname: 'Beto' });
  assert.equal(p.registry.displayName('b'), 'anónimo');
});

test('sin servidor de sesión (404 o 403): el juego arranca vacío, F2 lo dice y no se envía nada más', async () => {
  for (const status of [404, 403]) {
    const llamadas = [];
    const fetch = async (url, init = {}) => {
      llamadas.push(init.method ?? 'GET');
      return { ok: false, status, json: async () => ({}) };
    };
    const p = pagina(null, { fetch });
    const info = await p.sesion.restore();
    assert.equal(info.status, 'off', String(status));
    p.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
    p.registry.joinFromChat(chat('a', 'peru'), 0, 1);
    p.registry.addCoins('a', 5, 0);
    for (let i = 0; i < 20; i++) await p.cuadro(1);
    p.oyentes.get('pagehide')();
    assert.deepEqual(llamadas, ['GET'], 'solo el GET de la carga');
    assert.match(p.sesion.f2()[0].value, /sin servidor/);
  }
});

test('copia inválida o error de red: el juego arranca vacío y F2 lo dice', async () => {
  const mala = pagina(null, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ v: 2, users: [] }) }),
  });
  assert.equal((await mala.sesion.restore()).status, 'invalid');
  assert.match(mala.sesion.f2()[0].value, /inválida/);
  assert.equal(mala.match.state, 'matchup');

  const red = pagina(null, {
    fetch: async () => {
      throw new Error('sin red');
    },
  });
  assert.equal((await red.sesion.restore()).status, 'failed');
  assert.match(red.sesion.f2()[0].value, /no se pudo cargar/);

  const vacia = pagina(createFakeSessionServer());
  assert.equal((await vacia.sesion.restore()).status, 'empty');
  assert.match(vacia.sesion.f2()[0].value, /vacía/);
});

test('recién restaurada la copia está limpia: sin cambios no hay un solo PUT', async () => {
  const s = createFakeSessionServer();
  await conHistoria(s);
  const s2 = createFakeSessionServer({ store: s.store });
  const p = pagina(s2);
  await p.sesion.restore();
  for (let i = 0; i < 50; i++) await p.cuadro(1);
  assert.equal(puts(s2).length, 0);
  assert.equal(s2.sessionCalls().length, 1, 'solo el GET');
});

/** Los cambios que van en la copia. Cada uno parte de una página recién restaurada, ya con par y partido. */
const CAMBIOS = {
  'una unión': (p) => p.registry.joinFromChat(chat('n1', 'peru'), 0, 1),
  'un cambio de bando': (p) => p.registry.joinFromChat(chat('a', 'mexico'), 100, 1),
  monedas: (p) => p.registry.addCoins('a', 7, 0),
  'XP por valor destruido': (p) => p.registry.addDestroyed('a', 7, 0),
  'una baja': (p) => p.registry.addKill('a'),
  'ocultar a un donante': (p) => p.registry.hide('a'),
  'N (todos los nombres)': (p) => p.registry.setAllNamesHidden(true),
  'fin de ronda': (p) => {
    p.match.command({ type: 'startRound' });
    run(p.match, INTRO);
    p.match.world.bases[0].hp = 0;
    p.match.step();
  },
  'cambio de par': (p) => {
    p.match.command({ type: 'endMatch' });
    p.match.command({ type: 'pickPair', a: 'AR', b: 'CL' });
  },
  'fin del partido': (p) => {
    p.match.command({ type: 'startRound' });
    run(p.match, INTRO);
    p.match.world.bases[1].hp = 0;
    p.match.step();
    assert.equal(p.match.state, 'matchEnd');
  },
  'abortar el partido': (p) => p.match.command({ type: 'endMatch' }),
};

for (const [nombre, cambio] of Object.entries(CAMBIOS)) {
  test(`cambio relevante (${nombre}): una sola vez, como mucho 1 PUT por segundo`, async () => {
    const s = createFakeSessionServer();
    await conHistoria(s);
    const s2 = createFakeSessionServer({ store: s.store });
    const p = pagina(s2);
    await p.sesion.restore();
    await p.cuadro(10);
    assert.equal(puts(s2).length, 0);
    cambio(p);
    await p.cuadro(0.1);
    await p.sesion.client.settle();
    assert.equal(puts(s2).length, 1, 'se envía');
    assert.equal(puts(s2)[0].status, 204);
    for (let i = 0; i < 9; i++) await p.cuadro(0.1);
    await p.sesion.client.settle();
    assert.equal(puts(s2).length, 1, 'ya está guardada: no se repite');
  });
}

test('cambios que no van en la copia no la ensucian: avanzar el sim, chat sin pedir equipo, likes y lecturas', async () => {
  const s = createFakeSessionServer();
  await conHistoria(s);
  const s2 = createFakeSessionServer({ store: s.store });
  const p = pagina(s2);
  await p.sesion.restore();
  p.match.command({ type: 'startRound' });
  run(p.match, INTRO + 20); // dentro de la ronda: si terminara, el fin de ronda SÍ es un cambio
  assert.equal(p.match.state, 'battle');
  p.match.command({ type: 'chat', evt: chat('x', 'hola a todos') });
  p.match.command({ type: 'likes', evt: chat('a', ''), count: 50 });
  p.registry.touch({ userId: 'z', nickname: 'Zoe' });
  p.registry.displayName('a');
  p.registry.users();
  for (let i = 0; i < 30; i++) await p.cuadro(1);
  assert.equal(puts(s2).length, 0);
});

test('mucho movimiento en un segundo: un PUT por segundo con lo último, nunca una tormenta', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s);
  await p.sesion.restore();
  p.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  for (let i = 0; i < 100; i++) {
    p.registry.joinFromChat(chat('u' + i, 'peru'), i, 1);
    p.registry.addCoins('u' + i, 1, i);
    await p.cuadro(0.01); // 1,00 s en total
  }
  await p.sesion.client.settle();
  assert.equal(puts(s).length, 1, 'el primero sale de inmediato; el siguiente, un segundo después');
  await p.cuadro(0.5);
  await p.cuadro(0.5);
  await p.sesion.client.settle();
  assert.equal(puts(s).length, 2);
  assert.equal(copiaGuardada(s).users.length, 100);
});

test('newLive confirmado manda DELETE y la copia queda vacía, como un servidor reiniciado; sin confirmar no manda nada', async () => {
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  a.registry.touch(chat('a', '', 'Ana'));
  a.registry.addCoins('a', 100, 0);
  await a.cuadro(1);
  await a.sesion.client.settle();
  assert.ok(copiaGuardada(s));

  const s2 = createFakeSessionServer({ store: s.store });
  const p = pagina(s2);
  await p.sesion.restore();
  assert.equal(p.match.state, 'matchup');
  assert.equal(p.registry.get('a').xp.live, 100);
  // sin confirmar o fuera de matchup: el sim lo rechaza y la página no manda nada
  assert.equal(p.match.command({ type: 'newLive' }).ok, false);
  assert.equal(p.match.command({ type: 'newLive', confirmed: false }).ok, false);
  await p.sesion.client.settle();
  assert.equal(deletes(s2).length, 0);
  assert.ok(copiaGuardada(s2));
  // confirmado
  assert.equal(p.match.command({ type: 'newLive', confirmed: true }).ok, true);
  await p.sesion.client.settle();
  assert.equal(deletes(s2).length, 1);
  assert.equal(deletes(s2)[0].status, 204);
  assert.equal(s2.store.get(), null, 'la copia está vacía');
  assert.equal(p.registry.get('a').xp.live, 0);
  // reiniciar el servidor da lo mismo: GET 204 vacío
  const reiniciado = createFakeSessionServer();
  assert.equal(reiniciado.store.get(), null);
  assert.equal((await s2.fetch('/api/session')).status, 204);
  // el reinicio del registro no vuelve a llenar la copia por su cuenta
  for (let i = 0; i < 20; i++) await p.cuadro(1);
  assert.equal(puts(s2).length, 0);
  assert.equal(s2.store.get(), null);
  // y recargar ahora arranca todo en Recluta
  const q = pagina(createFakeSessionServer({ store: s2.store }));
  assert.equal((await q.sesion.restore()).status, 'empty');
  assert.equal(q.registry.users().length, 0);
  // lo que pase después sí se guarda otra vez
  p.registry.touch(chat('b', '', 'Beto'));
  p.registry.addCoins('b', 3, 0);
  await p.cuadro(1);
  await p.sesion.client.settle();
  assert.equal(puts(s2).length, 1);
});

test('newLive rechazado por el sim (durante un partido) no manda DELETE', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s);
  await p.sesion.restore();
  p.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  assert.equal(p.match.command({ type: 'newLive', confirmed: true }).ok, false);
  await p.sesion.client.settle();
  assert.equal(deletes(s).length, 0);
});

test('un newLive con el DELETE caído se reintenta y no pisa con un PUT viejo', async () => {
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  a.registry.touch(chat('a', '', 'Ana'));
  a.registry.addCoins('a', 100, 0);
  await a.cuadro(1);
  await a.sesion.client.settle();
  let caido = true;
  const fetch = async (url, init = {}) => {
    if (init.method === 'DELETE' && caido) throw new Error('red');
    return s.fetch(url, init);
  };
  const p = pagina(s, { fetch });
  await p.sesion.restore();
  p.match.command({ type: 'newLive', confirmed: true });
  await p.sesion.client.settle();
  assert.ok(copiaGuardada(s), 'el DELETE falló: sigue la copia vieja');
  caido = false;
  await p.cuadro(2);
  await p.sesion.client.settle();
  assert.equal(s.store.get(), null);
});

test('copia más grande que maxBytes: se corta en la página, F2 cuenta los que quedaron afuera y el servidor la acepta', async () => {
  const MAX = 70000;
  const s = createFakeSessionServer({ maxBytes: MAX });
  const p = pagina(s, { maxBytes: MAX });
  await p.sesion.restore();
  p.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  for (let i = 0; i < 5000; i++) {
    p.registry.joinFromChat(chat('u' + i, i % 2 ? 'peru' : 'mexico'), 0, 1);
    p.registry.addCoins('u' + i, (i * 31) % 997, 0);
  }
  for (let i = 0; i < 12; i++) p.registry.hide('oculto-' + i);
  p.registry.setAllNamesHidden(true);
  await p.cuadro(1);
  await p.sesion.client.settle();
  assert.equal(puts(s).length, 1);
  assert.equal(puts(s)[0].status, 204, 'el servidor la aceptó: la página respetó el mismo límite');
  assert.ok(Buffer.byteLength(puts(s)[0].body) <= MAX);
  const guardada = copiaGuardada(s);
  assert.equal(guardada.hidden.length, 12);
  assert.equal(guardada.allHidden, true);
  assert.ok(guardada.users.length > 0 && guardada.users.length < 5000);
  const afuera = 5000 - guardada.users.length;
  const lineas = Object.fromEntries(p.sesion.f2().map((l) => [l.key, l.value]));
  assert.equal(lineas['session.leftOut'], String(afuera));
  // los que están son los de más XP
  const menor = Math.min(...guardada.users.map((u) => u.xp.live));
  const quedaron = new Set(guardada.users.map((u) => u.key));
  for (const u of p.registry.users()) if (!quedaron.has(u.key)) assert.ok(u.xp.live <= menor);
});

test('?donantes: los donantes sintéticos tienen los mismos userId, así que una recarga no los duplica', async () => {
  const inyectar = (p) => {
    for (const team of [1, 2]) {
      for (let i = 0; i < 12; i++) {
        const id = `sint-${team}-${i}`;
        p.match.command({ type: 'chat', evt: { userId: id, nickname: 'Donante ' + i, text: String(team) } });
        p.match.command({
          type: 'gift',
          owner: id,
          coins: (12 - i) * 80,
          orders: [{ kind: 'soldado', team, owner: id, count: 1, unitValue: 40, source: 'gift' }],
        });
      }
    }
  };
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  a.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  a.match.command({ type: 'startMatch' });
  inyectar(a);
  await a.cuadro(1);
  await a.sesion.client.settle();
  assert.equal(copiaGuardada(s).users.length, 24);

  const p = pagina(s);
  await p.sesion.restore();
  assert.equal(p.registry.users().length, 24);
  p.match.command({ type: 'startRound' });
  inyectar(p);
  assert.equal(p.registry.users().length, 24, 'mismos userId: ninguno duplicado');
  await p.cuadro(1);
  await p.sesion.client.settle();
  assert.equal(copiaGuardada(s).users.length, 24);
});

test('peor caso de nombres: bidi y ancho cero, 1 y 200 caracteres, emoji y CJK vuelven saneados igual', async () => {
  const emoji = String.fromCodePoint(0x1f600).repeat(24);
  const nombres = [
    '\u202EAna\u200B_23',
    'k',
    'x'.repeat(200),
    emoji,
    '田中太郎さんの動画チャンネル',
    'xX_el_mas_capo_del_live_Xx',
  ];
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  nombres.forEach((n, i) => {
    a.registry.joinFromChat(chat('u' + i, '1', n), 0, 1);
    a.registry.addCoins('u' + i, i + 1, 0);
  });
  await a.cuadro(1);
  await a.sesion.client.settle();
  const p = pagina(s);
  assert.equal((await p.sesion.restore()).users, nombres.length);
  nombres.forEach((_, i) => {
    assert.equal(p.registry.get('u' + i).name, a.registry.get('u' + i).name);
    assert.doesNotMatch(p.registry.get('u' + i).name, new RegExp(String.raw`[\u202E\u200B]`));
  });
  assert.equal(p.registry.get('u0').name, 'Ana_23');
});

test('el reloj de la copia es el del mundo: se resta al restaurar y firstXpAt conserva su orden', async () => {
  const s = createFakeSessionServer();
  const a = pagina(s, { game: { round: { seconds: 60, introSeconds: 1, resultsSeconds: 1 } } });
  await a.sesion.restore();
  a.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  a.match.command({ type: 'startMatch' });
  run(a.match, INTRO + 90); // 3 s de batalla; el reloj del mundo solo corre en batalla
  a.registry.joinFromChat(chat('a', 'peru'), a.match.world.time, 1);
  a.registry.addCoins('a', 5, a.match.world.time);
  run(a.match, 30);
  a.registry.addCoins('b', 5, a.match.world.time);
  a.registry.joinFromChat(chat('b', 'mexico'), a.match.world.time, 1);
  a.registry.addCoins('b', 5, a.match.world.time);
  await a.cuadro(1);
  await a.sesion.client.settle();
  const guardada = copiaGuardada(s);
  assert.equal(guardada.clock, a.match.world.time);

  const p = pagina(s);
  await p.sesion.restore();
  const fa = p.registry.get('a').firstXpAt.match;
  const fb = p.registry.get('b').firstXpAt.match;
  assert.ok(fa <= 0 && fb <= 0 && fa < fb, `${fa} ${fb}`);
});

test('pagehide manda un último PUT con keepalive si la copia está sucia', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s);
  await p.sesion.restore();
  p.oyentes.get('pagehide')();
  assert.equal(puts(s).length, 0);
  p.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  p.registry.joinFromChat(chat('a', 'peru'), 0, 1);
  p.registry.addCoins('a', 5, 0);
  await p.cuadro(0.01); // el cuadro detecta el cambio y envía
  await p.sesion.client.settle();
  assert.equal(puts(s).length, 1);
  p.registry.addCoins('a', 5, 0);
  await p.cuadro(0.01); // dentro del mismo segundo: no se envía
  assert.equal(puts(s).length, 1);
  p.oyentes.get('pagehide')(); // sin esperar al cuadro: la página se va
  await p.sesion.client.settle();
  await new Promise((r) => setImmediate(r));
  assert.equal(puts(s).length, 2);
  assert.equal(puts(s)[1].keepalive, true);
  assert.equal(copiaGuardada(s).users[0].xp.live, 10);
});

test('pagehide mira primero si quedó un cambio sin detectar: el cuadro siguiente ya no va a llegar', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s);
  await p.sesion.restore();
  p.registry.touch(chat('a', '', 'Ana'));
  p.registry.addCoins('a', 5, 0);
  // ningún cuadro entre el cambio y la salida de la página
  p.oyentes.get('pagehide')();
  await p.sesion.client.settle();
  await new Promise((r) => setImmediate(r));
  assert.equal(puts(s).length, 1);
  assert.equal(puts(s)[0].keepalive, true);
  assert.equal(copiaGuardada(s).users[0].xp.live, 5);
});

/** Un fetch cuyo GET de carga falla `fallos` veces (500) antes de hablar con el servidor falso; el resto pasa directo. */
function conGetCaido(servidor, fallos) {
  let restantes = fallos;
  return async (url, init = {}) => {
    if (!init.method && restantes > 0) {
      restantes--;
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return servidor.fetch(url, init);
  };
}

test('C1: ida y vuelta con los apodos del revisor: unirse, exportar, PUT contra el almacén real (204), GET e importar', async () => {
  const apodos = [
    '\u{1F44D}' + '\u{1F3FB}'.repeat(2000),
    '\u{1F468}' + '\u200D\u{1F469}'.repeat(500),
    '\u{1F3F4}' + '\u{E0067}'.repeat(1000),
    '\u0600'.repeat(3000) + 'a',
  ];
  const s = createFakeSessionServer();
  const a = pagina(s);
  await a.sesion.restore();
  apodos.forEach((nick, i) => {
    a.registry.joinFromChat(chat('u' + i, '1', nick), 0, 1);
    a.registry.addCoins('u' + i, 10 + i, 0);
    assert.ok(a.registry.get('u' + i).name.length <= 64, `u${i}: ${a.registry.get('u' + i).name.length} unidades`);
  });
  await a.cuadro(1);
  await a.sesion.client.settle();
  assert.equal(puts(s).length, 1);
  assert.equal(puts(s)[0].status, 204, 'el servidor la acepta: el respaldo no queda muerto');
  assert.equal(a.sesion.client.state.saving, 'ok');
  const p = pagina(s);
  assert.equal((await p.sesion.restore()).users, 4);
  apodos.forEach((_, i) => {
    assert.equal(p.registry.get('u' + i).name, a.registry.get('u' + i).name);
    assert.ok(p.registry.get('u' + i).name.length <= 64);
    assert.equal(p.registry.get('u' + i).name.isWellFormed(), true);
  });
});

test('C1: la página filtra antes de enviar: un usuario que el validador rechaza no viaja y F2 lo cuenta como fuera de la copia', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s);
  await p.sesion.restore();
  p.registry.joinFromChat(chat('a', '1', 'Ana'), 0, 1);
  p.registry.addCoins('a', 5, 0);
  const original = p.registry.exportLive;
  // mañana aparece un campo inválido que el registro no filtra: el respaldo no puede quedar en 400 para siempre
  p.registry.exportLive = (c) => {
    const e = original(c);
    e.users.push({ ...e.users[0], key: 'malo', name: 'n'.repeat(600) }, { ...e.users[0], key: 'peor', team: 'uno' });
    return e;
  };
  await p.cuadro(1);
  await p.sesion.client.settle();
  assert.equal(puts(s)[0].status, 204);
  assert.deepEqual(
    copiaGuardada(s).users.map((u) => u.key),
    ['a'],
  );
  const lineas = Object.fromEntries(p.sesion.f2().map((l) => [l.key, l.value]));
  assert.equal(lineas['session.leftOut'], '2');
});

test('C2: si el GET de carga falla no se pisa la copia buena: sin PUT aunque haya cambios, y F2 dice que reintenta', async () => {
  const s = createFakeSessionServer();
  await conHistoria(s);
  const guardada = s.store.get();
  assert.ok(guardada);
  const s2 = createFakeSessionServer({ store: s.store });
  const p = pagina(s2, { fetch: conGetCaido(s2, 1000) });
  const info = await p.sesion.restore();
  assert.equal(info.status, 'failed');
  assert.equal(p.match.state, 'matchup', 'el juego sigue vacío, sin restaurar');
  p.match.command({ type: 'pickPair', a: 'AR', b: 'CL' });
  p.registry.touch(chat('n', '', 'Nuevo'));
  p.registry.addCoins('n', 50, 0);
  for (let i = 0; i < 40; i++) await p.cuadro(0.5);
  assert.equal(puts(s2).length, 0);
  assert.equal(s.store.get(), guardada, 'la copia buena sigue intacta');
  assert.match(p.sesion.f2()[0].value, /no se pudo cargar.*reintentando/);
  assert.equal(p.sesion.client.state.gate, 'pending');
});

test('C2: un GET tardío con 204 habilita los PUT y sale lo que cambió mientras tanto', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s, { fetch: conGetCaido(s, 2) }); // el de la carga y el primer reintento fallan
  assert.equal((await p.sesion.restore()).status, 'failed');
  p.match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  p.registry.joinFromChat(chat('a', 'peru', 'Ana'), 0, 1);
  p.registry.addCoins('a', 30, 0);
  for (let i = 0; i < 12; i++) await p.cuadro(0.5);
  await p.sesion.client.settle();
  assert.equal(p.sesion.client.state.gate, 'open');
  assert.ok(puts(s).length >= 1);
  assert.equal(copiaGuardada(s).users[0].xp.live, 30);
  assert.match(p.sesion.f2()[0].value, /vacía/);
});

test('C2: un GET tardío con 200 bloquea los PUT, no aplica la copia y F2 pide recargar', async () => {
  const s = createFakeSessionServer();
  await conHistoria(s);
  const guardada = s.store.get();
  const s2 = createFakeSessionServer({ store: s.store });
  const p = pagina(s2, { fetch: conGetCaido(s2, 1) });
  assert.equal((await p.sesion.restore()).status, 'failed');
  p.registry.touch(chat('n', '', 'Nuevo'));
  p.registry.addCoins('n', 50, 0);
  for (let i = 0; i < 20; i++) await p.cuadro(0.5);
  assert.equal(p.sesion.client.state.gate, 'blocked');
  assert.equal(p.registry.get('a'), undefined, 'lo guardado no se aplica a mitad de juego');
  assert.equal(puts(s2).length, 0);
  assert.equal(s.store.get(), guardada);
  assert.match(p.sesion.f2()[0].value, /hay una copia guardada sin cargar: recarga la página para recuperarla/);
});

test('C2: "nuevo en vivo" con la carga fallida o la copia bloqueada manda el DELETE y habilita el guardado', async () => {
  const s = createFakeSessionServer();
  await conHistoria(s);
  const s2 = createFakeSessionServer({ store: s.store });
  const p = pagina(s2, { fetch: conGetCaido(s2, 1) });
  await p.sesion.restore();
  await p.cuadro(0);
  await p.cuadro(1); // el reintento da 200: bloqueada
  await p.sesion.client.settle();
  assert.equal(p.sesion.client.state.gate, 'blocked');
  assert.equal(p.match.command({ type: 'newLive', confirmed: true }).ok, true);
  await p.sesion.client.settle();
  assert.equal(deletes(s2).length, 1);
  assert.equal(s2.store.get(), null);
  assert.equal(p.sesion.client.state.gate, 'open');
  p.registry.touch(chat('b', '', 'Beto'));
  p.registry.addCoins('b', 3, 0);
  await p.cuadro(2);
  await p.sesion.client.settle();
  assert.equal(puts(s2).length, 1);
});

test('F2: los ocultos que no entraron en la copia se cuentan aparte', async () => {
  const MAX = 64 * 1024;
  const s = createFakeSessionServer({ maxBytes: MAX });
  const p = pagina(s, { maxBytes: MAX });
  await p.sesion.restore();
  for (let i = 0; i < 3000; i++) p.registry.hide('oculto-con-un-nombre-bastante-largo-' + i);
  await p.cuadro(1);
  await p.sesion.client.settle();
  assert.equal(puts(s)[0].status, 204);
  const guardada = copiaGuardada(s);
  const afuera = 3000 - guardada.hidden.length;
  assert.ok(afuera > 0);
  const lineas = Object.fromEntries(p.sesion.f2().map((l) => [l.key, l.value]));
  assert.equal(lineas['session.leftOut'], `0 (+${afuera} ocultos)`);
});

test('F2: dos líneas con el estado de la sesión y los usuarios fuera de la copia, con textos de la constante exportada', async () => {
  const s = createFakeSessionServer();
  const p = pagina(s);
  assert.deepEqual(
    p.sesion.f2().map((l) => l.key),
    ['session.status', 'session.leftOut'],
  );
  await p.sesion.restore();
  const [estado, fuera] = p.sesion.f2();
  assert.equal(estado.label, S.session.statusLabel);
  assert.equal(fuera.label, S.session.leftOutLabel);
  assert.equal(fuera.value, '0');
  assert.ok(Object.isFrozen(S.session));
  // restaurada con N usuarios
  const a = await conHistoria(createFakeSessionServer({ store: s.store }));
  assert.ok(a);
  const q = pagina(createFakeSessionServer({ store: s.store }));
  await q.sesion.restore();
  assert.match(q.sesion.f2()[0].value, /restaurada.*\b2\b/);
});

test('f2Model suma las líneas de la sesión y no suma nada si no hay sesión (?golden)', async () => {
  const { f2Model } = await import('../public/js/render/f2.js');
  const base = {
    timer: { snapshot: () => ({ fps: 60, ms: { sim: 1, world: 1, ui: 1, fx: 0, work: 3 } }) },
    stats: {
      particles: 0,
      drawCalls: 0,
      culled: 0,
      s: 1,
      mode: 'nearest',
      marks: false,
      devicePass: true,
      canvasesAllocated: 0,
    },
    counts: { units: 0, squads: 0, planes: 0, hits: 0 },
    bakeCount: 0,
    hash: 'h',
  };
  const sin = f2Model(base).lines.map((l) => l.key);
  assert.equal(sin.includes('session.status'), false);
  const lineas = [
    { key: 'session.status', label: S.session.statusLabel, value: 'x' },
    { key: 'session.leftOut', label: S.session.leftOutLabel, value: '3' },
  ];
  const con = f2Model({ ...base, session: lineas }).lines;
  assert.deepEqual(
    con.filter((l) => l.key.startsWith('session.')),
    lineas,
  );
  assert.deepEqual(
    con.filter((l) => !l.key.startsWith('session.')).map((l) => l.key),
    sin,
  );
});

test('los textos de la sesión no llevan las palabras prohibidas ni nada de "guerra" o "directo"', () => {
  const todos = [];
  const juntar = (v) => {
    if (typeof v === 'string') todos.push(v);
    else if (typeof v === 'function') todos.push(v(3, 'lobby'), v(0, 'selector'), v(7, 'waitingNextRound', 2));
    else if (v && typeof v === 'object') Object.values(v).forEach(juntar);
  };
  juntar(S.session);
  assert.ok(todos.length > 6);
  assert.deepEqual(findForbidden(todos.join(' | ')), []);
});

test('la página no usa localStorage, sessionStorage, indexedDB ni cookies (D24, NM-11)', () => {
  const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const archivos = walk(GJ).filter((f) => f.endsWith('.js'));
  assert.ok(archivos.some((f) => f.endsWith('live-session.js')));
  for (const f of archivos) {
    const src = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, path.relative(GJ, f));
  }
});

test('live-session.js no usa reloj propio, azar, temporizadores periódicos ni la consola', () => {
  const src = fs
    .readFileSync(fileURLToPath(new URL('../public/js/live-session.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // los temporizadores de la carga llegan inyectados al cliente: aquí no se llama a ninguno
  assert.doesNotMatch(
    src,
    /Date\.now|performance\.now|Math\.random|setInterval|setTimeout\(|\bconsole\b|innerHTML|\bdocument\b|\bwindow\b/,
  );
});
