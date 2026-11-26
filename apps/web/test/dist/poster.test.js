// (CI) Póster de la portada: <picture> con AVIF y WebP, alt que describe la escena, aviso "Video próximamente" y sin
// control de reproducir (todavía no hay video). Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inicio } from '@tienda/contracts/i18n';
import { atributo, buscar, leerDist, parsear, texto } from './support/html.js';

const home = parsear(leerDist('index.html'));
const hero = buscar(home, 'section').find((s) => atributo(s, 'aria-labelledby') === 'titulo-inicio');

test('póster: <picture> con fuentes AVIF y WebP y una imagen de respaldo con el alt de la escena', () => {
  const imagen = buscar(hero, 'picture')[0];
  assert.ok(imagen, 'falta el <picture>');
  const tipos = buscar(imagen, 'source').map((s) => atributo(s, 'type'));
  assert.ok(tipos.includes('image/avif'), `tipos: ${tipos}`);
  assert.ok(tipos.includes('image/webp'), `tipos: ${tipos}`);
  const img = buscar(imagen, 'img')[0];
  assert.equal(atributo(img, 'alt'), inicio.videoPosterAlt);
  assert.match(atributo(img, 'src'), /^\/_astro\//, 'la imagen sale del sitio, no de otro origen');
  assert.equal(atributo(img, 'fetchpriority'), 'high');
  assert.notEqual(atributo(img, 'loading'), 'lazy', 'el póster es lo primero que se ve');
});

test('póster: el aviso "Video próximamente" está a la vista y no hay botón de reproducir ni <video>', () => {
  assert.ok(texto(hero).includes(inicio.videoProximamente));
  assert.equal(buscar(hero, 'video').length, 0);
  const marco = buscar(hero, 'div').find((d) => atributo(d, 'class')?.includes('poster'));
  assert.ok(marco);
  assert.equal(buscar(marco, 'button').length, 0, 'sin control de reproducir');
  assert.equal(buscar(marco, 'a').length, 0);
});

test('póster: el texto alternativo no repite el HUD de la captura (describe naves, bandos y base)', () => {
  const alt = atributo(buscar(hero, 'img')[0], 'alt');
  assert.ok(alt.length <= 150);
  assert.doesNotMatch(alt, /RONDA|REGALOS/i);
});
