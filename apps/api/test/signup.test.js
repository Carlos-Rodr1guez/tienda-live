import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarLista,
  createFakeMailer,
  createFakeTurnstile,
  cuerpoValido,
  filasDeLista,
  tokenDelUltimoCorreo,
} from './support/waitlist-harness.js';
import { AHORA } from './support/harness.js';
import { hashToken } from '../src/waitlist/tokens.js';
import { confirmByTokenHash } from '../src/waitlist/repository.js';
import { respuestas } from '@tienda/contracts/i18n';
import { API_RESPONSE_HEADERS } from '@tienda/contracts/security-headers';
import { BODY_CAPS } from '@tienda/contracts/limits';

const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const firmar = (h, extra, opciones) => h.post('/v1/waitlist', cuerpoValido(extra), opciones);

/** Estado completo de una respuesta, para compararlas byte a byte. */
async function huella(res) {
  return JSON.stringify({ status: res.status, headers: [...res.headers].sort(), cuerpo: await res.text() });
}

test('signup: un correo nuevo da 202 con el mensaje de éxito, crea la fila pendiente y manda un correo', async () => {
  const h = await armarLista();
  const res = await firmar(h);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, mensaje: respuestas.exito });
  await h.ctx.settle();

  const filas = filasDeLista(h);
  assert.equal(filas.length, 1);
  const f = filas[0];
  assert.equal(f.email, 'ana@example.com', 'el correo se guarda normalizado');
  assert.equal(f.live_frequency, 'semanal');
  assert.equal(f.stream_type, 'gaming');
  assert.equal(f.confirmed_at, null);
  assert.equal(f.consent_version, 'v1');
  assert.equal(f.consent_at, iso(AHORA));
  assert.equal(f.created_at, iso(AHORA));
  assert.equal(f.token_expires_at, iso(AHORA + 48 * 60 * MIN));
  assert.equal(f.recent_sends, JSON.stringify([iso(AHORA)]));
  assert.equal(h.mailer.enviados.length, 1);
  assert.equal(h.mailer.enviados[0].to, 'ana@example.com');
});

test('signup: los intereses se guardan ordenados como CATEGORIES (["metas","accion"] -> ["accion","metas"]) (A4)', async () => {
  const h = await armarLista();
  await firmar(h, { interests: ['metas', 'accion'] });
  assert.equal(filasDeLista(h)[0].interests, '["accion","metas"]');
  await firmar(h, { email: 'b@example.com', interests: ['relax', 'publico', 'metas', 'accion'] });
  assert.equal(filasDeLista(h)[1].interests, '["accion","publico","relax","metas"]');
});

test('signup: los opcionales ausentes quedan en NULL y los presentes se guardan', async () => {
  const h = await armarLista();
  await firmar(h);
  const f = filasDeLista(h)[0];
  assert.equal(f.tiktok_user, null);
  assert.equal(f.followers_range, null);
  assert.equal(f.country, null);
  await firmar(h, { email: 'b@example.com', tiktok_user: '@ana.live', followers_range: '1k-9k', country: 'MX' });
  const g = filasDeLista(h)[1];
  assert.equal(g.tiktok_user, 'ana.live');
  assert.equal(g.followers_range, '1k-9k');
  assert.equal(g.country, 'MX');
});

test('signup: el enlace del correo lleva el token en el fragmento y la base solo guarda su SHA-256', async () => {
  const h = await armarLista();
  await firmar(h);
  await h.ctx.settle();
  const { link } = h.mailer.enviados[0];
  const token = tokenDelUltimoCorreo(h);
  assert.equal(link, `${h.config.siteUrl}/confirmar#t=${token}`);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const f = filasDeLista(h)[0];
  assert.equal(f.token_hash, await hashToken(token));
  assert.doesNotMatch(JSON.stringify(f), new RegExp(token), 'el token en claro no está en ninguna columna');
});

test('signup: el correo sale con waitUntil, después de responder (la respuesta no espera al correo)', async () => {
  let soltar;
  const bloqueado = new Promise((resolve) => {
    soltar = resolve;
  });
  const mailer = createFakeMailer();
  const lento = {
    enviados: mailer.enviados,
    sendConfirmation(m) {
      mailer.enviados.push(m);
      return bloqueado;
    },
  };
  const h = await armarLista({ mailer: lento });
  const res = await firmar(h);
  assert.equal(res.status, 202, 'respondió aunque el correo sigue sin terminar');
  assert.equal(h.ctx.pendientes.length, 1);
  soltar();
  await h.ctx.settle();
});

