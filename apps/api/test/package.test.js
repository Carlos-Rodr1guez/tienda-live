import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('api: paquete privado y ESM, con contracts como única dependencia propia', () => {
  assert.equal(pkg.name, '@tienda/api');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.dependencies, { '@tienda/contracts': '*' });
});

test('api: wrangler es solo de desarrollo y va fijado a 4.157.0', () => {
  assert.equal(pkg.devDependencies.wrangler, '4.157.0');
  assert.equal(pkg.dependencies.wrangler, undefined);
});

test('api: los scripts pasan por el lanzador y respetan los puertos 8790 y 9290', () => {
  for (const nombre of ['dev', 'preview']) {
    assert.match(
      pkg.scripts[nombre],
      /^node \.\.\/\.\.\/scripts\/run\.mjs --port 8790 --port 9290 wrangler dev/,
      nombre,
    );
  }
  assert.match(pkg.scripts.preview, /--var SITE_URL:http:\/\/localhost:8790$/);
  assert.equal(pkg.scripts['db:migrate'], 'node ../../scripts/run.mjs wrangler d1 migrations apply DB --local');
  assert.equal(pkg.scripts.test, 'node --test --disable-warning=ExperimentalWarning "test/**/*.test.js"');
  for (const nombre of ['embudo', 'borrar', 'check:bundle']) assert.ok(pkg.scripts[nombre], nombre);
});

test('api: el Worker de arranque responde 404 a todo hasta que lleguen las rutas', async () => {
  for (const url of ['http://localhost:8790/', 'http://localhost:8790/v1/events']) {
    const res = await worker.fetch(new Request(url));
    assert.equal(res.status, 404, url);
  }
});
