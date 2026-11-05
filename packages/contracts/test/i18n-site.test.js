import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as es from '../src/i18n/es.js';
import { fmt } from '../src/i18n/format.js';
import { BRAND } from '../src/brand.js';
import { checkCopy } from '../src/copy-rules.js';
import {
  CATEGORIES,
  COUNTRIES,
  FOLLOWER_RANGES,
  GAME_STATES,
  LIVE_FREQUENCY,
  STREAMER_ROLES,
  STREAM_TYPES,
} from '../src/enums.js';

const SECCIONES = [
  'respuestas',
  'correo',
  'consentimiento',
  'sitio',
  'inicio',
  'pasos',
  'juego',
  'categorias',
  'proximos',
  'faq',
  'reglas',
  'formulario',
  'opciones',
  'confirmar',
  'pie',
  'pagina404',
  'legal',
];

/** Todas las cadenas de un árbol, con su ruta. */
function cadenas(nodo, ruta = '') {
  if (typeof nodo === 'string') return [[ruta, nodo]];
  return Object.entries(nodo).flatMap(([k, v]) => cadenas(v, ruta ? `${ruta}.${k}` : k));
}

const claves = (obj) => Object.keys(obj).sort();
const ordenadas = (lista) => [...lista].sort();
const TODAS = cadenas(Object.fromEntries(SECCIONES.map((s) => [s, es[s]])));

test('i18n-site: están todas las secciones, como exportaciones con nombre y congeladas', () => {
  for (const seccion of SECCIONES) {
    assert.equal(typeof es[seccion], 'object', seccion);
    assert.ok(Object.isFrozen(es[seccion]), `${seccion} debería estar congelada`);
  }
  assert.deepEqual(
    Object.keys(es).sort(),
    [...SECCIONES].sort(),
    'es.js no debería exportar nada más que las secciones',
  );
});

test('i18n-site: no hay textos vacíos ni con espacios sobrantes en ninguna sección', () => {
  assert.ok(TODAS.length > 100, 'debería haber muchos textos');
  for (const [ruta, texto] of TODAS) {
    assert.ok(texto.length > 0, `${ruta} está vacío`);
    assert.equal(texto, texto.trim(), `${ruta} tiene espacios al borde`);
  }
});

test('i18n-site: ningún texto incumple las reglas de redacción (sin voseo, sin presión a regalar, sin azar)', () => {
  for (const [ruta, texto] of TODAS) assert.deepEqual(checkCopy(texto), [], ruta);
});

test('i18n-site: los marcadores de los textos del sitio son los conocidos ({marca} y los de las páginas legales), y ninguno trae el nombre escrito', () => {
  const sitio = SECCIONES.filter((s) => !['correo'].includes(s));
  for (const [ruta, texto] of cadenas(Object.fromEntries(sitio.map((s) => [s, es[s]])))) {
    assert.doesNotThrow(() => fmt(texto, { marca: BRAND.name, titulo: 'x', version: 'x', fecha: 'x' }), ruta);
    assert.ok(!texto.toLowerCase().includes(BRAND.name.toLowerCase()), `${ruta} trae el nombre de la marca escrito`);
  }
});

// ---- opciones: una etiqueta por cada valor de cada enumeración ----

test('opciones: hay una etiqueta por cada valor de cada enumeración, y ninguna de más', () => {
  const pares = [
    ['roles', STREAMER_ROLES],
    ['tiposDeLive', STREAM_TYPES],
    ['frecuencia', LIVE_FREQUENCY],
    ['seguidores', FOLLOWER_RANGES],
    ['paises', COUNTRIES],
    ['estados', GAME_STATES],
    ['categorias', CATEGORIES],
  ];
  for (const [seccion, valores] of pares) {
    assert.deepEqual(claves(es.opciones[seccion]), ordenadas(valores), `opciones.${seccion}`);
  }
  assert.equal(es.opciones.paises.ZZ, 'Otro');
  assert.equal(es.opciones.frecuencia['todavia-no'], 'Todavía no hago LIVE');
});

test('opciones.categorias: cada categoría tiene nombre, descripción, rol, ideal para, nota de presencia y texto del arte', () => {
  for (const slug of CATEGORIES) {
    const c = es.opciones.categorias[slug];
    assert.deepEqual(claves(c), ['arteAlt', 'descripcion', 'idealPara', 'nombre', 'nota', 'rolStreamer'], slug);
    assert.ok(STREAMER_ROLES.includes(c.rolStreamer), `${slug}: rolStreamer ${c.rolStreamer}`);
    assert.ok(c.nombre.length >= 4, `${slug}.nombre`);
    for (const campo of ['descripcion', 'idealPara', 'nota', 'arteAlt']) {
      assert.ok(c[campo].length >= 20, `${slug}.${campo}`);
    }
  }
});

test('opciones.categorias: el rol de cada categoría es el del plan de producto', () => {
  assert.deepEqual(Object.fromEntries(CATEGORIES.map((c) => [c, es.opciones.categorias[c].rolStreamer])), {
    accion: 'juega',
    publico: 'conduce',
    relax: 'acompana',
    metas: 'conduce',
  });
});

test('opciones.categorias: los nombres de las categorías son distintos entre sí', () => {
  const nombres = CATEGORIES.map((c) => es.opciones.categorias[c].nombre);
  assert.equal(new Set(nombres).size, nombres.length);
  assert.deepEqual(nombres, ['Acción', 'Público', 'Relax', 'Metas']);
});

