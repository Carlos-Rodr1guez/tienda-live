import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cssDe, declaraciones, leer, problemasDeRevelado } from '../support/source-rules.js';

const LADDER = fileURLToPath(new URL('../../src/components/GiftLadder.astro', import.meta.url));

// ---- el comprobador, con ejemplos buenos y malos ----

const BUENO = `
  .nivel { color: var(--text); }
  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      .nivel { animation: sube var(--ease-out) both; animation-timeline: view(); animation-range: entry 0% entry 70%; }
    }
  }
  @keyframes sube { from { transform: translateY(0.75rem) scale(0.94); } to { transform: none; } }
`;

test('revelado: la escalera con solo transform, bajo @supports y sin preferencia de reducir movimiento, no da problemas', () => {
  assert.deepEqual(problemasDeRevelado(BUENO), []);
});

test('revelado: animar la opacidad, en @keyframes o en la propiedad animation/transition, se marca', () => {
  const enKeyframes = BUENO.replace('to { transform: none; }', 'to { transform: none; opacity: 1; }');
  assert.ok(problemasDeRevelado(enKeyframes).includes('@keyframes anima opacity'));
  const enAnimation = BUENO.replace(
    'animation: sube var(--ease-out) both;',
    'animation: sube 1s, aparece 1s; transition: opacity 1s;',
  );
  assert.ok(problemasDeRevelado(enAnimation).some((p) => p.startsWith('transition anima opacity')));
  assert.ok(
    problemasDeRevelado(BUENO.replace('animation: sube', 'animation: opacity-in')).some((p) =>
      p.includes('animation anima opacity'),
    ),
  );
});

test('revelado: animation-timeline fuera de @supports o sin prefers-reduced-motion: no-preference se marca', () => {
  const sinSupports = '@media (prefers-reduced-motion: no-preference) { .a { animation-timeline: view(); } }';
  assert.ok(problemasDeRevelado(sinSupports).some((p) => p.includes('@supports')));
  const sinMedia = '@supports (animation-timeline: view()) { .a { animation-timeline: view(); } }';
  assert.ok(problemasDeRevelado(sinMedia).some((p) => p.includes('prefers-reduced-motion: no-preference')));
  assert.ok(problemasDeRevelado('.a { animation: sube 1s; }').length >= 1, 'una animación suelta tampoco');
});

test('declaraciones: lee propiedades con su contexto y soporta la última sin punto y coma', () => {
  const lista = declaraciones('@supports (x: y) { .a { color: red; margin: 0 } }');
  assert.deepEqual(lista, [
    { prop: 'color', valor: 'red', contexto: ['@supports (x: y)', '.a'] },
    { prop: 'margin', valor: '0', contexto: ['@supports (x: y)', '.a'] },
  ]);
});

// ---- el archivo real ----

test('GiftLadder: el CSS nunca anima la opacidad y el revelado vive bajo @supports y no-preference', () => {
  const css = cssDe(LADDER, leer(LADDER));
  assert.deepEqual(problemasDeRevelado(css), []);
  // y el revelado existe de verdad (si no, el comprobador pasaría con un archivo sin animación)
  assert.match(css, /@supports\s*\(animation-timeline:\s*view\(\)\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
  assert.match(css, /animation-timeline:\s*view\(\)/);
});

test('GiftLadder: el movimiento es translateY(.75rem) scale(.94) hacia none, y la opacidad no se toca en ninguna regla', () => {
  const css = cssDe(LADDER, leer(LADDER));
  const keyframes = /@keyframes\s+[\w-]+\s*\{([\s\S]*?\}\s*)\}/.exec(css);
  assert.ok(keyframes, 'falta el @keyframes');
  assert.match(
    keyframes[1],
    /from\s*\{\s*transform:\s*translateY\(\s*0?\.75rem\s*\)\s*scale\(\s*0?\.94\s*\)\s*;?\s*\}/,
  );
  assert.match(keyframes[1], /to\s*\{\s*transform:\s*none\s*;?\s*\}/);
  assert.doesNotMatch(css, /opacity/, 'la opacidad queda en 1 en toda posición de scroll');
});
