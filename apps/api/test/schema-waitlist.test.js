import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1Fake } from './support/d1-fake.js';
import { COUNTRIES, FOLLOWER_RANGES, LIVE_FREQUENCY, STREAM_TYPES } from '@tienda/contracts/enums';

const SQL = readFileSync(new URL('../migrations/0001_waitlist.sql', import.meta.url), 'utf8');
const AHORA = '2026-11-05T12:00:00.000Z';
const HASH = 'a'.repeat(64);

function base() {
  return {
    email: 'ana@example.com',
    live_frequency: 'semanal',
    stream_type: 'gaming',
    interests: '["accion","metas"]',
    consent_version: 'v1',
    consent_at: AHORA,
    created_at: AHORA,
    updated_at: AHORA,
  };
}

/** Inserta una fila cruda (sin pasar por la API) con los campos dados. */
function insertar(db, fila) {
  const columnas = Object.keys(fila);
  const marcas = columnas.map((_, i) => `?${i + 1}`).join(', ');
  return db.sqlite
    .prepare(`INSERT INTO waitlist (${columnas.join(', ')}) VALUES (${marcas})`)
    .run(...Object.values(fila));
}

function conBase() {
  return createD1Fake();
}

function acepta(campos, mensaje) {
  const db = conBase();
  assert.doesNotThrow(() => insertar(db, { ...base(), ...campos }), mensaje);
}

function rechaza(campos, mensaje) {
  const db = conBase();
  assert.throws(() => insertar(db, { ...base(), ...campos }), /constraint/i, mensaje);
}

test('waitlist: la fila mínima válida entra y los opcionales quedan en NULL', () => {
  const db = conBase();
  insertar(db, base());
  const fila = db.sqlite.prepare('SELECT * FROM waitlist').get();
  assert.equal(fila.tiktok_user, null);
  assert.equal(fila.followers_range, null);
  assert.equal(fila.country, null);
  assert.equal(fila.confirmed_at, null);
  assert.equal(fila.token_hash, null);
  assert.equal(fila.recent_sends, '[]');
});

test('waitlist: no hay columnas de IP, agente de usuario ni huellas (WL-12)', () => {
  const db = conBase();
  const columnas = db.sqlite
    .prepare('PRAGMA table_info(waitlist)')
    .all()
    .map((c) => c.name);
  assert.deepEqual(
    columnas.sort(),
    [
      'consent_at',
      'consent_version',
      'country',
      'created_at',
      'confirmed_at',
      'email',
      'followers_range',
      'id',
      'interests',
      'live_frequency',
      'recent_sends',
      'stream_type',
      'tiktok_user',
      'token_expires_at',
      'token_hash',
      'updated_at',
    ].sort(),
  );
});

test('email: acepta 254 caracteres y rechaza 255', () => {
  const con = (n) => `${'a'.repeat(n - '@b.co'.length)}@b.co`;
  acepta({ email: con(254) }, '254');
  rechaza({ email: con(255) }, '255');
});

test('email: rechaza mayúsculas, espacios, sin arroba, dos arrobas, sin punto en el dominio y demasiado corto', () => {
  rechaza({ email: 'Ana@example.com' }, 'mayúsculas');
  rechaza({ email: ' ana@example.com' }, 'espacio al inicio');
  rechaza({ email: 'ana @example.com' }, 'espacio dentro');
  rechaza({ email: 'anaexample.com' }, 'sin arroba');
  rechaza({ email: 'a@b@example.com' }, 'dos arrobas');
  rechaza({ email: 'ana@examplecom' }, 'sin punto en el dominio');
  rechaza({ email: 'ana@.com' }, 'punto pegado a la arroba');
  rechaza({ email: '@example.com' }, 'sin parte local');
  rechaza({ email: 'a@b.' }, 'demasiado corto');
  rechaza({ email: 123456 }, 'no es texto');
});

test('email: es único (normalizado: la CHECK ya obliga a minúsculas sin espacios)', () => {
  const db = conBase();
  insertar(db, base());
  assert.throws(() => insertar(db, base()), /UNIQUE/i);
  assert.doesNotThrow(() => insertar(db, { ...base(), email: 'otra@example.com' }));
});

