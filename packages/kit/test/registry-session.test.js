import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { createBlocklist } from '@tienda/kit/sim/names.js';
import { ConfigError } from '@tienda/kit/sim/config.js';

// KIT-28 reglas 1, 5 y 8 (y KIT-10, KIT-11, KIT-22): `exportLive` / `importLive` y el contador de versión del registro.
// Son puras: sin `fetch`, sin reloj propio (el reloj llega como argumento) y sin tocar el disco.

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
const make = (extra = {}) => createRegistry({ teams: [PE, MX], ...extra });
const chat = (id, text, nick = 'U' + id, extra = {}) => ({
  type: 'chat',
  userId: id,
  nickname: nick,
  text,
  ...extra,
});
/** Una copia mínima válida a mano. */
const user = (key, extra = {}) => ({
  key,
  name: 'N' + key,
  team: 1,
  lastSwitch: -1e9,
  coins: { live: 0, match: 0 },
  value: { live: 0, match: 0 },
  xp: { live: 0, match: 0 },
  kills: { live: 0, match: 0 },
  firstXpAt: null,
  ...extra,
});
const copia = (users = [], extra = {}) => ({
  v: 1,
  clock: 0,
  users,
  hidden: [],
  allHidden: false,
  match: null,
  ...extra,
});
const viaJson = (x) => JSON.parse(JSON.stringify(x));

/** Un registro con casos de todo tipo. */
function conHistoria() {
  const r = make();
  r.joinFromChat(chat('a', 'peru', 'Ana', { avatar: 'https://cdn.example/a.png' }), 10, 1);
  r.addCoins('a', 100, 12);
  r.addDestroyed('a', 40, 20);
  r.addKill('a');
  r.joinFromChat(chat('b', 'mexico', 'Beto'), 30, 1);
  r.touch(chat('c', 'hola mundo secreto', 'Cami')); // sin equipo ni XP: no entra a la copia
  r.addCoins('d', 5, 1); // usuario que no existe: nada
  r.touch({ userId: 'e', nickname: 'Eva' });
  r.hide('e'); // oculto sin equipo ni XP: entra
  r.hide('fantasma'); // oculto que todavía no llegó: entra en la lista
  return r;
}

test('exportLive: solo usuarios con equipo, XP > 0 u ocultos; la lista de ocultos y allHidden', () => {
  const r = conHistoria();
  r.setAllNamesHidden(true);
  const e = r.exportLive(55);
  assert.equal(e.v, 1);
  assert.equal(e.clock, 55);
  assert.equal(e.match, null);
  assert.equal(e.allHidden, true);
  assert.deepEqual([...e.hidden].sort(), ['e', 'fantasma']);
  assert.deepEqual(e.users.map((u) => u.key).sort(), ['a', 'b', 'e']);
});

test('exportLive: sin avatares ni texto del chat, y sin alcance de ronda ni rango', () => {
  const r = conHistoria();
  const texto = JSON.stringify(r.exportLive(0));
  assert.doesNotMatch(texto, /cdn\.example|a\.png|secreto|hola mundo|avatar|"text"|"round"|"rank"|joinedRound/);
  const a = r.exportLive(0).users.find((u) => u.key === 'a');
  assert.deepEqual(Object.keys(a).sort(), [
    'coins',
    'firstXpAt',
    'key',
    'kills',
    'lastSwitch',
    'name',
    'team',
    'value',
    'xp',
  ]);
  assert.deepEqual(a.coins, { live: 100, match: 100 });
  assert.deepEqual(a.value, { live: 40, match: 40 });
  assert.deepEqual(a.xp, { live: 120, match: 120 });
  assert.deepEqual(a.kills, { live: 1, match: 1 });
  assert.equal(a.team, 1);
  assert.equal(a.firstXpAt, 12);
  assert.equal(a.lastSwitch, 10);
});

test('exportLive: el nombre exportado es el real saneado, no "anónimo"; un usuario sin XP tiene firstXpAt null', () => {
  const r = conHistoria();
  r.hide('a');
  const e = r.exportLive(0);
  assert.equal(e.users.find((u) => u.key === 'a').name, 'Ana');
  assert.equal(e.users.find((u) => u.key === 'b').firstXpAt, null);
});

test('exportLive: la copia sobrevive a JSON y no comparte objetos con el registro', () => {
  const r = conHistoria();
  const e = r.exportLive(7);
  assert.deepEqual(viaJson(e), e);
  e.users[0].xp.live = 99999;
  assert.notEqual(r.get(e.users[0].key).xp.live, 99999);
});

