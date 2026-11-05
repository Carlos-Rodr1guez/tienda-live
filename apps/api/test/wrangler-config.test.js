import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const API = new URL('../', import.meta.url);

/** Quita los comentarios de un JSONC sin tocar el texto dentro de las comillas. Sin dependencias. */
function stripJsonc(texto) {
  let salida = '';
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const siguiente = texto[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (texto[j] !== '"') j += texto[j] === '\\' ? 2 : 1;
      salida += texto.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && siguiente === '/') {
      while (i < texto.length && texto[i] !== '\n') i += 1;
    } else if (c === '/' && siguiente === '*') {
      i = texto.indexOf('*/', i + 2) + 2;
    } else {
      salida += c;
      i += 1;
    }
  }
  return salida;
}

const config = JSON.parse(stripJsonc(readFileSync(new URL('wrangler.jsonc', API), 'utf8')));

test('stripJsonc: quita // y /* */ pero respeta las comillas', () => {
  const jsonc = '{ // línea\n "a": "http://x // no", /* bloque\n varias líneas */ "b": [1, 2] }';
  assert.deepEqual(JSON.parse(stripJsonc(jsonc)), { a: 'http://x // no', b: [1, 2] });
  assert.deepEqual(JSON.parse(stripJsonc('{"a": "con \\" comilla // dentro"}')), { a: 'con " comilla // dentro' });
});

test('wrangler: nombre, punto de entrada y fecha de compatibilidad', () => {
  assert.equal(config.name, 'tienda-live');
  assert.equal(config.main, 'src/index.js');
  assert.ok(existsSync(new URL(config.main, API)), 'main existe');
  assert.equal(config.compatibility_date, '2026-11-01');
});

test('wrangler: la web estática sale de ../web/dist y el Worker solo corre primero para /v1/*', () => {
  assert.deepEqual(config.assets, {
    directory: '../web/dist',
    run_worker_first: ['/v1/*'],
    not_found_handling: '404-page',
  });
});

test('wrangler: una base D1 con el enlace DB y las migraciones de la carpeta migrations', () => {
  assert.equal(config.d1_databases.length, 1);
  const [db] = config.d1_databases;
  assert.equal(db.binding, 'DB');
  assert.equal(db.database_name, 'tienda-live');
  // Marcador: el id real lo crea el dueño al desplegar (runbook), nunca va al repositorio
  assert.equal(db.database_id, '00000000-0000-0000-0000-000000000000');
  assert.equal(db.migrations_dir, 'migrations');
  const migraciones = readdirSync(new URL(`${db.migrations_dir}/`, API)).filter((f) => f.endsWith('.sql'));
  assert.deepEqual(migraciones.sort(), ['0001_waitlist.sql', '0002_funnel_daily.sql']);
});

test('wrangler: la purga corre a diario a las 03:17 UTC', () => {
  assert.deepEqual(config.triggers.crons, ['17 3 * * *']);
});

test('wrangler: la observabilidad de la plataforma está apagada (no se guardan metadatos de los pedidos)', () => {
  assert.equal(config.observability.enabled, false);
});

test('wrangler: variables públicas de producción: ENVIRONMENT=production y SITE_URL vacío, sin secretos', () => {
  assert.deepEqual(config.vars, { ENVIRONMENT: 'production', SITE_URL: '' });
});

test('wrangler: puertos de desarrollo: API 8790 e inspector 9290, solo en localhost', () => {
  assert.deepEqual(config.dev, { ip: 'localhost', port: 8790, inspector_port: 9290 });
});

test('.dev.vars.example: desarrollo local con la clave secreta de prueba de Turnstile', () => {
  const lineas = readFileSync(new URL('.dev.vars.example', API), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  assert.deepEqual(lineas, [
    'ENVIRONMENT=development',
    'SITE_URL=http://localhost:4400',
    'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
  ]);
});
