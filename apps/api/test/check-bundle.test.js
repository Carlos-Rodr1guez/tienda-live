import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findViolations, mapSources } from '../scripts/check-bundle.mjs';

test('check-bundle: un paquete solo con código propio no tiene problemas', () => {
  const archivos = ['index.js', 'index.js.map', 'README.md'];
  assert.deepEqual(
    findViolations({ archivos, fuentes: ['../src/index.js', '../../../packages/contracts/src/waitlist.js'] }),
    [],
  );
});

test('check-bundle: un archivo del paquete dentro de node_modules es un problema', () => {
  const problemas = findViolations({ archivos: ['index.js', 'node_modules/lodash/lodash.js'], fuentes: [] });
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /node_modules\/lodash\/lodash\.js/);
});

test('check-bundle: también cuenta con separadores de Windows', () => {
  const problemas = findViolations({ archivos: ['index.js', 'node_modules\\zod\\index.js'], fuentes: [] });
  assert.equal(problemas.length, 1);
});

test('check-bundle: una fuente del mapa que viene de node_modules es un problema (dependencia empaquetada)', () => {
  const problemas = findViolations({
    archivos: ['index.js'],
    fuentes: ['../src/index.js', '../../../node_modules/zod/v4/index.js'],
  });
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /zod/);
});

test('check-bundle: las plantillas internas de wrangler no cuentan como dependencia del Worker', () => {
  const fuentes = ['../../../node_modules/wrangler/templates/middleware/loader-modules.ts', '../src/index.js'];
  assert.deepEqual(findViolations({ archivos: ['index.js'], fuentes }), []);
  // pero otro paquete bajo el mismo árbol sí
  assert.equal(findViolations({ archivos: ['index.js'], fuentes: ['../node_modules/wrangler-falso/x.js'] }).length, 1);
});

test('check-bundle: un paquete vacío (sin ningún .js) también falla: algo salió mal al empaquetar', () => {
  const problemas = findViolations({ archivos: ['README.md'], fuentes: [] });
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /ningún \.js/);
});

test('check-bundle: mapSources lee la lista "sources" de un mapa de fuentes y tolera lo que no es un mapa', () => {
  assert.deepEqual(mapSources(JSON.stringify({ version: 3, sources: ['a.js', 'b.js'] })), ['a.js', 'b.js']);
  assert.deepEqual(mapSources('{"version":3}'), []);
  assert.deepEqual(mapSources('no es json'), []);
});
