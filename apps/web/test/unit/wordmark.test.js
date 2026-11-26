import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWordmark } from '../../src/lib/wordmark.js';

test('marca: se parte en el último espacio; la última palabra va aparte (en dorado en la cabecera)', () => {
  assert.deepEqual(splitWordmark('Tienda LIVE'), { inicio: 'Tienda', final: 'LIVE' });
  assert.deepEqual(splitWordmark('Mi Tienda de Juegos'), { inicio: 'Mi Tienda de', final: 'Juegos' });
});

test('marca: un nombre de una sola palabra queda entero en el final, sin inicio', () => {
  assert.deepEqual(splitWordmark('Asedio'), { inicio: '', final: 'Asedio' });
});

test('marca: ignora espacios de los bordes y repetidos en el corte, y rechaza un nombre vacío', () => {
  assert.deepEqual(splitWordmark('  Tienda   LIVE '), { inicio: 'Tienda', final: 'LIVE' });
  assert.throws(() => splitWordmark('   '), /nombre/);
  assert.throws(() => splitWordmark(undefined), /nombre/);
});
