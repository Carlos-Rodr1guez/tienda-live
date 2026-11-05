import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREVIEW_ENV, buildPreviewPlan, previewEnv } from './preview.mjs';

test('preview: las variables locales son el origen de la API y la clave PÚBLICA de prueba de Turnstile', () => {
  assert.deepEqual(PREVIEW_ENV, {
    SITE_URL: 'http://localhost:8790',
    PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  });
});

test('previewEnv: pone las dos variables aunque falten, y no toca el resto del entorno', () => {
  const env = previewEnv({ PATH: '/bin', OTRA: '1' });
  assert.equal(env.SITE_URL, 'http://localhost:8790');
  assert.equal(env.PUBLIC_TURNSTILE_SITE_KEY, '1x00000000000000000000AA');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.OTRA, '1');
});

test('previewEnv: la vista previa es local, así que gana sobre valores de producción que haya en el entorno', () => {
  const env = previewEnv({ SITE_URL: 'https://produccion.example', PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAreal' });
  assert.equal(env.SITE_URL, 'http://localhost:8790');
  assert.equal(env.PUBLIC_TURNSTILE_SITE_KEY, '1x00000000000000000000AA');
});

test('previewEnv: no modifica el objeto que recibe', () => {
  const original = { PATH: '/bin' };
  previewEnv(original);
  assert.deepEqual(original, { PATH: '/bin' });
});

test('plan: primero construye la web y después sirve con el Worker, con el Node actual, sin shell y con las variables', () => {
  const plan = buildPreviewPlan({
    npmCli: '/ruta/npm-cli.js',
    execPath: '/ruta/node',
    env: { PATH: '/bin' },
    cwd: '/repo',
  });
  assert.equal(plan.length, 2);
  assert.deepEqual(
    plan.map((p) => [p.command, ...p.args]),
    [
      ['/ruta/node', '/ruta/npm-cli.js', 'run', 'build:web'],
      ['/ruta/node', '/ruta/npm-cli.js', 'run', 'preview', '-w', '@tienda/api'],
    ],
  );
  for (const paso of plan) {
    assert.equal(paso.options.cwd, '/repo');
    assert.equal(paso.options.stdio, 'inherit');
    assert.equal(paso.options.shell, undefined, 'sin shell: funciona igual en cmd y en bash');
    assert.equal(paso.options.env.SITE_URL, 'http://localhost:8790');
    assert.equal(paso.options.env.PUBLIC_TURNSTILE_SITE_KEY, '1x00000000000000000000AA');
    assert.equal(paso.options.env.PATH, '/bin');
  }
});

test('plan: sin npm_execpath (no se corrió con "npm run preview") falla explicando cómo', () => {
  assert.throws(() => buildPreviewPlan({ npmCli: undefined, execPath: 'node', env: {}, cwd: '.' }), /npm run preview/);
  assert.throws(() => buildPreviewPlan({ npmCli: 'npm.cmd', execPath: 'node', env: {}, cwd: '.' }), /npm run preview/);
});

test('package.json raíz: preview pasa por el lanzador y el README raíz lo documenta', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts.preview, 'node scripts/preview.mjs');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /SITE_URL=http:\/\/localhost:8790/);
  assert.match(readme, /1x00000000000000000000AA/);
});
