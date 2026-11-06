import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CB-13 y CB-18: `sim/`, `data/` y `camera/` son puros e isomórficos. Sin azar, sin reloj propio y sin DOM; y las
// reglas (`sim/`) solo usan operaciones cuyo resultado es idéntico en todos los motores. Red de seguridad para los
// lotes siguientes: se vuelve más estricta sola a medida que aparecen archivos.
const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));

/** Quita los comentarios de bloque y de línea: los JSDoc empiezan con "/**" y no son el operador "**". */
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PUREZA = /Math\.random|Date\.now|\bdocument\b|\bwindow\b/;
// Lo que puede dar resultados distintos entre Node y Chrome: trascendentes, potencias y el reloj de alta precisión
const NO_DETERMINISTA =
  /Math\.(hypot|exp|expm1|log\w*|pow|sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|cbrt)\b|\*\*|\bperformance\b/;
const IMPORTA_RNG = /from\s+['"][^'"]*\brng\.js['"]/;

// colors.js es el único exento, y solo de NO_DETERMINISTA: necesita pow, sin, cos, atan2 y exp (CIEDE2000 y gamma).
// Se usa al elegir el par, nunca dentro del paso del sim, y los umbrales dejan margen (Duda 6 del desglose).
const EXENTO_DE_TRASCENDENTES = new Set(['sim/colors.js']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (f) => path.relative(GJ, f).replaceAll('\\', '/');
const puros = ['sim', 'data', 'camera'].flatMap((d) => walk(path.join(GJ, d))).filter((f) => f.endsWith('.js'));
const reglas = puros.filter((f) => rel(f).startsWith('sim/'));

test('hay módulos que revisar en sim y en data', () => {
  assert.ok(rel(puros[0]).length > 0);
  for (const d of ['sim/', 'data/'])
    assert.ok(
      puros.some((f) => rel(f).startsWith(d)),
      d,
    );
});

for (const file of puros) {
  test(`aislamiento: ${rel(file)} no usa Math.random, Date.now ni DOM`, () => {
    assert.doesNotMatch(sinComentarios(fs.readFileSync(file, 'utf8')), PUREZA);
  });
}

for (const file of reglas) {
  const nombre = rel(file);
  test(`reglas: ${nombre} no usa trascendentes, potencias, performance ni importa rng.js`, () => {
    const src = sinComentarios(fs.readFileSync(file, 'utf8'));
    assert.doesNotMatch(src, IMPORTA_RNG);
    if (!EXENTO_DE_TRASCENDENTES.has(nombre)) assert.doesNotMatch(src, NO_DETERMINISTA);
  });
}

test('la exención de trascendentes es solo colors.js y tiene su comentario explicando por qué', () => {
  assert.deepEqual([...EXENTO_DE_TRASCENDENTES], ['sim/colors.js']);
  const src = fs.readFileSync(path.join(GJ, 'sim/colors.js'), 'utf8');
  assert.match(src, /EXENCIÓN DE AISLAMIENTO/);
  // sigue sujeto a las demás reglas de pureza
  assert.doesNotMatch(sinComentarios(src), PUREZA);
  assert.doesNotMatch(sinComentarios(src), IMPORTA_RNG);
});

test('el escáner detecta cada violación y deja pasar los comentarios', () => {
  for (const s of ['x = Math.random()', 'const t = Date.now()', 'document.body', 'window.innerWidth']) {
    assert.match(sinComentarios(s), PUREZA, s);
  }
  for (const s of [
    'Math.hypot(a, b)',
    'Math.exp(1)',
    'Math.expm1(1)',
    'Math.log2(8)',
    'Math.log(2)',
    'Math.pow(2, 3)',
    'Math.sin(1)',
    'Math.cos(1)',
    'Math.tan(1)',
    'Math.asin(1)',
    'Math.acos(1)',
    'Math.atan(1)',
    'Math.atan2(1, 2)',
    'Math.sinh(1)',
    'Math.cosh(1)',
    'Math.tanh(1)',
    'Math.cbrt(8)',
    'const x = 2 ** 3',
    'performance.now()',
  ]) {
    assert.match(sinComentarios(s), NO_DETERMINISTA, s);
  }
  assert.match("import { mulberry32 } from '@tienda/kit/sim/rng.js';", IMPORTA_RNG);
  // lo permitido: las cuatro operaciones y la raíz cuadrada, los comentarios y los JSDoc
  for (const s of [
    'Math.sqrt(x) + Math.floor(y) * Math.min(a, b) / 2 - 1',
    '/** @param {number} x */ f(x)',
    '// Math.pow(2, 3)',
    '/* 2 ** 3 */',
  ]) {
    assert.doesNotMatch(sinComentarios(s), NO_DETERMINISTA, s);
    assert.doesNotMatch(sinComentarios(s), PUREZA, s);
  }
});
