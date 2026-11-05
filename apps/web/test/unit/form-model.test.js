import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES } from '@tienda/contracts/api-errors';
import { FIELD_ERROR_CODES } from '@tienda/contracts/waitlist';
import { formulario, respuestas } from '@tienda/contracts/i18n';
import {
  FIELD_ORDER,
  buildRequest,
  errorId,
  fieldId,
  fieldLabel,
  initialState,
  interpretResponse,
  isSubmitDisabled,
  describedBy,
  reduce,
  submitLabel,
  validateForm,
} from '../../src/lib/form/model.js';

const crudoVacio = () => ({
  email: '',
  tiktok_user: '',
  live_frequency: '',
  stream_type: '',
  interests: [],
  followers_range: '',
  country: '',
  consent: false,
});
const crudoValido = () => ({
  ...crudoVacio(),
  email: '  Ana@Ejemplo.COM ',
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['metas', 'accion'],
  consent: true,
});

test('formulario: un envío mínimo válido arma el cuerpo normalizado, sin campos vacíos ni nulos', () => {
  const r = validateForm(crudoValido(), { turnstileToken: 'token-de-prueba' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, {
    email: 'ana@ejemplo.com',
    live_frequency: 'semanal',
    stream_type: 'gaming',
    interests: ['accion', 'metas'],
    consent: true,
    consent_version: 'v1',
    turnstile_token: 'token-de-prueba',
  });
});

test('formulario: los opcionales que sí se llenaron viajan (usuario sin @, rango y país)', () => {
  const r = validateForm(
    { ...crudoValido(), tiktok_user: '@mi_usuario', followers_range: '1k-9k', country: 'AR' },
    { turnstileToken: 't' },
  );
  assert.equal(r.ok, true);
  assert.equal(r.body.tiktok_user, 'mi_usuario');
  assert.equal(r.body.followers_range, '1k-9k');
  assert.equal(r.body.country, 'AR');
});

test('formulario: sin llenar nada marca los cinco campos obligatorios, en el orden de la página', () => {
  const r = validateForm(crudoVacio(), { turnstileToken: 't' });
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.errores.map((e) => e.campo),
    ['email', 'live_frequency', 'stream_type', 'interests', 'consent'],
  );
  assert.deepEqual(
    r.errores.map((e) => e.mensaje),
    [
      respuestas.campos.email,
      respuestas.campos.live_frequency,
      respuestas.campos.stream_type,
      respuestas.campos.interests,
      respuestas.campos.consent,
    ],
  );
  assert.deepEqual(r.errores[0], {
    campo: 'email',
    mensaje: respuestas.campos.email,
    idCampo: 'campo-email',
    idError: 'error-email',
  });
});

test('formulario: errores concretos por campo (correo mal escrito, usuario corto, 5 categorías, rango fuera de lista)', () => {
  const r = validateForm(
    {
      ...crudoValido(),
      email: 'no-es-un-correo',
      tiktok_user: 'a',
      interests: ['accion', 'publico', 'relax', 'metas', 'accion'],
      followers_range: 'muchos',
    },
    { turnstileToken: 't' },
  );
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.errores.map((e) => e.campo),
    ['email', 'tiktok_user', 'interests', 'followers_range'],
  );
});

test('formulario: cada campo y cada código de error de contracts tiene un mensaje', () => {
  assert.deepEqual([...FIELD_ORDER].sort(), Object.keys(respuestas.campos).sort());
  for (const campo of FIELD_ORDER) {
    assert.ok(respuestas.campos[campo].length > 0, campo);
    assert.match(fieldId(campo), /^campo-[a-z-]+$/);
    assert.match(errorId(campo), /^error-[a-z-]+$/);
  }
  // el mensaje depende del campo, no del código: todos los códigos del validador caen en un campo con mensaje
  assert.deepEqual([...FIELD_ERROR_CODES].length, 7);
  for (const codigo of ERROR_CODES) {
    assert.equal(typeof respuestas[codigo], 'string', codigo);
    assert.ok(respuestas[codigo].length > 0, codigo);
  }
});

test('fieldLabel: cada campo con error tiene un nombre legible para el resumen (así dos "Elige una opción" no se confunden)', () => {
  assert.equal(fieldLabel('email'), formulario.campos.email.etiqueta);
  assert.equal(fieldLabel('live_frequency'), formulario.campos.live_frequency.etiqueta);
  assert.equal(fieldLabel('stream_type'), formulario.campos.stream_type.etiqueta);
  assert.equal(fieldLabel('interests'), formulario.campos.interests.etiqueta);
  assert.equal(fieldLabel('consent'), formulario.grupos.consentimiento);
  for (const campo of FIELD_ORDER) assert.ok(fieldLabel(campo).length > 3, campo);
  const nombres = FIELD_ORDER.map(fieldLabel);
  assert.equal(new Set(nombres).size, nombres.length, 'sin nombres repetidos');
  assert.throws(() => fieldLabel('desconocido'), /desconocido/);
});

test('respuesta 202: éxito con el texto del diccionario', () => {
  assert.deepEqual(interpretResponse(202, { ok: true, mensaje: 'lo que diga el servidor' }), {
    fase: 'exito',
    errores: [],
    mensaje: respuestas.exito,
  });
});

