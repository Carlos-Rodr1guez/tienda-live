// (CI) Página 404: mensaje, enlace a la portada, aviso de no afiliación (lo cubren las pruebas globales) y noindex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagina404 } from '@tienda/contracts/i18n';
import { atributo, buscar, leerDist, parsear, texto } from './support/html.js';

const doc = parsear(leerDist('404.html'));

test('404: el título y el texto explican qué pasó', () => {
  assert.equal(texto(buscar(doc, 'h1')[0]), pagina404.titulo);
  assert.ok(texto(buscar(doc, 'main')[0]).includes(pagina404.texto));
});

test('404: ofrece volver al inicio con un enlace a la portada', () => {
  const volver = buscar(buscar(doc, 'main')[0], 'a').find((a) => texto(a) === pagina404.volver);
  assert.ok(volver, 'falta el enlace de vuelta');
  assert.equal(atributo(volver, 'href'), '/');
});

test('404: no se indexa y lleva el icono de aviso como decoración (aria-hidden)', () => {
  const robots = buscar(doc, 'meta').find((m) => atributo(m, 'name') === 'robots');
  assert.equal(atributo(robots, 'content'), 'noindex');
  const iconos = buscar(buscar(doc, 'main')[0], 'svg');
  assert.ok(iconos.length >= 1 && iconos.every((s) => atributo(s, 'aria-hidden') === 'true'));
});