test('exportLive: una clave de más de 512 caracteres se deja afuera (el servidor la rechazaría)', () => {
  const r = make();
  const larga = 'k'.repeat(513);
  r.touch({ userId: larga, nickname: 'x' });
  r.addCoins(larga, 5, 0);
  r.joinFromChat(chat('ok', '1'), 0, 1);
  assert.deepEqual(
    r.exportLive(0).users.map((u) => u.key),
    ['ok'],
  );
});

test('importLive: vuelve a sanear el nombre (bidi y ancho cero) y devuelve {users, dropped}', () => {
  const r = make();
  const res = r.importLive(copia([user('a', { name: '\u202EAna\u200B_23' })]));
  assert.deepEqual(res, { users: 1, dropped: 0 });
  assert.equal(r.get('a').name, 'Ana_23');
  assert.equal(r.displayName('a'), 'Ana_23');
});

test('importLive: aplica la lista de nombres vetados al nombre restaurado', () => {
  const r = make({ blocklist: createBlocklist({ contains: ['badword'] }) });
  r.importLive(copia([user('a', { name: 'B4dW0rd' }), user('b', { name: 'Luis' })]));
  assert.equal(r.displayName('a'), 'anónimo');
  assert.equal(r.displayName('b'), 'Luis');
});

test('importLive: el rango sale de la XP de LIVE; un rango escrito a mano se ignora y no hay rankUp', () => {
  const r = make();
  r.importLive(
    copia([
      user('a', { xp: { live: 30, match: 0 }, rank: 8 }),
      user('b', { xp: { live: 0, match: 0 }, rank: 5 }),
      user('c', { xp: { live: 7500, match: 7500 } }),
    ]),
  );
  assert.deepEqual(r.rankOf('a'), { index: 2, label: 'Cabo' });
  assert.deepEqual(r.rankOf('b'), { index: 0, label: 'Recluta' });
  assert.deepEqual(r.rankOf('c'), { index: 8, label: 'General' });
  assert.deepEqual(r.drain(), []);
});

