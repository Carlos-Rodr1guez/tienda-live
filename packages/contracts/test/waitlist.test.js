import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWaitlist, FIELD_ERROR_CODES } from '../src/waitlist.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { CATEGORIES, COUNTRIES, FOLLOWER_RANGES, LIVE_FREQUENCY, STREAM_TYPES } from '../src/enums.js';

/** Carga mínima válida: solo los campos obligatorios. */
const minima = () => ({
  email: 'ana@ejemplo.com',
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['accion'],
  consent: true,
  consent_version: CONSENT_VERSION,
  turnstile_token: 'token-de-prueba',
});

/** Carga completa: todos los campos opcionales presentes. */
const completa = () => ({
  ...minima(),
  tiktok_user: 'ana.live_01',
  followers_range: '1k-9k',
  country: 'AR',
});

/** Valida `base` con `cambios` encima; `undefined` en un cambio borra la clave. */
function con(cambios, base = minima()) {
  const carga = { ...base, ...cambios };
  for (const [k, v] of Object.entries(cambios)) if (v === undefined) delete carga[k];
  return validateWaitlist(carga);
}

/** Espera un error de campos y devuelve el mapa. */
function campos(resultado) {
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error, 'campos_invalidos');
  return resultado.campos;
}

test('waitlist: el conjunto de códigos de error por campo es el de la especificación', () => {
  assert.deepEqual(
    [...FIELD_ERROR_CODES],
    ['requerido', 'formato', 'largo', 'opcion', 'cantidad', 'repetido', 'consentimiento'],
  );
});

test('waitlist: la carga mínima es válida y los opcionales ausentes salen como null', () => {
  const r = validateWaitlist(minima());
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    email: 'ana@ejemplo.com',
    live_frequency: 'semanal',
    stream_type: 'gaming',
    interests: ['accion'],
    tiktok_user: null,
    followers_range: null,
    country: null,
    consent: true,
    consent_version: CONSENT_VERSION,
    turnstile_token: 'token-de-prueba',
  });
});

test('waitlist: la carga completa es válida y conserva los opcionales', () => {
  const r = validateWaitlist(completa());
  assert.equal(r.ok, true);
  assert.equal(r.value.tiktok_user, 'ana.live_01');
  assert.equal(r.value.followers_range, '1k-9k');
  assert.equal(r.value.country, 'AR');
});

test('waitlist: cada valor de cada enumeración es aceptado', () => {
  for (const live_frequency of LIVE_FREQUENCY) assert.equal(con({ live_frequency }).ok, true, live_frequency);
  for (const stream_type of STREAM_TYPES) assert.equal(con({ stream_type }).ok, true, stream_type);
  for (const followers_range of FOLLOWER_RANGES) assert.equal(con({ followers_range }).ok, true, followers_range);
  for (const country of COUNTRIES) assert.equal(con({ country }).ok, true, country);
  for (const c of CATEGORIES) assert.equal(con({ interests: [c] }).ok, true, c);
});

// ---- email ----

