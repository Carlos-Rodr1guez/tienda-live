import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createSessionStore } from '@tienda/kit/server';
import { createRegistry } from '@tienda/kit/sim/registry.js';

// KIT-28 reglas 2 a 6 (servidor): la copia de la sesión vive en una variable del proceso. Se prueba el manejador con un
// `req` y un `res` falsos para controlar la dirección remota, el Host, el tipo y los bytes que llegan.

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
const MIN = 64 * 1024;

const user = (key, extra = {}) => ({
  key,
  name: 'N' + key,
  team: 1,
  lastSwitch: -1e9,
  coins: { live: 1, match: 1 },
  value: { live: 0, match: 0 },
  xp: { live: 1, match: 1 },
  kills: { live: 0, match: 0 },
  firstXpAt: 3,
  ...extra,
});
const copia = (users = [user('a')], extra = {}) => ({
  v: 1,
  clock: 10,
  users,
  hidden: ['h1'],
  allHidden: false,
  match: { pair: ['PE', 'MX'], started: true, roundsDone: 1, wins: [1, 0] },
  ...extra,
});

/**
 * Llama al manejador como lo haría Node: `req` es un flujo con método, encabezados y socket; `res` junta lo que se escribe.
 * @param {ReturnType<typeof createSessionStore>} store
 */
async function llamar(store, o = {}) {
  const { method = 'GET', body, extra = {}, chunks } = o;
  // `undefined` explícito vale: es "sin dirección" o "sin encabezado", no el valor por defecto
  const addr = 'addr' in o ? o.addr : '127.0.0.1';
  const host = 'host' in o ? o.host : 'localhost:3100';
  const type = 'type' in o ? o.type : body === undefined ? undefined : 'application/json';
  const headers = { ...extra };
  if (host !== undefined) headers.host = host;
  if (type !== undefined) headers['content-type'] = type;
  const flujo =
    chunks ?? (body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  const req = Object.assign(Readable.from(flujo, { objectMode: false }), {
    method,
    url: '/api/session',
    headers,
    socket: { remoteAddress: addr },
  });
  o.espiar?.(req);
  const out = { status: 0, headers: {}, body: '', ended: false, req };
  const res = {
    headersSent: false,
    writeHead(status, h = {}) {
      out.status = status;
      for (const [k, v] of Object.entries(h)) out.headers[k.toLowerCase()] = v;
      res.headersSent = true;
      return res;
    },
    setHeader(k, v) {
      out.headers[k.toLowerCase()] = v;
    },
    end(b) {
      if (b !== undefined) out.body += typeof b === 'string' ? b : Buffer.from(b).toString('utf8');
      out.ended = true;
      return res;
    },
    on() {},
  };
  await store.handle(req, res);
  assert.equal(out.ended, true, 'el manejador siempre responde');
  return out;
}
const put = (store, body, o = {}) => llamar(store, { method: 'PUT', body, ...o });
const ver = async (store) => {
  const r = await llamar(store);
  return r.status === 204 ? null : JSON.parse(r.body);
};

test('GET sin copia da 204; PUT guarda y da 204; GET da 200 con la copia; DELETE la vacía y da 204', async () => {
  const s = createSessionStore({});
  assert.equal((await llamar(s)).status, 204);
  const c = copia();
  assert.equal((await put(s, c)).status, 204);
  const r = await llamar(s);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^application\/json/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(r.body), c);
  assert.equal((await llamar(s, { method: 'DELETE' })).status, 204);
  assert.equal((await llamar(s)).status, 204);
  assert.equal(s.get(), null);
});

test('PUT reemplaza la copia entera, no la mezcla', async () => {
  const s = createSessionStore({});
  await put(s, copia([user('a'), user('b')]));
  await put(s, copia([user('c')], { hidden: [] }));
  const e = await ver(s);
  assert.deepEqual(
    e.users.map((u) => u.key),
    ['c'],
  );
  assert.deepEqual(e.hidden, []);
});

test('un servidor nuevo parte vacío: las copias no se comparten entre almacenes', async () => {
  const a = createSessionStore({});
  await put(a, copia());
  const b = createSessionStore({});
  assert.equal((await llamar(b)).status, 204);
});

