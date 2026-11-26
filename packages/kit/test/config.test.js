import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, ConfigError, clampNumber } from '@tienda/kit/sim/config.js';
import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';

test('deepMerge: sobrescribe solo lo indicado y los arreglos se reemplazan', () => {
  const base = { a: 1, b: { c: 2, d: 3 }, l: [1, 2, 3] };
  const out = deepMerge(base, { b: { c: 9 }, l: [7] });
  assert.deepEqual(out, { a: 1, b: { c: 9, d: 3 }, l: [7] });
  // no toca la base
  assert.deepEqual(base, { a: 1, b: { c: 2, d: 3 }, l: [1, 2, 3] });
  assert.equal(deepMerge(base, undefined), base);
  assert.equal(deepMerge({ a: 1 }, null), null);
});

test('deepMerge: ignora __proto__, constructor y prototype', () => {
  const evil = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"ok":5}');
  const out = deepMerge({ ok: 1 }, evil);
  assert.equal(out.ok, 5);
  assert.equal({}.polluted, undefined);
  assert.equal(out.polluted, undefined);
  assert.equal(Object.hasOwn(out, '__proto__'), false);
  assert.equal(Object.hasOwn(out, 'constructor'), false);
  assert.equal(Object.hasOwn(out, 'prototype'), false);
  const nested = deepMerge({ a: { k: 1 } }, JSON.parse('{"a":{"__proto__":{"z":1},"k":2}}'));
  assert.deepEqual(nested, { a: { k: 2 } });
  assert.equal(nested.a.z, undefined);
});

test('ConfigError: es un Error con nombre propio', () => {
  const e = new ConfigError('alias "guinea" repetido entre equipos');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof ConfigError);
  assert.equal(e.name, 'ConfigError');
  assert.equal(e.message, 'alias "guinea" repetido entre equipos');
});

test('clampNumber: limita al rango y usa el valor por defecto si no es un número', () => {
  assert.equal(clampNumber(5, 1, 10, 3), 5);
  assert.equal(clampNumber(-5, 1, 10, 3), 1);
  assert.equal(clampNumber(50, 1, 10, 3), 10);
  assert.equal(clampNumber('7', 1, 10, 3), 7);
  assert.equal(clampNumber('x', 1, 10, 3), 3);
  assert.equal(clampNumber(NaN, 1, 10, 3), 3);
  assert.equal(clampNumber(Infinity, 1, 10, 3), 3);
  assert.equal(clampNumber(undefined, 1, 10, 3), 3);
  assert.equal(clampNumber(null, 1, 10, 3), 3);
});

test('mulberry32 y seedFrom: repetibles y con valores en [0, 1)', () => {
  const a = mulberry32(seedFrom('semilla'));
  const b = mulberry32(seedFrom('semilla'));
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(
    xs,
    Array.from({ length: 50 }, () => b()),
  );
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, mulberry32(seedFrom('otra'))));
  assert.equal(seedFrom('a'), 0xe40c292c);
  assert.equal(mulberry32(1)(), mulberry32(1)());
});
