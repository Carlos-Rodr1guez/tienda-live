import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_TOKEN_PATTERN, isConfirmToken, validateConfirm } from '../src/confirm.js';
import { EVENT_NAMES, validateEvent } from '../src/events.js';
import { ERROR_CODES, ERROR_STATUS } from '../src/api-errors.js';
import { CONFIRM_TOKEN_LENGTH } from '../src/limits.js';

const TOKEN = 'A'.repeat(20) + '_-' + 'z9'.repeat(10) + 'Q'; // 20 + 2 + 20 + 1 = 43
const SOLICITUD = { ok: false, error: 'solicitud_invalida' };
const ENLACE = { ok: false, error: 'enlace_invalido' };

test('confirm: el token de prueba mide 43 y es base64url', () => {
  assert.equal(TOKEN.length, CONFIRM_TOKEN_LENGTH);
  assert.match(TOKEN, CONFIRM_TOKEN_PATTERN);
});

test('confirm: isConfirmToken acepta 43 caracteres base64url y nada más', () => {
  assert.equal(isConfirmToken(TOKEN), true);
  assert.equal(isConfirmToken('a'.repeat(43)), true);
  assert.equal(isConfirmToken('a'.repeat(42)), false);
  assert.equal(isConfirmToken('a'.repeat(44)), false);
  assert.equal(isConfirmToken('a'.repeat(42) + '='), false, 'el relleno = no es base64url');
  assert.equal(isConfirmToken('a'.repeat(42) + '+'), false);
  assert.equal(isConfirmToken('a'.repeat(42) + '/'), false);
  assert.equal(isConfirmToken('a'.repeat(42) + ' '), false);
  assert.equal(isConfirmToken('a'.repeat(42) + '\n'), false, 'un salto de línea final no debe colarse');
  assert.equal(isConfirmToken(null), false);
  assert.equal(isConfirmToken(43), false);
});

test('confirm: validateConfirm devuelve el token cuando es válido', () => {
  assert.deepEqual(validateConfirm({ token: TOKEN }), { ok: true, value: { token: TOKEN } });
});

test('confirm: un token mal formado, ausente o de otro tipo es siempre el mismo "enlace_invalido"', () => {
  for (const token of ['', 'corto', TOKEN + 'x', TOKEN.slice(1) + '!', 12, null, undefined, [TOKEN]]) {
    assert.deepEqual(validateConfirm({ token }), ENLACE, JSON.stringify(token));
  }
  assert.deepEqual(validateConfirm({}), ENLACE);
});

test('confirm: una clave de más o un cuerpo que no es objeto es "solicitud_invalida"', () => {
  assert.deepEqual(validateConfirm({ token: TOKEN, extra: 1 }), SOLICITUD);
  for (const entrada of [null, undefined, 'x', 3, [], [TOKEN]]) assert.deepEqual(validateConfirm(entrada), SOLICITUD);
});

test('events: los nombres permitidos son video_play y form_open, congelados', () => {
  assert.deepEqual([...EVENT_NAMES], ['video_play', 'form_open']);
  assert.ok(Object.isFrozen(EVENT_NAMES));
});

test('events: cada nombre permitido es válido y devuelve solo {name}', () => {
  for (const name of EVENT_NAMES) assert.deepEqual(validateEvent({ name }), { ok: true, value: { name } });
});

test('events: nombre desconocido, vacío, ausente o de otro tipo es inválido', () => {
  for (const name of ['page_view', '', 'VIDEO_PLAY', ' form_open', 'form_open\n', 7, null, undefined, ['form_open']]) {
    assert.deepEqual(validateEvent({ name }), SOLICITUD, JSON.stringify(name));
  }
  assert.deepEqual(validateEvent({}), SOLICITUD);
});

test('events: claves de más o un cuerpo que no es objeto son inválidos', () => {
  assert.deepEqual(validateEvent({ name: 'form_open', extra: true }), SOLICITUD);
  assert.deepEqual(validateEvent({ name: 'form_open', user: 'ana' }), SOLICITUD);
  for (const entrada of [null, undefined, 'form_open', 5, [], [{ name: 'form_open' }]]) {
    assert.deepEqual(validateEvent(entrada), SOLICITUD);
  }
});

test('api-errors: los códigos de error son los de la especificación y cada uno tiene su estado HTTP', () => {
  assert.deepEqual(
    { ...ERROR_STATUS },
    {
      campos_invalidos: 400,
      solicitud_invalida: 400,
      enlace_invalido: 400,
      demasiado_grande: 413,
      verificacion_fallida: 403,
      origen_no_permitido: 403,
      no_disponible: 503,
      no_encontrado: 404,
      error_interno: 500,
    },
  );
  assert.deepEqual([...ERROR_CODES].sort(), Object.keys(ERROR_STATUS).sort());
  assert.ok(Object.isFrozen(ERROR_STATUS));
  assert.ok(Object.isFrozen(ERROR_CODES));
});
