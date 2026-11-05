import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/adapters/logger.js';
import { createClock } from '../src/adapters/clock.js';
import { createRandom } from '../src/adapters/random.js';

function espia() {
  /** @type {{ nivel: string, linea: string }[]} */
  const lineas = [];
  return {
    lineas,
    sink: {
      log: (/** @type {string} */ linea) => lineas.push({ nivel: 'log', linea }),
      warn: (/** @type {string} */ linea) => lineas.push({ nivel: 'warn', linea }),
      error: (/** @type {string} */ linea) => lineas.push({ nivel: 'error', linea }),
    },
  };
}

test('logger: escribe una línea JSON con el nivel, el evento y los campos permitidos', () => {
  const { lineas, sink } = espia();
  const logger = createLogger(sink);
  logger.info('http.respuesta', { ruta: '/v1/events', resultado: 'ok', estado: 204, ms: 3 });
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].nivel, 'log');
  assert.deepEqual(JSON.parse(lineas[0].linea), {
    nivel: 'info',
    evento: 'http.respuesta',
    ruta: '/v1/events',
    resultado: 'ok',
    estado: 204,
    ms: 3,
  });
});

test('logger: warn y error van a su canal con su nivel', () => {
  const { lineas, sink } = espia();
  const logger = createLogger(sink);
  logger.warn('a', { codigo: 'x' });
  logger.error('b', { cantidad: 2 });
  assert.deepEqual(
    lineas.map((l) => [l.nivel, JSON.parse(l.linea).nivel]),
    [
      ['warn', 'warn'],
      ['error', 'error'],
    ],
  );
});

test('logger: descarta cualquier campo fuera de la lista (correo, token, cuerpo, IP) y no los escribe', () => {
  const { lineas, sink } = espia();
  const logger = createLogger(sink);
  logger.info('mail.error', {
    ruta: '/v1/waitlist',
    email: 'ana@example.com',
    token: 'T'.repeat(43),
    cuerpo: '{"email":"ana@example.com"}',
    ip: '203.0.113.9',
    codigo: 'TypeError',
  });
  const texto = lineas.map((l) => l.linea).join('\n');
  assert.deepEqual(JSON.parse(lineas[0].linea), {
    nivel: 'info',
    evento: 'mail.error',
    ruta: '/v1/waitlist',
    codigo: 'TypeError',
  });
  assert.doesNotMatch(texto, /ana@example\.com/);
  assert.doesNotMatch(texto, /TTTTTTTT/);
  assert.doesNotMatch(texto, /203\.0\.113\.9/);
});

test('logger: solo deja pasar texto y números finitos en los campos permitidos', () => {
  const { lineas, sink } = espia();
  const logger = createLogger(sink);
  logger.info('x', { ruta: { email: 'ana@example.com' }, codigo: ['a'], ms: Infinity, cantidad: NaN, estado: 200 });
  assert.deepEqual(JSON.parse(lineas[0].linea), { nivel: 'info', evento: 'x', estado: 200 });
});

test('logger: sin campos escribe solo nivel y evento', () => {
  const { lineas, sink } = espia();
  createLogger(sink).info('arranque');
  assert.deepEqual(JSON.parse(lineas[0].linea), { nivel: 'info', evento: 'arranque' });
});

test('clock: now() devuelve los milisegundos actuales', () => {
  const antes = Date.now();
  const ahora = createClock().now();
  const despues = Date.now();
  assert.ok(Number.isInteger(ahora));
  assert.ok(ahora >= antes && ahora <= despues);
});

test('random: bytes(n) devuelve n bytes y dos llamadas distintas dan valores distintos', () => {
  const random = createRandom();
  const a = random.bytes(32);
  const b = random.bytes(32);
  assert.ok(a instanceof Uint8Array);
  assert.equal(a.length, 32);
  assert.equal(random.bytes(5).length, 5);
  assert.notDeepEqual(a, b);
});
