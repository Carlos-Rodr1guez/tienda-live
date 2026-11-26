import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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

    // los módulos puros del kit se sirven con los mismos bytes que importa Node (KIT-3)
    const reg = await fetch(`${base}/kit/sim/registry.js`);
    assert.equal(reg.status, 200);
    const delKit = fs.readFileSync(fileURLToPath(import.meta.resolve('@tienda/kit/sim/registry.js')));
    assert.ok(Buffer.from(await reg.arrayBuffer()).equals(delKit));

    // el código del servidor del kit no se sirve y ASEDIO no prende la sesión del kit (KIT-1, KIT-28): sin ruta, 404
    // y /api/config sigue con su forma de siempre
    assert.equal('session' in cfg, false);
    assert.equal((await fetch(`${base}/kit/server/app.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/session`)).status, 404);
  } finally {
    await app.close();
  }
});
