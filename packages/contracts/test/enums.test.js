import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as enums from '../src/enums.js';
import { LIMITS, BODY_CAPS, FUNNEL_COUNT_CAP, CONFIRM_TOKEN_LENGTH } from '../src/limits.js';

const ESPERADOS = {
  CATEGORIES: ['accion', 'publico', 'relax', 'metas'],
  STREAMER_ROLES: ['juega', 'conduce', 'acompana'],
  STREAM_TYPES: ['gaming', 'charla', 'musica', 'estudio'],
  LIVE_FREQUENCY: ['todavia-no', 'ocasional', 'semanal', 'varias-por-semana', 'diario'],
  FOLLOWER_RANGES: ['0-99', '100-999', '1k-9k', '10k-49k', '50k+'],
  GAME_STATES: ['concepto', 'prototipo', 'beta', 'venta'],
};

for (const [nombre, valores] of Object.entries(ESPERADOS)) {
  test(`enums: ${nombre} tiene exactamente los valores de la especificación y en ese orden`, () => {
    assert.deepEqual([...enums[nombre]], valores);
  });
}

test('enums: COUNTRIES son los 22 países de la especificación más ZZ (otro), en ese orden', () => {
  const esperado = 'ES AR MX CO CL PE UY PY BO EC VE CR PA DO GT HN SV NI CU PR US BR ZZ'.split(' ');
  assert.equal(esperado.length, 23);
  assert.deepEqual([...enums.COUNTRIES], esperado);
});

test('enums: todas las listas están congeladas y no tienen repetidos', () => {
  const nombres = [...Object.keys(ESPERADOS), 'COUNTRIES'];
  for (const nombre of nombres) {
    const lista = enums[nombre];
    assert.ok(Object.isFrozen(lista), `${nombre} debería estar congelada`);
    assert.equal(new Set(lista).size, lista.length, `${nombre} tiene repetidos`);
    assert.throws(() => lista.push('x'), TypeError, `${nombre} no debería aceptar cambios`);
  }
});

test('enums: no exporta nada más que las siete listas (una sola definición por enumeración)', () => {
  assert.deepEqual(Object.keys(enums).sort(), [...Object.keys(ESPERADOS), 'COUNTRIES'].sort());
});

test('limits: los topes de la especificación, sección 0', () => {
  assert.deepEqual(BODY_CAPS, { waitlist: 4096, confirm: 512, events: 256 });
  assert.equal(CONFIRM_TOKEN_LENGTH, 43);
  assert.equal(FUNNEL_COUNT_CAP, 100000);
  assert.equal(LIMITS.email.max, 254);
  assert.deepEqual(LIMITS.tiktokUser, { min: 2, max: 24 });
  assert.deepEqual(LIMITS.interests, { min: 1, max: 4 });
  assert.equal(LIMITS.turnstileToken.max, 2048);
});

test('limits: los objetos de límites están congelados', () => {
  for (const obj of [LIMITS, LIMITS.email, LIMITS.tiktokUser, LIMITS.interests, LIMITS.turnstileToken, BODY_CAPS]) {
    assert.ok(Object.isFrozen(obj));
  }
});
