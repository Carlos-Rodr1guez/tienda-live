import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// El README es el runbook del dueño: estas pruebas fijan lo que no puede perderse ni decir mal.

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/**
 * Comandos de Wrangler escritos en el README que NO pasan por el lanzador (`scripts/run.mjs wrangler ...`). Sin el
 * lanzador, el inicio de sesión y el estado de Wrangler irían a C: y `embudo --remote` no encontraría la misma sesión.
 * Solo se miran los subcomandos de los comandos reales; `wrangler dev` y los nombres entre comillas no cuentan.
 * @param {string} texto
 */
function comandosSinLanzador(texto) {
  const comando = /wrangler (login|logout|whoami|d1|secret|deploy|tail|versions|kv|r2)\b/;
  return texto
    .split('\n')
    .filter((linea) => !linea.startsWith('|')) // celdas de tablas: nombres, no comandos
    .filter((linea) => comando.test(linea.replace(/node (\.\.\/\.\.\/|)scripts\/run\.mjs wrangler/g, '')))
    .map((linea) => linea.trim());
}

test('readme: la revisión detecta un comando de Wrangler sin lanzador y acepta los que pasan por run.mjs', () => {
  assert.deepEqual(comandosSinLanzador('1. `wrangler login`'), ['1. `wrangler login`']);
  assert.deepEqual(comandosSinLanzador('   wrangler d1 migrations apply DB --remote'), [
    'wrangler d1 migrations apply DB --remote',
  ]);
  assert.deepEqual(comandosSinLanzador('node scripts/run.mjs wrangler login'), []);
  assert.deepEqual(comandosSinLanzador('node ../../scripts/run.mjs wrangler d1 execute DB --local'), []);
  assert.deepEqual(comandosSinLanzador('| `SECRET` | `wrangler secret put` | tabla |'), []);
});

test('readme: todos los comandos de Wrangler del runbook pasan por el lanzador', () => {
  assert.deepEqual(comandosSinLanzador(README), []);
  for (const comando of [
    'node scripts/run.mjs wrangler login',
    'node scripts/run.mjs wrangler d1 create',
    'node scripts/run.mjs wrangler d1 migrations apply DB --remote',
    'node scripts/run.mjs wrangler secret put TURNSTILE_SECRET_KEY',
    'node scripts/run.mjs wrangler deploy',
  ]) {
    assert.ok(README.includes(comando), `falta: ${comando}`);
  }
  assert.match(README, /\.dev-state/, 'explica por qué: el estado y la sesión viven en .dev-state');
  assert.match(README, /embudo -- --remote/);
});

test('readme: el límite de velocidad es para TODO /v1/* y los contadores del embudo son de mejor esfuerzo', () => {
  assert.match(README, /todo `\/v1\/\*`/);
  assert.match(README, /mejor esfuerzo/);
});

test('readme: la afirmación sobre tiempos está acotada (mismo cuerpo y estado, pero distinto trabajo en D1)', () => {
  assert.match(README, /idéntica byte a byte/);
  assert.match(README, /distinta de trabajo en D1/);
  assert.match(README, /sonda estadística/);
  assert.doesNotMatch(README, /el tiempo de respuesta tampoco lo delata/);
});

test('readme: tope global de envíos por día como requisito previo (no implementado en el H1)', () => {
  assert.match(README, /tope global de envíos por día/);
  assert.match(README, /No está implementado en el H1/);
});

test('readme: SITE_URL en producción detiene /v1 con 503 a propósito y dice cómo notarlo; la purga sigue', () => {
  assert.match(README, /detiene `\/v1` a propósito/);
  assert.match(README, /config\.invalida/);
  assert.match(README, /La purga diaria \*\*sigue corriendo\*\*/);
  assert.match(README, /`PUBLIC_TURNSTILE_SITE_KEY` puestos de forma explícita/);
});

test('readme (F2): el comando literal de despliegue lleva --var SITE_URL:https:// (sin eso SITE_URL queda vacío y /v1 da 503)', () => {
  const despliegues = README.split('\n').filter((l) => !l.startsWith('|') && /wrangler deploy\b/.test(l));
  assert.ok(despliegues.length > 0, 'el runbook tiene un comando de despliegue');
  for (const linea of despliegues) assert.match(linea, /--var SITE_URL:https:\/\//, linea);
});

test('readme (F10): la configuración inválida es el paso 0 del orden y la única excepción al 404 de las rutas desconocidas', () => {
  assert.match(README, /Orden de las comprobaciones: configuración \(paso 0\), ruta, método/);
  assert.match(README, /Una ruta desconocida da `404`, salvo con la configuración inválida/);
});

test('readme (F10): el sitio se sirve SOLO en el origen exacto de SITE_URL (www/apex se redirigen) o /v1 responde 403', () => {
  assert.match(README, /solo en el origen exacto de `SITE_URL`/);
  assert.match(README, /redirige/i);
  assert.match(README, /`403 origen_no_permitido`/);
});

test('readme: volver a anotarse siendo pendiente no reinicia los 7 días ni cambia lo guardado', () => {
  assert.match(README, /\*\*no\*\* reinicia esa ventana/);
  assert.doesNotMatch(README, /Volver a anotarse reinicia/);
});
