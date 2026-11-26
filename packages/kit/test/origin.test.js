import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { checkCopy } from '@tienda/contracts/copy-rules';
import { startServer } from '@tienda/kit/server';
import { SimulatorPanel } from '@tienda/kit/client/simulator.js';

// D6: `/ws` y `/api/simulate` solo aceptan al propio juego (Host de loopback y, si viene, el mismo Origin); el panel F1 pasa checkCopy.

const quiet = { info() {}, warn() {}, error() {} };
const FIXTURE = new URL('../fixtures/mini-game/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function servidor() {
  return startServer({ root: FIXTURE, config: {}, port: 0, tiktok: false, log: quiet });
}
/** POST /api/simulate con las cabeceras dadas (Node no deja a `fetch` fijar Host ni Origin a gusto). */
function simular(port, headers) {
  return new Promise((ok, mal) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/simulate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => ok(res.statusCode));
      },
    );
    req.on('error', mal);
    req.end(JSON.stringify({ type: 'chat', userId: 'a' }));
  });
}
const abrirWs = (port, headers) =>
  new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.on('open', () => ok({ abierto: true, ws }));
    ws.on('error', () => ok({ abierto: false }));
    ws.on('unexpected-response', () => ok({ abierto: false }));
  });

test('POST /api/simulate: sin Origin (cliente que no es navegador) y mismo origen pasan; Origin ajeno y Host ajeno dan 403', async () => {
  const app = await servidor();
  try {
    const p = app.port;
    assert.equal(await simular(p, {}), 204, 'sin Origin');
    assert.equal(await simular(p, { Origin: `http://127.0.0.1:${p}` }), 204, 'mismo origen');
    assert.equal(await simular(p, { Origin: 'http://malo.example' }), 403, 'Origin ajeno');
    assert.equal(await simular(p, { Origin: `http://127.0.0.1:${p + 1}` }), 403, 'mismo sitio, otro puerto');
    assert.equal(await simular(p, { Origin: 'null' }), 403, 'Origin "null"');
    assert.equal(await simular(p, { Host: 'malo.example' }), 403, 'Host ajeno (reenlace de DNS)');
  } finally {
    await app.close();
  }
});

test('/ws: el mismo origen y los clientes sin Origin se conectan; un Origin ajeno o un Host ajeno se rechazan', async () => {
  const app = await servidor();
  try {
    const p = app.port;
    for (const [headers, esperado, que] of [
      [{}, true, 'sin Origin'],
      [{ Origin: `http://127.0.0.1:${p}` }, true, 'mismo origen'],
      [{ Origin: 'http://malo.example' }, false, 'Origin ajeno'],
      [{ Host: 'malo.example' }, false, 'Host ajeno'],
    ]) {
      const r = await abrirWs(p, headers);
      assert.equal(r.abierto, esperado, que);
      r.ws?.close();
    }
  } finally {
    await app.close();
  }
});

test('C31: los textos del panel F1 pasan checkCopy (también el campo de nombre)', () => {
  const textos = [];
  const guardar = (v) => textos.push(String(v));
  const el = () => {
    const e = {
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {},
      append: (...a) => a.forEach((x) => x?.textos && 0),
      addEventListener() {},
    };
    for (const prop of ['textContent', 'placeholder', 'title']) {
      let v = '';
      Object.defineProperty(e, prop, {
        get: () => v,
        set: (x) => {
          v = x;
          guardar(x);
        },
      });
    }
    return e;
  };
  globalThis.document = {
    createElement: () => el(),
    createTextNode: (t) => (guardar(t), { data: t }),
    body: { append() {} },
    addEventListener() {},
  };
  try {
    new SimulatorPanel(el(), {
      config: {
        teams: [
          { name: 'Perú', aliases: ['peru'] },
          { name: 'México', aliases: ['mexico'] },
        ],
        simulator: { gifts: [{ name: 'Rose', coins: 1 }] },
      },
      onEvent() {},
      fab: false,
      hotkey: false,
    });
  } finally {
    delete globalThis.document;
  }
  assert.ok(
    textos.some((t) => /Nombre \(opcional\)/.test(t)),
    'el campo de nombre dice "Nombre (opcional)"',
  );
  for (const t of textos.filter((x) => x.trim())) {
    assert.deepEqual(checkCopy(t), [], t);
  }
});