test('importLive: resta el reloj guardado a firstXpAt y lastSwitch sin cambiar su orden', () => {
  const r = make({ switchCooldownSeconds: 15 });
  r.importLive(
    copia(
      [
        user('a', { firstXpAt: 40, lastSwitch: 90, xp: { live: 5, match: 5 } }),
        user('b', { firstXpAt: 40.5, lastSwitch: 95, xp: { live: 5, match: 5 } }),
        user('c', { firstXpAt: null, lastSwitch: -1e9 }),
      ],
      { clock: 100 },
    ),
  );
  assert.equal(r.get('a').firstXpAt.match, -60);
  assert.equal(r.get('b').firstXpAt.match, -59.5);
  assert.ok(r.get('a').firstXpAt.match < r.get('b').firstXpAt.match);
  assert.equal(r.get('a').lastSwitch, -10);
  assert.ok(r.get('b').lastSwitch > r.get('a').lastSwitch);
  // "todavía sin XP" sigue al final y "nunca cambió" sigue siendo nunca
  assert.ok(r.get('c').firstXpAt.match >= 1e8);
  assert.ok(r.get('c').lastSwitch <= -1e8);
  // el cooldown de cambio de bando sigue valiendo con el reloj nuevo, que arranca en 0
  assert.equal(r.joinFromChat(chat('a', 'mexico'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('a', 'mexico'), 4, 1), null);
  assert.equal(r.joinFromChat(chat('a', 'mexico'), 5, 1)?.team, 2);
  // quien nunca cambió puede cambiar enseguida
  assert.equal(r.joinFromChat(chat('c', 'mexico'), 0, 1)?.team, 2);
});

test('importLive: los alcances de ronda y los datos fuera de la copia empiezan limpios', () => {
  const r = make();
  r.importLive(copia([user('a', { xp: { live: 50, match: 20 }, coins: { live: 50, match: 20 } })]));
  const u = r.get('a');
  assert.deepEqual(u.xp, { live: 50, match: 20, round: 0 });
  assert.deepEqual(u.coins, { live: 50, match: 20, round: 0 });
  assert.equal(u.firstXpAt.round >= 1e8, true);
  assert.equal(u.avatar, '');
  assert.equal(u.joinedRound, -1);
});

test('importLive: descarta campos desconocidos, usuarios de forma inválida y claves repetidas (queda la primera)', () => {
  const r = make();
  const malos = [
    null,
    'texto',
    42,
    [],
    user(''),
    user(7),
    user('x'.repeat(513)),
    user('neg', { xp: { live: -1, match: 0 } }),
    user('str', { coins: { live: '5', match: 0 } }),
    user('inf', { value: { live: Infinity, match: 0 } }),
    user('nan', { kills: { live: NaN, match: 0 } }),
    user('sinxp', { xp: undefined }),
    user('t', { team: 'uno' }),
    user('gigante', { coins: { live: 1e300, match: 0 } }),
    user('fx', { firstXpAt: 'ayer' }),
    user('ls', { lastSwitch: Infinity }),
  ];
  const res = r.importLive(
    copia([
      user('ok', { evil: true, avatar: 'http://x', text: 'hola', xp: { live: 3, match: 3, extra: 1 } }),
      ...malos,
      user('ok', { name: 'Repetido' }),
      user('ok2'),
    ]),
  );
  assert.deepEqual(res, { users: 2, dropped: malos.length + 1 });
  assert.equal(r.users().length, 2);
  assert.equal(r.get('ok').name, 'Nok');
  assert.equal(r.get('ok').avatar, '');
  assert.equal(r.get('ok').evil, undefined);
  assert.deepEqual(r.get('ok').xp, { live: 3, match: 3, round: 0 });
});

test('importLive: un nombre de 512 caracteres pasa (y se corta al sanear) y uno de 513 se descarta', () => {
  const r = make();
  const res = r.importLive(copia([user('ok', { name: 'n'.repeat(512) }), user('largo', { name: 'n'.repeat(513) })]));
  assert.deepEqual(res, { users: 1, dropped: 1 });
  assert.ok([...r.get('ok').name].length <= 16, 'el saneado recorta a 16 grafemas');
  assert.equal(r.get('largo'), undefined);
});

test('importLive: un equipo fuera de 1..N queda sin equipo y el conteo por equipo se recalcula', () => {
  const r = make();
  r.importLive(
    copia([
      user('a', { team: 1 }),
      user('b', { team: 2 }),
      user('c', { team: 3 }),
      user('d', { team: 0 }),
      user('e', { team: null }),
    ]),
  );
  assert.deepEqual(r.teamSizes(), [1, 1]);
  assert.equal(r.get('c').team, null);
  assert.equal(r.get('d').team, null);
});

test('importLive: restaura ocultos y allHidden; un oculto restaurado muestra "anónimo"', () => {
  const r = make();
  r.importLive(
    copia([user('a', { name: 'Ana' })], {
      hidden: ['a', 'aun-no-llego', 5, '', 'x'.repeat(513), 'a'],
      allHidden: true,
    }),
  );
  assert.equal(r.allNamesHidden(), true);
  assert.equal(r.displayName('a'), 'anónimo');
  // el que todavía no llegó queda oculto cuando llegue
  r.touch({ userId: 'aun-no-llego', nickname: 'Tarde' });
  r.setAllNamesHidden(false);
  assert.equal(r.displayName('aun-no-llego'), 'anónimo');
  assert.equal(r.displayName('a'), 'anónimo');
  assert.equal(r.exportLive(0).hidden.sort().join(','), 'a,aun-no-llego');
});

test('importLive: allHidden que no es true exacto queda en falso', () => {
  const r = make();
  r.setAllNamesHidden(true);
  r.importLive(copia([], { allHidden: 'si' }));
  assert.equal(r.allNamesHidden(), false);
});

test('importLive: una copia que no es una copia lanza ConfigError y no cambia nada', () => {
  const r = conHistoria();
  const antes = JSON.stringify(r.exportLive(0));
  for (const mala of [null, undefined, 5, 'x', [], {}, { v: 2, users: [] }, { v: 1 }, { v: 1, users: {} }]) {
    assert.throws(() => r.importLive(mala), ConfigError);
  }
  assert.equal(JSON.stringify(r.exportLive(0)), antes);
});

test('importLive: __proto__, constructor y prototype en el JSON no contaminan nada', () => {
  const texto = `{"v":1,"clock":0,"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},
    "hidden":[],"allHidden":false,"match":null,"users":[{"key":"p","name":"P","team":1,"lastSwitch":-1000000000,
    "__proto__":{"polluted":3},"constructor":{"polluted":4},"prototype":{"polluted":5},
    "coins":{"live":1,"match":1,"__proto__":{"polluted":6}},"value":{"live":0,"match":0},"xp":{"live":1,"match":1},
    "kills":{"live":0,"match":0},"firstXpAt":null}]}`;
  const r = make();
  assert.deepEqual(r.importLive(JSON.parse(texto)), { users: 1, dropped: 0 });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const u = r.get('p');
  assert.equal(u.polluted, undefined);
  assert.equal(u.coins.polluted, undefined);
  assert.equal(Object.getPrototypeOf(u), Object.prototype);
  assert.deepEqual(Object.keys(u).sort(), Object.keys(conHistoria().get('a')).sort());
});

test('una clave de usuario "__proto__" es una clave más', () => {
  const r = make();
  const res = r.importLive(viaJson(copia([user('__proto__'), user('constructor')])));
  assert.deepEqual(res, { users: 2, dropped: 0 });
  assert.equal(r.get('__proto__').key, '__proto__');
  assert.equal(r.exportLive(0).users.length, 2);
});

test('ida y vuelta: exportar, pasar por JSON, importar en otro registro y volver a exportar da lo mismo', () => {
  const r = conHistoria();
  r.setAllNamesHidden(true);
  const e = r.exportLive(60);
  const r2 = make();
  r2.importLive(viaJson(e));
  const otra = r2.exportLive(0);
  // el reloj nuevo arranca en 0: los tiempos quedaron restados, el resto es idéntico
  const sinTiempos = (x) => ({
    ...x,
    clock: 0,
    users: x.users.map((u) => ({ ...u, lastSwitch: 0, firstXpAt: u.firstXpAt === null ? null : 0 })),
  });
  assert.deepEqual(sinTiempos(otra), sinTiempos(e));
  assert.equal(r2.get('a').firstXpAt.match, 12 - 60);
  assert.equal(r2.get('a').lastSwitch, 10 - 60);
  assert.deepEqual(r2.rankOf('a'), r.rankOf('a'));
  assert.deepEqual(r2.teamSizes(), r.teamSizes());
});

test('peor caso: nombres de 1 y de 200 caracteres, emoji y CJK pasan por la ida y vuelta sin romperse', () => {
  const emoji = String.fromCodePoint(0x1f600).repeat(24);
  const cjk = '田中太郎さんの動画チャンネル';
  const r = make();
  const nombres = ['k', 'x'.repeat(200), emoji, cjk, 'ａｎａ', '\u202Eoculto\u200B'];
  nombres.forEach((n, i) => {
    r.joinFromChat(chat('u' + i, '1', n), 0, 1);
    r.addCoins('u' + i, i + 1, 0);
  });
  const r2 = make();
  assert.deepEqual(r2.importLive(viaJson(r.exportLive(0))), { users: nombres.length, dropped: 0 });
  nombres.forEach((_, i) => assert.equal(r2.get('u' + i).name, r.get('u' + i).name));
  assert.ok([...r2.get('u1').name].length <= 16);
});

test('0, 1, 5000 y 20 000 usuarios; el usuario 20 001 se descarta', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => user('u' + i, { xp: { live: i, match: i } }));
  for (const [n, esperado] of [
    [0, 0],
    [1, 1],
    [5000, 5000],
    [20000, 20000],
  ]) {
    assert.deepEqual(make().importLive(copia(mk(n))), { users: esperado, dropped: 0 }, String(n));
  }
  assert.deepEqual(make().importLive(copia(mk(20001))), { users: 20000, dropped: 1 });
});

