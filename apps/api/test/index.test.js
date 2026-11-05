import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createD1Fake } from './support/d1-fake.js';
import { createFakeCtx } from './support/harness.js';

function entorno(extra = {}) {
  return { DB: createD1Fake(), ENVIRONMENT: 'development', SITE_URL: 'http://localhost:4400', ...extra };
}

function evento(env, { name = 'form_open', origin = 'http://localhost:4400', method = 'POST' } = {}) {
  return worker.fetch(
    new Request('http://localhost:8790/v1/events', {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ name }) : undefined,
    }),
    env,
    createFakeCtx(),
  );
}

test('index: el Worker exporta fetch y scheduled', () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
});

test('index: POST /v1/events cuenta el evento en la base del entorno', async () => {
  const env = entorno();
  const res = await evento(env);
  assert.equal(res.status, 204);
  const fila = await env.DB.prepare('SELECT event, count FROM funnel_daily').first();
  assert.deepEqual(fila, { event: 'form_open', count: 1 });
});

test('index: GET /v1/events -> 405 y una ruta desconocida o fuera de /v1 -> 404', async () => {
  const env = entorno();
  assert.equal((await evento(env, { method: 'GET' })).status, 405);
  for (const camino of ['/', '/v1/nada', '/v1/waitlist/otra']) {
    const res = await worker.fetch(new Request(`http://localhost:8790${camino}`), env, createFakeCtx());
    assert.equal(res.status, 404, camino);
  }
  for (const camino of ['/v1/waitlist', '/v1/waitlist/confirm']) {
    const res = await worker.fetch(new Request(`http://localhost:8790${camino}`), env, createFakeCtx());
    assert.equal(res.status, 405, camino);
  }
});

function inscribir(env, ctx = createFakeCtx()) {
  return worker.fetch(
    new Request('http://localhost:8790/v1/waitlist', {
      method: 'POST',
      headers: { origin: 'http://localhost:4400', 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'ana@example.com',
        live_frequency: 'semanal',
        stream_type: 'gaming',
        interests: ['accion'],
        consent: true,
        consent_version: 'v1',
        turnstile_token: 'token-del-widget',
      }),
    }),
    env,
    ctx,
  );
}

test('index: en producción, sin proveedor de correo ni secreto, la inscripción da 503 y no escribe', async () => {
  const env = entorno({ ENVIRONMENT: 'production', SITE_URL: 'http://localhost:4400' });
  const res = await inscribir(env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'no_disponible');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first()).n, 0);
});

test('index: en desarrollo sin secreto de Turnstile, la inscripción da 503 (no hay con qué verificar) y no escribe', async () => {
  const env = entorno();
  const res = await inscribir(env);
  assert.equal(res.status, 503);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first()).n, 0);
});

test('index: la confirmación está cableada (token desconocido -> 400 enlace_invalido)', async () => {
  const res = await worker.fetch(
    new Request('http://localhost:8790/v1/waitlist/confirm', {
      method: 'POST',
      headers: { origin: 'http://localhost:4400', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'A'.repeat(43) }),
    }),
    entorno(),
    createFakeCtx(),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'enlace_invalido');
});

test('index: en producción (sin ENVIRONMENT) solo vale el origen de SITE_URL', async () => {
  const env = entorno({ ENVIRONMENT: 'production', SITE_URL: 'https://tienda.example' });
  assert.equal((await evento(env, { origin: 'https://tienda.example' })).status, 204);
  assert.equal((await evento(env, { origin: 'http://localhost:4400' })).status, 403);
});

test('index: si falta la base, el pedido termina en un 500 uniforme y no en una excepción', async () => {
  const res = await evento(entorno({ DB: undefined }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'error_interno');
});

test('index: scheduled corre la purga de pendientes viejos dentro de waitUntil', async () => {
  const env = entorno();
  const vieja = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  env.DB.sqlite
    .prepare(
      `INSERT INTO waitlist (email, live_frequency, stream_type, interests, consent_version, consent_at, created_at,
         updated_at) VALUES ('vieja@example.com', 'diario', 'charla', '["relax"]', 'v1', ?1, ?1, ?1)`,
    )
    .run(vieja);
  const ctx = createFakeCtx();
  await worker.scheduled({ cron: '17 3 * * *' }, env, ctx);
  assert.equal(ctx.pendientes.length, 1);
  await ctx.settle();
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first()).n, 0);
});
