import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('contracts: paquete privado, ESM y sin paso de construcción', () => {
  assert.equal(pkg.name, '@tienda/contracts');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports['./*'], './src/*.js');
});

test('contracts: no tiene dependencias de ejecución (es código compartido entre el Worker y la web)', () => {
  assert.equal(pkg.dependencies, undefined);
});

test('contracts: las pruebas se descubren con una lista explícita que deja afuera test/support', () => {
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.js"');
});
