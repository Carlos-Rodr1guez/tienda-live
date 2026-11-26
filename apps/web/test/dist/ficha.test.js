// (CI) Ficha de juego: ASEDIO tiene página con sus mecánicas, regalos y requisitos; los conceptos NO tienen página ni
// enlace. Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { juego } from '@tienda/contracts/i18n';
import { DIST, atributo, buscar, leerDist, paginasDeDist, parsear, texto } from './support/html.js';

test('ficha: /juegos/asedio existe, con un h1 y las secciones de mecánicas, regalos y requisitos', () => {
  const doc = parsear(leerDist('juegos/asedio.html'));
  assert.equal(buscar(doc, 'h1').length, 1);
  assert.equal(texto(buscar(doc, 'h1')[0]), 'ASEDIO LIVE');
  const titulos = buscar(doc, 'h2').map(texto);
  assert.deepEqual(titulos, [juego.ficha.mecanicas, juego.ficha.regalos, juego.ficha.requisitos]);
  const regalos = buscar(doc, 'li').filter((li) => atributo(li, 'class')?.includes('regalo'));
  assert.equal(regalos.length, 4);
  assert.ok(texto(regalos[3]).includes('1000 o más'));
});

test('ficha: lleva el póster con "Video próximamente" y un enlace para anotarse que vuelve a la portada', () => {
  const doc = parsear(leerDist('juegos/asedio.html'));
  assert.ok(buscar(doc, 'picture').length === 1);
  const enlace = buscar(doc, 'a').find((a) => texto(a) === juego.ficha.anotarme);
  assert.equal(atributo(enlace, 'href'), '/#anotarme');
});

test('ficha: los conceptos (batalla, acuario, carrera) no tienen página en dist y nadie los enlaza', () => {
  for (const concepto of ['batalla', 'acuario', 'carrera']) {
    assert.equal(existsSync(join(DIST, 'juegos', `${concepto}.html`)), false, `existe juegos/${concepto}.html`);
  }
  for (const pagina of paginasDeDist()) {
    const hrefs = buscar(parsear(leerDist(pagina)), 'a').map((a) => atributo(a, 'href') ?? '');
    for (const concepto of ['batalla', 'acuario', 'carrera']) {
      assert.ok(!hrefs.some((h) => h.includes(concepto)), `${pagina} enlaza a ${concepto}`);
    }
  }
});

test('ficha: solo hay una ficha en juegos/ (ASEDIO) y el sitemap la lista', () => {
  const fichas = paginasDeDist().filter((p) => p.startsWith('juegos/'));
  assert.deepEqual(fichas, ['juegos/asedio.html']);
  const mapa = leerDist('sitemap.xml');
  assert.match(mapa, /\/juegos\/asedio<\/loc>/);
  assert.doesNotMatch(mapa, /batalla|acuario|carrera/);
});
