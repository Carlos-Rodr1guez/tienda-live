import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETA } from '../public/js/data/paleta.js';
import { COLORS, PANEL_ALPHA, STATE_MATRIX, TEAM_COLORS, VEIL_ALPHA, WORST_BACKDROP } from '../public/js/ui/theme.js';

// CB-17 y diseño §10.1: el contraste de cada par texto/fondo y gráfico/fondo de la matriz de estados del HUD, calculado
// con la luminancia relativa de WCAG 2.x. Mínimos: 4,5:1 el texto normal y 3:1 el texto grande y los gráficos.
// Decisión (6a): los paneles quedan TRANSLÚCIDOS (INK al 78 %, se ve el mundo detrás) y se miden contra BLANCO PURO, el
// peor fondo posible (el núcleo de una explosión): si pasa ahí, pasa sobre cualquier terreno. La alternativa, un panel
// opaco, tapa el campo; la medición contra el peor caso da la misma garantía sin ese costo.

const canal = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Luminancia relativa de WCAG. */
const lum = (hex) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};
/** Relación de contraste de WCAG (entre 1 y 21). */
const contraste = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `over` al `alpha` sobre `under`, en sRGB, como lo compone el lienzo. */
const componer = (over, alpha, under) => {
  const o = rgb(over);
  const u = rgb(under);
  const h = (i) =>
    Math.round(o[i] * alpha + u[i] * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
};

const MIN = { text: 4.5, large: 3, graphic: 3 };

/** El fondo de un par: un color, o `{over, alpha}` compuesto sobre el peor fondo. */
const fondo = (bg) => (typeof bg === 'string' ? bg : componer(bg.over, bg.alpha, WORST_BACKDROP));

test('el contraste de WCAG se calcula bien: negro/blanco 21:1 y el texto del diseño sobre el panel', () => {
  assert.ok(Math.abs(contraste('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.ok(Math.abs(contraste('#777777', '#FFFFFF') - 4.48) < 0.02);
  // el diseño: #F4F7FF sobre INK al 78 % da ≥ 9,84:1 sobre el cielo más claro del prototipo
  assert.ok(contraste(COLORS.text, componer(COLORS.ink, PANEL_ALPHA, '#FFFFFF')) > 9);
});

test('CB-17: todos los pares de la matriz de estados cumplen su mínimo, con cada color de equipo donde corresponde', () => {
  assert.ok(STATE_MATRIX.length >= 15, 'la matriz cubre texto, gráficos y los estados de cada pantalla');
  const estados = new Set(STATE_MATRIX.map((p) => p.state));
  for (const s of [
    'normal',
    'deshabilitado',
    'foco de teclado',
    'hover (puntero fino)',
    'cargando',
    'error',
    'vacío',
  ]) {
    assert.ok(estados.has(s), `la matriz tiene el estado "${s}"`);
  }
  const fallas = [];
  let casos = 0;
  for (const par of STATE_MATRIX) {
    const min = par.min ?? MIN[par.kind];
    const equipos = par.fg === 'team' || par.bg === 'team' ? TEAM_COLORS : [null];
    for (const t of equipos) {
      const fg = par.fg === 'team' ? t : par.fg;
      const bg = fondo(par.bg === 'team' ? t : par.bg);
      const c = contraste(fg, bg);
      casos++;
      if (c < min) fallas.push(`${par.id} (${par.state}) ${fg} sobre ${bg}: ${c.toFixed(2)} < ${min}`);
    }
  }
  assert.ok(casos >= 40, `${casos} combinaciones medidas`);
  assert.deepEqual(fallas, []);
});

test('el texto del HUD da más de 9:1 y el secundario más de 4,5:1 aun sobre el peor fondo (blanco)', () => {
  const panel = componer(COLORS.ink, PANEL_ALPHA, WORST_BACKDROP);
  assert.ok(contraste(COLORS.text, panel) > 9);
  assert.ok(contraste(COLORS.muted, panel) >= 4.5);
  // el secundario se tiñe del tono del panel (azulado), nunca un gris neutro
  const [r, g, b] = rgb(COLORS.muted);
  assert.ok(b > r && b > g, 'azulado');
  const [rd, gd, bd] = rgb(COLORS.disabled);
  assert.ok(bd > rd && bd > gd, 'el deshabilitado también');
});

test('el velo de la pausa deja el texto por encima de 9:1 sobre el peor fondo', () => {
  assert.ok(contraste(COLORS.text, componer(COLORS.ink, VEIL_ALPHA, WORST_BACKDROP)) > 9);
});

test('INK sobre cada color de equipo da al menos 4,5:1 en los 8 colores de la paleta', () => {
  assert.equal(TEAM_COLORS.length, 8);
  for (const c of PALETA.colors) assert.ok(contraste(PALETA.ink, c.hex) >= 4.5, c.id);
});

test('la barra de la base se distingue por el borde del relleno: cada color de equipo da 3:1 sobre el vacío de la barra', () => {
  for (const hex of TEAM_COLORS) assert.ok(contraste(hex, COLORS.track) >= 3, hex);
});
