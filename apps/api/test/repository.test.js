import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fake } from './support/d1-fake.js';
import {
  CONFIRM_SQL,
  findByEmail,
  insertPending,
  rotatePending,
  replacePending,
  confirmByTokenHash,
  purgePending,
} from '../src/waitlist/repository.js';

const AHORA = '2026-11-05T12:00:00.000Z';
const MAS_48H = '2026-11-07T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const perfil = (extra = {}) => ({
  email: 'ana@example.com',
  tiktok_user: 'ana.live',
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['accion', 'metas'],
  followers_range: '100-999',
  country: 'AR',
  consent_version: 'v1',
  ...extra,
});

const fila = (db, email = 'ana@example.com') => ({
  ...db.sqlite.prepare('SELECT * FROM waitlist WHERE email = ?').get(email),
});

const nuevo = (db, extra = {}) =>
  insertPending(db, {
    perfil: perfil(),
    ahora: AHORA,
    tokenHash: HASH_A,
    tokenExpiresAt: MAS_48H,
    recentSends: [AHORA],
    ...extra,
  });

test('repository: la sentencia de confirmar es exactamente la del diseño (A5)', () => {
  assert.equal(
    CONFIRM_SQL,
    'UPDATE waitlist SET confirmed_at=?2, updated_at=?2, token_hash=NULL, token_expires_at=NULL ' +
      'WHERE token_hash=?1 AND confirmed_at IS NULL AND token_expires_at > ?2',
  );
});

test('repository: findByEmail devuelve null si no existe y los datos mínimos si existe', async () => {
  const db = createD1Fake();
  assert.equal(await findByEmail(db, 'ana@example.com'), null);
  await nuevo(db);
  assert.deepEqual(await findByEmail(db, 'ana@example.com'), {
    id: 1,
    confirmedAt: null,
    createdAt: AHORA,
    recentSends: [AHORA],
    recentSendsRaw: JSON.stringify([AHORA]),
  });
  assert.equal(await findByEmail(db, 'otra@example.com'), null);
});

test('repository: insertPending guarda el perfil, el consentimiento y solo el hash del token', async () => {
  const db = createD1Fake();
  await nuevo(db);
  const f = fila(db);
  assert.equal(f.email, 'ana@example.com');
  assert.equal(f.tiktok_user, 'ana.live');
  assert.equal(f.live_frequency, 'semanal');
  assert.equal(f.stream_type, 'gaming');
  assert.equal(f.interests, '["accion","metas"]');
  assert.equal(f.followers_range, '100-999');
  assert.equal(f.country, 'AR');
  assert.equal(f.consent_version, 'v1');
  assert.equal(f.consent_at, AHORA);
  assert.equal(f.created_at, AHORA);
  assert.equal(f.updated_at, AHORA);
  assert.equal(f.confirmed_at, null);
  assert.equal(f.token_hash, HASH_A);
  assert.equal(f.token_expires_at, MAS_48H);
  assert.equal(f.recent_sends, JSON.stringify([AHORA]));
});

test('repository: los opcionales ausentes se guardan como NULL', async () => {
  const db = createD1Fake();
  await nuevo(db, { perfil: perfil({ tiktok_user: null, followers_range: null, country: null }) });
  const f = fila(db);
  assert.equal(f.tiktok_user, null);
  assert.equal(f.followers_range, null);
  assert.equal(f.country, null);
});

test('repository: insertar el mismo correo dos veces rompe por UNIQUE (la API reintenta como actualización)', async () => {
  const db = createD1Fake();
  await nuevo(db);
  await assert.rejects(() => nuevo(db, { tokenHash: HASH_B }), /UNIQUE/);
});

const DESPUES = '2026-11-06T09:00:00.000Z';
const MUTABLES = ['token_hash', 'token_expires_at', 'recent_sends', 'updated_at'];
const ENVIO_B = { tokenHash: HASH_B, tokenExpiresAt: '2026-11-08T09:00:00.000Z', recentSends: [AHORA, DESPUES] };