test('signup: 202 idéntico byte a byte para correo nuevo, pendiente reenviado, pendiente frenado y ya confirmado', async () => {
  const h = await armarLista();
  const nuevo = await huella(await firmar(h));
  h.clock.advance(11 * MIN);
  const reenviado = await huella(await firmar(h));
  h.clock.advance(1 * MIN);
  const frenado = await huella(await firmar(h));
  const token = tokenDelUltimoCorreo(h);
  await h.post('/v1/waitlist/confirm', { token });
  const confirmado = await huella(await firmar(h));
  assert.equal(h.mailer.enviados.length, 2, 'solo el nuevo y el reenviado mandaron correo');
  assert.equal(reenviado, nuevo);
  assert.equal(frenado, nuevo);
  assert.equal(confirmado, nuevo);
  assert.equal(JSON.parse(JSON.parse(nuevo).cuerpo).ok, true);
});

test('signup: campos inválidos -> 400 con todos los campos y SIN llamar a Turnstile ni escribir', async () => {
  const h = await armarLista();
  const res = await firmar(h, { email: 'no-es-correo', interests: [], consent: false });
  assert.equal(res.status, 400);
  const cuerpo = await res.json();
  assert.equal(cuerpo.error, 'campos_invalidos');
  assert.deepEqual(cuerpo.campos, { email: 'formato', interests: 'cantidad', consent: 'consentimiento' });
  assert.equal(h.turnstile.llamadas.length, 0);
  assert.equal(filasDeLista(h).length, 0);
});

test('signup: el orden de WL-1 -> JSON roto/clave de más (400) antes que campos, y ambos antes que Turnstile', async () => {
  const h = await armarLista();
  assert.equal((await h.post('/v1/waitlist', '{no es json')).status, 400);
  assert.equal((await firmar(h, { extra: 1 })).status, 400);
  assert.equal((await firmar(h, { consent_version: 'v0' })).status, 400);
  assert.equal(h.turnstile.llamadas.length, 0);
});

test('signup: sin turnstile_token, o con uno de más de 2048 caracteres -> 403 verificacion_fallida, sin consultar ni escribir', async () => {
  const h = await armarLista();
  const sinToken = cuerpoValido();
  delete sinToken.turnstile_token;
  for (const cuerpo of [
    sinToken,
    cuerpoValido({ turnstile_token: 'x'.repeat(2049) }),
    cuerpoValido({ turnstile_token: '' }),
  ]) {
    const res = await h.post('/v1/waitlist', cuerpo);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'verificacion_fallida');
  }
  assert.equal(h.turnstile.llamadas.length, 0);
  assert.equal(filasDeLista(h).length, 0);
});

test('signup: Turnstile rechaza -> 403 verificacion_fallida, sin fila y sin correo', async () => {
  const h = await armarLista();
  const res = await firmar(h, { turnstile_token: 'token-falso' });
  assert.equal(res.status, 403);
  const cuerpo = await res.json();
  assert.equal(cuerpo.error, 'verificacion_fallida');
  assert.equal(cuerpo.mensaje, respuestas.verificacion_fallida);
  await h.ctx.settle();
  assert.equal(filasDeLista(h).length, 0);
  assert.equal(h.mailer.enviados.length, 0);
});

test('signup: Turnstile no disponible -> 503 no_disponible, sin fila y sin correo', async () => {
  const h = await armarLista({ turnstile: createFakeTurnstile({ ok: false, reason: 'no_disponible' }) });
  const res = await firmar(h);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'no_disponible');
  assert.equal(filasDeLista(h).length, 0);
  assert.equal(h.mailer.enviados.length, 0);
});

test('signup: sin proveedor de correo (mailer null) -> 503 no_disponible y no se escribe nada', async () => {
  const h = await armarLista({ mailer: null });
  const res = await firmar(h);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'no_disponible');
  assert.equal(filasDeLista(h).length, 0);
  assert.equal(h.turnstile.llamadas.length, 1, 'Turnstile va antes que la comprobación del correo');
});

test('signup: con mailer null y Turnstile rechazando, gana el 403 (Turnstile va primero)', async () => {
  const h = await armarLista({ mailer: null });
  const res = await firmar(h, { turnstile_token: 'token-falso' });
  assert.equal(res.status, 403);
});

