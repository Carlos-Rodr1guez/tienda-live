import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

// Los módulos puros del kit llegan por tres vías con los mismos bytes: Node (exports map), el navegador
// (montaje /kit/sim/) y esbuild (exports map).
const SIM_DIR = fileURLToPath(new URL('../src/sim/', import.meta.url));

for (const modulo of ['words.js', 'registry.js']) {
  test(`kit/sim: ${modulo} se sirve en /kit/sim/ con los bytes del módulo y esbuild lo resuelve`, async () => {
    const { startServer } = await import('@tienda/kit/server');
    const { build } = await import('esbuild');
    const app = await startServer({ root: FIXTURE, port: 0, tiktok: false, log: quiet });
    try {
      const res = await fetch(`http://127.0.0.1:${app.port}/kit/sim/${modulo}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^text\/javascript/);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.ok(bytes.equals(fs.readFileSync(path.join(SIM_DIR, modulo))));
      // el mismo archivo que importa Node por el nombre del paquete
      assert.ok(Object.keys(await import(`@tienda/kit/sim/${modulo}`)).length > 0);
      const out = await build({
        bundle: true,
        write: false,
        logLevel: 'silent',
        format: 'esm',
        stdin: {
          contents: `import "@tienda/kit/sim/${modulo}"`,
          resolveDir: fileURLToPath(new URL('.', import.meta.url)),
        },
      });
      assert.equal(out.errors.length, 0);
    } finally {
      await app.close();
    }
  });
}

// Lo mismo para los módulos del navegador: /kit/client/ sirve los bytes del archivo que importa Node.
const CLIENT_DIR = fileURLToPath(new URL('../src/client/', import.meta.url));

for (const modulo of ['net.js', 'simulator-events.js', 'simulator.js']) {
  test(`kit/client: ${modulo} se sirve en /kit/client/ con los bytes del módulo y esbuild lo resuelve`, async () => {
    const { startServer } = await import('@tienda/kit/server');
    const { build } = await import('esbuild');
    const app = await startServer({ root: FIXTURE, port: 0, tiktok: false, log: quiet });
    try {
      const res = await fetch(`http://127.0.0.1:${app.port}/kit/client/${modulo}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^text\/javascript/);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.ok(bytes.equals(fs.readFileSync(path.join(CLIENT_DIR, modulo))));
      // importar el módulo no toca el DOM: solo declara
      assert.ok(Object.keys(await import(`@tienda/kit/client/${modulo}`)).length > 0);
      // y sus imports relativos a ../sim/ también existen en el navegador (montaje hermano /kit/sim/)
      const out = await build({
        bundle: true,
        write: false,
        logLevel: 'silent',
        format: 'esm',
        stdin: {
          contents: `import "@tienda/kit/client/${modulo}"`,
          resolveDir: fileURLToPath(new URL('.', import.meta.url)),
        },
      });
      assert.equal(out.errors.length, 0);
    } finally {
      await app.close();
    }
  });
}