test('repository: rotatePending cambia SOLO el token, su vencimiento, los envíos y updated_at (perfil, consentimiento y created_at intactos)', async () => {
  const db = createD1Fake();
  await nuevo(db);
  const antes = fila(db);
  const cambios = await rotatePending(db, 1, {
    ahora: DESPUES,
    envio: ENVIO_B,
    recentSendsLeido: JSON.stringify([AHORA]),
  });
  assert.equal(cambios, 1);
  const f = fila(db);
  assert.equal(f.token_hash, HASH_B);
  assert.equal(f.token_expires_at, '2026-11-08T09:00:00.000Z');
  assert.equal(f.recent_sends, JSON.stringify([AHORA, DESPUES]));
  assert.equal(f.updated_at, DESPUES);
  const sin = (/** @type {Record<string, unknown>} */ x) =>
    Object.fromEntries(Object.entries(x).filter(([clave]) => !MUTABLES.includes(clave)));
  assert.deepEqual(sin(f), sin(antes), 'ninguna otra columna cambió');
  assert.equal(f.created_at, AHORA);
  assert.equal(f.consent_at, AHORA);
  assert.equal(f.stream_type, 'gaming');
});

test('repository: rotatePending es un compare-and-swap sobre recent_sends: si otro ya envió, cambia 0 filas y no escribe', async () => {
  const db = createD1Fake();
  await nuevo(db);
  // Otro pedido ya rotó (recent_sends ahora es distinto de lo que este leyó).
  db.sqlite.prepare('UPDATE waitlist SET recent_sends = ?1 WHERE id = 1').run(JSON.stringify([AHORA, DESPUES]));
  const antes = fila(db);
  const cambios = await rotatePending(db, 1, {
    ahora: DESPUES,
    envio: { ...ENVIO_B, tokenHash: 'c'.repeat(64) },
    recentSendsLeido: JSON.stringify([AHORA]),
  });
  assert.equal(cambios, 0);
  assert.deepEqual(fila(db), antes);
});

test('repository: rotatePending no toca una fila ya confirmada', async () => {
  const db = createD1Fake();
  await nuevo(db);
  assert.equal(await confirmByTokenHash(db, HASH_A, AHORA), true);
  const antes = fila(db);
  const cambios = await rotatePending(db, 1, { ahora: MAS_48H, envio: ENVIO_B, recentSendsLeido: antes.recent_sends });
  assert.equal(cambios, 0);
  assert.deepEqual(fila(db), antes);
});

test('repository: replacePending (pendiente vencido) reemplaza perfil, consentimiento, created_at y token', async () => {
  const db = createD1Fake();
  await nuevo(db);
  const cambios = await replacePending(db, 1, {
    perfil: perfil({ stream_type: 'musica', interests: ['relax'], country: null }),
    ahora: DESPUES,
    envio: ENVIO_B,
    createdAtLeido: AHORA,
  });
  assert.equal(cambios, 1);
  const f = fila(db);
  assert.equal(f.stream_type, 'musica');
  assert.equal(f.interests, '["relax"]');
  assert.equal(f.country, null);
  assert.equal(f.consent_at, DESPUES);
  assert.equal(f.created_at, DESPUES);
  assert.equal(f.updated_at, DESPUES);
  assert.equal(f.token_hash, HASH_B);
  assert.equal(f.token_expires_at, '2026-11-08T09:00:00.000Z');
  assert.equal(f.recent_sends, JSON.stringify([AHORA, DESPUES]));
});

test('repository: replacePending es un compare-and-swap sobre created_at: el segundo que leyó lo mismo cambia 0 filas', async () => {
  const db = createD1Fake();
  await nuevo(db);
  const primero = { perfil: perfil({ stream_type: 'musica' }), ahora: DESPUES, envio: ENVIO_B, createdAtLeido: AHORA };
  assert.equal(await replacePending(db, 1, primero), 1);
  const segundo = {
    perfil: perfil({ stream_type: 'charla' }),
    ahora: '2026-11-06T09:00:00.001Z',
    envio: { ...ENVIO_B, tokenHash: 'c'.repeat(64) },
    createdAtLeido: AHORA,
  };
  assert.equal(await replacePending(db, 1, segundo), 0);
  assert.equal(fila(db).stream_type, 'musica');
  assert.equal(fila(db).token_hash, HASH_B);
});

