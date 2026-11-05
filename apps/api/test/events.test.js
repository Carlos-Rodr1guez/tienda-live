import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, AHORA } from './support/harness.js';
import { eventsRoute } from '../src/events/track.js';
import { utcDay, incrementEvent } from '../src/events/repository.js';
import { createD1Fake } from './support/d1-fake.js';
import { API_RESPONSE_HEADERS } from '@tienda/contracts/security-headers';
import { EVENT_NAMES } from '@tienda/contracts/events';
import { FUNNEL_COUNT_CAP } from '@tienda/contracts/limits';

const armar = () => createHarness({ routes: [eventsRoute] });

const filas = (h) =>
  h.db.sqlite
    .prepare('SELECT day, event, count FROM funnel_daily ORDER BY day, event')
    .all()
    .map((f) => ({ ...f }));

test('events: un evento válido responde 204 sin cuerpo y suma 1 en la fila de hoy (UTC)', async () => {
  const h = await armar();
  const res = await h.post('/v1/events', { name: 'form_open' });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.deepEqual(filas(h), [{ day: '2026-11-05', event: 'form_open', count: 1 }]);
});

test('events: la primera vez crea la fila en 1 y cada evento siguiente suma 1, por nombre', async () => {
  const h = await armar();
  for (let i = 0; i < 3; i += 1) await h.post('/v1/events', { name: 'form_open' });
  await h.post('/v1/events', { name: 'video_play' });
  assert.deepEqual(filas(h), [
    { day: '2026-11-05', event: 'form_open', count: 3 },
    { day: '2026-11-05', event: 'video_play', count: 1 },
  ]);
});

test('events: acepta todos los nombres de la lista de contracts', async () => {
  const h = await armar();
  for (const name of EVENT_NAMES) assert.equal((await h.post('/v1/events', { name })).status, 204, name);
  assert.deepEqual(
    filas(h).map((f) => f.event),
    [...EVENT_NAMES].sort(),
  );
});

test('events: el día cambia a medianoche UTC (reloj falso cruzando 23:59:59.999 -> 00:00:00.000)', async () => {
  const h = await armar();
  h.clock.set(Date.parse('2026-11-05T23:59:59.999Z'));
  await h.post('/v1/events', { name: 'form_open' });
  h.clock.set(Date.parse('2026-11-06T00:00:00.000Z'));
  await h.post('/v1/events', { name: 'form_open' });
  await h.post('/v1/events', { name: 'form_open' });
  assert.deepEqual(filas(h), [
    { day: '2026-11-05', event: 'form_open', count: 1 },
    { day: '2026-11-06', event: 'form_open', count: 2 },
  ]);
});

test('events: el día es UTC aunque la zona horaria de la máquina sea otra', () => {
  // 2026-11-05T23:30:00-05:00 es ya el 6 en UTC
  assert.equal(utcDay(Date.parse('2026-11-05T23:30:00-05:00')), '2026-11-06');
  assert.equal(utcDay(Date.parse('2026-11-05T00:30:00+05:00')), '2026-11-04');
  assert.equal(utcDay(AHORA), '2026-11-05');
});

test('events: el contador se satura en 100000 y sigue respondiendo 204', async () => {
  const h = await armar();
  h.db.sqlite
    .prepare('INSERT INTO funnel_daily (day, event, count) VALUES (?, ?, ?)')
    .run('2026-11-05', 'form_open', FUNNEL_COUNT_CAP - 1);
  assert.equal((await h.post('/v1/events', { name: 'form_open' })).status, 204);
  assert.equal(filas(h)[0].count, FUNNEL_COUNT_CAP);
  const saturado = await h.post('/v1/events', { name: 'form_open' });
  assert.equal(saturado.status, 204);
  assert.equal(filas(h)[0].count, FUNNEL_COUNT_CAP);
});