// ---- reglas visibles ----

test('reglas: la regla de presencia dice que el streamer está en cámara y que nada corre solo', () => {
  assert.match(es.reglas.presencia.titulo, /LIVE/);
  assert.match(es.reglas.presencia.texto, /en cámara/);
  assert.match(es.reglas.presencia.texto, /nada corre sin ti/);
});

test('reglas: la regla de no azar dice que el efecto de un regalo depende de su valor y no de la casualidad', () => {
  const t = es.reglas.sinAzar.texto;
  assert.match(t, /depende solo de su valor/);
  assert.match(t, /siempre es el mismo/);
  assert.match(es.reglas.sinAzar.titulo, /casualidad/);
});

// ---- aviso de no afiliación ----

test('pie: el aviso de no afiliación nombra a TikTok y a ByteDance y lleva la marca', () => {
  const aviso = fmt(es.pie.noAfiliacion, { marca: BRAND.name });
  assert.ok(aviso.startsWith(BRAND.name));
  assert.match(aviso, /no está afiliado a TikTok ni a ByteDance/);
  assert.match(aviso, /respaldo/);
});

test('pie: tiene los enlaces legales, el contacto y el texto de "pendiente"', () => {
  assert.deepEqual(claves(es.pie), [
    'aviso',
    'contacto',
    'licencias',
    'navegacion',
    'noAfiliacion',
    'pendiente',
    'privacidad',
  ]);
  assert.equal(es.pie.pendiente, 'pendiente');
});

// ---- formulario ----

test('formulario: tiene etiqueta para cada campo del formulario y marca los opcionales', () => {
  assert.deepEqual(claves(es.formulario.campos), [
    'country',
    'email',
    'followers_range',
    'interests',
    'live_frequency',
    'stream_type',
    'tiktok_user',
  ]);
  for (const [campo, textos] of Object.entries(es.formulario.campos)) {
    assert.ok(textos.etiqueta.length > 3, campo);
  }
  assert.equal(es.formulario.opcional, '(opcional)');
});

test('formulario: el resumen de errores, el estado enviando y el aviso sin JavaScript existen', () => {
  assert.match(es.formulario.enviando, /Enviando/);
  assert.match(es.formulario.noscript, /JavaScript/);
  assert.equal(es.formulario.abrir, 'Quiero anotarme');
  assert.ok(es.formulario.resumenErrores.length > 5);
});

// ---- el resto de secciones ----

test('inicio, pasos, juego y proximos: lo que la portada necesita', () => {
  assert.ok(es.inicio.titulo.length > 10);
  assert.equal(es.inicio.videoProximamente, 'Video próximamente');
  assert.deepEqual(
    es.pasos.lista.map((p) => p.verbo),
    ['Instala', 'Captura', 'Juega con tu chat'],
  );
  assert.deepEqual(
    es.juego.escalera.map((n) => n.unidad),
    ['Caza', 'Bombardero', 'Coloso', 'Acorazado'],
  );
  assert.deepEqual(
    es.juego.escalera.map((n) => n.monedas),
    ['1 a 9', '10 a 99', '100 a 999', '1000 o más'],
  );
  assert.equal(es.proximos.chip, 'Próximamente');
});

test('faq: cada pregunta trae su respuesta y la primera aclara que el streamer está en el directo', () => {
  assert.ok(es.faq.preguntas.length >= 4);
  for (const p of es.faq.preguntas) {
    assert.deepEqual(claves(p), ['pregunta', 'respuesta']);
    assert.match(p.pregunta, /^¿.+\?$/);
  }
  assert.match(es.faq.preguntas[0].respuesta, /presente en el directo/);
});

test('confirmar y pagina404: tienen sus textos de estado y de salida', () => {
  assert.equal(es.confirmar.boton, 'Confirmar');
  assert.ok(es.confirmar.sinEnlace.length > 10);
  assert.ok(es.pagina404.titulo.length > 5);
  assert.ok(es.pagina404.volver.length > 3);
});

test('sitio: lleva el título y la descripción de la portada, con la marca como marcador', () => {
  assert.match(es.sitio.tituloInicio, /\{marca\}/);
  assert.ok(es.sitio.descripcion.length > 40 && es.sitio.descripcion.length <= 160);
  assert.equal(es.sitio.idioma, 'es');
});

test('páginas de apoyo: título de página con la marca, descripciones, aviso sin JavaScript y textos del borrador legal', () => {
  assert.equal(fmt(es.sitio.tituloPagina, { titulo: 'Aviso legal', marca: BRAND.name }), `Aviso legal | ${BRAND.name}`);
  assert.match(es.pie.navegacion, /legal/);
  assert.match(es.confirmar.noscript, /JavaScript/);
  for (const descripcion of [es.confirmar.descripcion, es.pagina404.descripcion]) {
    assert.ok(descripcion.length > 20 && descripcion.length <= 160);
  }
  assert.equal(es.legal.borradorTitulo, 'Borrador');
  assert.equal(
    fmt(es.legal.versionActualizado, { version: '0.1', fecha: '5 de noviembre de 2026' }),
    'Versión 0.1, actualizada el 5 de noviembre de 2026',
  );
  assert.equal(
    fmt(es.legal.descripcion, { titulo: 'Aviso legal', marca: BRAND.name }),
    `Aviso legal de ${BRAND.name}.`,
  );
});
