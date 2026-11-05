import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt } from '../src/i18n/format.js';
import { respuestas, correo, consentimiento } from '../src/i18n/es.js';
import * as indice from '../src/i18n/index.js';
import { ERROR_CODES } from '../src/api-errors.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { BRAND } from '../src/brand.js';
import { checkCopy } from '../src/copy-rules.js';

/** Todas las cadenas de un árbol de diccionario, con su ruta. */
function cadenas(nodo, ruta = '') {
  if (typeof nodo === 'string') return [[ruta, nodo]];
  return Object.entries(nodo).flatMap(([k, v]) => cadenas(v, ruta ? `${ruta}.${k}` : k));
}

// ---- fmt ----

test('fmt: reemplaza cada marcador por su valor, también si se repite', () => {
  assert.equal(
    fmt('Hola {nombre}, bienvenido a {marca}. {nombre}!', { nombre: 'Ana', marca: 'X' }),
    'Hola Ana, bienvenido a X. Ana!',
  );
});

test('fmt: convierte números a texto y no toca una plantilla sin marcadores', () => {
  assert.equal(fmt('Tienes {n} días', { n: 7 }), 'Tienes 7 días');
  assert.equal(fmt('Sin marcadores', {}), 'Sin marcadores');
});

test('fmt: un parámetro que falta lanza un error que dice cuál es', () => {
  assert.throws(() => fmt('Hola {nombre}', {}), /nombre/);
  assert.throws(() => fmt('Hola {nombre} {marca}', { nombre: 'Ana' }), /marca/);
  assert.throws(() => fmt('Hola {nombre}', { nombre: undefined }), /nombre/);
});

test('fmt: un parámetro de más se ignora; las llaves que no son marcadores quedan como están', () => {
  assert.equal(fmt('a {x}', { x: 1, y: 2 }), 'a 1');
  assert.equal(fmt('{ no es marcador } {1x}', {}), '{ no es marcador } {1x}');
});

test('fmt: el valor insertado no se vuelve a interpretar como plantilla', () => {
  assert.equal(fmt('{a}', { a: '{b}', b: 'x' }), '{b}');
});

// ---- respuestas (tabla WL-4, textos tal cual) ----

test('respuestas: los mensajes de la tabla de la especificación, palabra por palabra', () => {
  assert.equal(
    respuestas.exito,
    'Casi listo. Si el correo es válido, te enviamos un mensaje para confirmar tu lugar. Si no llega en 10 minutos, revisa spam o inténtalo de nuevo más tarde.',
  );
  assert.equal(respuestas.solicitud_invalida, 'No pudimos leer tu solicitud. Recarga la página e inténtalo de nuevo.');
  assert.equal(respuestas.demasiado_grande, respuestas.solicitud_invalida);
  assert.equal(
    respuestas.verificacion_fallida,
    'No pudimos verificar que eres una persona. Recarga la verificación e inténtalo de nuevo.',
  );
  assert.equal(respuestas.no_disponible, 'El registro no está disponible por ahora. Inténtalo de nuevo más tarde.');
  assert.equal(respuestas.confirmado, 'Listo, tu correo quedó confirmado. Te avisaremos cuando haya novedades.');
  assert.equal(
    respuestas.enlace_invalido,
    'Este enlace no es válido o ya venció. Si ya confirmaste, no tienes que hacer nada más. Si no, vuelve a anotarte para recibir uno nuevo.',
  );
});

test('respuestas: textos por campo de la tabla, palabra por palabra', () => {
  assert.deepEqual(
    { ...respuestas.campos },
    {
      email: 'Escribe un correo válido, por ejemplo nombre@dominio.com.',
      tiktok_user: 'Usa de 2 a 24 letras, números, puntos o guiones bajos.',
      live_frequency: 'Elige una opción.',
      stream_type: 'Elige una opción.',
      interests: 'Elige entre 1 y 4 categorías.',
      followers_range: 'Elige una opción de la lista.',
      country: 'Elige una opción de la lista.',
      consent: 'Necesitamos tu consentimiento y que confirmes que tienes 18 años o más.',
    },
  );
});

test('respuestas: todo código de error de la API tiene un mensaje no vacío', () => {
  for (const codigo of ERROR_CODES) {
    assert.equal(typeof respuestas[codigo], 'string', codigo);
    assert.ok(respuestas[codigo].length > 10, codigo);
  }
});

