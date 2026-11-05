import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

async function cargarConfig(siteUrl) {
  const anterior = process.env.SITE_URL;
  if (siteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = siteUrl;
  try {
    // El parámetro de la URL evita que Node devuelva el módulo en caché.
    const modulo = await import(`../../astro.config.mjs?caso=${encodeURIComponent(String(siteUrl))}`);
    return modulo.default;
  } finally {
    if (anterior === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = anterior;
  }
}

test('config de Astro: URLs de archivo sin barra final, sin estilos ni recursos incrustados (CSP sin hashes)', async () => {
  const config = await cargarConfig(undefined);
  assert.equal(config.build.format, 'file');
  assert.equal(config.trailingSlash, 'never');
  assert.equal(config.build.inlineStylesheets, 'never');
  assert.equal(config.vite.build.assetsInlineLimit, 0);
});

test('config de Astro: puerto 4400 estricto y proxy de /v1 hacia la API en 8790', async () => {
  const config = await cargarConfig(undefined);
  assert.equal(config.server.port, 4400);
  assert.equal(config.vite.server.strictPort, true);
  assert.equal(config.vite.server.proxy['/v1'], 'http://localhost:8790');
});

test('config de Astro: el sitio sale de SITE_URL y, sin ella, es el origen local de la API', async () => {
  assert.equal((await cargarConfig('https://ejemplo.test')).site, 'https://ejemplo.test');
  assert.equal((await cargarConfig(undefined)).site, 'http://localhost:8790');
});

test('web: dependencias fijadas por el diseño (Astro 7.4.5 en dependencies, TypeScript 6 solo acá)', () => {
  assert.equal(pkg.name, '@tienda/web');
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies.astro, '7.4.5');
  assert.equal(pkg.dependencies['@fontsource-variable/oxanium'], '5.3.0');
  assert.equal(pkg.dependencies['@tienda/contracts'], '*');
  assert.equal(pkg.devDependencies['@astrojs/check'], '0.9.12');
  assert.equal(pkg.devDependencies.typescript, '~6.0.3');
  assert.equal(pkg.devDependencies.parse5, '^8.1.0');
});

test('tsconfig de la web: deja que los tipos JSDoc de @tienda/contracts lleguen a astro check (sin ts7016)', () => {
  const { compilerOptions } = JSON.parse(
    readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  );
  assert.equal(compilerOptions.allowJs, true);
  assert.equal(compilerOptions.checkJs, false);
  assert.deepEqual(compilerOptions.paths, {
    '@tienda/contracts/i18n': ['../../packages/contracts/src/i18n/index.js'],
    '@tienda/contracts/*': ['../../packages/contracts/src/*.js'],
  });
});

test('web: los scripts pasan por el lanzador; el desarrollo usa el puerto 4400', () => {
  assert.equal(pkg.scripts.dev, 'node ../../scripts/run.mjs --port 4400 astro dev');
  assert.equal(pkg.scripts.build, 'node ../../scripts/run.mjs astro build');
  assert.equal(pkg.scripts.typecheck, 'node ../../scripts/run.mjs astro check');
  assert.equal(pkg.scripts.test, 'node --test "test/unit/**/*.test.js"');
  assert.equal(pkg.scripts['test:dist'], 'node --test "test/dist/**/*.test.js"');
  assert.equal(pkg.scripts['check:schema'], 'node scripts/expect-invalid-content.mjs');
});
