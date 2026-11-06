import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// El kit solo se importa por su exports map (KIT-3) y sus carpetas del navegador se montan bajo /kit/ (KIT-2).
const FIXTURE = fileURLToPath(new URL('../fixtures/mini-game/', import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };

test('exports map: un import profundo a src/ lanza ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
  await assert.rejects(import('@tienda/kit/src/sim/x.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  await assert.rejects(import('@tienda/kit/src/server/app.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('exports map: @tienda/kit/server expone la API del servidor', async () => {
  const api = await import('@tienda/kit/server');
  for (const nombre of [
    'startServer',
    'loadConfigFile',
    'packageDir',
    'createNormalizer',
    'userOf',
    'cleanUsername',
    'createTikTokBridge',
  ]) {
    assert.equal(typeof api[nombre], 'function', nombre);
  }
});

test('startServer y loadConfigFile exigen "root"', async () => {
  const { startServer, loadConfigFile } = await import('@tienda/kit/server');
  await assert.rejects(startServer({ port: 0, tiktok: false, log: quiet }), TypeError);
  await assert.rejects(startServer(), TypeError);
  await assert.rejects(loadConfigFile(), TypeError);
});

test('montajes /kit/: src/server nunca se sirve y los intentos de salirse no devuelven archivos', async () => {
  const { startServer } = await import('@tienda/kit/server');
  const app = await startServer({ root: FIXTURE, port: 0, tiktok: false, log: quiet });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(`${base}/kit/server/tiktok.js`)).status, 404);
    assert.equal((await fetch(`${base}/kit/server/app.js`)).status, 404);
    assert.equal((await fetch(`${base}/kit/sim/..%2f..%2fserver%2fapp.js`)).status, 403);
    assert.equal((await fetch(`${base}/kit/../server/app.js`)).status, 404);
    // una carpeta no se lista
    assert.equal((await fetch(`${base}/kit/sim/`)).status, 404);
    assert.equal((await fetch(`${base}/kit/client/`)).status, 404);
  } finally {
    await app.close();
  }
});