test('signup: reenvío frenado -> a los 5 minutos 202 con 1 solo correo y el mismo token; a los 11 minutos 2 correos y el viejo muere', async () => {
  const h = await armarLista();
  await firmar(h);
  const tokenViejo = tokenDelUltimoCorreo(h);
  const hashViejo = filasDeLista(h)[0].token_hash;

  h.clock.advance(5 * MIN);
  assert.equal((await firmar(h)).status, 202);
  await h.ctx.settle();
  assert.equal(h.mailer.enviados.length, 1);
  assert.equal(filasDeLista(h)[0].token_hash, hashViejo, 'sin token nuevo');
  assert.equal(filasDeLista(h)[0].recent_sends, JSON.stringify([iso(AHORA)]));

  h.clock.advance(6 * MIN); // t0 + 11 min
  assert.equal((await firmar(h)).status, 202);
  await h.ctx.settle();
  assert.equal(h.mailer.enviados.length, 2);
  const tokenNuevo = tokenDelUltimoCorreo(h);
  assert.notEqual(tokenNuevo, tokenViejo);
  assert.deepEqual(JSON.parse(filasDeLista(h)[0].recent_sends), [iso(AHORA), iso(AHORA + 11 * MIN)]);

  // el enlace viejo ya no confirma; el nuevo sí
  const viejo = await h.post('/v1/waitlist/confirm', { token: tokenViejo });
  assert.equal(viejo.status, 400);
  assert.equal((await h.post('/v1/waitlist/confirm', { token: tokenNuevo })).status, 200);
});

test('signup: tope de 5 envíos en 24 horas -> deja de enviar; pasadas las 24 horas vuelve a enviar', async () => {
  const h = await armarLista();
  for (let i = 0; i < 5; i += 1) {
    await firmar(h);
    h.clock.advance(11 * MIN);
  }
  await h.ctx.settle();
  assert.equal(h.mailer.enviados.length, 5);
  assert.equal((await firmar(h)).status, 202);
  await h.ctx.settle();
  assert.equal(h.mailer.enviados.length, 5, 'el sexto intento dentro de 24 h no manda');
  h.clock.set(AHORA + 24 * 60 * MIN + 1);
  await firmar(h);
  await h.ctx.settle();
  assert.equal(h.mailer.enviados.length, 6);
});

test('signup: volver a anotarse siendo pendiente reemplaza el perfil y el consentimiento y reinicia los 7 días', async () => {
  const h = await armarLista();
  await firmar(h, { stream_type: 'gaming', interests: ['accion'] });
  h.clock.advance(5 * MIN); // frenado: sin token nuevo, pero el perfil se actualiza igual
  await firmar(h, { stream_type: 'musica', interests: ['relax', 'publico'], country: 'AR' });
  const [f] = filasDeLista(h);
  assert.equal(filasDeLista(h).length, 1);
  assert.equal(f.stream_type, 'musica');
  assert.equal(f.interests, '["publico","relax"]');
  assert.equal(f.country, 'AR');
  assert.equal(f.created_at, iso(AHORA + 5 * MIN));
  assert.equal(f.consent_at, iso(AHORA + 5 * MIN));
  assert.equal(f.updated_at, iso(AHORA + 5 * MIN));
});

test('signup: el mismo correo en otra escritura (mayúsculas, espacios) es la misma persona', async () => {
  const h = await armarLista();
  await firmar(h, { email: 'ana@example.com' });
  await firmar(h, { email: '  ANA@Example.COM ' });
  assert.equal(filasDeLista(h).length, 1);
});

test('signup: un correo ya confirmado no se toca, no manda correo y responde igual', async () => {
  const h = await armarLista();
  await firmar(h, { stream_type: 'gaming' });
  await h.post('/v1/waitlist/confirm', { token: tokenDelUltimoCorreo(h) });
  const antes = filasDeLista(h)[0];
  h.clock.advance(60 * MIN);
  const res = await firmar(h, { stream_type: 'estudio', country: 'ES' });
  assert.equal(res.status, 202);
  await h.ctx.settle();
  assert.deepEqual(filasDeLista(h)[0], antes);
  assert.equal(h.mailer.enviados.length, 1);
});

test('signup: carrera UNIQUE -> si otro pedido inserta el mismo correo en medio, se reintenta como actualización', async () => {
  const h = await armarLista();
  const real = h.ports.db;
  let primera = true;
  // La primera búsqueda dice "no existe" y, justo antes, otro pedido inserta la fila (la carrera).
  h.ports.db = {
    sqlite: real.sqlite,
    batch: real.batch,
    prepare(sql) {
      const sentencia = real.prepare(sql);
      if (!sql.startsWith('SELECT id, confirmed_at') || !primera) return sentencia;
      return {
        bind: () => ({
          first: async () => {
            primera = false;
            real.sqlite
              .prepare(
                `INSERT INTO waitlist (email, live_frequency, stream_type, interests, consent_version, consent_at,
                   created_at, updated_at, token_hash, token_expires_at, recent_sends)
                 VALUES ('ana@example.com', 'diario', 'charla', '["relax"]', 'v1', ?1, ?1, ?1, ?2, ?3, ?4)`,
              )
              .run(iso(AHORA), 'd'.repeat(64), iso(AHORA + 48 * 60 * MIN), JSON.stringify([iso(AHORA)]));
            return null;
          },
        }),
      };
    },
  };
  const res = await firmar(h, { stream_type: 'gaming' });
  assert.equal(res.status, 202);
  await h.ctx.settle();
  const filas = filasDeLista(h);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].stream_type, 'gaming', 'el segundo pedido gana el perfil');
  assert.equal(h.mailer.enviados.length, 0, 'el otro pedido ya envió: el enfriamiento frena un segundo correo');
});