test('waitlist/email: se recorta, se pasa a minúsculas y esa es la forma que devuelve', () => {
  const r = con({ email: '  Ana.Perez@Ejemplo.COM  ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.email, 'ana.perez@ejemplo.com');
});

test('waitlist/email: 254 caracteres pasan y 255 fallan con "largo"', () => {
  const local = 'a'.repeat(254 - '@e.com'.length);
  const justo = `${local}@e.com`;
  assert.equal(justo.length, 254);
  assert.equal(con({ email: justo }).ok, true);
  assert.deepEqual(campos(con({ email: `a${justo}` })), { email: 'largo' });
});

test('waitlist/email: ausente o vacío es "requerido"', () => {
  assert.deepEqual(campos(con({ email: undefined })), { email: 'requerido' });
  assert.deepEqual(campos(con({ email: '' })), { email: 'requerido' });
  assert.deepEqual(campos(con({ email: '   ' })), { email: 'requerido' });
});

test('waitlist/email: formatos inválidos dan "formato"', () => {
  const malos = [
    'sin-arroba.com',
    'dos@@ejemplo.com',
    'a@b@ejemplo.com',
    '@ejemplo.com',
    'ana@',
    'ana@ejemplo',
    'ana@.com',
    'ana@ejemplo.',
    'ana @ejemplo.com',
    'ana@eje mplo.com',
    'ana\u0000@ejemplo.com',
    'ana\n@ejemplo.com',
  ];
  for (const email of malos) assert.deepEqual(campos(con({ email })), { email: 'formato' }, JSON.stringify(email));
  assert.deepEqual(campos(con({ email: 42 })), { email: 'formato' });
});

// ---- tiktok_user ----

test('waitlist/tiktok_user: se quita el @ inicial y la cadena vacía equivale a ausente', () => {
  assert.equal(con({ tiktok_user: '@ana_live' }).value.tiktok_user, 'ana_live');
  assert.equal(con({ tiktok_user: '' }).value.tiktok_user, null);
  assert.equal(con({ tiktok_user: '@' }).value.tiktok_user, null);
});

test('waitlist/tiktok_user: 2 y 24 caracteres pasan; 25 da "largo"; 1 y símbolos dan "formato"', () => {
  assert.equal(con({ tiktok_user: 'ab' }).ok, true);
  assert.equal(con({ tiktok_user: 'a'.repeat(24) }).ok, true);
  assert.deepEqual(campos(con({ tiktok_user: 'a'.repeat(25) })), { tiktok_user: 'largo' });
  assert.deepEqual(campos(con({ tiktok_user: '@' + 'a'.repeat(25) })), { tiktok_user: 'largo' });
  assert.deepEqual(campos(con({ tiktok_user: 'a' })), { tiktok_user: 'formato' });
  assert.deepEqual(campos(con({ tiktok_user: 'ana live' })), { tiktok_user: 'formato' });
  assert.deepEqual(campos(con({ tiktok_user: 'ana-live' })), { tiktok_user: 'formato' });
  assert.deepEqual(campos(con({ tiktok_user: 'añá' })), { tiktok_user: 'formato' });
  assert.deepEqual(campos(con({ tiktok_user: 7 })), { tiktok_user: 'formato' });
});

// ---- enumeraciones obligatorias ----

test('waitlist/live_frequency y stream_type: ausentes son "requerido", fuera de la lista "opcion"', () => {
  assert.deepEqual(campos(con({ live_frequency: undefined })), { live_frequency: 'requerido' });
  assert.deepEqual(campos(con({ live_frequency: 'nunca' })), { live_frequency: 'opcion' });
  assert.deepEqual(campos(con({ live_frequency: 3 })), { live_frequency: 'opcion' });
  assert.deepEqual(campos(con({ stream_type: undefined })), { stream_type: 'requerido' });
  assert.deepEqual(campos(con({ stream_type: 'cocina' })), { stream_type: 'opcion' });
});

// ---- interests ----

test('waitlist/interests: 0 y 5 elementos dan "cantidad"; 1 y 4 pasan', () => {
  assert.deepEqual(campos(con({ interests: [] })), { interests: 'cantidad' });
  assert.deepEqual(campos(con({ interests: [...CATEGORIES, 'accion'] })), { interests: 'cantidad' });
  assert.equal(con({ interests: ['relax'] }).ok, true);
  assert.equal(con({ interests: [...CATEGORIES] }).ok, true);
});

test('waitlist/interests: repetido, fuera de la lista, ausente y de otro tipo', () => {
  assert.deepEqual(campos(con({ interests: ['accion', 'accion'] })), { interests: 'repetido' });
  assert.deepEqual(campos(con({ interests: ['accion', 'terror'] })), { interests: 'opcion' });
  assert.deepEqual(campos(con({ interests: [1] })), { interests: 'opcion' });
  assert.deepEqual(campos(con({ interests: undefined })), { interests: 'requerido' });
  assert.deepEqual(campos(con({ interests: 'accion' })), { interests: 'formato' });
});

test('waitlist/interests: se devuelven ordenados como CATEGORIES, sea cual sea el orden de entrada', () => {
  assert.deepEqual(con({ interests: ['metas', 'accion'] }).value.interests, ['accion', 'metas']);
  assert.deepEqual(con({ interests: ['metas', 'relax', 'publico', 'accion'] }).value.interests, [...CATEGORIES]);
});

// ---- opcionales con lista ----

test('waitlist/followers_range y country: vacío equivale a ausente; fuera de la lista da "opcion"', () => {
  assert.equal(con({ followers_range: '' }).value.followers_range, null);
  assert.equal(con({ country: '' }).value.country, null);
  assert.deepEqual(campos(con({ followers_range: '1M+' })), { followers_range: 'opcion' });
  assert.deepEqual(campos(con({ country: 'FR' })), { country: 'opcion' });
  assert.deepEqual(campos(con({ country: 'ar' })), { country: 'opcion' });
  assert.deepEqual(campos(con({ country: null })), { country: 'opcion' });
});

// ---- consentimiento ----

test('waitlist/consent: solo el booleano true sirve; falso, ausente o de otro tipo dan "consentimiento"', () => {
  assert.deepEqual(campos(con({ consent: false })), { consent: 'consentimiento' });
  assert.deepEqual(campos(con({ consent: undefined })), { consent: 'consentimiento' });
  assert.deepEqual(campos(con({ consent: 'true' })), { consent: 'consentimiento' });
  assert.deepEqual(campos(con({ consent: 1 })), { consent: 'consentimiento' });
});

test('waitlist/consent_version: una versión vieja, mal formada o ausente es una solicitud inválida', () => {
  const esperado = { ok: false, error: 'solicitud_invalida' };
  assert.deepEqual(con({ consent_version: 'v0' }), esperado);
  assert.deepEqual(con({ consent_version: 'v99' }), esperado);
  assert.deepEqual(con({ consent_version: 'uno' }), esperado);
  assert.deepEqual(con({ consent_version: 1 }), esperado);
  assert.deepEqual(con({ consent_version: undefined }), esperado);
});

// ---- turnstile_token ----

test('waitlist/turnstile_token: la API decide con 403; el validador solo lo devuelve o null', () => {
  assert.equal(con({ turnstile_token: undefined }).value.turnstile_token, null);
  assert.equal(con({ turnstile_token: '' }).value.turnstile_token, null);
  assert.equal(con({ turnstile_token: 5 }).value.turnstile_token, null);
  assert.equal(con({ turnstile_token: 'x'.repeat(2049) }).value.turnstile_token, null);
  assert.equal(con({ turnstile_token: 'x'.repeat(2048) }).value.turnstile_token, 'x'.repeat(2048));
});

// ---- forma general ----

test('waitlist: una clave de más es una solicitud inválida, aunque lo demás esté bien', () => {
  assert.deepEqual(con({ extra: 1 }), { ok: false, error: 'solicitud_invalida' });
  // JSON.parse crea "__proto__" como clave propia: tampoco debe colarse.
  const conProto = JSON.parse(JSON.stringify(minima()).replace('{', '{"__proto__":{"admin":true},'));
  assert.deepEqual(validateWaitlist(conProto), { ok: false, error: 'solicitud_invalida' });
});

test('waitlist: lo que no es un objeto plano es una solicitud inválida', () => {
  for (const entrada of [null, undefined, 'texto', 7, true, [], [minima()]]) {
    assert.deepEqual(validateWaitlist(entrada), { ok: false, error: 'solicitud_invalida' }, String(entrada));
  }
});

test('waitlist: informa todos los campos con error en una sola respuesta', () => {
  const r = validateWaitlist({
    email: 'mal',
    live_frequency: 'nunca',
    stream_type: undefined,
    interests: [],
    tiktok_user: 'x',
    followers_range: 'mucho',
    country: 'XX',
    consent: false,
    consent_version: CONSENT_VERSION,
    turnstile_token: 't',
  });
  assert.deepEqual(campos(r), {
    email: 'formato',
    live_frequency: 'opcion',
    stream_type: 'requerido',
    interests: 'cantidad',
    tiktok_user: 'formato',
    followers_range: 'opcion',
    country: 'opcion',
    consent: 'consentimiento',
  });
});

test('waitlist: una clave de más gana sobre los errores de campo (la estructura se revisa primero)', () => {
  const r = validateWaitlist({ ...minima(), email: 'mal', extra: true });
  assert.deepEqual(r, { ok: false, error: 'solicitud_invalida' });
});

test('waitlist: no modifica la entrada', () => {
  const entrada = { ...completa(), email: '  ANA@Ejemplo.com ', interests: ['metas', 'accion'] };
  const copia = structuredClone(entrada);
  validateWaitlist(entrada);
  assert.deepEqual(entrada, copia);
});