test('repository: replacePending no toca una fila ya confirmada', async () => {
  const db = createD1Fake();
  await nuevo(db);
  assert.equal(await confirmByTokenHash(db, HASH_A, AHORA), true);
  const cambios = await replacePending(db, 1, {
    perfil: perfil({ stream_type: 'charla' }),
    ahora: MAS_48H,
    envio: ENVIO_B,
    createdAtLeido: AHORA,
  });
  assert.equal(cambios, 0);
  assert.equal(fila(db).stream_type, 'gaming');
});

test('repository: confirmar deja confirmed_at = updated_at = ahora y borra el token (cumple las CHECK de pares)', async () => {
  const db = createD1Fake();
  await nuevo(db);
  const ahora = '2026-11-05T13:00:00.000Z';
  assert.equal(await confirmByTokenHash(db, HASH_A, ahora), true);
  const f = fila(db);
  assert.equal(f.confirmed_at, ahora);
  assert.equal(f.updated_at, ahora);
  assert.equal(f.token_hash, null);
  assert.equal(f.token_expires_at, null);
});

test('repository: confirmar dos veces el mismo token -> la segunda no cambia nada', async () => {
  const db = createD1Fake();
  await nuevo(db);
  assert.equal(await confirmByTokenHash(db, HASH_A, '2026-11-05T13:00:00.000Z'), true);
  assert.equal(await confirmByTokenHash(db, HASH_A, '2026-11-05T13:01:00.000Z'), false);
  assert.equal(fila(db).confirmed_at, '2026-11-05T13:00:00.000Z');
});

test('repository: un token desconocido no confirma nada', async () => {
  const db = createD1Fake();
  await nuevo(db);
  assert.equal(await confirmByTokenHash(db, HASH_B, AHORA), false);
  assert.equal(fila(db).confirmed_at, null);
});

test('repository: confirmar exige token_expires_at > ahora (vence en el instante exacto)', async () => {
  const db = createD1Fake();
  await nuevo(db);
  assert.equal(await confirmByTokenHash(db, HASH_A, MAS_48H), false);
  assert.equal(await confirmByTokenHash(db, HASH_A, '2026-11-07T12:00:00.001Z'), false);
  assert.equal(await confirmByTokenHash(db, HASH_A, '2026-11-07T11:59:59.999Z'), true);
});

test('repository: purgePending borra solo pendientes anteriores al corte y devuelve cuántas', async () => {
  const db = createD1Fake();
  await nuevo(db, {
    perfil: perfil({ email: 'vieja@example.com' }),
    ahora: '2026-10-20T00:00:00.000Z',
    tokenHash: HASH_A,
  });
  await nuevo(db, {
    perfil: perfil({ email: 'reciente@example.com' }),
    ahora: '2026-11-05T00:00:00.000Z',
    tokenHash: HASH_B,
  });
  // una confirmada y vieja: no se toca
  await nuevo(db, {
    perfil: perfil({ email: 'confirmada@example.com' }),
    ahora: '2026-10-01T00:00:00.000Z',
    tokenHash: 'c'.repeat(64),
  });
  assert.equal(await confirmByTokenHash(db, 'c'.repeat(64), '2026-10-01T00:00:01.000Z'), true);

  assert.equal(await purgePending(db, '2026-10-29T12:00:00.000Z'), 1);
  const quedan = db.sqlite
    .prepare('SELECT email FROM waitlist ORDER BY email')
    .all()
    .map((f) => f.email);
  assert.deepEqual(quedan, ['confirmada@example.com', 'reciente@example.com']);
  assert.equal(await purgePending(db, '2026-10-29T12:00:00.000Z'), 0);
});
