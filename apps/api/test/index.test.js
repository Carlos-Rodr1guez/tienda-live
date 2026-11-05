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
  for (const camino of ['/', '/v1/nada', '/v1/waitlist']) {
    const res = await worker.fetch(new Request(`http://localhost:8790${camino}`), env, createFakeCtx());
    assert.equal(res.status, 404, camino);
  }
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

test('index: scheduled responde sin fallar aunque todavía no haya tareas', async () => {
  const ctx = createFakeCtx();
  await worker.scheduled({ cron: '17 3 * * *' }, entorno(), ctx);
  assert.equal(ctx.pendientes.length, 0);
});
