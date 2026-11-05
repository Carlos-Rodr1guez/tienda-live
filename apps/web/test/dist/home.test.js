// (CI) Portada: orden de las secciones, un solo h1, pasos, escalera de regalos, categorías con arte, próximos juegos sin
// enlaces y las dos reglas visibles. Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorias as textosCategorias, faq, juego, opciones, pasos, proximos, reglas } from '@tienda/contracts/i18n';
import { BRAND } from '@tienda/contracts/brand';
import { CATEGORIES } from '@tienda/contracts/enums';
import { atributo, buscar, elementos, leerDist, parsear, texto } from './support/html.js';

const home = parsear(leerDist('index.html'));
const main = buscar(home, 'main')[0];

/** La sección (o franja) de la portada que se rotula con ese id de título. */
function seccion(idTitulo) {
  const s = buscar(main, 'section').find((e) => atributo(e, 'aria-labelledby') === idTitulo);
  assert.ok(s, `falta la sección rotulada por #${idTitulo}`);
  return s;
}

test('portada: un único h1 y las secciones en el orden de la especificación', () => {
  assert.equal(buscar(home, 'h1').length, 1);
  const ids = buscar(main, 'section')
    .map((s) => atributo(s, 'aria-labelledby'))
    .filter(Boolean);
  assert.deepEqual(ids, [
    'titulo-inicio',
    'titulo-formulario',
    'titulo-pasos',
    'titulo-juego',
    'titulo-categorias',
    'titulo-proximos',
    'titulo-faq',
    'titulo-reglas',
  ]);
});

test('portada: cómo funciona es una lista ordenada con los tres verbos y sin numerales decorativos', () => {
  const lista = buscar(seccion('titulo-pasos'), 'ol')[0];
  const verbos = buscar(lista, 'li').map((li) => texto(buscar(li, 'h3')[0]));
  assert.deepEqual(
    verbos,
    pasos.lista.map((p) => p.verbo),
  );
  assert.doesNotMatch(texto(lista), /\b0[1-3]\b/, 'sin 01/02/03 como adorno');
});

test('portada: ASEDIO trae cinco mecánicas con tecla y la escalera de cuatro niveles con las unidades del juego', () => {
  const s = seccion('titulo-juego');
  assert.equal(texto(buscar(s, 'h2')[0]), juego.titulo);
  const teclas = buscar(s, 'li')
    .filter((li) => buscar(li, 'span').some((sp) => atributo(sp, 'class')?.includes('tecla')))
    .map((li) => texto(buscar(li, 'span')[0]));
  assert.deepEqual(
    teclas,
    juego.mecanicasPortada.map((f) => f.tecla),
  );

  const escalera = buscar(s, 'ol').find((ol) => atributo(ol, 'aria-label') === juego.escaleraEtiqueta);
  assert.ok(escalera, 'falta la lista ordenada de la escalera');
  const niveles = buscar(escalera, 'li');
  assert.equal(niveles.length, 4);
  assert.deepEqual(
    niveles.map((li) => texto(buscar(li, 'h4')[0])),
    juego.escalera.map((n) => n.unidad),
  );
  assert.deepEqual(
    niveles.map((li) => texto(buscar(li, 'p')[0])),
    juego.escalera.map((n) => n.desde),
  );
  assert.ok(texto(s).includes(`${juego.tesis.antes} ${juego.tesis.destacada} ${juego.tesis.despues}`));
  assert.ok(texto(s).includes(juego.regalarOpcional));
  const enlace = buscar(s, 'a').find((a) => texto(a).includes(juego.verFicha));
  assert.equal(atributo(enlace, 'href'), '/juegos/asedio');
});

test('portada: las cuatro categorías llevan su arte con role="img" y título del diccionario', () => {
  const s = seccion('titulo-categorias');
  const artes = buscar(s, 'svg').filter((e) => atributo(e, 'role') === 'img');
  assert.equal(artes.length, CATEGORIES.length);
  assert.deepEqual(
    artes.map((svg) => texto(buscar(svg, 'title')[0])),
    CATEGORIES.map((c) => opciones.categorias[c].arteAlt),
  );
  assert.deepEqual(
    buscar(s, 'h3').map(texto),
    CATEGORIES.map((c) => opciones.categorias[c].nombre),
  );
  assert.equal(texto(buscar(s, 'h2')[0]), textosCategorias.titulo);
});

test('portada: los próximos juegos son tres tarjetas en orden, con "Próximamente" y SIN ningún enlace ni página', () => {
  const s = seccion('titulo-proximos');
  assert.equal(texto(buscar(s, 'h2')[0]), proximos.titulo);
  const tarjetas = buscar(s, 'li');
  assert.deepEqual(
    tarjetas.map((li) => texto(buscar(li, 'h3')[0])),
    ['Batalla de países', 'Acuario', 'Carrera por equipos'],
  );
  for (const tarjeta of tarjetas) {
    assert.ok(texto(tarjeta).includes(proximos.chip));
    assert.ok(texto(tarjeta).includes(proximos.provisional));
    assert.equal(buscar(tarjeta, 'a').length, 0, 'un concepto no se enlaza');
  }
  // y en ninguna parte de la portada hay un enlace a una ficha de concepto
  const hrefs = buscar(home, 'a').map((a) => atributo(a, 'href'));
  for (const concepto of ['batalla', 'acuario', 'carrera']) {
    assert.ok(!hrefs.some((h) => h?.includes(concepto)), `enlace a ${concepto}`);
  }
});

test('portada: la batalla no usa banderas ni la palabra guerra en ningún texto visible', () => {
  const visible = texto(main);
  assert.doesNotMatch(visible, /guerra/i);
  assert.doesNotMatch(visible, /[\u{1F1E6}-\u{1F1FF}]/u);
});

test('portada: las preguntas frecuentes son <details> y las dos reglas están visibles', () => {
  const detalles = buscar(seccion('titulo-faq'), 'details');
  assert.deepEqual(
    detalles.map((d) => texto(buscar(d, 'summary')[0])),
    faq.preguntas.map((p) => p.pregunta),
  );
  const visible = texto(seccion('titulo-reglas'));
  for (const regla of [reglas.presencia, reglas.sinAzar]) {
    assert.ok(visible.includes(regla.titulo), regla.titulo);
    assert.ok(visible.includes(regla.texto), regla.texto);
  }
});

test('portada: la cabecera lleva la marca de BRAND y el arte es SVG en línea (no imágenes sueltas)', () => {
  assert.equal(texto(buscar(home, 'header')[0]), BRAND.name);
  assert.equal(
    elementos(main).filter((e) => e.tagName === 'img' && atributo(e, 'src')?.endsWith('.svg')).length,
    0,
    'el arte es SVG en línea, no imágenes sueltas',
  );
});
