// (CI) Formulario de la lista de espera: <details id="anotarme">, campos con etiqueta, opcionales marcados, consentimiento
// sin marcar, envío deshabilitado sin JavaScript y aviso <noscript>. Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentimiento, formulario } from '@tienda/contracts/i18n';
import { COUNTRIES, FOLLOWER_RANGES, LIVE_FREQUENCY, STREAM_TYPES, CATEGORIES } from '@tienda/contracts/enums';
import { atributo, buscar, elementos, leerDist, parsear, texto } from './support/html.js';

const home = parsear(leerDist('index.html'));
const detalles = buscar(home, 'details').find((d) => atributo(d, 'id') === 'anotarme');
const form = buscar(detalles, 'form')[0];

test('formulario: es un <details id="anotarme"> cerrado, cuyo resumen es el botón "Quiero anotarme"', () => {
  assert.ok(detalles, 'falta details#anotarme');
  assert.equal(atributo(detalles, 'open'), null, 'nace cerrado');
  assert.equal(texto(buscar(detalles, 'summary')[0]), formulario.abrir);
});

test('formulario: method="post" action="/v1/waitlist" (un envío sin JavaScript no pone datos en la URL) y el botón nace deshabilitado', () => {
  assert.equal(atributo(form, 'method')?.toLowerCase(), 'post');
  assert.equal(atributo(form, 'action'), '/v1/waitlist');
  const enviar = buscar(form, 'button').find((b) => atributo(b, 'type') === 'submit');
  assert.notEqual(atributo(enviar, 'disabled'), null, 'JavaScript lo habilita');
  assert.equal(texto(enviar), formulario.enviar);
});

test('formulario: el aviso <noscript> explica que hace falta JavaScript', () => {
  const aviso = buscar(detalles, 'noscript')[0];
  assert.ok(aviso, 'falta <noscript>');
  assert.ok(texto(aviso).includes(formulario.noscript) || /JavaScript/.test(texto(aviso)));
});

test('formulario: cada campo tiene su etiqueta y los tres opcionales dicen "(opcional)"', () => {
  const etiquetas = buscar(form, 'label');
  const por = (id) => etiquetas.find((l) => atributo(l, 'for') === id);
  assert.equal(texto(por('campo-email')), formulario.campos.email.etiqueta);
  for (const id of ['campo-tiktok-user', 'campo-followers-range', 'campo-country']) {
    assert.ok(texto(por(id)).endsWith(formulario.opcional), `${id} sin "(opcional)"`);
  }
  assert.equal(texto(por('campo-email')).includes(formulario.opcional), false, 'el correo es obligatorio');
});

test('formulario: radios y listas ofrecen exactamente los valores de contracts, y 4 categorías de interés', () => {
  const valores = (nombre) =>
    buscar(form, 'input')
      .filter((i) => atributo(i, 'name') === nombre)
      .map((i) => atributo(i, 'value'));
  assert.deepEqual(valores('live_frequency'), [...LIVE_FREQUENCY]);
  assert.deepEqual(valores('stream_type'), [...STREAM_TYPES]);
  assert.deepEqual(valores('interests'), [...CATEGORIES]);
  const opcionesDe = (id) =>
    buscar(
      buscar(form, 'select').find((s) => atributo(s, 'id') === id),
      'option',
    )
      .map((o) => atributo(o, 'value'))
      .filter((v) => v !== '');
  assert.deepEqual(opcionesDe('campo-followers-range'), [...FOLLOWER_RANGES]);
  assert.deepEqual(opcionesDe('campo-country'), [...COUNTRIES]);
});

test('formulario: los grupos son fieldset con legend, y los campos con error tienen su texto de error enlazable', () => {
  const grupos = buscar(form, 'fieldset');
  assert.ok(grupos.length >= 5);
  for (const g of grupos) assert.ok(buscar(g, 'legend').length >= 1, 'fieldset sin legend');
  for (const id of [
    'email',
    'tiktok-user',
    'live-frequency',
    'stream-type',
    'interests',
    'followers-range',
    'country',
    'consent',
  ]) {
    const error = elementos(form).find((e) => atributo(e, 'id') === `error-${id}`);
    assert.ok(error, `falta #error-${id}`);
    assert.notEqual(atributo(error, 'hidden'), null, 'los errores nacen ocultos');
  }
});

test('formulario: el consentimiento nace sin marcar, dice 18 años o más y enlaza la política de privacidad', () => {
  const casilla = buscar(form, 'input').find((i) => atributo(i, 'id') === 'campo-consent');
  assert.equal(atributo(casilla, 'type'), 'checkbox');
  assert.equal(atributo(casilla, 'checked'), null);
  assert.match(texto(buscar(form, 'label').find((l) => atributo(l, 'for') === 'campo-consent')), /18 años o más/);
  const enlace = buscar(form, 'a').find((a) => atributo(a, 'href') === '/legal/privacidad');
  assert.equal(texto(enlace), consentimiento.v1.enlacePrivacidad);
  assert.equal(atributo(enlace, 'target'), '_blank');
  assert.match(atributo(enlace, 'rel'), /noopener/);
});

test('formulario: Turnstile no está en el HTML (se carga al abrir) y hay una ranura, un resumen con role="alert" y el éxito oculto', () => {
  assert.equal(
    buscar(home, 'script').some((s) => /challenges\.cloudflare\.com/.test(atributo(s, 'src') ?? '')),
    false,
  );
  const ids = new Set(elementos(detalles).map((e) => atributo(e, 'id')));
  for (const id of ['anotarme-turnstile', 'anotarme-resumen', 'anotarme-exito', 'anotarme-verificacion-error']) {
    assert.ok(ids.has(id), `falta #${id}`);
  }
  const resumen = elementos(detalles).find((e) => atributo(e, 'id') === 'anotarme-resumen');
  assert.equal(atributo(resumen, 'role'), 'alert');
});
