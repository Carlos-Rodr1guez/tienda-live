import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateToken, hashToken } from '../src/waitlist/tokens.js';
import { isConfirmToken } from '@tienda/contracts/confirm';
import { createFakeRandom } from './support/harness.js';

test('tokens: generateToken pide 32 bytes y devuelve 43 caracteres base64url que contracts acepta', () => {
  const random = createFakeRandom();
  let pedidos = [];
  const espia = {
    bytes(n) {
      pedidos.push(n);
      return random.bytes(n);
    },
  };
  const token = generateToken(espia);
  assert.deepEqual(pedidos, [32]);
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isConfirmToken(token), true);
});

test('tokens: con bytes deterministas el token es el base64url exacto de esos bytes', () => {
  // bytes 0..31 -> base64url conocido (sin relleno)
  const esperado = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64url');
  assert.equal(generateToken(createFakeRandom()), esperado);
  assert.equal(esperado, 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
});

test('tokens: dos llamadas seguidas dan tokens distintos; bytes con +, / y 0xff usan - y _ en vez de + y /', () => {
  const random = createFakeRandom();
  assert.notEqual(generateToken(random), generateToken(random));
  const unos = { bytes: (n) => new Uint8Array(n).fill(0xfb) }; // 0xfb 0xfb 0xfb = "+/v7" en base64, "-_v7" en base64url
  const token = generateToken(unos);
  assert.doesNotMatch(token, /[+/=]/);
  assert.match(token, /^-_v7/);
});

test('tokens: hashToken es el SHA-256 en hexadecimal (64 caracteres en minúscula)', async () => {
  const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const hash = await hashToken(token);
  assert.equal(hash, createHash('sha256').update(token).digest('hex'));
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('tokens: hashToken es determinista y cambia con un solo carácter', async () => {
  const a = 'A'.repeat(43);
  const b = `${'A'.repeat(42)}B`;
  assert.equal(await hashToken(a), await hashToken(a));
  assert.notEqual(await hashToken(a), await hashToken(b));
});
