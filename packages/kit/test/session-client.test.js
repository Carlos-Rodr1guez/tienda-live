import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClient, fitCopy } from '@tienda/kit/client/session.js';

// KIT-28 reglas 1 y 4 (cliente): marca sucia, 1 PUT por segundo con el reloj de vista inyectado, `pagehide` con
// keepalive, corte por `maxBytes` en BYTES y carga con tope de tiempo. Todo con `fetch` y reloj falsos.

const KB = 1024;
const bytes = (s) => Buffer.byteLength(s);
const user = (key, xp = 1, extra = {}) => ({
  key,
  name: 'N' + key,
  team: 1,
  lastSwitch: -1e9,
  coins: { live: xp, match: xp },
  value: { live: 0, match: 0 },
  xp: { live: xp, match: xp },
  kills: { live: 0, match: 0 },
  firstXpAt: null,
  ...extra,
});
const copia = (users = [user('a')], extra = {}) => ({
  v: 1,
  clock: 12.5,
  users,
  hidden: [],
  allHidden: false,
  match: null,
  ...extra,
});

/** `fetch` falso: guarda las llamadas y contesta lo que diga `responder(url, init)`. */
function fakeFetch(responder = () => ({ status: 204 })) {
  const llamadas = [];
  const fn = async (url, init = {}) => {
    llamadas.push({ url, init });
    const r = await responder(url, init, llamadas.length);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json() };
  };
  fn.llamadas = llamadas;
  return fn;
}
const respuesta = (status, cuerpo) => ({
  status,
  json: () => {
    if (cuerpo instanceof Error) throw cuerpo;
    return cuerpo;
  },
});
/** Temporizadores a mano. */
function reloj() {
  const pendientes = new Map();
  let id = 0;
  return {
    setTimeout: (fn, ms) => {
      pendientes.set(++id, { fn, ms });
      return id;
    },
    clearTimeout: (i) => pendientes.delete(i),
    pendientes,
    disparar() {
      for (const [i, t] of [...pendientes]) {
        pendientes.delete(i);
        t.fn();
      }
    },
  };
}
function crear(opts = {}) {
  const f = opts.fetch ?? fakeFetch();
  const oyentes = new Map();
  const t = opts.timers ?? reloj();
  const c = createSessionClient({
    fetch: f,
    snapshot: opts.snapshot ?? (() => copia()),
    addEventListener: (type, fn) => oyentes.set(type, fn),
    setTimeout: t.setTimeout,
    clearTimeout: t.clearTimeout,
    ...(opts.maxBytes ? { maxBytes: opts.maxBytes } : {}),
    ...(opts.clockMs ? { clockMs: opts.clockMs } : {}),
  });
  return { c, f, t, oyentes };
}
/**
 * Un cliente que ya cargó (con 204) y está listo para enviar. Si la prueba trae su propio `fetch`, el GET de la carga
 * se contesta aparte y ese `fetch` solo ve lo que se envía después.
 */
async function listo(opts = {}) {
  const propio = opts.fetch;
  const cargar = fakeFetch(() => ({ status: 204 }));
  const x = crear(
    propio ? { ...opts, fetch: (url, init) => (init?.method ? propio(url, init) : cargar(url, init)) } : opts,
  );
  assert.equal((await x.c.load()).status, 'empty');
  if (propio) x.f = propio;
  else x.f.llamadas.length = 0;
  return x;
}
/** Cuántos usuarios con nombre `nombre` hacen falta para que la copia pase de `limite` bytes (sin pasar de él en caracteres). */
function usuariosHasta(limite, nombre) {
  let n = 10;
  const hacer = (k) => Array.from({ length: k }, (_, i) => user('k' + i, k - i, { name: nombre(i) }));
  while (bytes(JSON.stringify(copia(hacer(n)))) <= limite) n++;
  return hacer(n);
}

// ---------------------------------------------------------------------------------------------------------------
// fitCopy: el corte por maxBytes

test('fitCopy: una copia que cabe sale entera y en el mismo orden', () => {
  const c = copia([user('a', 5), user('b', 9), user('c', 1)], { hidden: ['h1', 'h2'] });
  const r = fitCopy(c, 1024 * KB);
  assert.equal(r.dropped, 0);
  assert.equal(r.droppedHidden, 0);
  assert.deepEqual(JSON.parse(r.body).hidden, ['h1', 'h2']);
  assert.deepEqual(
    JSON.parse(r.body)
      .users.map((u) => u.key)
      .sort(),
    ['a', 'b', 'c'],
  );
  assert.equal(r.bytes, bytes(r.body));
  assert.equal(JSON.parse(r.body).v, 1);
  assert.equal(JSON.parse(r.body).clock, 12.5);
});

