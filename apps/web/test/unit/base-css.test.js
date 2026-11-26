import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { leerPropiedades, sinComentarios } from '../support/css.js';

const raiz = new URL('../../', import.meta.url);
const base = sinComentarios(readFileSync(new URL('src/styles/base.css', raiz), 'utf8'));
const tokens = leerPropiedades(readFileSync(new URL('src/styles/tokens.css', raiz), 'utf8'));

/** Las reglas sin anidar de base.css: selectores separados por comas y cuerpo. */
const REGLAS = [...base.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectores: m[1].split(',').map((s) => s.trim()),
  cuerpo: m[2],
}));

/** Los cuerpos de todas las reglas que nombran el selector dado, juntos. */
function regla(selector) {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nombra = new RegExp(`(?<![\\w-])${escapado}(?![\\w-])`);
  const cuerpos = REGLAS.filter((r) => r.selectores.some((s) => nombra.test(s))).map((r) => r.cuerpo);
  assert.ok(cuerpos.length > 0, `base.css no tiene una regla para ${selector}`);
  return cuerpos.join('\n');
}

test('base: superficies del navegador (color-scheme oscuro, acento, cursor, selección, barras de desplazamiento)', () => {
  const html = regla('html');
  assert.match(html, /color-scheme:\s*dark/);
  assert.match(html, /accent-color:\s*var\(--gold\)/);
  assert.match(html, /caret-color:\s*var\(--gold\)/);
  assert.match(html, /scrollbar-color:\s*#2a3550\s+var\(--bg\)/);
  assert.match(html, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(regla('::selection'), /background(?:-color)?:\s*rgb\(47 155 255 \/ 0\.35\)/);
});

test('base: anillo de foco de 2px con separación de 3px (la enmienda 7 mantiene el del diseño)', () => {
  const foco = regla(':focus-visible');
  assert.match(foco, /outline:\s*2px solid var\(--focus\)/);
  assert.match(foco, /outline-offset:\s*3px/);
});

test('base: toques cómodos (touch-action, objetivos de 44px, entradas de al menos 16px)', () => {
  assert.match(base, /touch-action:\s*manipulation/);
  const objetivos = regla('button');
  assert.match(objetivos, /min-height:\s*44px/);
  const campos = regla('input');
  assert.match(campos, /font-size:\s*var\(--fs-base\)/);
  assert.ok(parseFloat(tokens.get('--fs-base')) >= 1, 'el tamaño base no baja de 16px (1rem)');
  assert.match(campos, /min-height:\s*44px/);
});

test('base: pulsación con escala .97 en 120ms y con la curva de salida del token', () => {
  assert.match(base, /:active[^{]*\{[^}]*transform:\s*scale\(0?\.97\)/);
  assert.match(base, /transition:\s*transform var\(--dur-press\) var\(--ease-out\)/);
});

test('base: con movimiento reducido no se mueve nada (se conservan opacidad y color)', () => {
  const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(base);
  assert.ok(m, 'falta @media (prefers-reduced-motion: reduce)');
  assert.match(m[1], /transition-duration:\s*0\.01ms/);
  assert.match(m[1], /animation-duration:\s*0\.01ms/);
  assert.match(m[1], /scroll-behavior:\s*auto/);
});

test('base: títulos con texto equilibrado, prosa con medida y numerales tabulares', () => {
  assert.match(regla('h1'), /text-wrap:\s*balance/);
  assert.match(regla('p'), /text-wrap:\s*pretty/);
  assert.match(regla('p'), /max-inline-size:\s*var\(--measure\)/);
  assert.match(regla('.num'), /font-variant-numeric:\s*tabular-nums/);
});

test('base: el campo de estrellas es un archivo SVG propio (nunca data:) y existe', () => {
  assert.match(base, /url\(\s*['"]?\.\/estrellas\.svg['"]?\s*\)/);
  assert.ok(!/data:/.test(base), 'la CSP es default-src self: un data: queda bloqueado');
  assert.ok(existsSync(new URL('src/styles/estrellas.svg', raiz)));
});

test('base: la tipografía sale de los tokens y los botones dorados usan --on-gold', () => {
  assert.match(regla('body'), /font-family:\s*var\(--font-sans\)/);
  assert.match(regla('.btn'), /background:\s*var\(--gold\)/);
  assert.match(regla('.btn'), /color:\s*var\(--on-gold\)/);
  assert.match(regla('.btn'), /min-height:\s*52px/);
});

test('base: los colores salen de los tokens (no hay hexadecimales sueltos fuera de tokens.css)', () => {
  const sueltos = [...base.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  // #2a3550 es el pulgar de la barra de desplazamiento, que el diseño fija a mano (sin token propio)
  assert.deepEqual(
    sueltos.filter((c) => c.toLowerCase() !== '#2a3550'),
    [],
  );
});

test('base: [hidden] gana siempre (un .btn con hidden no se muestra) y las páginas de apoyo usan --fs-2xl y una prosa acotada', () => {
  assert.match(regla('[hidden]'), /display:\s*none\s*!important/);
  assert.match(regla('.apoyo h1'), /font-size:\s*var\(--fs-2xl\)/);
  assert.match(regla('.prose'), /max-inline-size:\s*var\(--measure\)/);
  assert.match(regla('.aviso-panel'), /background:\s*var\(--surface-2\)/);
  assert.match(regla('.aviso-panel'), /border-radius:\s*var\(--radius-panel\)/);
});

test('base: el tono de un mensaje de estado sale de data-tono (ok en verde, error en rosa claro) sin franjas laterales', () => {
  assert.match(regla("[data-tono='ok']"), /color:\s*var\(--ok\)/);
  assert.match(regla("[data-tono='error']"), /color:\s*var\(--error\)/);
});