test('métodos que no son GET, PUT ni DELETE dan 405 con Allow y no tocan la copia', async () => {
  const s = createSessionStore({});
  await put(s, copia());
  const antes = s.get();
  for (const method of ['POST', 'PATCH', 'OPTIONS', 'HEAD', 'TRACE']) {
    const r = await llamar(s, { method, body: copia() });
    assert.equal(r.status, 405, method);
    assert.match(r.headers.allow, /GET.*PUT.*DELETE/);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(s.get(), antes);
});

test('solo loopback: 127.0.0.1, ::1 y ::ffff:127.0.0.1 pasan; cualquier otra dirección da 403 y la copia no cambia', async () => {
  const s = createSessionStore({});
  for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal((await put(s, copia(), { addr })).status, 204, addr);
  }
  const antes = s.get();
  const malas = [
    '10.0.0.5',
    '192.168.1.20',
    '8.8.8.8',
    '::ffff:10.0.0.1',
    '::2',
    '127.0.0.2',
    '0.0.0.0',
    'localhost',
    '',
    undefined,
  ];
  for (const addr of malas) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await llamar(s, { method, body: method === 'PUT' ? copia([user('intruso')]) : undefined, addr });
      assert.equal(r.status, 403, `${method} desde ${addr}`);
      assert.equal(r.body, '', 'el 403 no filtra la copia');
    }
  }
  assert.equal(s.get(), antes);
});

test('X-Forwarded-For no se cree: ni abre una dirección externa ni cierra una local', async () => {
  const s = createSessionStore({});
  const externa = await put(s, copia(), {
    addr: '203.0.113.9',
    extra: { 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1' },
  });
  assert.equal(externa.status, 403);
  assert.equal(s.get(), null);
  const local = await put(s, copia(), { addr: '127.0.0.1', extra: { 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(local.status, 204);
});

test('Host: localhost, 127.0.0.1 y [::1], con o sin puerto y sin distinguir mayúsculas; el resto da 403 (DNS rebinding)', async () => {
  const s = createSessionStore({});
  for (const host of [
    'localhost',
    'LOCALHOST:3100',
    '127.0.0.1',
    '127.0.0.1:80',
    '[::1]',
    '[::1]:3100',
    'LocalHost:65535',
  ]) {
    assert.equal((await put(s, copia(), { host })).status, 204, host);
  }
  const antes = s.get();
  const malos = [
    'evil.com',
    'evil.com:3100',
    'localhost.evil.com',
    'localhost.evil.com:3100',
    '127.0.0.1.evil.com',
    'xlocalhost',
    'localhost:abc',
    'localhost:',
    'localhost:123456',
    '[::1',
    '::1',
    '[::2]',
    '127.0.0.2',
    '0.0.0.0',
    'localhost evil.com',
    '',
    undefined,
  ];
  for (const host of malos) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await llamar(s, { method, body: method === 'PUT' ? copia([user('intruso')]) : undefined, host });
      assert.equal(r.status, 403, `${method} con Host ${JSON.stringify(host)}`);
    }
  }
  assert.equal(s.get(), antes);
});

test('Content-Type: application/json con o sin parámetros y sin distinguir mayúsculas; otro tipo da 415 y no cambia la copia', async () => {
  const s = createSessionStore({});
  for (const type of [
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON;charset=UTF-8',
    'APPLICATION/JSON ; charset=utf-8',
  ]) {
    assert.equal((await put(s, copia(), { type })).status, 204, type);
  }
  const antes = s.get();
  for (const type of [
    'text/plain',
    'text/plain;charset=UTF-8',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/jsonp',
    'application/json-patch+json',
    'application/vnd.api+json',
    'xapplication/json',
    'application/json,text/plain',
    '',
  ]) {
    const r = await put(s, copia([user('intruso')]), { type });
    assert.equal(r.status, 415, JSON.stringify(type));
  }
  const sin = await llamar(s, { method: 'PUT', body: copia([user('intruso')]), type: undefined });
  assert.equal(sin.status, 415);
  assert.equal(s.get(), antes);
});

test('no hay encabezados CORS en ninguna respuesta', async () => {
  const s = createSessionStore({});
  const respuestas = [
    await put(s, copia()),
    await llamar(s),
    await llamar(s, { method: 'DELETE' }),
    await llamar(s, { method: 'OPTIONS' }),
    await put(s, copia(), { addr: '1.2.3.4' }),
    await put(s, copia(), { type: 'text/plain' }),
    await put(s, '{roto'),
  ];
  for (const r of respuestas) {
    assert.deepEqual(
      Object.keys(r.headers).filter((k) => k.startsWith('access-control-')),
      [],
    );
  }
});

test('JSON roto o de otra forma da 400 y la copia queda igual', async () => {
  const s = createSessionStore({});
  await put(s, copia());
  const antes = s.get();
  const malos = [
    '{roto',
    '',
    '   ',
    'null',
    '[]',
    '"texto"',
    '42',
    'true',
    '{}',
    JSON.stringify({ ...copia(), v: 2 }),
    JSON.stringify({ ...copia(), v: '1' }),
    JSON.stringify({ ...copia(), users: {} }),
    JSON.stringify({ ...copia(), users: 'x' }),
    JSON.stringify({ ...copia(), hidden: 'x' }),
    JSON.stringify({ ...copia(), clock: 'ayer' }),
    JSON.stringify({ ...copia(), clock: -1 }),
    JSON.stringify({ ...copia(), allHidden: 'si' }),
    JSON.stringify({ ...copia(), allHidden: 1 }),
    JSON.stringify({ v: 1, clock: 0, users: [], hidden: [] }),
    JSON.stringify(copia([null])),
    JSON.stringify(copia(['x'])),
    JSON.stringify(copia([[]])),
    JSON.stringify(copia([user(5)])),
    JSON.stringify(copia([user('')])),
    JSON.stringify(copia([user('a', { name: 5 })])),
    JSON.stringify(copia([user('a', { xp: undefined })])),
    JSON.stringify(copia([user('a', { xp: { live: 1 } })])),
    JSON.stringify(copia([user('a', { coins: { live: '1', match: 1 } })])),
    JSON.stringify(copia([user('a', { lastSwitch: 'x' })])),
    JSON.stringify(copia([user('a', { firstXpAt: 'x' })])),
    JSON.stringify(copia([user('a', { team: 'uno' })])),
    JSON.stringify(copia([user('a', { team: 0 })])),
    JSON.stringify(copia([user('a', { team: 65 })])),
    JSON.stringify(copia([user('a', { team: 1.5 })])),
    JSON.stringify(copia([user('a'), { ...user('b'), kills: null }])),
    JSON.stringify(copia([user('a')], { hidden: [5] })),
    JSON.stringify(copia([user('a')], { hidden: [''] })),
    JSON.stringify(copia([user('a')], { match: 'x' })),
    JSON.stringify(copia([user('a')], { match: [] })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE'], started: true, roundsDone: 0, wins: [0, 0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 7], started: true, roundsDone: 0, wins: [0, 0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 'MX'], started: 'si', roundsDone: 0, wins: [0, 0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 'MX'], started: true, roundsDone: -1, wins: [0, 0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 'MX'], started: true, roundsDone: 100, wins: [0, 0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 'MX'], started: true, roundsDone: 1.5, wins: [0, 0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 'MX'], started: true, roundsDone: 0, wins: [0] } })),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', 'MX'], started: true, roundsDone: 0, wins: [0, -1] } })),
    JSON.stringify(
      copia([user('a')], { match: { pair: ['PE', 'x'.repeat(65)], started: true, roundsDone: 0, wins: [0, 0] } }),
    ),
    JSON.stringify(copia([user('a')], { match: { pair: ['PE', ''], started: true, roundsDone: 0, wins: [0, 0] } })),
  ];
  for (const body of malos) {
    const r = await put(s, body);
    assert.equal(r.status, 400, body.slice(0, 120));
  }
  assert.equal(s.get(), antes);
});

