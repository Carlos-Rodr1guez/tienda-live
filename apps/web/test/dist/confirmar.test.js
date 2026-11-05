// (CI) Página /confirmar: no se indexa, no se refiere a nadie, sin scripts de terceros ni eventos, y con los
// elementos que el controlador necesita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmar } from '@tienda/contracts/i18n';
import { atributo, buscar, elementos, leerDist, parsear, texto } from './support/html.js';

const doc = parsear(leerDist('confirmar.html'));
const porId = (id) => elementos(doc).find((e) => atributo(e, 'id') === id);

test('confirmar: noindex y referrer no-referrer en <meta> (además de las cabeceras de _headers)', () => {
  const metas = buscar(doc, 'meta');
  const valor = (nombre) =>
    atributo(
      metas.find((m) => atributo(m, 'name') === nombre),
      'content',
    );
  assert.equal(valor('robots'), 'noindex');
  assert.equal(valor('referrer'), 'no-referrer');
  assert.equal(texto(buscar(doc, 'h1')[0]), confirmar.titulo);
});

test('confirmar: tiene la región de estado, el botón y el enlace de vuelta, ocultos hasta que el script decide', () => {
  const mensaje = porId('confirmar-mensaje');
  assert.equal(atributo(mensaje, 'role'), 'status');
  assert.equal(atributo(mensaje, 'aria-live'), 'polite');
  const boton = porId('confirmar-boton');
  assert.equal(boton.tagName, 'button');
  assert.equal(atributo(boton, 'type'), 'button');
  assert.notEqual(atributo(boton, 'hidden'), null);
  assert.equal(texto(boton), confirmar.boton);
  const volver = porId('confirmar-volver');
  assert.equal(atributo(volver, 'href'), '/');
  assert.notEqual(atributo(volver, 'hidden'), null);
});

test('confirmar: sin JavaScript avisa que hace falta (noscript)', () => {
  const textoPagina = leerDist('confirmar.html');
  assert.ok(textoPagina.includes(confirmar.noscript));
});

test('confirmar: solo scripts de la propia web, y ninguno nombra Turnstile ni /v1/events', () => {
  const srcs = buscar(doc, 'script').map((s) => atributo(s, 'src'));
  assert.ok(srcs.length >= 1, 'el controlador va como script agrupado');
  assert.ok(
    srcs.every((s) => s && s.startsWith('/_astro/')),
    srcs.join(', '),
  );
  for (const src of srcs) {
    const js = leerDist(src.slice(1));
    assert.ok(!js.includes('challenges.cloudflare.com'), `${src} nombra Turnstile`);
    assert.ok(!js.includes('/v1/events'), `${src} manda eventos`);
  }
  assert.ok(!buscar(doc, 'iframe').length);
});