test('live_frequency y stream_type: rechazan un valor fuera de la lista y NULL', () => {
  rechaza({ live_frequency: 'siempre' });
  rechaza({ live_frequency: null });
  rechaza({ stream_type: 'cocina' });
  rechaza({ stream_type: null });
});

test('interests: JSON de arreglo con 1 a 4 elementos y hasta 48 caracteres', () => {
  acepta({ interests: '["accion"]' }, '1 elemento');
  acepta({ interests: '["accion","publico","relax","metas"]' }, 'las 4 categorías');
  rechaza({ interests: '[]' }, '0 elementos');
  rechaza({ interests: '["a","b","c","d","e"]' }, '5 elementos');
  rechaza({ interests: '{"a":1}' }, 'objeto');
  rechaza({ interests: '"accion"' }, 'texto JSON');
  rechaza({ interests: 'accion' }, 'no es JSON');
  rechaza({ interests: `["${'x'.repeat(46)}"]` }, '50 caracteres (más de 48)');
  acepta({ interests: `["${'x'.repeat(44)}"]` }, '48 caracteres justos');
  rechaza({ interests: null }, 'NULL');
});

test('tiktok_user: NULL, 2 a 24 caracteres de [A-Za-z0-9._]', () => {
  acepta({ tiktok_user: null }, 'NULL');
  acepta({ tiktok_user: 'ab' }, '2');
  acepta({ tiktok_user: 'a'.repeat(24) }, '24');
  acepta({ tiktok_user: 'Mi.Usuario_9' }, 'mezcla válida');
  rechaza({ tiktok_user: 'a' }, '1');
  rechaza({ tiktok_user: 'a'.repeat(25) }, '25');
  rechaza({ tiktok_user: 'con espacio' }, 'espacio');
  rechaza({ tiktok_user: '@usuario' }, 'arroba');
  rechaza({ tiktok_user: 'usuario-con-guion' }, 'guion medio');
  rechaza({ tiktok_user: '' }, 'vacío (la API manda NULL)');
});

test('followers_range y country: NULL o un valor de la lista', () => {
  acepta({ followers_range: null, country: null }, 'NULL');
  acepta({ followers_range: '1k-9k', country: 'AR' }, 'válidos');
  rechaza({ followers_range: '5k' }, 'rango inventado');
  rechaza({ followers_range: '' }, 'rango vacío');
  rechaza({ country: 'AA' }, 'país inventado');
  rechaza({ country: 'ar' }, 'minúsculas');
  rechaza({ country: '' }, 'país vacío');
});

test('consent_version: v seguida de 1 a 3 dígitos', () => {
  acepta({ consent_version: 'v1' });
  acepta({ consent_version: 'v12' });
  acepta({ consent_version: 'v123' });
  rechaza({ consent_version: 'v' }, 'sin número');
  rechaza({ consent_version: 'v1234' }, '5 caracteres');
  rechaza({ consent_version: 'x1' }, 'sin v');
  rechaza({ consent_version: 'v1a' }, 'letra');
  rechaza({ consent_version: 'v-1' }, 'signo');
  rechaza({ consent_version: null }, 'NULL');
});

test('marcas de tiempo: ISO-8601 UTC de 24 caracteres en las cuatro columnas que siempre se llenan', () => {
  for (const columna of ['consent_at', 'created_at', 'updated_at']) {
    acepta({ [columna]: '2026-11-05T00:00:00.000Z' }, `${columna} válida`);
    rechaza({ [columna]: '2026-11-05' }, `${columna} solo fecha`);
    rechaza({ [columna]: '2026-11-05T12:00:00Z' }, `${columna} sin milisegundos`);
    rechaza({ [columna]: '2026-11-05 12:00:00.000Z' }, `${columna} con espacio`);
    rechaza({ [columna]: '2026-11-05T12:00:00.000+00:00' }, `${columna} con desfase`);
    rechaza({ [columna]: null }, `${columna} NULL`);
  }
  acepta({ confirmed_at: AHORA }, 'confirmed_at válida');
  rechaza({ confirmed_at: '2026-11-05' }, 'confirmed_at mal formada');
  rechaza({ token_hash: HASH, token_expires_at: 'mañana' }, 'token_expires_at mal formada');
});

