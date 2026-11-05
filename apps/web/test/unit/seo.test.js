import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OG_IMAGE_SIZE, absoluteUrl, buildSeo } from '../../src/lib/seo.js';
import { buildSitemap } from '../../src/lib/sitemap.js';
import { buildRobots } from '../../src/lib/robots.js';

const meta = (lista, clave) => lista.find((m) => (m.property ?? m.name) === clave)?.content;

test('absoluteUrl: junta el origen del sitio con la ruta, sin importar la barra final ni una ruta en el sitio', () => {
  assert.equal(absoluteUrl('https://ejemplo.test', '/juegos/asedio'), 'https://ejemplo.test/juegos/asedio');
  assert.equal(absoluteUrl('https://ejemplo.test/', '/'), 'https://ejemplo.test/');
  assert.equal(absoluteUrl('http://localhost:8790', '/confirmar'), 'http://localhost:8790/confirmar');
  assert.equal(absoluteUrl('https://ejemplo.test/base/', '/legal/aviso'), 'https://ejemplo.test/legal/aviso');
});

test('absoluteUrl: una URL absoluta se respeta; una ruta sin barra inicial o un sitio que no es http(s) fallan', () => {
  assert.equal(absoluteUrl('https://ejemplo.test', 'https://otro.test/x.png'), 'https://otro.test/x.png');
  assert.throws(() => absoluteUrl('https://ejemplo.test', 'juegos/asedio'), /barra/);
  assert.throws(() => absoluteUrl('ftp://ejemplo.test', '/'), /http/);
  assert.throws(() => absoluteUrl('no es una url', '/'), /URL/);
});

test('buildSeo: Open Graph y Twitter con URLs absolutas, imagen 1200x630 y og:locale es_ES', () => {
  const seo = buildSeo({
    site: 'https://ejemplo.test',
    path: '/juegos/asedio',
    titulo: 'ASEDIO LIVE',
    descripcion: 'Un juego para tu LIVE.',
    nombreSitio: 'Sitio de prueba',
    imagen: '/_astro/sitio.abc123.png',
  });
  assert.equal(seo.canonical, 'https://ejemplo.test/juegos/asedio');
  assert.equal(seo.robots, null);

  assert.equal(meta(seo.openGraph, 'og:title'), 'ASEDIO LIVE');
  assert.equal(meta(seo.openGraph, 'og:description'), 'Un juego para tu LIVE.');
  assert.equal(meta(seo.openGraph, 'og:type'), 'website');
  assert.equal(meta(seo.openGraph, 'og:url'), 'https://ejemplo.test/juegos/asedio');
  assert.equal(meta(seo.openGraph, 'og:image'), 'https://ejemplo.test/_astro/sitio.abc123.png');
  assert.equal(meta(seo.openGraph, 'og:image:width'), '1200');
  assert.equal(meta(seo.openGraph, 'og:image:height'), '630');
  assert.equal(meta(seo.openGraph, 'og:site_name'), 'Sitio de prueba');
  assert.equal(meta(seo.openGraph, 'og:locale'), 'es_ES');

  assert.equal(meta(seo.twitter, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(seo.twitter, 'twitter:title'), 'ASEDIO LIVE');
  assert.equal(meta(seo.twitter, 'twitter:description'), 'Un juego para tu LIVE.');
  assert.equal(meta(seo.twitter, 'twitter:image'), 'https://ejemplo.test/_astro/sitio.abc123.png');

  assert.deepEqual(OG_IMAGE_SIZE, { width: 1200, height: 630 });
});

test('buildSeo: otro sitio y otra página dan otras URLs; noindex se refleja en robots; nada queda relativo', () => {
  const seo = buildSeo({
    site: 'http://localhost:8790',
    path: '/',
    titulo: 'Inicio',
    descripcion: 'Descripción.',
    nombreSitio: 'Sitio',
    imagen: 'https://cdn.ejemplo.test/og.png',
    noindex: true,
  });
  assert.equal(seo.canonical, 'http://localhost:8790/');
  assert.equal(seo.robots, 'noindex');
  assert.equal(meta(seo.openGraph, 'og:url'), 'http://localhost:8790/');
  assert.equal(meta(seo.openGraph, 'og:image'), 'https://cdn.ejemplo.test/og.png');
  for (const { content } of [...seo.openGraph, ...seo.twitter].filter((m) => /url|image$/.test(m.property ?? m.name))) {
    assert.match(content, /^https?:\/\//);
  }
  assert.equal(meta(seo.openGraph, 'og:locale'), 'es_ES');
});

test('buildSeo: sin título, descripción o imagen falla (no se publica una página sin vista previa)', () => {
  const base = {
    site: 'https://ejemplo.test',
    path: '/',
    titulo: 'T',
    descripcion: 'D',
    nombreSitio: 'S',
    imagen: '/x.png',
  };
  for (const campo of ['titulo', 'descripcion', 'nombreSitio', 'imagen']) {
    assert.throws(() => buildSeo({ ...base, [campo]: '' }), new RegExp(campo));
  }
});

test('sitemap: lista las rutas con URL absoluta, sin repetidas, en XML válido', () => {
  const xml = buildSitemap('https://ejemplo.test', ['/', '/juegos/asedio', '/legal/aviso', '/']);
  assert.match(
    xml,
    /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/,
  );
  assert.deepEqual(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    ['https://ejemplo.test/', 'https://ejemplo.test/juegos/asedio', 'https://ejemplo.test/legal/aviso'],
  );
  assert.ok(xml.endsWith('</urlset>\n'));
});

test('sitemap: escapa los caracteres de XML y rechaza /confirmar y /404', () => {
  assert.match(buildSitemap('https://ejemplo.test', ['/a&b']), /<loc>https:\/\/ejemplo\.test\/a&amp;b<\/loc>/);
  assert.throws(() => buildSitemap('https://ejemplo.test', ['/', '/confirmar']), /\/confirmar/);
  assert.throws(() => buildSitemap('https://ejemplo.test', ['/404']), /\/404/);
});

test('robots: bloquea /confirmar y /v1/, no bloquea el resto y apunta al sitemap absoluto', () => {
  const texto = buildRobots('https://ejemplo.test');
  const lineas = texto.trimEnd().split('\n');
  assert.deepEqual(lineas, [
    'User-agent: *',
    'Allow: /',
    'Disallow: /confirmar',
    'Disallow: /v1/',
    '',
    'Sitemap: https://ejemplo.test/sitemap.xml',
  ]);
  assert.ok(texto.endsWith('\n'));
  assert.match(buildRobots('http://localhost:8790/'), /Sitemap: http:\/\/localhost:8790\/sitemap\.xml/);
});
