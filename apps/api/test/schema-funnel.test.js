import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fake } from './support/d1-fake.js';

function insertar(db, fila) {
  return db.sqlite
    .prepare('INSERT INTO funnel_daily (day, event, count) VALUES (?1, ?2, ?3)')
    .run(fila.day, fila.event, fila.count);
}

const VALIDA = { day: '2026-11-05', event: 'form_open', count: 1 };

function acepta(campos, mensaje) {
  assert.doesNotThrow(() => insertar(createD1Fake(), { ...VALIDA, ...campos }), mensaje);
}

function rechaza(campos, mensaje) {
  assert.throws(() => insertar(createD1Fake(), { ...VALIDA, ...campos }), /constraint/i, mensaje);
}

test('funnel_daily: solo guarda día, evento y contador (FM-4: nada de IP, agente, cookie ni referente)', () => {
  const columnas = createD1Fake()
    .sqlite.prepare('PRAGMA table_info(funnel_daily)')
    .all()
    .map((c) => c.name);
  assert.deepEqual(columnas, ['day', 'event', 'count']);
});

test('day: AAAA-MM-DD de 10 caracteres', () => {
  acepta({ day: '2026-11-05' });
  rechaza({ day: '2026-11-5' }, 'sin cero');
  rechaza({ day: '2026-11-05T00:00:00.000Z' }, 'con hora');
  rechaza({ day: '05/11/2026' }, 'otro formato');
  rechaza({ day: null }, 'NULL');
});

test('event: de 1 a 32 caracteres en minúscula y guion bajo (sin lista cerrada en SQL, FM-2)', () => {
  acepta({ event: 'video_play' });
  acepta({ event: 'otro_evento_futuro' }, 'un evento nuevo no necesita migración');
  acepta({ event: 'a' }, '1 carácter');
  acepta({ event: 'a'.repeat(32) }, '32 caracteres');
  rechaza({ event: 'a'.repeat(33) }, '33 caracteres');
  rechaza({ event: '' }, 'vacío');
  rechaza({ event: 'Form_open' }, 'mayúscula');
  rechaza({ event: 'form-open' }, 'guion medio');
  rechaza({ event: 'form open' }, 'espacio');
  rechaza({ event: 'form1' }, 'dígito');
  rechaza({ event: null }, 'NULL');
});

test('count: entero de 1 a 100000', () => {
  acepta({ count: 1 });
  acepta({ count: 100000 });
  rechaza({ count: 0 }, '0');
  rechaza({ count: 100001 }, '100001');
  rechaza({ count: -1 }, 'negativo');
  rechaza({ count: 2.5 }, 'decimal');
  rechaza({ count: null }, 'NULL');
});

test('la clave primaria es (día, evento): se repite el evento solo en otro día', () => {
  const db = createD1Fake();
  insertar(db, VALIDA);
  assert.throws(() => insertar(db, VALIDA), /UNIQUE|PRIMARY/i);
  assert.doesNotThrow(() => insertar(db, { ...VALIDA, day: '2026-11-06' }));
  assert.doesNotThrow(() => insertar(db, { ...VALIDA, event: 'video_play' }));
});

const UPSERT =
  'INSERT INTO funnel_daily (day, event, count) VALUES (?1, ?2, 1) ON CONFLICT (day, event) DO UPDATE SET count = count + 1 WHERE count < 100000';

test('el upsert del diseño crea la fila con 1 y después suma de a uno', async () => {
  const db = createD1Fake();
  const primera = await db.prepare(UPSERT).bind('2026-11-05', 'form_open').run();
  assert.equal(primera.meta.changes, 1);
  await db.prepare(UPSERT).bind('2026-11-05', 'form_open').run();
  await db.prepare(UPSERT).bind('2026-11-05', 'form_open').run();
  await db.prepare(UPSERT).bind('2026-11-05', 'video_play').run();
  const res = await db.prepare('SELECT day, event, count FROM funnel_daily ORDER BY event').all();
  assert.deepEqual(res.results, [
    { day: '2026-11-05', event: 'form_open', count: 3 },
    { day: '2026-11-05', event: 'video_play', count: 1 },
  ]);
});

test('el upsert se satura en 100000: no falla, no suma y no cambia filas', async () => {
  const db = createD1Fake();
  insertar(db, { ...VALIDA, count: 99999 });
  const ultimo = await db.prepare(UPSERT).bind(VALIDA.day, VALIDA.event).run();
  assert.equal(ultimo.meta.changes, 1);
  assert.equal(await db.prepare('SELECT count FROM funnel_daily').first('count'), 100000);
  const saturado = await db.prepare(UPSERT).bind(VALIDA.day, VALIDA.event).run();
  assert.equal(saturado.meta.changes, 0);
  assert.equal(await db.prepare('SELECT count FROM funnel_daily').first('count'), 100000);
});