test('números fuera de rango: negativos, enormes y no finitos (1e309 llega como Infinity) dan 400', async () => {
  const s = createSessionStore({});
  const base = JSON.stringify(copia([user('a')]));
  const casos = [
    base.replace('"coins":{"live":1', '"coins":{"live":1e309'),
    base.replace('"coins":{"live":1', '"coins":{"live":-1'),
    base.replace('"coins":{"live":1', '"coins":{"live":1e13'),
    base.replace('"xp":{"live":1', '"xp":{"live":1e300'),
    base.replace('"lastSwitch":-1000000000', '"lastSwitch":-1e309'),
    base.replace('"lastSwitch":-1000000000', '"lastSwitch":1e13'),
    base.replace('"firstXpAt":3', '"firstXpAt":1e309'),
    base.replace('"clock":10', '"clock":1e309'),
  ];
  for (const c of casos) {
    assert.notEqual(c, base);
    assert.equal((await put(s, c)).status, 400, c.slice(0, 160));
  }
  assert.equal(s.get(), null);
});

test('límites de largo: clave de 512 pasa y de 513 no; nombre de 512 pasa y de 513 no; 20 000 usuarios pasan y 20 001 no', async () => {
  const s = createSessionStore({ maxBytes: 4 * 1024 * 1024 });
  assert.equal((await put(s, copia([user('k'.repeat(512), { name: 'n' })]))).status, 204);
  assert.equal((await put(s, copia([user('k'.repeat(513), { name: 'n' })]))).status, 400);
  assert.equal((await put(s, copia([user('a', { name: 'n'.repeat(512) })]))).status, 204);
  assert.equal((await put(s, copia([user('a', { name: 'n'.repeat(513) })]))).status, 400);
  assert.equal((await put(s, copia([user('a')], { hidden: ['h'.repeat(512)] }))).status, 204);
  assert.equal((await put(s, copia([user('a')], { hidden: ['h'.repeat(513)] }))).status, 400);
  const mk = (n) => Array.from({ length: n }, (_, i) => user('u' + i));
  assert.equal((await put(s, copia(mk(20000), { hidden: [] }))).status, 204);
  const guardada = s.get();
  assert.equal((await put(s, copia(mk(20001), { hidden: [] }))).status, 400);
  assert.equal(s.get(), guardada);
  const ocultos = Array.from({ length: 20001 }, (_, i) => 'h' + i);
  assert.equal((await put(s, copia([user('a')], { hidden: ocultos }))).status, 400);
});