test('fitCopy: 5000 usuarios, 12 ocultos y el flag pasan maxBytes: van todos los ocultos y el flag, y luego los de más XP', () => {
  const users = Array.from({ length: 5000 }, (_, i) => user('u' + String(i).padStart(5, '0'), (i * 7919) % 5000));
  const hidden = Array.from({ length: 12 }, (_, i) => 'oculto-' + i);
  const full = copia(users, {
    hidden,
    allHidden: true,
    match: { pair: ['PE', 'MX'], started: true, roundsDone: 1, wins: [1, 0] },
  });
  const max = 200 * KB;
  assert.ok(bytes(JSON.stringify(full)) > max, 'la copia entera pasa el tope');
  const r = fitCopy(full, max);
  const sale = JSON.parse(r.body);
  assert.deepEqual(sale.hidden, hidden);
  assert.equal(sale.allHidden, true);
  assert.deepEqual(sale.match, full.match);
  assert.ok(r.bytes <= max);
  assert.equal(r.bytes, bytes(r.body));
  assert.equal(sale.users.length + r.dropped, 5000);
  assert.ok(r.dropped > 0 && sale.users.length > 0);
  // los que quedan son los de más XP, de mayor a menor, con la clave de desempate
  const xps = sale.users.map((u) => u.xp.live);
  assert.deepEqual(
    xps,
    [...xps].sort((a, b) => b - a),
  );
  const minimoQueda = Math.min(...xps);
  const maximoAfuera = Math.max(...users.filter((u) => !sale.users.some((s) => s.key === u.key)).map((u) => u.xp.live));
  assert.ok(maximoAfuera <= minimoQueda, 'ningún usuario de más XP quedó afuera');
  // es un prefijo maximal: el siguiente ya no cabía
  const siguiente = users
    .filter((u) => !sale.users.some((s) => s.key === u.key))
    .sort((a, b) => b.xp.live - a.xp.live || (a.key < b.key ? -1 : 1))[0];
  assert.ok(r.bytes + bytes(JSON.stringify(siguiente)) + 1 > max);
});

test('fitCopy: con el límite exacto entra todo; con un byte menos se corta el último (ocultos y usuarios)', () => {
  const users = [user('a', 9), user('b', 5), user('c', 1)];
  const full = copia(users, { hidden: ['h1', 'h2'] });
  const exacto = bytes(JSON.stringify(full));
  const justo = fitCopy(full, exacto);
  assert.equal(justo.dropped, 0);
  assert.equal(justo.droppedHidden, 0);
  assert.equal(justo.bytes, exacto);
  // un byte menos: lo último que cabía en la cuenta (el usuario de menos XP) queda afuera
  const menos = fitCopy(full, exacto - 1);
  assert.equal(menos.dropped, 1);
  assert.equal(menos.droppedHidden, 0);
  assert.deepEqual(
    JSON.parse(menos.body).users.map((u) => u.key),
    ['a', 'b'],
  );
  // lo mismo con los ocultos: sin usuarios, la lista de ocultos define el exacto
  const soloOcultos = copia([], { hidden: ['h1', 'h2', 'h3'] });
  const e2 = bytes(JSON.stringify(soloOcultos));
  assert.equal(fitCopy(soloOcultos, e2).droppedHidden, 0);
  const m2 = fitCopy(soloOcultos, e2 - 1);
  assert.equal(m2.droppedHidden, 1);
  assert.deepEqual(JSON.parse(m2.body).hidden, ['h1', 'h2']);
});

test('fitCopy: se miden bytes UTF-8, no caracteres (emoji de 4 bytes y CJK de 3)', () => {
  const emoji = String.fromCodePoint(0x1f600).repeat(16);
  const cjk = '田中太郎さんの動画チャンネル';
  const max = 64 * KB;
  const users = usuariosHasta(max, (i) => (i % 2 ? emoji : cjk));
  const full = copia(users);
  const texto = JSON.stringify(full);
  // con "length" la copia entera cabría; en bytes no
  assert.ok(texto.length <= max, `length ${texto.length}`);
  assert.ok(bytes(texto) > max, `bytes ${bytes(texto)}`);
  const r = fitCopy(full, max);
  assert.ok(r.dropped > 0);
  assert.ok(bytes(r.body) <= max, `${bytes(r.body)} bytes`);
  assert.equal(r.bytes, bytes(r.body));
});

test('fitCopy: el desempate por XP es la clave y no depende del orden de entrada', () => {
  const users = Array.from({ length: 60 }, (_, i) => user('c' + String(i).padStart(3, '0'), 10));
  const barajado = [...users].reverse().sort((a, b) => (a.key.charCodeAt(2) % 3) - (b.key.charCodeAt(2) % 3));
  const max = 8 * KB;
  const a = fitCopy(copia(users), max);
  const b = fitCopy(copia(barajado), max);
  assert.ok(a.dropped > 0);
  assert.deepEqual(
    JSON.parse(a.body).users.map((u) => u.key),
    JSON.parse(b.body).users.map((u) => u.key),
  );
  assert.deepEqual(
    JSON.parse(a.body).users.map((u) => u.key),
    users.slice(0, JSON.parse(a.body).users.length).map((u) => u.key),
  );
});

test('fitCopy: los ocultos van primero aunque quepan pocos usuarios; si ni ellos caben, se cortan los últimos y se cuentan', () => {
  const hidden = Array.from({ length: 12 }, (_, i) => 'oculto-' + i);
  const r = fitCopy(copia([user('a', 99)], { hidden }), 600);
  const e = JSON.parse(r.body);
  assert.deepEqual(e.hidden, hidden);
  assert.equal(e.users.length + r.dropped, 1);

  const muchos = Array.from({ length: 3000 }, (_, i) => 'oculto-con-nombre-largo-' + i);
  const max = 64 * KB;
  const q = fitCopy(copia([user('a', 99)], { hidden: muchos, allHidden: true }), max);
  const f = JSON.parse(q.body);
  assert.deepEqual(f.hidden, muchos.slice(0, f.hidden.length));
  assert.equal(f.hidden.length + q.droppedHidden, 3000);
  assert.ok(q.droppedHidden > 0);
  assert.equal(f.users.length, 0);
  assert.equal(q.dropped, 1);
  assert.equal(f.allHidden, true);
  assert.ok(q.bytes <= max);
});

