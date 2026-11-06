import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, loadConfigFile } from '@tienda/kit/server';
import { ROOT } from '../server/root.js';

const quiet = { info() {}, warn() {}, error() {} };

// [I] El juego arranca a través del kit: página, módulos del kit, config y sin ruta de sesión todavía.
test('arranque: Batalla de países se sirve a través del kit', async () => {
  const config = await loadConfigFile(ROOT);
  const app = await startServer({ root: ROOT, config, port: 0, tiktok: false, log: quiet });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Batalla de países/);

    const reg = await fetch(`${base}/kit/sim/registry.js`);
    assert.equal(reg.status, 200);
    const delKit = fs.readFileSync(fileURLToPath(import.meta.resolve('@tienda/kit/sim/registry.js')));
    assert.ok(Buffer.from(await reg.arrayBuffer()).equals(delKit));

    const cfgRes = await fetch(`${base}/api/config`);
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.equal(cfg.serverMode, true);
    assert.deepEqual(cfg.game, config.game ?? {});

    // el código del servidor del kit no se sirve y la ruta de sesión llega recién en el lote 5e
    assert.equal((await fetch(`${base}/kit/server/app.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/session`)).status, 404);
  } finally {
    await app.close();
  }
});

test('config.json: puerto 3100, usuario de ejemplo y game vacío', async () => {
  const config = await loadConfigFile(ROOT);
  assert.equal(config.port, 3100);
  assert.equal(typeof config.tiktokUsername, 'string');
  assert.deepEqual(config.game, {});
});