test('signup: un fallo del correo (rechazo o excepción) no cambia la respuesta y se registra solo con el nombre del error', async () => {
  for (const fallo of ['rechaza', 'lanza']) {
    const h = await armarLista({ mailer: createFakeMailer({ fallo }) });
    const res = await firmar(h);
    assert.equal(res.status, 202, fallo);
    await h.ctx.settle();
    assert.equal(filasDeLista(h).length, 1);
    const lineas = h.spy.lineas.filter((l) => l.nivel === 'error');
    assert.equal(lineas.length, 1, fallo);
    assert.deepEqual(JSON.parse(lineas[0].linea), { nivel: 'error', evento: 'mail.error', codigo: 'TypeError' });
  }
});

test('signup: nada de la persona llega al registro (ni correo, ni token, ni enlace) ni a la respuesta', async () => {
  const h = await armarLista();
  const res = await firmar(h, { tiktok_user: 'ana.live' });
  await h.ctx.settle();
  const token = tokenDelUltimoCorreo(h);
  const registro = h.spy.texto();
  for (const secreto of ['ana@example.com', 'ana.live', token, 'confirmar', 'token-bueno']) {
    assert.ok(!registro.includes(secreto), `el registro no debe tener ${secreto}`);
  }
  const cuerpo = await res.text();
  assert.ok(!cuerpo.includes(token) && !cuerpo.includes('ana@example.com'));
});

test('signup: sin cookies y con las cabeceras de la API en éxito y en error', async () => {
  const h = await armarLista();
  for (const res of [await firmar(h), await firmar(h, { email: 'x' }), await firmar(h, { turnstile_token: 'malo' })]) {
    assert.equal(res.headers.has('set-cookie'), false);
    for (const [nombre, valor] of Object.entries(API_RESPONSE_HEADERS))
      assert.equal(res.headers.get(nombre), valor, nombre);
  }
});

test('signup: Origin fuera de la lista -> 403 origen_no_permitido, sin consultar Turnstile ni escribir (A6)', async () => {
  const h = await armarLista();
  for (const origin of ['https://malo.example', null, 'http://localhost:9999']) {
    const res = await firmar(h, {}, { origin });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'origen_no_permitido');
  }
  assert.equal(h.turnstile.llamadas.length, 0);
  assert.equal(filasDeLista(h).length, 0);
});

test('signup: Sec-Fetch-Site cross-site (o same-site) -> 403 origen_no_permitido y no escribe (A6)', async () => {
  const h = await armarLista();
  for (const sitio of ['cross-site', 'same-site', 'none']) {
    const res = await firmar(h, {}, { headers: { 'sec-fetch-site': sitio } });
    assert.equal(res.status, 403, sitio);
    assert.equal((await res.json()).error, 'origen_no_permitido');
  }
  assert.equal((await firmar(h, {}, { headers: { 'sec-fetch-site': 'same-origin' } })).status, 202);
  assert.equal(filasDeLista(h).length, 1);
});

test('signup: GET -> 405; cuerpo de más de 4096 bytes -> 413; texto plano -> 415; ninguno escribe', async () => {
  const h = await armarLista();
  assert.equal((await h.request('/v1/waitlist', { method: 'GET' })).status, 405);
  const grande = JSON.stringify(cuerpoValido({ turnstile_token: 'x'.repeat(BODY_CAPS.waitlist) }));
  assert.equal((await h.post('/v1/waitlist', grande)).status, 413);
  const plano = await h.request('/v1/waitlist', { headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plano.status, 415);
  assert.equal(filasDeLista(h).length, 0);
});

test('signup: el token vencido y el confirmado no se mezclan -> un correo confirmado no vuelve a pendiente', async () => {
  const h = await armarLista();
  await firmar(h);
  const token = tokenDelUltimoCorreo(h);
  assert.equal(await confirmByTokenHash(h.db, await hashToken(token), iso(AHORA + MIN)), true);
  h.clock.advance(30 * MIN);
  await firmar(h);
  const [f] = filasDeLista(h);
  assert.equal(f.confirmed_at, iso(AHORA + MIN));
  assert.equal(f.token_hash, null);
});