test('respuestas: los mensajes que no estaban en la tabla de la especificación (apoyo de la API) existen', () => {
  assert.match(respuestas.campos_invalidos, /campos/);
  assert.match(respuestas.error_interno, /más tarde/);
  assert.match(respuestas.no_encontrado, /encontramos/);
  assert.equal(respuestas.origen_no_permitido, respuestas.solicitud_invalida);
});

test('respuestas: sin llaves sueltas ni marcadores (son texto final)', () => {
  for (const [ruta, texto] of cadenas(respuestas)) assert.doesNotMatch(texto, /[{}]/, ruta);
});

// ---- correo (WL-15) ----

test('correo: el asunto y el cuerpo se arman con marca y enlace', () => {
  const enlace = 'https://ejemplo.test/confirmar#t=' + 'a'.repeat(43);
  const asunto = fmt(correo.asunto, { marca: BRAND.name });
  const cuerpo = fmt(correo.texto, { marca: BRAND.name, enlace });
  assert.ok(asunto.includes(BRAND.name));
  assert.ok(cuerpo.includes(BRAND.name));
  assert.equal(cuerpo.split(enlace).length - 1, 1, 'el enlace aparece una sola vez');
});

test('correo: dice por qué llegó y que ignorarlo borra la solicitud a los 7 días', () => {
  const cuerpo = fmt(correo.texto, { marca: 'X', enlace: 'https://e.test/confirmar#t=' + 'a'.repeat(43) });
  assert.match(cuerpo, /Recibimos una solicitud para anotar este correo/);
  assert.match(cuerpo, /ignora este mensaje/i);
  assert.match(cuerpo, /7 días/);
  assert.match(cuerpo, /48 horas/);
});

test('correo: el único enlace es el de confirmación; sin imágenes ni seguimiento', () => {
  const enlace = 'https://e.test/confirmar#t=' + 'b'.repeat(43);
  const cuerpo = fmt(correo.texto, { marca: 'X', enlace });
  assert.deepEqual(cuerpo.match(/https?:\/\/\S+/g), [enlace]);
  assert.doesNotMatch(cuerpo, /<img|<a |pixel|utm_|track/i);
  assert.doesNotMatch(correo.texto, /https?:/, 'la plantilla no trae ninguna URL fija');
});

test('correo: solo usa los marcadores marca y enlace', () => {
  const marcadores = [...(correo.asunto + correo.texto).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(marcadores)].sort(), ['enlace', 'marca']);
});

// ---- consentimiento (WL-11) ----

test('consentimiento: existe el texto de la versión vigente y menciona 18 años y para qué se usan los datos', () => {
  const v = consentimiento[CONSENT_VERSION];
  assert.ok(v, `falta consentimiento.${CONSENT_VERSION}`);
  const texto = fmt(v.texto, { marca: BRAND.name });
  assert.match(texto, /18 años o más/);
  assert.match(texto, /correo/);
  assert.match(texto, /novedades/);
  assert.match(texto, /borren mis datos/);
  assert.equal(typeof v.enlacePrivacidad, 'string');
});

test('consentimiento: el texto de v1 está congelado (un cambio de texto es una versión nueva)', () => {
  assert.equal(
    consentimiento.v1.texto,
    'Tengo 18 años o más y acepto que {marca} use mi correo y los datos que indiqué solo para avisarme de novedades de la lista de espera. Puedo pedir que borren mis datos cuando quiera.',
  );
  assert.ok(Object.isFrozen(consentimiento.v1));
});

// ---- el diccionario cumple las reglas de redacción ----

test('i18n: las secciones del núcleo cumplen las reglas de redacción (voseo, presión a regalar, azar)', () => {
  for (const [ruta, texto] of cadenas({ respuestas, correo, consentimiento })) {
    assert.deepEqual(checkCopy(texto), [], ruta);
  }
});

// ---- índice ----

test('i18n/index: exporta fmt y las secciones, y el paquete las expone como @tienda/contracts/i18n', async () => {
  assert.equal(indice.fmt, fmt);
  assert.equal(indice.respuestas, respuestas);
  assert.equal(indice.es.respuestas, respuestas);
  const porNombre = await import('@tienda/contracts/i18n');
  assert.equal(porNombre.respuestas, respuestas);
});