test('fitCopy: 0 y 1 usuario, y el tope de 20 000 usuarios', () => {
  assert.equal(fitCopy(copia([]), 1024 * KB).dropped, 0);
  assert.equal(fitCopy(copia([user('solo')]), 1024 * KB).dropped, 0);
  const mini = (i) => ({
    key: 'u' + i,
    name: 'n',
    team: null,
    lastSwitch: 0,
    coins: { live: 0, match: 0 },
    value: { live: 0, match: 0 },
    xp: { live: 1, match: 1 },
    kills: { live: 0, match: 0 },
    firstXpAt: null,
  });
  const r = fitCopy(copia(Array.from({ length: 20001 }, (_, i) => mini(i))), 4 * 1024 * KB);
  assert.equal(r.dropped, 1);
  assert.equal(JSON.parse(r.body).users.length, 20000);
});

test('fitCopy: no re-serializa toda la copia por cada usuario (lineal, no cuadrático)', () => {
  const users = Array.from({ length: 5000 }, (_, i) => user('u' + i, i));
  const hidden = ['h1', 'h2'];
  const full = copia(users, { hidden });
  let llamadas = 0;
  const original = JSON.stringify;
  mock.method(JSON, 'stringify', (...a) => {
    llamadas++;
    return original(...a);
  });
  let r;
  try {
    r = fitCopy(full, 100 * KB);
  } finally {
    mock.restoreAll();
  }
  assert.ok(r.dropped > 0);
  // C3: la cuenta de bytes no serializa a cada usuario: queda el esqueleto y el resultado final
  assert.ok(llamadas <= 4, `${llamadas} llamadas a JSON.stringify`);
});

test('C3: un solo TextEncoder.encode (el del resultado final), sin importar cuántos usuarios', () => {
  const users = Array.from({ length: 5000 }, (_, i) => user('u' + i, i));
  let codificaciones = 0;
  const original = TextEncoder.prototype.encode;
  mock.method(TextEncoder.prototype, 'encode', function (...a) {
    codificaciones++;
    return original.apply(this, a);
  });
  try {
    fitCopy(copia(users, { hidden: ['h1', 'h2'] }), 100 * KB); // se corta
    const cortado = codificaciones;
    codificaciones = 0;
    fitCopy(copia(users.slice(0, 50)), 1024 * KB); // entra entera
    assert.ok(cortado <= 3, `${cortado} codificaciones al cortar`);
    assert.ok(codificaciones <= 3, `${codificaciones} codificaciones al entrar entera`);
  } finally {
    mock.restoreAll();
  }
});

test('C3: si la copia entera entra en maxBytes no se ordena nada (mismo orden de entrada); si no entra, se ordena por XP', () => {
  const users = [user('b', 1), user('a', 9), user('c', 5)];
  const entra = fitCopy(copia(users), 1024 * KB);
  assert.deepEqual(
    JSON.parse(entra.body).users.map((u) => u.key),
    ['b', 'a', 'c'],
  );
  const exacto = bytes(JSON.stringify(copia(users)));
  const corta = fitCopy(copia(users), exacto - 1);
  assert.deepEqual(
    JSON.parse(corta.body).users.map((u) => u.key),
    ['a', 'c'],
  );
});

test('C3: con 20 000 usuarios tarda poco y el resultado coincide byte a byte con serializar a mano', () => {
  const users = Array.from({ length: 20000 }, (_, i) =>
    user('u' + i, i % 977, { name: i % 3 ? 'Ana ' + i : '田中' + i }),
  );
  const t0 = performance.now();
  const r = fitCopy(copia(users), 1024 * KB);
  assert.ok(performance.now() - t0 < 1500);
  assert.equal(r.bytes, bytes(r.body));
  assert.ok(r.bytes <= 1024 * KB);
  assert.equal(r.dropped, 20000 - JSON.parse(r.body).users.length);
});

test('C1: la página filtra antes de enviar: un usuario que el validador rechaza no viaja y cuenta como fuera de la copia', () => {
  const malo = user('malo', 5, { name: 'n'.repeat(513) });
  const peor = user('peor', 5, { team: 'uno' });
  const full = copia([user('a', 9), malo, user('b', 3), peor, 'texto', null], {
    hidden: ['h', '', 'x'.repeat(513), 5],
  });
  const r = fitCopy(full, 1024 * KB);
  const sale = JSON.parse(r.body);
  assert.deepEqual(
    sale.users.map((u) => u.key),
    ['a', 'b'],
  );
  assert.deepEqual(sale.hidden, ['h']);
  assert.equal(r.dropped, 4);
  assert.equal(r.droppedHidden, 3);
  assert.equal(r.bytes, bytes(r.body));
});

