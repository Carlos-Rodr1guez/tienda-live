import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, OK, WARN, DENY } from './check-licenses.mjs';

test('licencias: las permisivas pasan', () => {
  for (const l of ['MIT', 'Apache-2.0', '0BSD', 'ISC', '(Apache-2.0 AND BSD-3-Clause)', '(MIT OR CC0-1.0)']) {
    assert.equal(evaluate(l), OK, l);
  }
});

test('licencias: copyleft fuerte, no comercial y sin licencia se bloquean', () => {
  for (const l of [
    'GPL-3.0-only',
    'AGPL-3.0-only',
    'SSPL-1.0',
    'BUSL-1.1',
    'CC-BY-NC-4.0',
    'GPL-2.0 WITH Classpath-exception-2.0',
    '',
    'UNLICENSED',
    'SEE LICENSE IN LICENSE.md',
  ]) {
    assert.equal(evaluate(l), DENY, l || '(vacía)');
  }
});

test('licencias: el copyleft débil solo avisa', () => {
  for (const l of ['LGPL-3.0-or-later', 'MPL-2.0', 'EPL-2.0']) assert.equal(evaluate(l), WARN, l);
});

test('licencias: con OR alcanza una opción permitida, con AND cuentan todas', () => {
  assert.equal(evaluate('(MIT OR GPL-3.0-only)'), OK);
  assert.equal(evaluate('(MIT OR LGPL-2.1)'), OK);
  assert.equal(evaluate('GPL-2.0 AND (MIT OR BSD-3-Clause)'), DENY);
  assert.equal(evaluate('(GPL-2.0 OR LGPL-2.1) AND MIT'), WARN);
});
