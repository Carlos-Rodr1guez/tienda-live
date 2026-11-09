import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, loadConfigFile } from '@tienda/kit/server';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createMatch, importProgress } from '../public/js/sim/match.js';
import { ROOT } from '../server/root.js';

const quiet = { info() {}, warn() {}, error() {} };

// [I] El juego arranca a través del kit: página, módulos del kit, config y la ruta de sesión prendida (KIT-28).
test('arranque: Batalla de países se sirve a través del kit', async () => {
  const config = await loadConfigFile(ROOT);
  const app = await startServer({
    root: ROOT,
    config,
    port: 0,
    tiktok: false,
    log: quiet,
    session: config.session ?? true,
  });
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
    assert.deepEqual(cfg.session, { maxBytes: 1024 * 1024 }, 'la página recibe el mismo tope que usa el servidor');

    // el código del servidor del kit no se sirve; la sesión de la transmisión está prendida y arranca vacía
    assert.equal((await fetch(`${base}/kit/server/app.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/session`)).status, 204);
  } finally {
    await app.close();
  }
});

// [I] KIT-28 punta a punta con el servidor real: PUT, "recarga" (otro GET) y DELETE.
test('sesión: PUT, recarga simulada y GET devuelven rangos y ocultos; DELETE la vacía', async () => {
  const config = await loadConfigFile(ROOT);
  const app = await startServer({
    root: ROOT,
    config,
    port: 0,
    tiktok: false,
    log: quiet,
    session: config.session ?? true,
  });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    // la copia sale del registro de verdad, como la manda la página
    const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
    registry.touch({ userId: 'a', nickname: '\u202EAna\u200B_23' });
    registry.addCoins('a', 200, 3);
    registry.touch({ userId: 'b', nickname: 'Beto' });
    registry.hide('b');
    const copia = {
      ...registry.exportLive(12),
      match: { pair: ['PE', 'MX'], started: true, roundsDone: 1, wins: [1, 0] },
    };
    const put = await fetch(`${base}/api/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(copia),
    });
    assert.equal(put.status, 204);

    // "recarga": un registro y un partido nuevos piden la copia y la restauran
    const recibida = await (await fetch(`${base}/api/session`)).json();
    const nuevo = createRegistry({ teams: [PAISES[0], PAISES[1]] });
    const partido = createMatch({ paises: PAISES, registry: nuevo });
    assert.equal(importProgress(partido, recibida.match).state, 'waitingNextRound');
    assert.deepEqual(nuevo.importLive(recibida), { users: 2, dropped: 0 });
    assert.deepEqual(nuevo.rankOf('a'), registry.rankOf('a'));
    assert.equal(nuevo.rankOf('a').label, 'Teniente');
    assert.equal(nuevo.get('a').name, 'Ana_23', 'el nombre vuelve saneado');
    assert.equal(nuevo.displayName('b'), 'anónimo');
    assert.deepEqual(partido.wins, [1, 0]);

    assert.equal((await fetch(`${base}/api/session`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/session`)).status, 204);
  } finally {
    await app.close();
  }
});

test('"session": false en config.json apaga la ruta (404) y config.session la deja prendida o cambia su tope', async () => {
  const config = await loadConfigFile(ROOT);
  const arrancar = (session) => startServer({ root: ROOT, config, port: 0, tiktok: false, log: quiet, session });
  const apagada = await arrancar(false);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${apagada.port}/api/session`)).status, 404);
    assert.equal('session' in (await (await fetch(`http://127.0.0.1:${apagada.port}/api/config`)).json()), false);
  } finally {
    await apagada.close();
  }
  const tope = await arrancar({ maxBytes: 100000 });
  try {
    const cfg = await (await fetch(`http://127.0.0.1:${tope.port}/api/config`)).json();
    assert.deepEqual(cfg.session, { maxBytes: 100000 });
  } finally {
    await tope.close();
  }
});

test('server/index.js pasa session: config.session ?? true (el único dato de config que cambia la sesión)', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../server/index.js', import.meta.url)), 'utf8');
  // `??` y no `||`: "session": false tiene que llegar como false
  assert.match(src, /startServer\(\{[^}]*session: config\.session \?\? true[^}]*\}\)/);
});

test('config.json: puerto 3100, usuario de ejemplo y game vacío', async () => {
  const config = await loadConfigFile(ROOT);
  assert.equal(config.port, 3100);
  assert.equal(typeof config.tiktokUsername, 'string');
  assert.deepEqual(config.game, {});
});

// [I] 6.9 (DOC-2): las fuentes se sirven desde el propio servidor, con el tipo que pide el navegador.
test('fuentes: /fonts/*.woff2 responde 200 con font/woff2 y trae bytes de verdad', async () => {
  const config = await loadConfigFile(ROOT);
  const app = await startServer({ root: ROOT, config, port: 0, tiktok: false, log: quiet, session: false });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    for (const f of ['pixelify-sans-600.woff2', 'silkscreen-700.woff2']) {
      const res = await fetch(`${base}/fonts/${f}`);
      assert.equal(res.status, 200, f);
      assert.match(res.headers.get('content-type') ?? '', /^font\/woff2/, f);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.ok(bytes.length > 1000, `${f}: ${bytes.length} bytes`);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${f}: firma WOFF2`);
    }
    assert.equal((await fetch(`${base}/fonts/inexistente.woff2`)).status, 404);
  } finally {
    await app.close();
  }
});