test('C3: los usuarios que viajan salen copiados en orden canónico y sin campos de más, y el conteo coincide con el cuerpo', () => {
  const sucios = Array.from({ length: 50 }, (_, i) => ({
    ...user('u' + i, i),
    avatar: 'http://x/' + 'a'.repeat(200),
    xp: { live: i, match: i, extra: 'z'.repeat(100) },
  }));
  for (const max of [1024 * KB, 6 * KB]) {
    const r = fitCopy(copia(sucios), max);
    const sale = JSON.parse(r.body);
    assert.ok(sale.users.length > 0);
    for (const u of sale.users) {
      assert.deepEqual(Object.keys(u), [
        'key',
        'name',
        'team',
        'lastSwitch',
        'coins',
        'value',
        'xp',
        'kills',
        'firstXpAt',
      ]);
      assert.deepEqual(Object.keys(u.xp), ['live', 'match']);
    }
    assert.equal(r.bytes, bytes(r.body));
    assert.ok(r.bytes <= max);
  }
  // sin la red de seguridad: lo que se cuenta a mano alcanza (el prefijo cabe sin recortes de última hora)
  const r = fitCopy(copia(sucios), 6 * KB);
  const prefijo = fitCopy(copia(JSON.parse(r.body).users), 6 * KB);
  assert.equal(prefijo.dropped, 0);
});

test('C1: el filtro se suma al corte por maxBytes en la cuenta de afuera', () => {
  const users = [...Array.from({ length: 200 }, (_, i) => user('u' + i, 200 - i)), user('malo', 1, { xp: undefined })];
  const r = fitCopy(copia(users), 8 * KB);
  const queda = JSON.parse(r.body).users.length;
  assert.equal(queda + r.dropped, 201);
  assert.ok(!JSON.parse(r.body).users.some((u) => u.key === 'malo'));
});

test('fitCopy no cambia la copia recibida', () => {
  const full = copia(
    Array.from({ length: 300 }, (_, i) => user('u' + i, i)),
    { hidden: ['h'] },
  );
  const antes = JSON.stringify(full);
  fitCopy(full, 8 * KB);
  assert.equal(JSON.stringify(full), antes);
});

// ---------------------------------------------------------------------------------------------------------------
// carga

test('load: GET a /api/session antes de todo; 200 con la copia, 204 vacía', async () => {
  const f = fakeFetch(() => respuesta(200, copia()));
  const { c } = crear({ fetch: f });
  const r = await c.load();
  assert.equal(r.status, 'restored');
  assert.deepEqual(r.copy, copia());
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].url, '/api/session');
  assert.equal(f.llamadas[0].init.method ?? 'GET', 'GET');
  assert.equal(f.llamadas[0].init.body, undefined);
  assert.equal((await crear({ fetch: fakeFetch(() => ({ status: 204 })) }).c.load()).status, 'empty');
});

test('load: 404 y 403 (y 405) dejan la sesión apagada y el cliente deja de enviar', async () => {
  for (const status of [404, 403, 405]) {
    const f = fakeFetch(() => ({ status }));
    const { c } = crear({ fetch: f });
    assert.equal((await c.load()).status, 'off', String(status));
    assert.equal(c.state.stopped, true);
    c.markDirty();
    assert.equal(c.tick(100), null);
    await c.clear();
    c.flush();
    assert.equal(f.llamadas.length, 1, 'solo el GET');
  }
});

test('load: error de red, 500 y respuesta sin estado dejan el juego vacío (failed) y NO se envía nada (C2: no pisar la copia buena)', async () => {
  for (const r of [new Error('red caída'), { status: 500 }, { status: 0 }, { status: 502 }, { status: 418 }]) {
    const f = fakeFetch(() => r);
    const { c } = crear({ fetch: f });
    assert.equal((await c.load()).status, 'failed');
    assert.equal(c.state.stopped, false);
    assert.equal(c.state.gate, 'pending');
    f.llamadas.length = 0;
    c.markDirty();
    for (const t of [0, 0.2, 0.9]) assert.equal(c.tick(t), null, `sin reintento antes del primer segundo (${t})`);
    c.flush();
    assert.equal(f.llamadas.length, 0, 'ni PUT ni nada');
  }
});

/** Un cliente cuyo GET responde según `respuestas.shift()` (y 500 cuando se acaban) y que registra los métodos. */
function conCarga(respuestas, extra = {}) {
  const cola = [...respuestas];
  const f = fakeFetch((_url, init) => {
    if (init.method) return extra.otros ? extra.otros(init) : { status: 204 };
    return cola.length ? cola.shift() : { status: 500 };
  });
  return crear({ fetch: f, ...extra.opts });
}
const metodos = (f) => f.llamadas.map((l) => l.init.method ?? 'GET').join(' ');