test('token: hash de 64 caracteres hexadecimales en minúscula y su vencimiento van siempre juntos', () => {
  acepta({ token_hash: HASH, token_expires_at: AHORA }, 'par completo');
  acepta({ token_hash: null, token_expires_at: null }, 'par vacío');
  rechaza({ token_hash: HASH, token_expires_at: null }, 'hash sin vencimiento');
  rechaza({ token_hash: null, token_expires_at: AHORA }, 'vencimiento sin hash');
  rechaza({ token_hash: 'a'.repeat(63), token_expires_at: AHORA }, '63 caracteres');
  rechaza({ token_hash: 'a'.repeat(65), token_expires_at: AHORA }, '65 caracteres');
  rechaza({ token_hash: 'A'.repeat(64), token_expires_at: AHORA }, 'mayúsculas');
  rechaza({ token_hash: 'g'.repeat(64), token_expires_at: AHORA }, 'no hexadecimal');
});

test('token: una fila confirmada no puede conservar el hash; el hash no se repite', () => {
  rechaza({ confirmed_at: AHORA, token_hash: HASH, token_expires_at: AHORA }, 'confirmada con hash');
  acepta({ confirmed_at: AHORA, token_hash: null, token_expires_at: null }, 'confirmada sin hash');
  const db = conBase();
  insertar(db, { ...base(), token_hash: HASH, token_expires_at: AHORA });
  assert.throws(
    () => insertar(db, { ...base(), email: 'otra@example.com', token_hash: HASH, token_expires_at: AHORA }),
    /UNIQUE/i,
  );
});

test('recent_sends: arreglo JSON de hasta 5 marcas de tiempo; por defecto []', () => {
  acepta({ recent_sends: '[]' }, 'vacío');
  acepta({ recent_sends: JSON.stringify(Array(5).fill(AHORA)) }, '5 envíos');
  rechaza({ recent_sends: JSON.stringify(Array(6).fill(AHORA)) }, '6 envíos');
  rechaza({ recent_sends: '{}' }, 'objeto');
  rechaza({ recent_sends: 'no es json' }, 'no es JSON');
  rechaza({ recent_sends: null }, 'NULL');
});

test('A4: las listas de las CHECK son exactamente las enumeraciones de contracts', () => {
  const enums = {
    live_frequency: LIVE_FREQUENCY,
    stream_type: STREAM_TYPES,
    followers_range: FOLLOWER_RANGES,
    country: COUNTRIES,
  };
  for (const [columna, valores] of Object.entries(enums)) {
    // CHECK (columna IN (...)) o CHECK (columna IS NULL OR columna IN (...))
    const coincidencia = new RegExp(`${columna}\\s+IN\\s*\\(([^)]*)\\)`).exec(SQL);
    assert.ok(coincidencia, `no encontré la lista de ${columna} en el SQL`);
    const enSql = [...coincidencia[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    assert.equal(new Set(enSql).size, enSql.length, `${columna}: valores repetidos en el SQL`);
    assert.deepEqual([...enSql].sort(), [...valores].sort(), `${columna}: SQL y contracts difieren`);

    for (const valor of valores)
      acepta({ [columna]: valor, email: `${columna}-${valor.toLowerCase()}@example.com` }, `${columna}=${valor}`);
    rechaza({ [columna]: 'fuera-de-la-lista' }, `${columna} fuera de la lista`);
  }
});

test('A4: agregar un valor a contracts sin migración rompería esta prueba (la lista de SQL es finita y cerrada)', () => {
  const simulada = [...LIVE_FREQUENCY, 'nuevo-valor'].sort();
  const coincidencia = /live_frequency\s+IN\s*\(([^)]*)\)/.exec(SQL);
  const enSql = [...coincidencia[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
  assert.notDeepEqual(enSql, simulada);
});

test('índices: hash de token único cuando existe e índice parcial para la purga de pendientes', () => {
  const db = conBase();
  const indices = db.sqlite
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'waitlist' AND sql IS NOT NULL")
    .all();
  const nombres = indices.map((i) => i.name).sort();
  assert.deepEqual(nombres, ['waitlist_pending_created', 'waitlist_token_hash']);
  assert.match(indices.find((i) => i.name === 'waitlist_token_hash').sql, /UNIQUE/);
});
