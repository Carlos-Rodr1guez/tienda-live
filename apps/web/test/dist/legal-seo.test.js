// (CI) Páginas legales con el aviso de "Borrador", robots.txt y sitemap.xml construidos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { BRAND } from '@tienda/contracts/brand';
import { legal, sitio } from '@tienda/contracts/i18n';
import { legalMeta } from '../../src/lib/legal.js';
import { buildRobots } from '../../src/lib/robots.js';
import { indexableRoutes } from '../../src/lib/routes.js';
import { buildSitemap } from '../../src/lib/sitemap.js';
import { parseFrontmatter } from '../support/frontmatter.js';
import { atributo, buscar, leerDist, parsear, texto } from './support/html.js';

const SITIO = new URL(process.env.SITE_URL || 'http://localhost:8790').origin;

/** Las entradas de una colección leídas de sus .md. */
function coleccion(carpeta) {
  const dir = new URL(`../../src/content/${carpeta}/`, import.meta.url);
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => ({ id: n.replace(/\.md$/, ''), data: parseFrontmatter(readFileSync(new URL(n, dir), 'utf8')).data }));
}

const legales = coleccion('legal');
const juegos = coleccion('juegos');

test('legal: hay una página por cada archivo de src/content/legal, con su h1, título y versión', () => {
  assert.ok(legales.length >= 2);
  for (const { id, data } of legales) {
    const doc = parsear(leerDist(`legal/${id}.html`));
    const meta = legalMeta(data, BRAND.name);
    assert.equal(texto(buscar(doc, 'h1')[0]), data.titulo, id);
    assert.equal(texto(buscar(doc, 'title')[0]), meta.titulo, id);
    assert.ok(texto(buscar(doc, 'main')[0]).includes(meta.versionActualizado), `${id}: versión y fecha`);
    const canonical = buscar(doc, 'link').find((e) => atributo(e, 'rel') === 'canonical');
    assert.equal(atributo(canonical, 'href'), `${SITIO}/legal/${id}`, id);
  }
});

test('legal: mientras el archivo diga borrador: true, la página muestra el aviso de "Borrador"', () => {
  for (const { id, data } of legales) {
    const doc = parsear(leerDist(`legal/${id}.html`));
    const aviso = buscar(doc, 'div').find((d) => atributo(d, 'role') === 'note');
    if (data.borrador) {
      assert.ok(aviso, `${id}: falta el aviso`);
      assert.ok(texto(aviso).includes(legal.borradorTitulo), id);
      assert.ok(texto(aviso).includes(sitio.borrador), id);
    } else {
      assert.equal(aviso, undefined, `${id}: ya no es borrador y no debería mostrar el aviso`);
    }
  }
});

test('legal: el cuerpo del archivo se muestra (al menos un subtítulo y un párrafo de la prosa)', () => {
  for (const { id } of legales) {
    const prosa = buscar(parsear(leerDist(`legal/${id}.html`)), 'div').find((d) => atributo(d, 'class') === 'prose');
    assert.ok(prosa && buscar(prosa, 'h2').length >= 1 && buscar(prosa, 'p').length >= 1, id);
  }
});

test('robots.txt: bloquea /confirmar y /v1/, apunta al sitemap absoluto y es el que arma lib/robots.js', () => {
  const robots = leerDist('robots.txt');
  assert.equal(robots, buildRobots(SITIO));
  assert.match(robots, /^Disallow: \/confirmar$/m);
  assert.match(robots, /^Disallow: \/v1\/$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${SITIO}/sitemap\\.xml$`, 'm'));
});

test('sitemap.xml: solo rutas indexables (portada y legales), nunca /confirmar ni /404', () => {
  const sitemap = leerDist('sitemap.xml');
  assert.equal(sitemap, buildSitemap(SITIO, indexableRoutes({ juegos, legales })));
  assert.ok(sitemap.includes(`<loc>${SITIO}/</loc>`));
  for (const { id } of legales) assert.ok(sitemap.includes(`<loc>${SITIO}/legal/${id}</loc>`), id);
  assert.ok(!sitemap.includes('/confirmar') && !sitemap.includes('/404'));
});
