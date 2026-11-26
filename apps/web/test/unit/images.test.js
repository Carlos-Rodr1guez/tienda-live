import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSETS_BASE, resolvePoster } from '../../src/lib/images.js';

const metadatos = { src: '/src/assets/juegos/asedio/poster.png', width: 1080, height: 1920, format: 'png' };
const modulos = {
  '/src/assets/juegos/asedio/poster.png': { default: metadatos },
  '/src/assets/juegos/otro/portada.webp': { default: { ...metadatos, format: 'webp' } },
};

test('resolvePoster: devuelve los metadatos de la imagen que apunta la ficha (ruta relativa a src/assets)', () => {
  assert.equal(ASSETS_BASE, '/src/assets/');
  assert.equal(resolvePoster('juegos/asedio/poster.png', modulos), metadatos);
  assert.equal(resolvePoster('juegos/otro/portada.webp', modulos).format, 'webp');
});

test('resolvePoster: un archivo que no existe falla nombrando la ruta, así la construcción no publica una ficha sin póster', () => {
  assert.throws(() => resolvePoster('juegos/asedio/falta.png', modulos), /juegos\/asedio\/falta\.png/);
  assert.throws(() => resolvePoster('juegos/asedio/poster.png', {}), /poster\.png/);
});

test('resolvePoster: una ruta vacía, con .. o absoluta se rechaza', () => {
  for (const mala of ['', '../secreto.png', '/etc/passwd', 'juegos/../../x.png']) {
    assert.throws(() => resolvePoster(mala, modulos), /ruta/i, mala);
  }
});

test('resolvePoster: si el módulo no trae una imagen con ancho y alto falla (un archivo que no es imagen)', () => {
  assert.throws(
    () => resolvePoster('juegos/asedio/poster.png', { '/src/assets/juegos/asedio/poster.png': { default: 'x' } }),
    /imagen/i,
  );
});
