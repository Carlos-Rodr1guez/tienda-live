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
  problemasDeTokens,
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

test('tokens: encuentra colores, radios, sombras y curvas escritos a mano fuera de tokens.css', () => {
  const malos = {
    'color hexadecimal': '.a { color: #ffc23d; }',
    'color rgb': '.a { background: rgb(4 6 12 / .86); }',
    'color hsl': '.a { color: hsl(40 100% 60%); }',
    'radio escrito a mano': '.a { border-radius: 8px; }',
    'radio mezclado': '.a { border-radius: var(--radius-card) 8px 0 0; }',
    'sombra escrita a mano': '.a { box-shadow: 0 1px 2px black; }',
    'curva escrita a mano': '.a { transition: transform 120ms cubic-bezier(.2,.8,.2,1); }',
  };
  for (const [esperado, css] of Object.entries(malos)) {
    assert.ok(
      problemasDeTokens(css).some((p) => p.includes(esperado.split(' ')[0])),
      esperado,
    );
  }
});

test('tokens: lo que sale de los tokens no da problemas (var(), 0, 50%, none) y las excepciones declaradas se respetan', () => {
  const bueno = `
    .a { color: var(--text); border-radius: var(--radius-card) var(--radius-card) 0 0; box-shadow: var(--shadow); }
    .b { border-radius: 50%; box-shadow: none; transition: transform var(--dur-press) var(--ease-out); }
    .c { background: url('./estrellas.svg'); }
  `;
  assert.deepEqual(problemasDeTokens(bueno), []);
  assert.deepEqual(problemasDeTokens('html { scrollbar-color: #2a3550 var(--bg); }', ['#2a3550']), []);
  assert.equal(problemasDeTokens('html { scrollbar-color: #2a3551 var(--bg); }', ['#2a3550']).length, 1);
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

// Los dos únicos valores a mano que el diseño fija sin token: el pulgar de la barra de desplazamiento y la selección
const EXCEPCIONES_BASE = ['#2a3550', 'rgb(47 155 255 / 0.35)'];

test('src: ningún color, radio, sombra ni curva se escribe a mano fuera de tokens.css', () => {
  const problemas = [];
  for (const ruta of archivos(SRC, ['.css', '.astro'])) {
    if (ruta.endsWith('tokens.css')) continue;
    const css = cssDe(ruta, leer(ruta));
    const excepciones = ruta.endsWith('base.css') ? EXCEPCIONES_BASE : [];
    for (const p of problemasDeTokens(css, excepciones)) problemas.push(`${legible(SRC, ruta)}: ${p}`);
  }
  assert.deepEqual(problemas, []);
});
