import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHeadersFile } from '@tienda/contracts/security-headers';
import securityHeaders from '../../integrations/security-headers.js';

// Las carpetas temporales van dentro del repo (gitignored), nunca en la carpeta temporal del sistema (C:).
const ESTADO = fileURLToPath(new URL('../../../../.dev-state/pruebas-web', import.meta.url));

function carpetaTemporal() {
  mkdirSync(ESTADO, { recursive: true });
  return mkdtempSync(path.join(ESTADO, 'cabeceras-'));
}

test('integración: se llama cabeceras-de-seguridad y escucha astro:build:done', () => {
  const integracion = securityHeaders();
  assert.equal(integracion.name, 'cabeceras-de-seguridad');
  assert.equal(typeof integracion.hooks['astro:build:done'], 'function');
});

test('integración: escribe dist/_headers con la política de contracts, sin beacon', async () => {
  const escritos = [];
  const integracion = securityHeaders({
    beacon: false,
    escribir: async (ruta, texto) => escritos.push({ ruta, texto }),
  });
  await integracion.hooks['astro:build:done']({ dir: pathToFileURL(path.resolve('/falso/dist') + path.sep) });
  assert.equal(escritos.length, 1);
  assert.equal(path.basename(escritos[0].ruta), '_headers');
  assert.equal(path.basename(path.dirname(escritos[0].ruta)), 'dist');
  assert.equal(escritos[0].texto, buildHeadersFile({ beacon: false }));
  assert.doesNotMatch(escritos[0].texto, /cloudflareinsights/);
});

test('integración: con beacon la política deja pasar el script y la conexión de Web Analytics', async () => {
  const escritos = [];
  const integracion = securityHeaders({
    beacon: true,
    escribir: async (ruta, texto) => escritos.push({ ruta, texto }),
  });
  await integracion.hooks['astro:build:done']({ dir: pathToFileURL(path.resolve('/falso/dist') + path.sep) });
  assert.equal(escritos[0].texto, buildHeadersFile({ beacon: true }));
  assert.match(escritos[0].texto, /static\.cloudflareinsights\.com/);
  assert.match(escritos[0].texto, /connect-src 'self' https:\/\/cloudflareinsights\.com/);
});

test('integración: sin la opción beacon, la decide PUBLIC_CF_BEACON_TOKEN al construir', async () => {
  const anterior = process.env.PUBLIC_CF_BEACON_TOKEN;
  const escritos = [];
  // Raíz sin .env: así la prueba solo depende de la variable del proceso, no del .env de quien la corre
  const raiz = carpetaTemporal();
  const integracion = securityHeaders({ escribir: async (ruta, texto) => escritos.push(texto), root: raiz });
  const dir = pathToFileURL(path.resolve('/falso/dist') + path.sep);
  try {
    delete process.env.PUBLIC_CF_BEACON_TOKEN;
    await integracion.hooks['astro:build:done']({ dir });
    process.env.PUBLIC_CF_BEACON_TOKEN = 'un-token';
    await integracion.hooks['astro:build:done']({ dir });
    process.env.PUBLIC_CF_BEACON_TOKEN = '';
    await integracion.hooks['astro:build:done']({ dir });
  } finally {
    if (anterior === undefined) delete process.env.PUBLIC_CF_BEACON_TOKEN;
    else process.env.PUBLIC_CF_BEACON_TOKEN = anterior;
    rmSync(raiz, { recursive: true, force: true });
  }
  assert.deepEqual(escritos, [
    buildHeadersFile({ beacon: false }),
    buildHeadersFile({ beacon: true }),
    buildHeadersFile({ beacon: false }),
  ]);
});

test('integración: un token que solo está en el .env del proyecto también cuenta (misma fuente que import.meta.env)', async () => {
  const anterior = process.env.PUBLIC_CF_BEACON_TOKEN;
  delete process.env.PUBLIC_CF_BEACON_TOKEN;
  const raiz = carpetaTemporal();
  writeFileSync(path.join(raiz, '.env'), 'PUBLIC_CF_BEACON_TOKEN=token-solo-en-dotenv\n');
  const escritos = [];
  const dir = pathToFileURL(path.resolve('/falso/dist') + path.sep);
  try {
    // con la raíz que da el hook de configuración de Astro
    const integracion = securityHeaders({ escribir: async (ruta, texto) => escritos.push(texto) });
    integracion.hooks['astro:config:setup']({ config: { root: pathToFileURL(raiz + path.sep) } });
    await integracion.hooks['astro:build:done']({ dir });
    // y con la raíz dada como opción
    await securityHeaders({ escribir: async (ruta, texto) => escritos.push(texto), root: raiz }).hooks[
      'astro:build:done'
    ]({ dir });
  } finally {
    if (anterior !== undefined) process.env.PUBLIC_CF_BEACON_TOKEN = anterior;
    rmSync(raiz, { recursive: true, force: true });
  }
  assert.deepEqual(escritos, [buildHeadersFile({ beacon: true }), buildHeadersFile({ beacon: true })]);
  assert.match(escritos[0], /static\.cloudflareinsights\.com/);
});

test('integración: escribe de verdad en la carpeta de salida', async () => {
  const dist = carpetaTemporal();
  try {
    await securityHeaders({ beacon: false }).hooks['astro:build:done']({
      dir: pathToFileURL(dist + path.sep),
    });
    assert.equal(readFileSync(path.join(dist, '_headers'), 'utf8'), buildHeadersFile({ beacon: false }));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('astro.config: registra la integración de cabeceras', async () => {
  const config = (await import('../../astro.config.mjs?cabeceras')).default;
  assert.ok(
    config.integrations.some((i) => i.name === 'cabeceras-de-seguridad'),
    'falta registrar la integración en astro.config.mjs',
  );
});