test('C2: tras un GET fallido se reintenta a 1, 2, 4 y 8 s y después cada 10 s, con el reloj de vista, y nunca hay PUT', async () => {
  const { c, f } = conCarga([{ status: 500 }]);
  assert.equal((await c.load()).status, 'failed');
  c.markDirty();
  const gets = () => f.llamadas.filter((l) => !l.init.method).length;
  assert.equal(gets(), 1);
  // la espera se arma con el primer tick, desde ese momento
  const pasos = [
    [0, 1],
    [0.99, 1],
    [1, 2],
    [2.9, 2],
    [3, 3],
    [6.99, 3],
    [7, 4],
    [14.9, 4],
    [15, 5],
    [24.9, 5],
    [25, 6],
    [34.9, 6],
    [35, 7],
    [45, 8],
  ];
  for (const [t, esperados] of pasos) {
    const p = c.tick(t);
    if (p) await p;
    assert.equal(gets(), esperados, `a los ${t} s`);
    assert.equal(c.state.gate, 'pending');
  }
  assert.equal(metodos(f), 'GET GET GET GET GET GET GET GET', 'jamás un PUT');
});

test('C2: un reintento con 204 habilita los PUT (no hay nada que perder) y lo sucio sale en el siguiente intervalo', async () => {
  const { c, f } = conCarga([{ status: 500 }, { status: 500 }, { status: 204 }]);
  await c.load();
  c.markDirty();
  await c.tick(0);
  await c.tick(1); // falla
  assert.equal(c.state.gate, 'pending');
  await c.tick(3); // 204
  assert.equal(c.state.gate, 'open');
  assert.equal(c.state.blocked, false);
  assert.equal(metodos(f), 'GET GET GET');
  assert.equal(c.tick(3.4), null, 'respeta el intervalo de 1 s desde el último intento');
  await c.tick(4);
  assert.equal(metodos(f), 'GET GET GET PUT');
  assert.equal(c.state.saving, 'ok');
});

test('C2: un reintento con 200 avisa que hay una copia sin cargar, no la aplica y deja los PUT bloqueados', async () => {
  const { c, f } = conCarga([{ status: 500 }, respuesta(200, copia([user('viejo', 99)]))]);
  await c.load();
  c.markDirty();
  await c.tick(0);
  const p = c.tick(1);
  await p;
  assert.equal(c.state.gate, 'blocked');
  assert.equal(c.state.blocked, true);
  for (const t of [2, 3, 10, 100]) {
    c.markDirty();
    assert.equal(c.tick(t), null);
  }
  c.flush();
  assert.equal(metodos(f), 'GET GET', 'ni PUT ni más GET');
  assert.equal(c.state.stopped, false);
});

test('C2: clear() durante la falla manda el DELETE igual; si sale bien se habilitan los PUT', async () => {
  const { c, f } = conCarga([{ status: 500 }]);
  await c.load();
  assert.equal(c.state.gate, 'pending');
  await c.clear();
  assert.equal(metodos(f), 'GET DELETE');
  assert.equal(c.state.gate, 'open');
  assert.equal(c.state.pendingDelete, false);
  c.markDirty();
  await c.tick(5);
  assert.equal(metodos(f), 'GET DELETE PUT');
});

test('C2: clear() con la copia bloqueada también descarta; con el DELETE caído sigue bloqueado y se reintenta', async () => {
  let cae = true;
  const { c, f } = conCarga([{ status: 500 }, respuesta(200, copia())], {
    otros: (init) => (init.method === 'DELETE' && cae ? new Error('red') : { status: 204 }),
  });
  await c.load();
  await c.tick(0);
  await c.tick(1);
  assert.equal(c.state.gate, 'blocked');
  await c.clear(); // falla
  assert.equal(c.state.gate, 'blocked');
  assert.equal(c.state.pendingDelete, true);
  c.markDirty();
  assert.equal(c.tick(1.5), null, 'dentro del segundo no hay reintento');
  cae = false;
  await c.tick(2.5);
  assert.equal(c.state.gate, 'open');
  assert.equal(metodos(f), 'GET GET DELETE DELETE');
  await c.tick(3.6);
  assert.equal(metodos(f), 'GET GET DELETE DELETE PUT');
});

test('C2: un reintento con 404 apaga la sesión sin más reintentos', async () => {
  const { c, f } = conCarga([{ status: 500 }, { status: 404 }]);
  await c.load();
  await c.tick(0);
  await c.tick(1);
  assert.equal(c.state.stopped, true);
  assert.equal(c.state.gate, 'off');
  for (const t of [3, 10, 100]) assert.equal(c.tick(t), null);
  assert.equal(metodos(f), 'GET GET');
});

test('C2: pagehide respeta las mismas reglas (pendiente o bloqueada: nada; un DELETE pendiente sí sale)', async () => {
  const { c, f, oyentes } = conCarga([{ status: 500 }]);
  await c.load();
  c.markDirty();
  oyentes.get('pagehide')();
  assert.equal(metodos(f), 'GET');
  const b = conCarga([{ status: 500 }, respuesta(200, copia())]);
  await b.c.load();
  await b.c.tick(0);
  await b.c.tick(1);
  b.c.markDirty();
  b.oyentes.get('pagehide')();
  assert.equal(metodos(b.f), 'GET GET');
  // con un DELETE pendiente (la red cayó en clear), la salida de la página lo intenta con keepalive
  const d = conCarga([{ status: 500 }], { otros: () => new Error('red') });
  await d.c.load();
  await d.c.clear();
  d.oyentes.get('pagehide')();
  assert.equal(d.f.llamadas.at(-1).init.method, 'DELETE');
  assert.equal(d.f.llamadas.at(-1).init.keepalive, true);
});

