import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerPropiedades } from '../support/css.js';

const raiz = new URL('../../', import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), 'utf8');
const tokens = leerPropiedades(leer('src/styles/tokens.css'));

test('favicon: la nave "caza" en dorado sobre un cuadrado redondeado del color de fondo', () => {
  const svg = leer('public/favicon.svg');
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 48 48"/);
  // el trazado del caza, tal cual en la dirección A
  assert.match(svg, /d="M24 4 34 42 24 34 14 42Z"/);
  const colores = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
  assert.ok(colores.includes(tokens.get('--gold')), 'la nave va en --gold');
  assert.ok(colores.includes(tokens.get('--bg')), 'el cuadrado va en --bg');
  assert.match(svg, /<rect[^>]*\brx="/);
  assert.ok(!/<style|style=|<script|<image|href=/.test(svg), 'sin estilos, scripts ni recursos externos');
});

test('estrellas: archivo SVG propio, decorativo, de puntos claros pequeños y tenues (una por celda de 35x35px)', () => {
  const svg = leer('src/styles/estrellas.svg');
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!/<style|style=|<script|<image|href=|data:/.test(svg));
  const ancho = Number(/width="(\d+)"/.exec(svg)?.[1]);
  const alto = Number(/height="(\d+)"/.exec(svg)?.[1]);
  const puntos = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"(?: opacity="([\d.]+)")?\/>/g)];
  assert.ok(puntos.length >= 20, `muy pocas estrellas: ${puntos.length}`);
  const densidad = (ancho * alto) / puntos.length;
  assert.ok(densidad >= 30 * 30 && densidad <= 40 * 40, `una estrella cada ${Math.sqrt(densidad).toFixed(1)}px`);
  assert.match(svg, /fill="#dbe6ff"/);
  for (const [, cx, cy, r, opacidad] of puntos) {
    assert.ok(Number(r) <= 1.3, `radio ${r} mayor que 1.3`);
    assert.ok(Number(opacidad ?? 1) <= 0.6, `opacidad ${opacidad} mayor que .6`);
    // entera dentro del mosaico: así el mosaico repetido no corta ni duplica puntos
    assert.ok(Number(cx) - Number(r) >= 0 && Number(cx) + Number(r) <= ancho, `cx ${cx} se sale`);
    assert.ok(Number(cy) - Number(r) >= 0 && Number(cy) + Number(r) <= alto, `cy ${cy} se sale`);
  }
});

test('licencias: el aviso de la OFL de Oxanium es la LICENSE del paquete, palabra por palabra', () => {
  const del_paquete = readFileSync(new URL('../../node_modules/@fontsource-variable/oxanium/LICENSE', raiz), 'utf8');
  const publicada = leer('public/licencias/oxanium-OFL.txt');
  assert.equal(publicada, del_paquete);
  assert.match(publicada, /SIL OPEN FONT LICENSE Version 1\.1/);
});
