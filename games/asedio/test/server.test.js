import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, loadConfigFile } from '@tienda/kit/server';
import { ROOT } from '../server/root.js';

const quiet = { info() {}, warn() {}, error() {} };

// Los 7 tests del servidor (normalización, racha, limpieza de usuario, three y servidor de fixture) viven ahora en
// packages/kit/test/server.test.js. Acá queda solo la prueba de que ASEDIO arranca a través del kit (KIT-1).
test('arranque: ASEDIO se sirve a través del kit', async () => {
  const config = await loadConfigFile(ROOT);
  const app = await startServer({ root: ROOT, config, port: 0, tiktok: false, log: quiet });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /ASEDIO/);
    assert.equal((await fetch(`${base}/js/main.js`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/three/build/three.module.js`, { method: 'HEAD' })).status, 200);

    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(cfg.game, config.game ?? {});

    // el código del servidor del kit no se sirve y ASEDIO no tiene ruta de sesión (todavía no existe)
    assert.equal((await fetch(`${base}/kit/server/app.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/session`)).status, 404);
  } finally {
    await app.close();
  }
});