test('0 y 1 usuario, sin ocultos y sin partido son copias válidas', async () => {
  const s = createSessionStore({});
  assert.equal((await put(s, copia([], { hidden: [], match: null }))).status, 204);
  assert.equal((await put(s, copia([user('solo')], { hidden: [], match: null }))).status, 204);
  const sinMatch = { ...copia(), match: undefined };
  assert.equal((await put(s, JSON.stringify(sinMatch))).status, 204);
  assert.equal((await ver(s)).match, null);
});

test('el equipo puede ser null y 1..64', async () => {
  const s = createSessionStore({});
  for (const team of [null, 1, 2, 64]) {
    assert.equal((await put(s, copia([user('a', { team })]))).status, 204, String(team));
  }
});

test('se descartan los campos desconocidos y la copia guardada solo tiene los campos conocidos', async () => {
  const s = createSessionStore({});
  const sucia = copia(
    [{ ...user('a'), evil: 1, avatar: 'http://x', text: 'hola', xp: { live: 1, match: 1, otro: 9 } }],
    {
      extra: 1,
      avatars: ['x'],
      match: { pair: ['PE', 'MX'], started: true, roundsDone: 1, wins: [1, 0], campo: 'x' },
    },
  );
  assert.equal((await put(s, sucia)).status, 204);
  assert.deepEqual(await ver(s), copia([user('a')]));
});

test('claves repetidas: queda la primera, en los usuarios y en los ocultos', async () => {
  const s = createSessionStore({});
  const c = copia([user('a', { name: 'Primero' }), user('b'), user('a', { name: 'Segundo' })], {
    hidden: ['h', 'x', 'h'],
  });
  assert.equal((await put(s, c)).status, 204);
  const e = await ver(s);
  assert.deepEqual(
    e.users.map((u) => [u.key, u.name]),
    [
      ['a', 'Primero'],
      ['b', 'Nb'],
    ],
  );
  assert.deepEqual(e.hidden, ['h', 'x']);
});

test('__proto__, constructor y prototype en el JSON no contaminan nada ni quedan guardados', async () => {
  const s = createSessionStore({});
  const texto = `{"v":1,"clock":0,"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"prototype":{"polluted":3},
    "hidden":["__proto__","constructor"],"allHidden":false,"match":{"pair":["PE","MX"],"started":true,"roundsDone":0,"wins":[0,0],"__proto__":{"polluted":4}},
    "users":[{"key":"__proto__","name":"P","team":1,"lastSwitch":-1000000000,"__proto__":{"polluted":5},"constructor":{"polluted":6},
    "coins":{"live":1,"match":1,"__proto__":{"polluted":7}},"value":{"live":0,"match":0},"xp":{"live":1,"match":1},
    "kills":{"live":0,"match":0},"firstXpAt":null}]}`;
  assert.equal((await put(s, texto)).status, 204);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const guardada = s.get();
  assert.doesNotMatch(guardada, /polluted|prototype/);
  assert.deepEqual(JSON.parse(guardada).hidden, ['__proto__', 'constructor']);
  assert.equal(JSON.parse(guardada).users[0].key, '__proto__');
});

