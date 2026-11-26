import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startServer } from '@tienda/kit/server';

// KIT-1 y KIT-28: `startServer` monta `/api/session` solo con la opción `session` (apagada por defecto). Servidor real
// en el puerto 0 y sin red externa.

const FIXTURE = fileURLToPath(new URL('../fixtures/mini-game/', import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };
const JSON_HDR = { 'Content-Type': 'application/json' };

async function arrancar(session) {
  const app = await startServer({
    root: FIXTURE,
    port: 0,
    tiktok: false,
    log: quiet,
    ...(session === undefined ? {} : { session }),
  });
  return { app, base: `http://127.0.0.1:${app.port}` };
}
const user = (key) => ({
  key,
  name: 'N' + key,
  team: 1,
  lastSwitch: -1e9,
  coins: { live: 1, match: 1 },
  value: { live: 0, match: 0 },
  xp: { live: 1, match: 1 },
  kills: { live: 0, match: 0 },
  firstXpAt: null,
});
const copia = (users = [user('a')]) => ({ v: 1, clock: 0, users, hidden: ['h'], allHidden: false, match: null });
const put = (base, body, headers = JSON_HDR) =>
  fetch(`${base}/api/session`, {
    method: 'PUT',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Un pedido con el Host que se quiera (fetch no deja cambiarlo). */
function pedir(port, { method = 'GET', host, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/session', method, headers: { ...headers, Host: host } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('sin la opción session: /api/session da lo mismo que cualquier ruta que no existe y /api/config no cambia', async () => {
  for (const opcion of [undefined, false, null, 0, '', 'si']) {
    const { app, base } = await arrancar(opcion);
    try {
      for (const method of ['GET', 'PUT', 'DELETE', 'POST']) {
        const sesion = await fetch(`${base}/api/session`, {
          method,
          headers: JSON_HDR,
          body: method === 'GET' ? undefined : '{}',
        });
        const otra = await fetch(`${base}/api/ruta-que-no-existe`, {
          method,
          headers: JSON_HDR,
          body: method === 'GET' ? undefined : '{}',
        });
        assert.equal(sesion.status, otra.status, `${method} con session=${JSON.stringify(opcion)}`);
      }
      assert.equal((await fetch(`${base}/api/session`)).status, 404);
      const cfg = await (await fetch(`${base}/api/config`)).json();
      assert.deepEqual(Object.keys(cfg).sort(), ['game', 'models', 'serverMode', 'tiktokUsername']);
    } finally {
      await app.close();
    }
  }
});

test('con session:true responde: 204 vacía, PUT, GET con la copia, DELETE; y /api/config trae maxBytes', async () => {
  const { app, base } = await arrancar(true);
  try {
    assert.equal((await fetch(`${base}/api/session`)).status, 204);
    const c = copia();
    assert.equal((await put(base, c)).status, 204);
    const r = await fetch(`${base}/api/session`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), c);
    assert.equal((await fetch(`${base}/api/session`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/session`)).status, 204);
    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(cfg.session, { maxBytes: 1024 * 1024 });
  } finally {
    await app.close();
  }
});

test('session:{maxBytes} cambia el tope (recortado a [64 KB, 4 MB]) y /api/config lo informa', async () => {
  const { app, base } = await arrancar({ maxBytes: 70000 });
  try {
    assert.deepEqual((await (await fetch(`${base}/api/config`)).json()).session, { maxBytes: 70000 });
    assert.equal((await put(base, ' '.repeat(70001))).status, 413);
  } finally {
    await app.close();
  }
  const b = await arrancar({ maxBytes: 5 });
  try {
    assert.deepEqual((await (await fetch(`${b.base}/api/config`)).json()).session, { maxBytes: 64 * 1024 });
  } finally {
    await b.app.close();
  }
});

test('la ruta exacta es /api/session: con una barra de más o un subcamino no hay sesión', async () => {
  const { app, base } = await arrancar(true);
  try {
    assert.equal((await put(base, copia())).status, 204);
    assert.equal((await fetch(`${base}/api/session/`)).status, 404);
    assert.equal((await fetch(`${base}/api/session/x`)).status, 404);
    assert.equal((await fetch(`${base}/api/session?x=1`)).status, 200);
  } finally {
    await app.close();
  }
});

test('Host de otro dominio (DNS rebinding) da 403 y no cambia ni filtra la copia', async () => {
  const { app, base } = await arrancar(true);
  try {
    await put(base, copia());
    for (const host of ['evil.example', `evil.example:${app.port}`, `localhost.evil.example:${app.port}`, '10.0.0.5']) {
      const g = await pedir(app.port, { host });
      assert.equal(g.status, 403, host);
      assert.equal(g.text, '');
      assert.equal((await pedir(app.port, { method: 'DELETE', host })).status, 403);
      assert.equal(
        (await pedir(app.port, { method: 'PUT', host, body: JSON.stringify(copia([user('x')])), headers: JSON_HDR }))
          .status,
        403,
      );
    }
    // con el Host correcto, la copia sigue ahí
    const ok = await pedir(app.port, { host: `localhost:${app.port}` });
    assert.equal(ok.status, 200);
    assert.deepEqual(
      JSON.parse(ok.text).users.map((u) => u.key),
      ['a'],
    );
    assert.equal((await pedir(app.port, { host: `[::1]:${app.port}` })).status, 200);
  } finally {
    await app.close();
  }
});

test('un pedido de otro origen: el tipo de contenido obliga a un preflight que no se contesta (415 y 405, sin CORS)', async () => {
  const { app, base } = await arrancar(true);
  try {
    await put(base, copia());
    const simple = await put(base, JSON.stringify(copia([user('x')])), {
      'Content-Type': 'text/plain',
      Origin: 'https://evil.example',
    });
    assert.equal(simple.status, 415);
    const preflight = await fetch(`${base}/api/session`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' },
    });
    assert.equal(preflight.status, 405);
    for (const r of [
      simple,
      preflight,
      await fetch(`${base}/api/session`, { headers: { Origin: 'https://evil.example' } }),
    ]) {
      assert.equal(r.headers.get('access-control-allow-origin'), null);
      assert.equal(r.headers.get('access-control-allow-methods'), null);
    }
    assert.deepEqual(
      (await (await fetch(`${base}/api/session`)).json()).users.map((u) => u.key),
      ['a'],
    );
  } finally {
    await app.close();
  }
});

test('un cuerpo de 5 MB da 413 con el servidor real y el servidor sigue respondiendo con la copia intacta', async () => {
  const { app, base } = await arrancar(true);
  try {
    await put(base, copia());
    const antes = await (await fetch(`${base}/api/session`)).text();
    let estado;
    try {
      estado = (await put(base, 'x'.repeat(5 * 1024 * 1024))).status;
    } catch (e) {
      // el corte puede cerrar la conexión antes de que el cliente termine de subir: también es un rechazo
      estado = e?.cause?.code ?? e?.message;
    }
    assert.ok(estado === 413 || typeof estado === 'string', `estado ${estado}`);
    assert.equal(await (await fetch(`${base}/api/session`)).text(), antes);
    assert.equal((await put(base, copia([user('b')]))).status, 204);
    assert.equal((await fetch(`${base}/api/status`)).status, 200);
  } finally {
    await app.close();
  }
});

test('un cuerpo de más de maxBytes con Content-Length honesto da 413 y la copia no cambia', async () => {
  const { app, base } = await arrancar({ maxBytes: 70000 });
  try {
    await put(base, copia());
    const antes = await (await fetch(`${base}/api/session`)).text();
    const r = await pedir(app.port, {
      method: 'PUT',
      host: `localhost:${app.port}`,
      headers: { ...JSON_HDR, 'Content-Length': '80000' },
      body: Buffer.alloc(80000, 0x20),
    }).catch((e) => ({ status: e.code }));
    assert.ok(r.status === 413 || r.status === 'ECONNRESET' || r.status === 'EPIPE', String(r.status));
    assert.equal(await (await fetch(`${base}/api/session`)).text(), antes);
  } finally {
    await app.close();
  }
});

test('JSON roto: 400 con el servidor real; reiniciar el servidor deja la copia vacía', async () => {
  const a = await arrancar(true);
  try {
    assert.equal((await put(a.base, '{roto')).status, 400);
    await put(a.base, copia());
    assert.equal((await fetch(`${a.base}/api/session`)).status, 200);
  } finally {
    await a.app.close();
  }
  const b = await arrancar(true);
  try {
    assert.equal((await fetch(`${b.base}/api/session`)).status, 204);
  } finally {
    await b.app.close();
  }
});

test('el servidor completo no escribe a disco al guardar, reemplazar, leer y vaciar', async () => {
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
  const { app, base } = await arrancar(true);
  try {
    await put(base, copia());
    await put(base, copia([user('b')]));
    await fetch(`${base}/api/session`);
    await put(base, '{roto');
    await fetch(`${base}/api/session`, { method: 'DELETE' });
  } finally {
    await app.close();
    for (const [obj, nombre, fn] of guardadas) obj[nombre] = fn;
  }
  assert.deepEqual(espiadas, []);
});