test('C2: la carga inválida (200 con otra forma) y la vacía habilitan los PUT; el 200 válido también', async () => {
  for (const [r, nombre] of [
    [{ status: 204 }, 'vacía'],
    [respuesta(200, { v: 2, users: [] }), 'inválida'],
    [respuesta(200, copia()), 'restaurada'],
  ]) {
    const { c, f } = conCarga([r]);
    await c.load();
    assert.equal(c.state.gate, 'open', nombre);
    c.markDirty();
    await c.tick(0);
    assert.equal(metodos(f), 'GET PUT', nombre);
  }
});

test('load: una copia que no es JSON o no tiene la forma es inválida', async () => {
  for (const cuerpo of [
    new SyntaxError('JSON roto'),
    null,
    5,
    'x',
    [],
    { v: 2, users: [] },
    { users: [] },
    { v: 1 },
    { v: 1, users: {} },
  ]) {
    const { c } = crear({ fetch: fakeFetch(() => respuesta(200, cuerpo)) });
    assert.equal((await c.load()).status, 'invalid', JSON.stringify(cuerpo));
  }
});

test('load: vence a los 3000 ms con AbortController y el juego arranca vacío', async () => {
  const t = reloj();
  let senal = null;
  const f = fakeFetch(
    (_url, init) =>
      new Promise((_res, rej) => {
        senal = init.signal;
        init.signal.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')));
      }),
  );
  const { c } = crear({ fetch: f, timers: t });
  const p = c.load();
  assert.equal(t.pendientes.size, 1);
  assert.equal([...t.pendientes.values()][0].ms, 3000);
  assert.equal(senal.aborted, false);
  t.disparar();
  const r = await p;
  assert.equal(senal.aborted, true);
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, 'timeout');
  assert.equal(c.state.stopped, false);
});

test('load: si responde a tiempo se cancela el temporizador', async () => {
  const t = reloj();
  const { c } = crear({ fetch: fakeFetch(() => respuesta(200, copia())), timers: t });
  await c.load();
  assert.equal(t.pendientes.size, 0);
});