test('maxBytes: 1 MB por defecto y recortado a [64 KB, 4 MB]', () => {
  assert.equal(createSessionStore({}).maxBytes, 1024 * 1024);
  assert.equal(createSessionStore().maxBytes, 1024 * 1024);
  assert.equal(createSessionStore({ maxBytes: 10 }).maxBytes, MIN);
  assert.equal(createSessionStore({ maxBytes: 0 }).maxBytes, MIN);
  assert.equal(createSessionStore({ maxBytes: -5 }).maxBytes, MIN);
  assert.equal(createSessionStore({ maxBytes: 1e12 }).maxBytes, 4 * 1024 * 1024);
  assert.equal(createSessionStore({ maxBytes: Infinity }).maxBytes, 1024 * 1024);
  assert.equal(createSessionStore({ maxBytes: NaN }).maxBytes, 1024 * 1024);
  assert.equal(createSessionStore({ maxBytes: '70000' }).maxBytes, 1024 * 1024);
  assert.equal(createSessionStore({ maxBytes: 100000 }).maxBytes, 100000);
  assert.equal(createSessionStore({ maxBytes: 100000.9 }).maxBytes, 100000);
});

/** Rellena la copia con espacios hasta que el cuerpo mida exactamente `bytes` bytes UTF-8. */
function cuerpoDe(bytes, users) {
  const base = JSON.stringify(copia(users));
  const falta = bytes - Buffer.byteLength(base);
  assert.ok(falta >= 0, 'la base cabe');
  return base + ' '.repeat(falta);
}

test('413: se miden bytes y no caracteres (emoji de 4 bytes y CJK de 3), y el límite exacto pasa', async () => {
  const s = createSessionStore({ maxBytes: MIN });
  const nombres = [String.fromCodePoint(0x1f600).repeat(16), '田中太郎さんの動画チャンネル', 'k'];
  const users = nombres.map((name, i) => user('u' + i, { name }));
  // el cuerpo exacto de MIN bytes pasa; uno más no
  const justo = cuerpoDe(MIN, users);
  assert.equal(Buffer.byteLength(justo), MIN);
  assert.equal((await put(s, justo)).status, 204);
  const guardada = s.get();
  assert.equal((await put(s, justo + ' ')).status, 413);
  assert.equal(s.get(), guardada);
  // 20 000 emoji = 40 000 unidades UTF-16 (menos que MIN) pero 80 000 bytes (más que MIN)
  const emoji = String.fromCodePoint(0x1f600).repeat(20000);
  assert.ok(emoji.length < MIN && Buffer.byteLength(emoji) > MIN);
  assert.equal((await put(s, `{"v":1,"basura":"${emoji}"}`)).status, 413);
  const cjk = '語'.repeat(30000);
  assert.ok(cjk.length < MIN && Buffer.byteLength(cjk) > MIN);
  assert.equal((await put(s, `{"v":1,"basura":"${cjk}"}`)).status, 413);
  assert.equal(s.get(), guardada);
});

test('413 por Content-Length: se responde sin leer el cuerpo', async () => {
  const s = createSessionStore({ maxBytes: MIN });
  await put(s, copia());
  const antes = s.get();
  const r = await put(s, copia(), { extra: { 'content-length': String(MIN + 1) } });
  assert.equal(r.status, 413);
  assert.equal(s.get(), antes);
  // un Content-Length chico que miente igual se corta por los bytes que llegan de verdad
  const gigante = Buffer.alloc(MIN + 10, 0x20);
  const m = await put(s, gigante.toString(), { extra: { 'content-length': '10' } });
  assert.equal(m.status, 413);
  assert.equal(s.get(), antes);
});

test('413: el servidor deja de leer al pasar el límite y no acumula el resto', async () => {
  const s = createSessionStore({ maxBytes: MIN });
  await put(s, copia());
  const antes = s.get();
  let producidos = 0;
  const KB = Buffer.alloc(1024, 0x20);
  function* infinito() {
    while (producidos < 200000) {
      producidos++;
      yield KB;
    }
  }
  // C6: se cuentan los bytes que el manejador realmente consumió (eventos 'data' entregados), no solo el estado final
  let consumidos = 0;
  const espiar = (req) => {
    const emit = req.emit;
    req.emit = function (ev, ...a) {
      if (ev === 'data') consumidos += a[0].length;
      return emit.call(this, ev, ...a);
    };
  };
  const r = await llamar(s, { method: 'PUT', type: 'application/json', chunks: infinito(), espiar });
  assert.equal(r.status, 413);
  assert.equal(s.get(), antes);
  // consumió hasta pasar el límite (el último trozo de 1 KB lo pasa) y ni un byte más
  assert.ok(consumidos > MIN && consumidos <= MIN + 1024, `consumió ${consumidos} bytes`);
  // y dejó de leer: pausado y sin oyentes de datos (un flujo sin oyente pero sin pausa seguiría corriendo)
  assert.equal(r.req.isPaused(), true);
  assert.equal(r.req.listenerCount('data'), 0);
  // el flujo solo se vacía hasta llenar su búfer: unos pocos KB más allá del límite, no los 200 000
  assert.ok(producidos < 64 + 100, `se leyeron ${producidos} KB`);
});