test('events: un evento saturado no afecta a otro evento ni a otro día', async () => {
  const h = await armar();
  h.db.sqlite
    .prepare('INSERT INTO funnel_daily (day, event, count) VALUES (?, ?, ?)')
    .run('2026-11-05', 'form_open', FUNNEL_COUNT_CAP);
  await h.post('/v1/events', { name: 'video_play' });
  h.clock.set(Date.parse('2026-11-06T01:00:00.000Z'));
  await h.post('/v1/events', { name: 'form_open' });
  assert.deepEqual(filas(h), [
    { day: '2026-11-05', event: 'form_open', count: FUNNEL_COUNT_CAP },
    { day: '2026-11-05', event: 'video_play', count: 1 },
    { day: '2026-11-06', event: 'form_open', count: 1 },
  ]);
});

test('events: un nombre desconocido, vacío, de otro tipo o con claves de más -> 400 y no escribe nada', async () => {
  const h = await armar();
  for (const cuerpo of [
    { name: 'compra' },
    { name: '' },
    { name: 5 },
    { name: null },
    {},
    { name: 'form_open', extra: 1 },
  ]) {
    const res = await h.post('/v1/events', cuerpo);
    assert.equal(res.status, 400, JSON.stringify(cuerpo));
    assert.equal((await res.json()).error, 'solicitud_invalida');
  }
  assert.deepEqual(filas(h), []);
});

test('events: GET (y cualquier método que no sea POST) -> 405 y no escribe nada', async () => {
  const h = await armar();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await h.request('/v1/events', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST');
  }
  assert.deepEqual(filas(h), []);
});

test('events: origen ajeno -> 403, tipo de contenido incorrecto -> 415, cuerpo grande -> 413; ninguno escribe', async () => {
  const h = await armar();
  assert.equal((await h.post('/v1/events', { name: 'form_open' }, { origin: 'https://malo.example' })).status, 403);
  assert.equal((await h.post('/v1/events', { name: 'form_open' }, { origin: null })).status, 403);
  assert.equal(
    (await h.request('/v1/events', { headers: { 'content-type': 'text/plain' }, body: '{"name":"form_open"}' })).status,
    415,
  );
  assert.equal((await h.post('/v1/events', JSON.stringify({ name: 'form_open', x: 'y'.repeat(300) }))).status, 413);
  assert.deepEqual(filas(h), []);
});

test('events: el tope del cuerpo es de 256 bytes', async () => {
  const h = await armar();
  const justo = JSON.stringify({ name: 'form_open' }).padEnd(256, ' ');
  assert.equal(justo.length, 256);
  assert.equal((await h.post('/v1/events', justo)).status, 204);
  assert.equal((await h.post('/v1/events', `${justo} `)).status, 413);
});

test('events: no pone cookies y lleva las cabeceras de la API', async () => {
  const h = await armar();
  const res = await h.post('/v1/events', { name: 'form_open' });
  assert.equal(res.headers.has('set-cookie'), false);
  for (const [nombre, valor] of Object.entries(API_RESPONSE_HEADERS))
    assert.equal(res.headers.get(nombre), valor, nombre);
});

test('events: solo se guardan día, evento y contador (nada del pedido llega a la base)', async () => {
  const h = await armar();
  await h.post(
    '/v1/events',
    { name: 'form_open' },
    { headers: { 'user-agent': 'PruebaBot/1.0', referer: 'https://x.example/ruta', cookie: 'a=b' } },
  );
  const columnas = h.db.sqlite
    .prepare('PRAGMA table_info(funnel_daily)')
    .all()
    .map((c) => c.name);
  assert.deepEqual(columnas, ['day', 'event', 'count']);
  const volcado = JSON.stringify(h.db.sqlite.prepare('SELECT * FROM funnel_daily').all());
  assert.doesNotMatch(volcado, /PruebaBot|x\.example|a=b/);
  assert.doesNotMatch(h.spy.texto(), /PruebaBot|x\.example|a=b/);
});

test('repository: incrementEvent devuelve true si sumó y false si estaba saturado', async () => {
  const db = createD1Fake();
  assert.equal(await incrementEvent(db, '2026-11-05', 'form_open'), true);
  db.sqlite.prepare('UPDATE funnel_daily SET count = ?').run(FUNNEL_COUNT_CAP);
  assert.equal(await incrementEvent(db, '2026-11-05', 'form_open'), false);
});
