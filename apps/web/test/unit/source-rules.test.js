import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  archivos,
  cssDe,
  hoverSinCompuerta,
  leer,
  legible,
  problemasDeAstro,
  problemasDeCss,
} from '../support/source-rules.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

// ---- los comprobadores, con ejemplos malos y buenos ----

test('hover: un :hover suelto se marca y el que está bajo (hover: hover) pasa', () => {
  assert.equal(hoverSinCompuerta('.a:hover { color: red; }').length, 1);
  assert.deepEqual(hoverSinCompuerta('@media (hover: hover) and (pointer: fine) { .a:hover { color: red; } }'), []);
  // un @media distinto no es compuerta
  assert.equal(hoverSinCompuerta('@media (min-width: 40rem) { .a:hover { color: red; } }').length, 1);
  // un :hover después de un bloque con compuerta sigue marcándose
  assert.equal(
    hoverSinCompuerta('@media (hover: hover) { .a:hover { x: 1; } } .b:hover { y: 2; }').length,
    1,
    'la compuerta no se filtra a lo que viene después',
  );
});

test('css: encuentra transition all, 100vh, scale(0), ease-in, recursos externos, data:, desenfoque y degradado en texto', () => {
  const malos = {
    'transition: all': '.a { transition: all 200ms; }',
    '100vh': '.a { min-height: 100vh; }',
    'scale(0)': '.a { transform: scale(0); }',
    'ease-in': '.a { transition: transform 200ms ease-in; }',
    'url() externa': '.a { background: url(https://x.test/a.png); }',
    '@import externo': "@import url('https://fonts.googleapis.com/css2?family=X');",
    'url(data:)': ".a { background: url('data:image/svg+xml,%3Csvg%3E'); }",
    'desenfoque decorativo': '.a { backdrop-filter: blur(8px); }',
    'texto con degradado': '.a { background-clip: text; }',
    'franja de color lateral': '.a { border-left: 4px solid red; }',
    'transition anima background-color: solo transform y opacidad': '.a { transition: background-color 200ms; }',
  };
  for (const [esperado, css] of Object.entries(malos)) {
    const problemas = problemasDeCss(css);
    assert.ok(
      problemas.some((p) => p.includes(esperado.split(':')[0])),
      `${esperado}: ${JSON.stringify(problemas)}`,
    );
  }
});

test('css: lo correcto no da problemas (transform y opacity, dvh, ease-in-out, borde fino, hover con compuerta)', () => {
  const bueno = `
    .a { min-height: 100dvh; transition: transform 140ms var(--ease-out), opacity 140ms var(--ease-out); }
    .b { transform: scale(0.97); border-left: 1px solid var(--line-strong); }
    @media (hover: hover) and (pointer: fine) { .a:hover { transform: translateY(-2px); } }
  `;
  assert.deepEqual(problemasDeCss(bueno), []);
});

test('astro: encuentra style=, is:inline, scripts con atributos, emoji como icono, CDN y <style> dentro de un SVG', () => {
  assert.ok(problemasDeAstro('<p style="color:red">x</p>').includes('atributo style='));
  assert.ok(problemasDeAstro('<script is:inline>1</script>').includes('is:inline'));
  assert.ok(problemasDeAstro('<script defer src="/a.js"></script>').some((p) => p.includes('con atributos')));
  assert.ok(problemasDeAstro('<button>Siguiente →</button>').some((p) => p.includes('emoji')));
  assert.ok(problemasDeAstro('<p>🚀 listo</p>').some((p) => p.includes('emoji')));
  assert.ok(problemasDeAstro('<link href="https://fonts.googleapis.com/x">').some((p) => p.includes('externo')));
  assert.ok(problemasDeAstro('<svg><style>.a{}</style></svg>').includes('<style> dentro de un SVG'));
});

test('astro: un componente limpio no da problemas (script agrupado sin atributos, style con hover bien compuerteado)', () => {
  const limpio = `---
const x = 'style="no es un atributo, es una cadena del frontmatter"';
---
<p class="a">{x}</p>
<script>
  import '../lib/algo.js';
</script>
<style>
  .a { color: var(--text); }
  @media (hover: hover) and (pointer: fine) { .a:hover { transform: translateY(-2px); } }
</style>`;
  assert.deepEqual(problemasDeAstro(limpio), []);
});

// ---- los archivos reales ----

test('src: ningún CSS ni componente de la web rompe las reglas (sin style=, sin is:inline, sin fuentes externas, hover con compuerta)', () => {
  const lista = archivos(SRC, ['.css', '.astro']);
  assert.ok(lista.length >= 2, 'tendría que haber al menos tokens.css y base.css');
  const problemas = [];
  for (const ruta of lista) {
    const texto = leer(ruta);
    const encontrados = ruta.endsWith('.astro') ? problemasDeAstro(texto) : problemasDeCss(cssDe(ruta, texto));
    for (const p of encontrados) problemas.push(`${legible(SRC, ruta)}: ${p}`);
  }
  assert.deepEqual(problemas, []);
});