test('números enormes pero finitos pasan; el infinito de un JSON como 1e309 se descarta', () => {
  const r = make();
  const bien = user('ok', { coins: { live: 1e12, match: 0 } });
  const mal = JSON.parse(
    '{"key":"mal","name":"x","team":1,"lastSwitch":0,"coins":{"live":1e309,"match":0},"value":{"live":0,"match":0},"xp":{"live":0,"match":0},"kills":{"live":0,"match":0},"firstXpAt":null}',
  );
  assert.equal(mal.coins.live, Infinity);
  assert.deepEqual(r.importLive(copia([bien, mal])), { users: 1, dropped: 1 });
});

test('importLive vuelve a poner a un usuario que ya existía con los datos de la copia y sin duplicarlo', () => {
  const r = make();
  r.joinFromChat(chat('a', 'peru'), 0, 1);
  r.addCoins('a', 10, 0);
  r.importLive(copia([user('a', { team: 2, xp: { live: 40, match: 40 }, coins: { live: 40, match: 40 } })]));
  assert.equal(r.users().length, 1);
  assert.equal(r.get('a').team, 2);
  assert.deepEqual(r.teamSizes(), [0, 1]);
  assert.equal(r.get('a').xp.live, 40);
});

test('version(): sube con cada cambio que va en la copia y no cambia con lecturas ni con eventos sin efecto', () => {
  const r = make();
  const v = () => r.version();
  const v0 = v();
  assert.equal(v(), v0);
  r.touch(chat('a', 'x'));
  r.displayName('a');
  r.exportLive(0);
  r.users();
  r.drain();
  assert.equal(v(), v0, 'tocar o leer no cambia la copia');
  const pasos = [
    () => r.joinFromChat(chat('a', 'peru'), 0, 1),
    () => r.joinFromChat(chat('a', 'mexico'), 20, 1),
    () => r.ensureTeam(r.touch(chat('b', 'x'))),
    () => r.addCoins('a', 5, 0),
    () => r.addDestroyed('a', 5, 0),
    () => r.addKill('a'),
    () => r.hide('a'),
    () => r.setAllNamesHidden(true),
    () => r.startMatch(),
    () => r.setTeams([PE, MX]),
    () => r.resetLive(),
    () => r.importLive(copia([user('z')])),
  ];
  let ultimo = v();
  pasos.forEach((paso, i) => {
    paso();
    assert.ok(v() > ultimo, `el paso ${i} sube la versión`);
    ultimo = v();
  });
  // sin efecto: una moneda de 0, un usuario que no existe, ocultar a quien ya está oculto, repetir el mismo valor
  r.hide('a'); // resetLive y la copia anterior dejaron todo limpio: se vuelve a ocultar una vez
  r.setAllNamesHidden(true);
  const antes = v();
  r.addCoins('a', 0, 0);
  r.addCoins('nadie', 5, 0);
  r.addKill('nadie');
  r.hide('a');
  r.setAllNamesHidden(true);
  assert.equal(v(), antes);
});

