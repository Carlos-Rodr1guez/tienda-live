import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contraste, leerPropiedades } from '../support/css.js';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const props = leerPropiedades(css);

/** Valor de un token (sin el `--`). */
const t = (nombre) => {
  const valor = props.get(`--${nombre}`);
  assert.ok(valor, `falta el token --${nombre} en tokens.css`);
  return valor;
};

// ---- los valores de la dirección A (diseño §10 + enmiendas 1, 2 y 6) ----

test('tokens: colores del diseño §10, más --surface-3 y --ink de la dirección A', () => {
  const esperado = {
    bg: '#04060c',
    'surface-1': '#0b1020',
    'surface-2': '#121a31',
    'surface-3': '#1b2748',
    text: '#f2f5fb',
    muted: '#9aa6bd',
    'line-strong': '#5b6a8a',
    def: '#2f9bff',
    inv: '#ff4545',
    ok: '#3ddc84',
    gold: '#ffc23d',
    'on-gold': '#1a1205',
    ink: '#04060c',
    focus: '#8ccaff',
    error: '#ff8f8f',
  };
  for (const [nombre, valor] of Object.entries(esperado)) assert.equal(t(nombre).toLowerCase(), valor, nombre);
});

test('tokens: escala de radios de la dirección A (enmienda 6)', () => {
  assert.equal(t('radius-chip'), '0.375rem');
  assert.equal(t('radius-field'), '0.625rem');
  assert.equal(t('radius-btn'), '0.75rem');
  assert.equal(t('radius-card'), '0.875rem');
  assert.equal(t('radius-panel'), '1rem');
  assert.equal(t('radius-phone-outer'), '1.75rem');
  assert.equal(t('radius-phone-inner'), '1.375rem');
  assert.equal(t('radius-pill'), '999px');
});

test('tokens: tipografía, espacio, contenedor, sombra y curva de movimiento del diseño §10', () => {
  assert.match(t('font-sans'), /^'Oxanium Variable'/);
  assert.equal(t('fs-base'), '1.0625rem');
  assert.equal(t('fs-xl'), 'clamp(1.5rem, 1.25rem + 1.1vw, 2rem)');
  assert.equal(t('fs-2xl'), 'clamp(2rem, 1.4rem + 2.8vw, 3.25rem)');
  assert.equal(t('fs-hero'), 'clamp(2.25rem, 1.5rem + 3.6vw, 4.25rem)');
  assert.equal(t('lh-body'), '1.6');
  assert.equal(t('lh-head'), '1.1');
  assert.equal(t('measure'), '68ch');
  assert.equal(t('sp-1'), '0.25rem');
  assert.equal(t('sp-8'), '4.5rem');
  assert.equal(t('section-pad'), 'clamp(3rem, 2rem + 5vw, 6rem)');
  assert.equal(t('container'), 'min(100% - 2rem, 70rem)');
  assert.equal(t('shadow'), '0 0.75rem 2rem -0.75rem rgb(0 0 0 / 0.7)');
  assert.equal(t('ease-out'), 'cubic-bezier(0.23, 1, 0.32, 1)');
});

test('tokens: la escala de espacio sube de a pasos de 4px', () => {
  const valores = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => parseFloat(t(`sp-${n}`)));
  assert.equal(valores.length, 8);
  for (const rem of valores) assert.equal((rem * 16) % 4, 0, `${rem}rem no es múltiplo de 4px`);
  assert.deepEqual(
    valores,
    [...valores].sort((a, b) => a - b),
    'la escala tiene que crecer',
  );
  assert.equal(new Set(valores).size, 8, 'sin pasos repetidos');
});

test('tokens: la tipografía no baja del piso de interletrado ni pasa el máximo de títulos', () => {
  assert.ok(parseFloat(t('tracking-head')) >= -0.04, 'interletrado mínimo -0.04em');
  const hero = /(\d+(?:\.\d+)?)rem\)$/.exec(t('fs-hero'));
  assert.ok(hero && parseFloat(hero[1]) <= 6, 'el título grande no pasa de 6rem');
});

// ---- contraste: tabla explícita de pares AA ----

const SUPERFICIES = ['bg', 'surface-1', 'surface-2', 'surface-3'];

/** [primer plano, fondo, mínimo, dónde se usa] */
const PARES = [
  // texto y secundario en cada superficie donde se usan (con --surface-3 por la enmienda 1)
  ...SUPERFICIES.flatMap((s) => [
    ['text', s, 4.5, 'cuerpo'],
    ['muted', s, 4.5, 'texto secundario y placeholder'],
  ]),
  // acentos como texto o enlace
  ...['bg', 'surface-1', 'surface-2'].flatMap((s) => [
    ['def', s, 4.5, 'Público y enlaces'],
    ['inv', s, 4.5, 'Acción'],
    ['ok', s, 4.5, 'Relax y éxito'],
    ['error', s, 4.5, 'errores'],
  ]),
  ...SUPERFICIES.map((s) => ['gold', s, 4.5, 'Metas, monedas y CTA']),
  // texto sobre relleno de color
  ['on-gold', 'gold', 4.5, 'botón dorado y escalón 4'],
  ['ink', 'inv', 4.5, 'tecla roja'],
  ['ink', 'def', 4.5, 'tecla azul'],
  ['ink', 'ok', 4.5, 'tecla verde'],
  ['ink', 'gold', 4.5, 'tecla dorada'],
  // elementos de interfaz (3:1)
  ...['bg', 'surface-1', 'surface-2'].map((s) => ['line-strong', s, 3, 'borde de campos']),
  ...SUPERFICIES.map((s) => ['focus', s, 3, 'anillo de foco']),
];

test('contraste: cada par de la tabla cumple su mínimo WCAG AA', () => {
  assert.equal(PARES.length, 36, 'la tabla es explícita: si sumas un par, actualiza este número');
  const fallos = [];
  for (const [fg, bg, minimo, uso] of PARES) {
    const razon = contraste(t(fg), t(bg));
    if (razon < minimo) fallos.push(`--${fg} sobre --${bg} (${uso}): ${razon.toFixed(2)}:1, pide ${minimo}:1`);
  }
  assert.deepEqual(fallos, []);
});

test('contraste: el blanco sobre el azul falla, así que el azul nunca es relleno bajo texto blanco', () => {
  assert.ok(contraste('#ffffff', t('def')) < 4.5);
  assert.ok(contraste(t('ink'), t('def')) >= 4.5);
});

test('contraste: los valores de referencia de la dirección A (rojo ~5.8, azul ~6.8) se cumplen', () => {
  assert.ok(contraste(t('ink'), t('inv')) >= 5.5);
  assert.ok(contraste(t('ink'), t('def')) >= 6.5);
  assert.ok(contraste(t('ink'), t('gold')) >= 10);
});

test('contraste: el helper calcula bien los extremos (blanco/negro 21:1, igual 1:1)', () => {
  assert.equal(contraste('#ffffff', '#000000').toFixed(2), '21.00');
  assert.equal(contraste('#123456', '#123456').toFixed(2), '1.00');
});