test('sin load terminado no se envía nada (no se pisa una copia que todavía no se leyó)', async () => {
  const { c, f } = crear();
  c.markDirty();
  assert.equal(c.tick(0), null);
  c.flush();
  assert.equal(f.llamadas.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// cadencia de envío

test('como máximo 1 PUT por segundo: marcar sucia muchas veces no multiplica los pedidos', async () => {
  const { c, f } = await listo();
  for (let i = 0; i < 100; i++) c.markDirty();
  await c.tick(0);
  assert.equal(f.llamadas.length, 1);
  for (let i = 0; i < 99; i++) {
    c.markDirty();
    c.tick(0.01 * (i + 1)); // hasta 0,99 s: el segundo PUT todavía no
  }
  await c.settle();
  assert.equal(f.llamadas.length, 1);
  c.markDirty();
  await c.tick(1);
  assert.equal(f.llamadas.length, 2);
  assert.equal(f.llamadas[0].init.method, 'PUT');
  assert.equal(f.llamadas[0].url, '/api/session');
  assert.equal(f.llamadas[0].init.headers['Content-Type'], 'application/json');
  assert.equal(f.llamadas[0].init.keepalive, undefined);
  assert.equal(f.llamadas[0].init.body, fitCopy(copia(), 1024 * KB).body);
});

test('C3: el intervalo se adapta a lo que costó armar la copia: 1 s hasta 8 ms, +1 s por cada 8 ms más, tope de 5 s, y se recupera', async () => {
  let reloj = 0;
  let costo = 0;
  const { c, f } = await listo({
    clockMs: () => reloj,
    snapshot: () => {
      reloj += costo; // el reloj de milisegundos solo avanza lo que la prueba diga que costó armar la copia
      return copia();
    },
  });
  /** Envía una copia que "costó" `ms` y devuelve a partir de qué segundo se envía la siguiente (con 0,1 s de resolución). */
  async function siguienteEnvio(ms, desde) {
    costo = ms;
    c.markDirty();
    await c.tick(desde);
    costo = 0;
    c.markDirty();
    let t = desde;
    while (c.tick(t) === null) {
      t = Math.round((t + 0.1) * 10) / 10;
      assert.ok(t < desde + 10, 'no espera de más');
    }
    await c.settle();
    return Math.round((t - desde) * 10) / 10;
  }
  let t = 0;
  const casos = [
    [0, 1],
    [5, 1],
    [8, 1],
    [9, 2],
    [16, 2],
    [20, 3],
    [32, 4],
    [33, 5],
    [100, 5],
    [4000, 5],
    [3, 1],
  ];
  for (const [ms, espera] of casos) {
    const e = await siguienteEnvio(ms, t);
    assert.equal(e, espera, `un armado de ${ms} ms espera ${espera} s`);
    t = Math.round((t + e) * 10) / 10 + 1.5; // el envío de comprobación (sin costo) deja el intervalo en 1 s
  }
  assert.ok(f.llamadas.length >= casos.length);
});

test('C3: el intervalo adaptable nunca baja del mínimo configurado ni pasa de 5 s', async () => {
  let reloj = 0;
  const { c } = await listo({
    clockMs: () => reloj,
    snapshot: () => {
      reloj += 1e6;
      return copia();
    },
  });
  c.markDirty();
  await c.tick(0);
  c.markDirty();
  assert.equal(c.tick(4.9), null);
  assert.ok(c.tick(5));
});

test('sin cambios no hay pedidos ni se arma la copia', async () => {
  let armadas = 0;
  const { c, f } = await listo({
    snapshot: () => {
      armadas++;
      return copia();
    },
  });
  for (let t = 0; t < 30; t++) c.tick(t);
  assert.equal(f.llamadas.length, 0);
  assert.equal(armadas, 0);
  c.markDirty();
  await c.tick(31);
  assert.equal(armadas, 1);
  for (let t = 32; t < 60; t++) c.tick(t);
  await c.settle();
  assert.equal(f.llamadas.length, 1, 'enviada la copia, no se repite');
});

test('un PUT que falla deja la copia sucia y se reintenta en el siguiente segundo, sin tormenta', async () => {
  let n = 0;
  const f = fakeFetch(() => {
    n++;
    if (n === 1) return new Error('red');
    if (n === 2) return { status: 500 };
    return { status: 204 };
  });
  const { c } = await listo({ fetch: f });
  c.markDirty();
  await c.tick(0);
  assert.equal(f.llamadas.length, 1);
  assert.equal(c.state.saving, 'error');
  for (let i = 1; i < 100; i++) c.tick(i / 100);
  await c.settle();
  assert.equal(f.llamadas.length, 1, 'dentro del segundo no hay reintento');
  await c.tick(1);
  assert.equal(f.llamadas.length, 2);
  assert.equal(c.state.saving, 'error', 'el 500 también es error');
  for (let i = 0; i < 100; i++) c.tick(1.5);
  await c.settle();
  assert.equal(f.llamadas.length, 2);
  await c.tick(2);
  assert.equal(f.llamadas.length, 3);
  assert.equal(c.state.saving, 'ok');
  await c.tick(3);
  assert.equal(f.llamadas.length, 3, 'guardada: no se envía de nuevo');
});

test('un PUT con 404, 403 o 405 apaga el guardado; un 413 o un 400 solo cuentan como error', async () => {
  for (const status of [404, 403, 405]) {
    const { c, f } = await listo({ fetch: fakeFetch(() => ({ status })) });
    c.markDirty();
    await c.tick(0);
    assert.equal(c.state.stopped, true, String(status));
    c.markDirty();
    assert.equal(c.tick(5), null);
    assert.equal(f.llamadas.length, 1);
  }
  for (const status of [413, 400, 415]) {
    const { c } = await listo({ fetch: fakeFetch(() => ({ status })) });
    c.markDirty();
    await c.tick(0);
    assert.equal(c.state.stopped, false, String(status));
    assert.equal(c.state.saving, 'error');
  }
});

test('nunca hay dos PUT a la vez; un cambio durante el vuelo vuelve a ensuciar la copia', async () => {
  let soltar;
  const f = fakeFetch(() => new Promise((res) => (soltar = () => res({ status: 204 }))));
  const { c } = await listo({ fetch: f });
  c.markDirty();
  const p = c.tick(0);
  c.markDirty();
  assert.equal(c.tick(5), null, 'hay uno en vuelo');
  assert.equal(f.llamadas.length, 1);
  soltar();
  await p;
  assert.equal(c.state.dirty, true, 'el cambio de durante el vuelo sigue pendiente');
  const q = c.tick(6);
  assert.ok(q);
  soltar();
  await q;
  assert.equal(f.llamadas.length, 2);
  assert.equal(c.state.dirty, false);
});

test('el corte por maxBytes se aplica al enviar y la cuenta de los que quedaron afuera queda para F2', async () => {
  const users = Array.from({ length: 5000 }, (_, i) => user('u' + i, i + 1));
  const hidden = Array.from({ length: 12 }, (_, i) => 'oculto-' + i);
  const { c, f } = await listo({
    snapshot: () => copia(users, { hidden, allHidden: true }),
    maxBytes: 100 * KB,
  });
  c.markDirty();
  await c.tick(0);
  const body = f.llamadas[0].init.body;
  assert.ok(bytes(body) <= 100 * KB);
  const enviada = JSON.parse(body);
  assert.deepEqual(enviada.hidden, hidden);
  assert.equal(enviada.allHidden, true);
  assert.ok(c.state.dropped > 0);
  assert.equal(c.state.dropped, 5000 - enviada.users.length);
  assert.equal(c.state.droppedHidden, 0);
  // el que más XP tiene está; el que menos, no
  assert.ok(enviada.users.some((u) => u.key === 'u4999'));
  assert.ok(!enviada.users.some((u) => u.key === 'u0'));
});

// ---------------------------------------------------------------------------------------------------------------
// pagehide

test('pagehide: se registra y manda un último PUT con keepalive si la copia está sucia y pesa ≤ 64 KB', async () => {
  const { c, f, oyentes } = await listo();
  assert.equal(typeof oyentes.get('pagehide'), 'function');
  oyentes.get('pagehide')();
  assert.equal(f.llamadas.length, 0, 'limpia: nada que mandar');
  c.markDirty();
  oyentes.get('pagehide')();
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].init.method, 'PUT');
  assert.equal(f.llamadas[0].init.keepalive, true);
  assert.ok(bytes(f.llamadas[0].init.body) <= 64 * KB);
});

test('pagehide: con una copia de más de 64 KB no manda nada; el límite exacto de 65 536 bytes sí pasa', async () => {
  const grande = Array.from({ length: 800 }, (_, i) => user('u' + i, i + 1));
  const a = await listo({ snapshot: () => copia(grande) });
  a.c.markDirty();
  a.oyentes.get('pagehide')();
  assert.equal(a.f.llamadas.length, 0);

  // 64 KB justos: m usuarios de relleno y un último cuyo nombre y clave (hasta 512 cada uno) afinan el byte
  const relleno = (m, p) => [
    ...Array.from({ length: m }, (_, i) => user('r' + i, 1, { name: 'x'.repeat(500) })),
    user('k' + 'y'.repeat(Math.max(0, p - 512)), 1, { name: 'z'.repeat(Math.min(p, 512)) }),
  ];
  const tam = (m, p) => bytes(fitCopy(copia(relleno(m, p)), 1024 * KB).body);
  let m = 1;
  while (tam(m + 1, 0) <= 64 * KB) m++;
  let justo = 0;
  while (tam(m, justo) < 64 * KB) justo++;
  assert.equal(tam(m, justo), 64 * KB, 'se puede afinar al byte');
  const conRelleno = (p) => copia(relleno(m, p));
  const b = await listo({ snapshot: () => conRelleno(justo) });
  b.c.markDirty();
  b.oyentes.get('pagehide')();
  assert.equal(b.f.llamadas.length, 1);
  const c2 = await listo({ snapshot: () => conRelleno(justo + 1) });
  c2.c.markDirty();
  c2.oyentes.get('pagehide')();
  assert.equal(c2.f.llamadas.length, 0);
});

test('pagehide mide bytes: emoji y CJK que en caracteres cabrían no se mandan si en bytes pasan 64 KB', async () => {
  const emoji = String.fromCodePoint(0x1f600).repeat(16);
  const users = usuariosHasta(64 * KB, () => emoji);
  const texto = JSON.stringify(copia(users));
  assert.ok(texto.length < 64 * KB && bytes(texto) > 64 * KB);
  const { c, f, oyentes } = await listo({ snapshot: () => copia(users) });
  c.markDirty();
  oyentes.get('pagehide')();
  assert.equal(f.llamadas.length, 0);
});

test('pagehide con la sesión apagada no hace nada', async () => {
  const f = fakeFetch(() => ({ status: 404 }));
  const x = crear({ fetch: f });
  await x.c.load();
  x.c.markDirty();
  x.oyentes.get('pagehide')();
  assert.equal(f.llamadas.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// vaciar (newLive)

test('clear: manda DELETE, deja la copia limpia y no vuelve a enviar lo anterior', async () => {
  const { c, f } = await listo();
  c.markDirty();
  await c.clear();
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].init.method, 'DELETE');
  assert.equal(f.llamadas[0].url, '/api/session');
  assert.equal(c.state.dirty, false);
  assert.equal(c.tick(10), null);
});

test('clear: si el DELETE falla se reintenta en el siguiente segundo, antes de cualquier PUT', async () => {
  let n = 0;
  const f = fakeFetch(() => (++n === 1 ? new Error('red') : { status: 204 }));
  const { c } = await listo({ fetch: f });
  await c.clear();
  assert.equal(c.state.pendingDelete, true);
  c.markDirty();
  c.tick(0.2);
  await c.settle();
  assert.equal(f.llamadas.length, 1, 'dentro del segundo no hay reintento');
  await c.tick(1.1);
  assert.deepEqual(
    f.llamadas.map((l) => l.init.method),
    ['DELETE', 'DELETE'],
  );
  assert.equal(c.state.pendingDelete, false);
  await c.tick(2.2);
  assert.deepEqual(
    f.llamadas.map((l) => l.init.method),
    ['DELETE', 'DELETE', 'PUT'],
  );
});

test('clear espera al PUT en vuelo: el DELETE nunca llega antes y deja la copia vacía', async () => {
  let soltar;
  const orden = [];
  const f = fakeFetch(
    (_u, init) =>
      new Promise((res) => {
        if (init.method === 'PUT') soltar = () => (orden.push('PUT-listo'), res({ status: 204 }));
        else (orden.push('DELETE'), res({ status: 204 }));
      }),
  );
  const { c } = await listo({ fetch: f });
  c.markDirty();
  const p = c.tick(0);
  const d = c.clear();
  assert.equal(f.llamadas.length, 1, 'el DELETE espera');
  soltar();
  await p;
  await d;
  assert.deepEqual(orden, ['PUT-listo', 'DELETE']);
  assert.deepEqual(
    f.llamadas.map((l) => l.init.method),
    ['PUT', 'DELETE'],
  );
});

test('el cliente solo usa fetch, el reloj que le pasan y los temporizadores inyectados', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/client/session.js', import.meta.url), 'utf8');
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(
    sinComentarios,
    /Date\.now|Math\.random|performance\.now|localStorage|sessionStorage|indexedDB|innerHTML|\bconsole\b|\bsetInterval\b/,
  );
});
