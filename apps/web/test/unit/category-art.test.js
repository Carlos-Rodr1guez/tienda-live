import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '@tienda/contracts/enums';
import { opciones } from '@tienda/contracts/i18n';
import { ART_CLASSES, artAlt, renderArt } from '../../src/lib/category-art.js';

test('arte: hay una composición para cada categoría de contracts y todas son distintas', () => {
  const marcados = CATEGORIES.map((c) => renderArt(c));
  assert.equal(marcados.length, 4);
  assert.equal(new Set(marcados).size, 4, 'cada categoría tiene su propia composición');
  for (const m of marcados) assert.ok(m.length > 200, 'una composición con contenido');
});

test('arte: una categoría que no existe falla (no se dibuja un panel vacío)', () => {
  assert.throws(() => renderArt('estrategia'), /estrategia/);
  assert.throws(() => renderArt(undefined), /undefined/);
});

test('arte: sin style=, sin <style>, sin scripts ni referencias externas; solo clases del sistema', () => {
  for (const c of CATEGORIES) {
    const m = renderArt(c);
    assert.ok(!/style\s*=|<style|<script|<use|href|xlink|url\(|data:/i.test(m), c);
    const usadas = new Set([...m.matchAll(/class="([^"]+)"/g)].flatMap((x) => x[1].split(' ')));
    assert.ok(usadas.size > 0, `${c} usa clases`);
    for (const clase of usadas) assert.ok(ART_CLASSES.includes(clase), `${c}: clase desconocida ${clase}`);
    assert.ok(usadas.has('kb'), `${c} pinta su fondo`);
    assert.ok(usadas.has('k1'), `${c} usa su color de categoría`);
    assert.ok(!/NaN|undefined|null/.test(m), `${c}: coordenadas inválidas`);
  }
});

test('arte: Acción lleva el bombardero grande del Comandante, cazas invasores vueltos 180 grados y disparos en diagonal', () => {
  const m = renderArt('accion');
  assert.match(m, /d="M24 6 28 18 45 30/, 'bombardero');
  assert.equal([...m.matchAll(/rotate\(180 /g)].length, 3, 'tres cazas invasores');
  assert.match(m, /<path class="k2s"[^>]*d="M27 38 50 84/, 'disparos');
});

test('arte: Público lleva dos carriles de equipo, burbujas con el 1 y el 2 y cazas enfrentados', () => {
  const m = renderArt('publico');
  assert.match(m, />1<\/text>/);
  assert.match(m, />2<\/text>/);
  assert.match(m, /rotate\(90 /);
  assert.match(m, /rotate\(-90 /);
});

test('arte: Relax lleva agua en capas, peces y linternas; Metas, bloques hacia una meta con barra de avance', () => {
  const relax = renderArt('relax');
  assert.equal([...relax.matchAll(/<ellipse /g)].length, 2, 'dos peces');
  assert.equal([...relax.matchAll(/<rect class="k2" x="(?:30|84|112)"/g)].length, 3, 'tres linternas');
  assert.match(relax, /M-40 126Q-10 114 20 126T80 126/, 'olas');
  const metas = renderArt('metas');
  assert.equal([...metas.matchAll(/stroke-dasharray="5 4"/g)].length, 1, 'la meta punteada');
  assert.match(metas, /<rect class="k2" x="152" y="86" width="16" height="86"/, 'barra de avance');
});

test('arte: el texto alternativo sale del diccionario, uno por categoría', () => {
  for (const c of CATEGORIES) assert.equal(artAlt(c), opciones.categorias[c].arteAlt);
  assert.throws(() => artAlt('estrategia'), /estrategia/);
});
