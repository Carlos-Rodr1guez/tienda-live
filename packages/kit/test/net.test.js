import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// KIT-26: connectBridge es una copia literal del de ASEDIO. Aquí se prueba con un WebSocket falso y relojes falsos.
const CLIENT = fileURLToPath(new URL('../src/client/', import.meta.url));

/** WebSocket falso: guarda las instancias y deja al test abrir, cerrar y enviar mensajes a mano. */
function installFakeSocket({ throwOnConstruct = false } = {}) {
  const original = globalThis.WebSocket;
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      if (throwOnConstruct) throw new Error('sin red');
      this.url = url;
      this.closeCalls = 0;
      sockets.push(this);
    }
    open() {
      this.onopen?.();
    }
    // lo que hace un cierre real: avisa a quien escucha
    close() {
      this.closeCalls++;
      this.onclose?.();
    }
    message(data) {
      this.onmessage?.({ data });
    }
  }
  globalThis.WebSocket = FakeSocket;
  return {
    sockets,
    restore() {
      globalThis.WebSocket = original;
    },
  };
}

const load = () => import('@tienda/kit/client/net.js');

test('KIT-26: reconecta a 1000, 1700, 2890 ms y sigue sin pasar de 10 000 ms', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    connectBridge('ws://x/ws', {});
    assert.equal(fake.sockets.length, 1);
    const waits = [1000, 1700, 2890, 4913, 8352.1, 10000, 10000, 10000];
    let expected = 1;
    for (const wait of waits) {
      fake.sockets.at(-1).close(); // el socket se cae enseguida
      mock.timers.tick(Math.floor(wait) - 1);
      assert.equal(fake.sockets.length, expected, `antes de ${wait} ms todavía no reintenta`);
      mock.timers.tick(2);
      expected++;
      assert.equal(fake.sockets.length, expected, `a los ${wait} ms reintenta`);
    }
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: tras abrir con éxito la espera vuelve a 1000 ms', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    connectBridge('ws://x/ws', {});
    for (let i = 0; i < 3; i++) {
      fake.sockets.at(-1).close();
      mock.timers.tick(10_001);
    }
    assert.equal(fake.sockets.length, 4);
    fake.sockets.at(-1).open();
    fake.sockets.at(-1).close();
    mock.timers.tick(999);
    assert.equal(fake.sockets.length, 4);
    mock.timers.tick(2);
    assert.equal(fake.sockets.length, 5);
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: ningún reintento después de close(), tampoco uno que ya estaba esperando', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const bridge = connectBridge('ws://x/ws', {});
    fake.sockets[0].close(); // programa un reintento
    bridge.close(); // el reintento pendiente ya no debe abrir nada
    mock.timers.tick(60_000);
    assert.equal(fake.sockets.length, 1);

    // close() con el socket abierto: lo cierra y no reintenta
    const fake2 = installFakeSocket();
    const bridge2 = connectBridge('ws://y/ws', {});
    fake2.sockets[0].open();
    bridge2.close();
    assert.equal(fake2.sockets[0].closeCalls, 1);
    mock.timers.tick(60_000);
    assert.equal(fake2.sockets.length, 1);
    // cerrar dos veces no lanza
    bridge2.close();
    fake2.restore();
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: {state:"bridge"} al abrir y {state:"bridge-lost"} al cerrar; status va a onStatus y el resto a onEvent', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const status = [];
    const events = [];
    connectBridge('ws://x/ws', { onStatus: (s) => status.push(s), onEvent: (e) => events.push(e) });
    const ws = fake.sockets[0];
    assert.equal(ws.url, 'ws://x/ws');
    ws.open();
    ws.message(JSON.stringify({ type: 'status', state: 'live', viewers: 3 }));
    ws.message(JSON.stringify({ type: 'chat', userId: 'a', text: 'hola' }));
    ws.close();
    assert.deepEqual(status, [
      { state: 'bridge' },
      { type: 'status', state: 'live', viewers: 3 },
      { state: 'bridge-lost' },
    ]);
    assert.deepEqual(events, [{ type: 'chat', userId: 'a', text: 'hola' }]);
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: un mensaje que no es JSON no dispara callbacks ni lanza', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = [];
    connectBridge('ws://x/ws', { onStatus: (s) => calls.push(s), onEvent: (e) => calls.push(e) });
    const ws = fake.sockets[0];
    for (const bad of ['not json', '', '{', '{"type":', undefined, '\u0000']) {
      assert.doesNotThrow(() => ws.message(bad));
    }
    assert.deepEqual(calls, []);
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: sin callbacks no pasa nada, y un error del socket lo cierra', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    connectBridge('ws://x/ws', {});
    const ws = fake.sockets[0];
    assert.doesNotThrow(() => {
      ws.open();
      ws.message(JSON.stringify({ type: 'status' }));
      ws.message(JSON.stringify({ type: 'gift' }));
    });
    ws.onerror();
    assert.equal(ws.closeCalls, 1);
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: si el constructor del WebSocket lanza, reintenta con la misma espera', async () => {
  const { connectBridge } = await load();
  const fake = installFakeSocket({ throwOnConstruct: true });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const bridge = connectBridge('ws://x/ws', {});
    assert.equal(fake.sockets.length, 0);
    mock.timers.tick(1001);
    mock.timers.tick(1701);
    bridge.close();
    mock.timers.tick(60_000);
    assert.equal(fake.sockets.length, 0);
  } finally {
    mock.timers.reset();
    fake.restore();
  }
});

test('KIT-26: net.js es copia literal de la de ASEDIO, byte a byte', () => {
  const kit = fs.readFileSync(CLIENT + 'net.js');
  const asedio = fs.readFileSync(new URL('../../../games/asedio/public/js/net.js', import.meta.url));
  assert.ok(kit.equals(asedio), 'net.js del kit debe ser idéntico al de games/asedio/public/js/net.js');
});
