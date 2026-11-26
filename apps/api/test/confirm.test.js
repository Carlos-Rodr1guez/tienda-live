import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarLista, cuerpoValido, filasDeLista, tokenDelUltimoCorreo } from './support/waitlist-harness.js';
import { AHORA } from './support/harness.js';
import { respuestas } from '@tienda/contracts/i18n';
import { API_RESPONSE_HEADERS } from '@tienda/contracts/security-headers';

const SEG = 1000;
const HORAS_48 = 48 * 60 * 60 * SEG;
const iso = (ms) => new Date(ms).toISOString();

/** Una persona anotada, con su token en claro tomado del correo. */
async function conPendiente() {
  const h = await armarLista();
  assert.equal((await h.post('/v1/waitlist', cuerpoValido())).status, 202);
  await h.ctx.settle();
  return { h, token: tokenDelUltimoCorreo(h) };
}

const confirmar = (h, cuerpo, opciones) => h.post('/v1/waitlist/confirm', cuerpo, opciones);

test('confirm: un token válido confirma una vez -> 200 con el mensaje de confirmación', async () => {
  const { h, token } = await conPendiente();
  h.clock.advance(60 * SEG);
  const res = await confirmar(h, { token });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, mensaje: respuestas.confirmado });
  const [f] = filasDeLista(h);
  assert.equal(f.confirmed_at, iso(AHORA + 60 * SEG));
  assert.equal(f.updated_at, iso(AHORA + 60 * SEG));
  assert.equal(f.token_hash, null);
  assert.equal(f.token_expires_at, null);
});

test('confirm: reusar el mismo enlace -> 400 enlace_invalido y la fila no cambia', async () => {
  const { h, token } = await conPendiente();
  assert.equal((await confirmar(h, { token })).status, 200);
  const antes = filasDeLista(h);
  h.clock.advance(60 * SEG);
  const res = await confirmar(h, { token });
  assert.equal(res.status, 400);
  const cuerpo = await res.json();
  assert.equal(cuerpo.error, 'enlace_invalido');
  assert.equal(cuerpo.mensaje, respuestas.enlace_invalido);
  assert.deepEqual(filasDeLista(h), antes);
});

test('confirm: vencido, desconocido, mal formado, ausente o de otro tipo -> el mismo 400, byte a byte', async () => {
  const { h, token } = await conPendiente();
  h.clock.advance(HORAS_48 + SEG);
  const vencido = await confirmar(h, { token });
  const desconocido = await confirmar(h, { token: 'A'.repeat(43) });
  const corto = await confirmar(h, { token: 'abc' });
  const ausente = await confirmar(h, {});
  const numero = await confirmar(h, { token: 12345 });
  const nulo = await confirmar(h, { token: null });
  const huellas = [];
  for (const res of [vencido, desconocido, corto, ausente, numero, nulo]) {
    assert.equal(res.status, 400);
    huellas.push(JSON.stringify({ headers: [...res.headers].sort(), cuerpo: await res.text() }));
  }
  assert.equal(new Set(huellas).size, 1, 'todas las respuestas son idénticas');
  assert.equal(JSON.parse(JSON.parse(huellas[0]).cuerpo).error, 'enlace_invalido');
  assert.equal(filasDeLista(h)[0].confirmed_at, null, 'el vencido no confirmó nada');
});

test('confirm: el vencimiento es de 48 horas: a 48 h - 1 s sirve; a 48 h exactas y a 48 h + 1 s no', async () => {
  const a = await conPendiente();
  a.h.clock.set(AHORA + HORAS_48 - SEG);
  assert.equal((await confirmar(a.h, { token: a.token })).status, 200);

  const b = await conPendiente();
  b.h.clock.set(AHORA + HORAS_48);
  assert.equal((await confirmar(b.h, { token: b.token })).status, 400);

  const c = await conPendiente();
  c.h.clock.set(AHORA + HORAS_48 + SEG);
  assert.equal((await confirmar(c.h, { token: c.token })).status, 400);
});

test('confirm: GET (con o sin consulta) -> 405 y la tabla queda exactamente igual', async () => {
  const { h, token } = await conPendiente();
  const antes = filasDeLista(h);
  for (const camino of [
    '/v1/waitlist/confirm',
    `/v1/waitlist/confirm?t=${token}`,
    `/v1/waitlist/confirm?token=${token}`,
  ]) {
    const res = await h.request(camino, { method: 'GET' });
    assert.equal(res.status, 405, camino);
    assert.equal(res.headers.get('allow'), 'POST');
  }
  assert.deepEqual(filasDeLista(h), antes);
  assert.equal(antes[0].confirmed_at, null);
});

test('confirm: la base nunca guarda el token en claro, ni antes ni después de confirmar', async () => {
  const { h, token } = await conPendiente();
  const volcado = () => JSON.stringify(h.db.sqlite.prepare('SELECT * FROM waitlist').all());
  assert.ok(!volcado().includes(token));
  await confirmar(h, { token });
  assert.ok(!volcado().includes(token));
  assert.ok(!h.spy.texto().includes(token));
});

test('confirm: Origin fuera de la lista -> 403 origen_no_permitido y el token no se consume (A6)', async () => {
  const { h, token } = await conPendiente();
  for (const origin of ['https://malo.example', null]) {
    const res = await confirmar(h, { token }, { origin });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'origen_no_permitido');
  }
  assert.equal(filasDeLista(h)[0].confirmed_at, null);
  assert.ok(filasDeLista(h)[0].token_hash, 'el token sigue vivo');
  assert.equal((await confirmar(h, { token })).status, 200);
});

test('confirm: Sec-Fetch-Site cross-site -> 403 origen_no_permitido y el token no se consume (A6)', async () => {
  const { h, token } = await conPendiente();
  const res = await confirmar(h, { token }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'origen_no_permitido');
  assert.equal(filasDeLista(h)[0].confirmed_at, null);
  assert.equal((await confirmar(h, { token }, { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
});

test('confirm: una clave de más -> 400 solicitud_invalida; texto plano -> 415; más de 512 bytes -> 413; nada se consume', async () => {
  const { h, token } = await conPendiente();
  const extra = await confirmar(h, { token, otra: 1 });
  assert.equal(extra.status, 400);
  assert.equal((await extra.json()).error, 'solicitud_invalida');
  const plano = await h.request('/v1/waitlist/confirm', { headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plano.status, 415);
  assert.equal((await confirmar(h, JSON.stringify({ token, relleno: 'x'.repeat(600) }))).status, 413);
  assert.equal(filasDeLista(h)[0].confirmed_at, null);
});

test('confirm: sin cookies, con las cabeceras de la API y sin tocar a otras personas', async () => {
  const { h, token } = await conPendiente();
  await h.post('/v1/waitlist', cuerpoValido({ email: 'otra@example.com' }));
  const res = await confirmar(h, { token });
  assert.equal(res.headers.has('set-cookie'), false);
  for (const [nombre, valor] of Object.entries(API_RESPONSE_HEADERS))
    assert.equal(res.headers.get(nombre), valor, nombre);
  const [ana, otra] = filasDeLista(h);
  assert.ok(ana.confirmed_at);
  assert.equal(otra.confirmed_at, null);
});
