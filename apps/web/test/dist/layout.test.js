// (CI) Diseño base: metadatos, vista previa al compartir, fuente precargada, cabecera con la marca y beacon solo si
// hay token. Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '@tienda/contracts/brand';
import { fmt, sitio } from '@tienda/contracts/i18n';
import { atributo, buscar, DIST, leerDist, parsear, texto } from './support/html.js';

const SITIO = new URL(process.env.SITE_URL || 'http://localhost:8790').origin;
const home = parsear(leerDist('index.html'));

/** El contenido de un <meta> por name o property. */
function meta(doc, clave) {
  const m = buscar(doc, 'meta').find((e) => (atributo(e, 'property') ?? atributo(e, 'name')) === clave);
  return m ? atributo(m, 'content') : null;
}

/** Todos los archivos .js y .css de dist/_astro, con su texto. */
function recursos(extension) {
  const dir = join(DIST, '_astro');
  return readdirSync(dir)
    .filter((n) => n.endsWith(extension))
    .map((n) => ({ nombre: n, texto: leerDist(`_astro/${n}`) }));
}

test('layout: título, descripción, esquema de color y color del tema', () => {
  assert.equal(texto(buscar(home, 'title')[0]), fmt(sitio.tituloInicio, { marca: BRAND.name }));
  assert.equal(meta(home, 'description'), sitio.descripcion);
  assert.equal(meta(home, 'color-scheme'), 'dark');
  assert.equal(meta(home, 'theme-color'), '#04060c');
  assert.equal(atributo(buscar(home, 'html')[0], 'lang'), 'es');
});

test('layout: canonical y Open Graph con URLs absolutas del sitio, og:locale es_ES e imagen de 1200x630', () => {
  const canonical = buscar(home, 'link').find((e) => atributo(e, 'rel') === 'canonical');
  assert.equal(atributo(canonical, 'href'), `${SITIO}/`);
  assert.equal(meta(home, 'og:url'), `${SITIO}/`);
  assert.equal(meta(home, 'og:type'), 'website');
  assert.equal(meta(home, 'og:locale'), 'es_ES');
  assert.equal(meta(home, 'og:site_name'), BRAND.name);
  assert.equal(meta(home, 'og:image'), `${SITIO}/og/sitio.png`);
  assert.equal(meta(home, 'og:image:width'), '1200');
  assert.equal(meta(home, 'og:image:height'), '630');
});

test('layout: tarjeta de Twitter grande con título, descripción e imagen absolutos', () => {
  assert.equal(meta(home, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(home, 'twitter:title'), fmt(sitio.tituloInicio, { marca: BRAND.name }));
  assert.equal(meta(home, 'twitter:description'), sitio.descripcion);
  assert.equal(meta(home, 'twitter:image'), `${SITIO}/og/sitio.png`);
});

test('layout: la fuente que se precarga es el mismo archivo que pide el CSS (latino, woff2, crossorigin)', () => {
  const precarga = buscar(home, 'link').find((e) => atributo(e, 'rel') === 'preload' && atributo(e, 'as') === 'font');
  assert.ok(precarga, 'falta <link rel="preload" as="font">');
  assert.equal(atributo(precarga, 'type'), 'font/woff2');
  assert.notEqual(atributo(precarga, 'crossorigin'), null);
  const href = atributo(precarga, 'href');
  assert.match(href, /^\/_astro\/oxanium-latin-wght-normal\.[\w-]+\.woff2$/);
  const nombre = href.split('/').pop();
  assert.ok(
    recursos('.css').some((css) => css.texto.includes(nombre)),
    `ningún CSS pide ${nombre}`,
  );
});

test('layout: favicon SVG, hojas de estilo como archivos y el campo de estrellas como archivo (nunca data:)', () => {
  const enlaces = buscar(home, 'link');
  assert.ok(enlaces.some((e) => atributo(e, 'rel') === 'icon' && atributo(e, 'href') === '/favicon.svg'));
  const hojas = enlaces.filter((e) => atributo(e, 'rel') === 'stylesheet').map((e) => atributo(e, 'href'));
  assert.ok(hojas.length >= 1 && hojas.every((h) => h.startsWith('/_astro/')), hojas.join(', '));
  const css = recursos('.css')
    .map((r) => r.texto)
    .join('\n');
  assert.match(css, /estrellas\.[\w-]+\.svg/);
  assert.ok(!/url\(\s*['"]?data:/.test(css));
});

test('layout: la cabecera lleva solo la marca (BRAND.name, la última palabra en <b>) como enlace a la portada', () => {
  const cabecera = buscar(home, 'header')[0];
  assert.equal(texto(cabecera), BRAND.name);
  const enlaces = buscar(cabecera, 'a');
  assert.equal(enlaces.length, 1);
  assert.equal(atributo(enlaces[0], 'href'), '/');
  assert.equal(texto(buscar(enlaces[0], 'b')[0]), BRAND.name.split(' ').pop());
});

test('layout: enlace para saltar al contenido y un único <main id="contenido">', () => {
  const salto = buscar(home, 'a').find((e) => atributo(e, 'class') === 'skip-link');
  assert.equal(atributo(salto, 'href'), '#contenido');
  assert.equal(texto(salto), sitio.saltar);
  const mains = buscar(home, 'main');
  assert.equal(mains.length, 1);
  assert.equal(atributo(mains[0], 'id'), 'contenido');
});

test('layout: el beacon solo está si se construyó con PUBLIC_CF_BEACON_TOKEN (nunca en el HTML, siempre agregado por un módulo)', () => {
  const html = leerDist('index.html');
  assert.ok(!/cloudflareinsights/.test(html), 'el origen del beacon no debe estar escrito en el HTML');
  const js = recursos('.js')
    .map((r) => r.texto)
    .join('\n');
  if (process.env.PUBLIC_CF_BEACON_TOKEN) {
    assert.ok(js.includes('static.cloudflareinsights.com'), 'con token, el módulo del beacon va en el sitio');
  } else {
    assert.ok(!js.includes('cloudflareinsights'), 'sin token no queda rastro del beacon');
  }
});

test('layout: las páginas que no se indexan (404 y confirmar) llevan robots noindex y sin canonical', () => {
  for (const pagina of ['404.html', 'confirmar.html']) {
    const doc = parsear(leerDist(pagina));
    assert.equal(meta(doc, 'robots'), 'noindex', pagina);
    assert.ok(!buscar(doc, 'link').some((e) => atributo(e, 'rel') === 'canonical'), `${pagina} no lleva canonical`);
  }
  assert.equal(meta(home, 'robots'), null, 'la portada sí se indexa');
});