test('version(): un cambio de apodo ensucia la copia solo si el nombre saneado cambia de verdad y el usuario va en la copia', () => {
  const r = make();
  // un usuario que no va en la copia (sin equipo, sin XP, sin ocultar): su apodo no ensucia nada
  r.touch({ userId: 'a', nickname: 'Ana' });
  const v0 = r.version();
  r.touch({ userId: 'a', nickname: 'Ana María' });
  r.touch({ userId: 'a', nickname: 'Otra' });
  assert.equal(r.version(), v0);
  // ya con equipo: el mismo apodo cien veces no ensucia; uno distinto sí, una vez
  r.joinFromChat(chat('a', 'peru', 'Otra'), 0, 1);
  const v1 = r.version();
  for (let i = 0; i < 100; i++) r.touch({ userId: 'a', nickname: 'Otra', text: 'hola ' + i });
  assert.equal(r.version(), v1);
  r.touch({ userId: 'a', nickname: 'Nueva' });
  assert.equal(r.version(), v1 + 1);
  assert.equal(r.get('a').name, 'Nueva');
  // el nombre "distinto" se compara ya saneado: un apodo que sanea igual no cuenta
  r.touch({ userId: 'a', nickname: '\u202ENueva\u200B' });
  assert.equal(r.version(), v1 + 1);
  // un oculto también va en la copia; uno con XP, igual
  r.touch({ userId: 'h', nickname: 'Hugo' });
  r.hide('h');
  const v2 = r.version();
  r.touch({ userId: 'h', nickname: 'Hugo Dos' });
  assert.equal(r.version(), v2 + 1);
  r.touch({ userId: 'x', nickname: 'Xia' });
  r.addCoins('x', 5, 0);
  const v3 = r.version();
  r.touch({ userId: 'x', nickname: 'Xia' });
  assert.equal(r.version(), v3);
  r.touch({ userId: 'x', nickname: 'Xiao' });
  assert.equal(r.version(), v3 + 1);
});

test('versión: dos registros con la misma historia dan la misma versión (es un contador, no un reloj)', () => {
  const hist = (r) => {
    r.joinFromChat(chat('a', 'peru'), 0, 1);
    r.addCoins('a', 5, 0);
    r.hide('a');
  };
  const a = make();
  const b = make();
  hist(a);
  hist(b);
  assert.equal(a.version(), b.version());
});

test('exportLive e importLive no escriben a disco ni imprimen la copia', async () => {
  const fs = await import('node:fs');
  const espiadas = [];
  const guardadas = [];
  for (const nombre of ['writeFileSync', 'appendFileSync', 'writeSync', 'createWriteStream']) {
    guardadas.push([fs.default, nombre, fs.default[nombre]]);
    fs.default[nombre] = (...a) => espiadas.push([nombre, a]);
  }
  const consola = [];
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map((n) => [n, console[n]]);
  for (const [n] of logs) console[n] = (...a) => consola.push([n, a]);
  try {
    const r = conHistoria();
    r.importLive(viaJson(r.exportLive(1)));
    r.importLive({ v: 1, users: [null, user('')] });
    assert.throws(() => r.importLive(null));
  } finally {
    for (const [obj, nombre, fn] of guardadas) obj[nombre] = fn;
    for (const [n, fn] of logs) console[n] = fn;
  }
  assert.deepEqual(espiadas, []);
  assert.deepEqual(consola, []);
});