test('el almacén sigue respondiendo después de un 413, un 400, un 415 y un 403', async () => {
  const s = createSessionStore({ maxBytes: MIN });
  await put(s, copia());
  const antes = s.get();
  await put(s, 'x'.repeat(MIN + 1));
  await put(s, '{roto');
  await put(s, copia(), { type: 'text/plain' });
  await put(s, copia(), { addr: '9.9.9.9' });
  assert.equal(s.get(), antes);
  assert.equal((await llamar(s)).status, 200);
  assert.equal((await put(s, copia([user('nuevo')]))).status, 204);
  assert.deepEqual((await ver(s)).users[0].key, 'nuevo');
});

test('lo que exporta el registro (peor caso: emoji, CJK, 200 caracteres) siempre pasa la validación del servidor', async () => {
  const emoji = String.fromCodePoint(0x1f600).repeat(24);
  const r = createRegistry({ teams: [PE, MX] });
  const nombres = ['k', 'x'.repeat(200), emoji, '田中太郎さんの動画チャンネル', '\u202EAna\u200B_23', 'ａｂｃ'];
  nombres.forEach((nickname, i) => {
    r.joinFromChat({ userId: 'u' + i, nickname, text: String((i % 2) + 1) }, i, 1);
    r.addCoins('u' + i, 10 + i, i);
  });
  r.hide('u1');
  r.hide('desconocido');
  r.setAllNamesHidden(true);
  const e = r.exportLive(33);
  e.match = { pair: ['PE', 'MX'], started: false, roundsDone: 0, wins: [0, 0] };
  const s = createSessionStore({});
  assert.equal((await put(s, e)).status, 204);
  assert.deepEqual(await ver(s), e);
});

test('nada a disco ni a la consola: guardar, reemplazar, leer y vaciar no escriben', async () => {
  const espiadas = [];
  const guardadas = [];
  for (const nombre of [
    'writeFile',
    'writeFileSync',
    'appendFile',
    'appendFileSync',
    'write',
    'writeSync',
    'createWriteStream',
  ]) {
    guardadas.push([fs, nombre, fs[nombre]]);
    fs[nombre] = (...a) => espiadas.push([nombre, a]);
  }
  for (const nombre of ['writeFile', 'appendFile']) {
    guardadas.push([fs.promises, nombre, fs.promises[nombre]]);
    fs.promises[nombre] = async (...a) => espiadas.push([`promises.${nombre}`, a]);
  }
  const consola = [];
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map((n) => [n, console[n]]);
  for (const [n] of logs) console[n] = (...a) => consola.push([n, a]);
  try {
    const s = createSessionStore({ maxBytes: MIN });
    await put(s, copia());
    await put(s, copia([user('b')]));
    await llamar(s);
    await put(s, '{roto');
    await put(s, 'x'.repeat(MIN + 1));
    await put(s, copia(), { type: 'text/plain' });
    await put(s, copia(), { addr: '8.8.8.8' });
    await llamar(s, { method: 'DELETE' });
    await llamar(s);
  } finally {
    for (const [obj, nombre, fn] of guardadas) obj[nombre] = fn;
    for (const [n, fn] of logs) console[n] = fn;
  }
  assert.deepEqual(espiadas, []);
  assert.deepEqual(consola, []);
});

test('el código del almacén no importa fs ni usa console, Date.now, Math.random ni X-Forwarded-For', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/server/session.js', import.meta.url)), 'utf8');
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(sinComentarios, /node:fs|from ['"]fs|require\(|\bconsole\b|Date\.now|Math\.random/);
  assert.doesNotMatch(sinComentarios, /x-forwarded|forwarded-for/i);
  assert.doesNotMatch(sinComentarios, /Object\.assign|\.\.\.\s*(data|body|raw|copy|parsed|input)\b|__proto__\s*=/);
});
