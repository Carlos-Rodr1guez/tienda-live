import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmar, respuestas } from '@tienda/contracts/i18n';
import {
  CLEAN_PATH,
  buildConfirmRequest,
  initialConfirmState,
  messageFor,
  parseFragment,
  reduceConfirm,
} from '../../src/lib/confirm/model.js';

const TOKEN = 'A'.repeat(43);
const OTRO_TOKEN = 'abc_DEF-123'.padEnd(43, 'x');

test('fragmento: #t=<43 caracteres base64url> da el token, con o sin el #', () => {
  assert.equal(parseFragment(`#t=${TOKEN}`), TOKEN);
  assert.equal(parseFragment(`t=${OTRO_TOKEN}`), OTRO_TOKEN);
});

test('fragmento: vacío, de otra forma, corto, largo o con caracteres de más no da token', () => {
  for (const malo of [
    '',
    '#',
    '#t=',
    `#t=${'A'.repeat(42)}`,
    `#t=${'A'.repeat(44)}`,
    `#x=${TOKEN}`,
    `#t=${TOKEN}&otro=1`,
    `#t=${'A'.repeat(42)}!`,
    `#t=${TOKEN} `,
    undefined,
    null,
    42,
  ]) {
    assert.equal(parseFragment(malo), null, String(malo));
  }
});

test('estado inicial: con token válido queda listo para confirmar; sin él, sin enlace', () => {
  assert.deepEqual(initialConfirmState(`#t=${TOKEN}`), { fase: 'listo', token: TOKEN });
  assert.deepEqual(initialConfirmState(''), { fase: 'sin-enlace', token: null });
  assert.deepEqual(initialConfirmState('#t=corto'), { fase: 'sin-enlace', token: null });
});

test('confirmar: listo, enviando y confirmado; el token se descarta al terminar', () => {
  let s = initialConfirmState(`#t=${TOKEN}`);
  s = reduceConfirm(s, { type: 'confirmar' });
  assert.deepEqual(s, { fase: 'enviando', token: TOKEN });
  // dos clics seguidos no mandan dos pedidos
  assert.equal(reduceConfirm(s, { type: 'confirmar' }), s);

  s = reduceConfirm(s, { type: 'respuesta', status: 200, body: { ok: true } });
  assert.deepEqual(s, { fase: 'confirmado', token: null });
  assert.equal(reduceConfirm(s, { type: 'confirmar' }), s, 'ya confirmado: no hay nada más que hacer');
});

test('confirmar: un enlace inválido o vencido (400) no se puede reintentar y descarta el token', () => {
  let s = reduceConfirm(initialConfirmState(`#t=${TOKEN}`), { type: 'confirmar' });
  s = reduceConfirm(s, { type: 'respuesta', status: 400, body: { ok: false, error: 'enlace_invalido' } });
  assert.deepEqual(s, { fase: 'invalido', token: null });
  assert.equal(reduceConfirm(s, { type: 'confirmar' }), s);
});

test('confirmar: red caída o error del servidor dejan reintentar con el mismo token', () => {
  for (const evento of [
    { type: 'falloRed' },
    { type: 'respuesta', status: 503, body: { ok: false, error: 'no_disponible' } },
    { type: 'respuesta', status: 500, body: null },
    { type: 'respuesta', status: 403, body: { ok: false, error: 'origen_no_permitido' } },
  ]) {
    let s = reduceConfirm(initialConfirmState(`#t=${TOKEN}`), { type: 'confirmar' });
    s = reduceConfirm(s, evento);
    assert.deepEqual(s, { fase: 'error-red', token: TOKEN }, JSON.stringify(evento));
    s = reduceConfirm(s, { type: 'confirmar' });
    assert.deepEqual(s, { fase: 'enviando', token: TOKEN }, 'reintento');
  }
});

test('confirmar: sin enlace no se puede confirmar, y una respuesta fuera de un envío se ignora', () => {
  const sinEnlace = initialConfirmState('');
  assert.equal(reduceConfirm(sinEnlace, { type: 'confirmar' }), sinEnlace);
  const listo = initialConfirmState(`#t=${TOKEN}`);
  assert.equal(reduceConfirm(listo, { type: 'respuesta', status: 200, body: { ok: true } }), listo);
  assert.equal(reduceConfirm(listo, { type: 'falloRed' }), listo);
});

test('mensajes: cada estado tiene su texto del diccionario', () => {
  assert.equal(messageFor({ fase: 'sin-enlace', token: null }), confirmar.sinEnlace);
  assert.equal(messageFor({ fase: 'listo', token: TOKEN }), confirmar.listo);
  assert.equal(messageFor({ fase: 'enviando', token: TOKEN }), confirmar.enviando);
  assert.equal(messageFor({ fase: 'confirmado', token: null }), respuestas.confirmado);
  assert.equal(messageFor({ fase: 'invalido', token: null }), respuestas.enlace_invalido);
  assert.equal(messageFor({ fase: 'error-red', token: TOKEN }), confirmar.errorRed);
});

test('petición: POST /v1/waitlist/confirm con el token en el cuerpo, nunca en la URL', () => {
  const { url, init } = buildConfirmRequest(TOKEN);
  assert.equal(url, '/v1/waitlist/confirm');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, JSON.stringify({ token: TOKEN }));
  assert.equal(url.includes(TOKEN), false);
  assert.equal(CLEAN_PATH, '/confirmar');
});
