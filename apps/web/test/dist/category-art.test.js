// (CI) Arte de las categorías construido: role="img" con <title> del diccionario, sin style= ni <style>. Hasta que la
// portada (lote siguiente) lo use, las pruebas solo revisan lo que haya en dist; cuando la portada lo use, tiene que
// estar el de las cuatro categorías.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '@tienda/contracts/enums';
import { opciones } from '@tienda/contracts/i18n';
import { atributo, buscar, leerDist, paginasDeDist, parsear, texto } from './support/html.js';

/** Los <svg class="arte ..."> de una página, con su categoría. */
function artes(doc) {
  return buscar(doc, 'svg')
    .filter((s) => (atributo(s, 'class') ?? '').split(/\s+/).includes('arte'))
    .map((s) => ({
      svg: s,
      categoria: (atributo(s, 'class') ?? '')
        .split(/\s+/)
        .find((c) => c.startsWith('arte--'))
        ?.slice(6),
    }));
}

const todas = paginasDeDist().flatMap((p) => artes(parsear(leerDist(p))).map((a) => ({ ...a, pagina: p })));

test('arte: cada SVG de categoría o es decorativo (aria-hidden) o tiene role="img" y el <title> del diccionario', () => {
  for (const { svg, categoria, pagina } of todas) {
    assert.ok(CATEGORIES.includes(categoria), `${pagina}: categoría desconocida ${categoria}`);
    if (atributo(svg, 'aria-hidden') === 'true') {
      assert.equal(atributo(svg, 'role'), null, `${pagina}: un decorativo no lleva role`);
      continue;
    }
    assert.equal(atributo(svg, 'role'), 'img', `${pagina}: ${categoria}`);
    const titulo = buscar(svg, 'title')[0];
    assert.equal(texto(titulo), opciones.categorias[categoria].arteAlt, `${pagina}: ${categoria}`);
  }
});

test('arte: sin style=, sin <style> y sin referencias <use> dentro de ningún SVG de categoría', () => {
  for (const { svg, categoria, pagina } of todas) {
    const dentro = [svg, ...buscar(svg, 'path'), ...buscar(svg, 'rect'), ...buscar(svg, 'g'), ...buscar(svg, 'text')];
    assert.ok(
      dentro.every((e) => atributo(e, 'style') === null),
      `${pagina}: ${categoria} trae style=`,
    );
    assert.equal(buscar(svg, 'style').length, 0, `${pagina}: ${categoria} trae <style>`);
    assert.equal(buscar(svg, 'use').length, 0, `${pagina}: ${categoria} trae <use>`);
  }
});

test('arte: si la portada usa el arte, usa el de las cuatro categorías', () => {
  const enPortada = todas.filter((a) => a.pagina === 'index.html' && atributo(a.svg, 'aria-hidden') !== 'true');
  if (enPortada.length === 0) return;
  assert.deepEqual([...new Set(enPortada.map((a) => a.categoria))].sort(), [...CATEGORIES].sort());
});