test('respuesta 400 campos_invalidos: errores por campo en el orden de la página; lo desconocido se ignora', () => {
  const r = interpretResponse(400, {
    ok: false,
    error: 'campos_invalidos',
    campos: { consent: 'consentimiento', email: 'formato', inventado: 'opcion' },
  });
  assert.equal(r.fase, 'error');
  assert.equal(r.mensaje, respuestas.campos_invalidos);
  assert.deepEqual(
    r.errores.map((e) => [e.campo, e.mensaje]),
    [
      ['email', respuestas.campos.email],
      ['consent', respuestas.campos.consent],
    ],
  );
});

test('respuesta: cada código de error de la API da su mensaje y ninguno deja la pantalla sin texto', () => {
  for (const codigo of ERROR_CODES) {
    const r = interpretResponse(codigo === 'campos_invalidos' ? 400 : 500, { ok: false, error: codigo });
    assert.equal(r.fase, 'error', codigo);
    assert.ok(r.mensaje.length > 0, codigo);
    if (codigo !== 'campos_invalidos') assert.equal(r.mensaje, respuestas[codigo], codigo);
  }
});

test('respuesta: si el cuerpo no se entiende, el estado HTTP decide el mensaje', () => {
  assert.equal(interpretResponse(403, null).mensaje, respuestas.verificacion_fallida);
  assert.equal(interpretResponse(413, 'texto').mensaje, respuestas.demasiado_grande);
  assert.equal(interpretResponse(415, {}).mensaje, respuestas.solicitud_invalida);
  assert.equal(interpretResponse(503, undefined).mensaje, respuestas.no_disponible);
  assert.equal(interpretResponse(500, { raro: true }).mensaje, respuestas.error_interno);
  assert.equal(interpretResponse(404, null).mensaje, respuestas.error_interno);
  // un 400 de campos sin campos legibles tampoco deja la pantalla vacía
  const sinCampos = interpretResponse(400, { ok: false, error: 'campos_invalidos', campos: {} });
  assert.equal(sinCampos.fase, 'error');
  assert.deepEqual(sinCampos.errores, []);
  assert.equal(sinCampos.mensaje, respuestas.campos_invalidos);
});

test('máquina de estados: editar, enviar, éxito; el botón se bloquea mientras envía y tras el éxito', () => {
  let s = initialState();
  assert.equal(s.fase, 'editando');
  assert.equal(isSubmitDisabled(s), false);
  assert.equal(submitLabel(s), formulario.enviar);

  s = reduce(s, { type: 'enviar' });
  assert.equal(s.fase, 'enviando');
  assert.equal(isSubmitDisabled(s), true);
  assert.equal(submitLabel(s), formulario.enviando);

  // un segundo "enviar" mientras envía no cambia nada (no hay doble envío)
  assert.equal(reduce(s, { type: 'enviar' }), s);

  s = reduce(s, { type: 'respuesta', status: 202, body: { ok: true } });
  assert.equal(s.fase, 'exito');
  assert.equal(isSubmitDisabled(s), true);
  assert.equal(s.mensaje, respuestas.exito);
  // ya anotado: nada más lo mueve
  assert.equal(reduce(s, { type: 'enviar' }), s);
});

test('máquina de estados: la validación local, el error de servidor y la red caída se pueden reintentar', () => {
  const errores = validateForm(crudoVacio(), { turnstileToken: 't' }).errores;
  let s = reduce(initialState(), { type: 'invalido', errores });
  assert.equal(s.fase, 'editando');
  assert.equal(s.errores.length, 5);
  assert.equal(s.mensaje, respuestas.campos_invalidos);
  assert.equal(isSubmitDisabled(s), false);

  s = reduce(s, { type: 'enviar' });
  assert.deepEqual(s.errores, [], 'al reenviar se limpian los errores');
  s = reduce(s, { type: 'respuesta', status: 503, body: { ok: false, error: 'no_disponible' } });
  assert.equal(s.fase, 'error');
  assert.equal(s.mensaje, respuestas.no_disponible);
  assert.equal(isSubmitDisabled(s), false, 'tras un error se puede intentar de nuevo');

  s = reduce(s, { type: 'enviar' });
  s = reduce(s, { type: 'falloRed' });
  assert.equal(s.fase, 'error');
  assert.equal(s.mensaje, formulario.errorRed);

  s = reduce(s, { type: 'enviar' });
  s = reduce(s, { type: 'sinVerificacion' });
  assert.equal(s.fase, 'error');
  assert.equal(s.mensaje, respuestas.verificacion_fallida);
});

test('máquina de estados: una respuesta fuera de un envío en curso se ignora', () => {
  const s = initialState();
  assert.equal(reduce(s, { type: 'respuesta', status: 202, body: { ok: true } }), s);
  assert.equal(reduce(s, { type: 'falloRed' }), s);
  assert.equal(reduce(s, { type: 'accion-inexistente' }), s);
});

test('aria: describedBy apunta al error del campo solo cuando ese campo tiene error', () => {
  const s = reduce(initialState(), {
    type: 'invalido',
    errores: validateForm({ ...crudoValido(), email: 'x' }, { turnstileToken: 't' }).errores,
  });
  assert.equal(describedBy(s, 'email'), 'error-email');
  assert.equal(describedBy(s, 'country'), undefined);
});

test('petición: POST /v1/waitlist como JSON, mismo origen y sin cookies', () => {
  const cuerpo = { email: 'a@b.co' };
  const { url, init } = buildRequest(cuerpo);
  assert.equal(url, '/v1/waitlist');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"email":"a@b.co"}');
});
