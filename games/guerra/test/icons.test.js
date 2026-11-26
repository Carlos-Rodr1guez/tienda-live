import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, seedUnits } from '../public/js/sim/world.js';
import { contrast } from '../public/js/sim/colors.js';
import { PALETA } from '../public/js/data/paleta.js';
import { tint } from '../public/js/render/sprites.js';
import { ICONS, ICON_TINT, createIconBank, drawUiIcon, inFieldCounts, uiIconRect } from '../public/js/render/icons.js';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';

// Íconos del HUD (CB-17, D22): la flecha junto al conteo «en campo», dibujada por código y horneados por equipo.
// Desde v2.6 no hay roles: el ícono de defensa (`shield`) se retiró y el HUD usa tamaño fijo. Sin DOM ni lienzo real.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const TEAM_HEX = PALETA.colors.map((c) => c.hex);
const mundo = () => createWorld({}, { phase: 'sandbox' });

// ---------------------------------------------------------------------------------------------------------------
// formas

test('flecha 10×8, único ícono (ya no hay `shield`); id en inglés y ningún id ni archivo de escudo', () => {
  assert.deepEqual([ICONS.arrow.w, ICONS.arrow.h], [10, 8]);
  for (const id of ['arrow']) {
    const rows = ICONS[id].rows;
    assert.equal(rows.length, ICONS[id].h);
    for (const r of rows) assert.equal(r.length, ICONS[id].w, `${id}: filas de igual largo`);
    assert.match(rows.join(''), /^[.ohT]+$/, 'solo contorno INK (o), borde claro (h), relleno del equipo (T) y vacío');
    for (const c of 'ohT') assert.ok(rows.join('').includes(c), c);
  }
  assert.deepEqual(Object.keys(ICONS).sort(), ['arrow']);
  const todos = [];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) recorrer(path.join(d, e.name));
      else todos.push(e.name);
    }
  };
  recorrer(GJ);
  assert.equal(
    todos.some((n) => /escudo/i.test(n)),
    false,
    'ningún archivo se llama escudo',
  );
  assert.equal(
    Object.keys(ICONS).some((n) => /escudo/i.test(n)),
    false,
  );
});

test('la flecha apunta hacia el este y no es simétrica (la forma distingue el rol sin depender del color)', () => {
  const alReves = ICONS.arrow.rows.map((r) => [...r].reverse().join(''));
  assert.notDeepEqual(alReves, ICONS.arrow.rows, 'espejarla cambia algo: apunta a un lado');
  // la punta está a la derecha: la última columna con píxeles es la 9, y la primera de la cola es la 0
  assert.ok(ICONS.arrow.rows.some((r) => r[9] !== '.'));
  assert.ok(ICONS.arrow.rows.some((r) => r[0] !== '.'));
});

test('contraste: el borde claro (equipo aclarado 45 %) da >= 3:1 contra cada color transitable con los 8 colores', () => {
  assert.equal(ICON_TINT, 0.45);
  for (const hex of TEAM_HEX) {
    const borde = tint(hex, ICON_TINT);
    for (const t of PALETA.terrain) {
      const c = contrast(borde, t.hex);
      assert.ok(c >= 3, `${hex} aclarado ${borde} sobre ${t.id} ${t.hex}: ${c.toFixed(2)}`);
    }
  }
});

test('contraste: el texto INK de la pastilla da >= 4,90:1 sobre los 8 colores de equipo', () => {
  for (const hex of TEAM_HEX) {
    const c = contrast(PALETA.ink, hex);
    assert.ok(c >= 4.9, `${hex}: ${c.toFixed(2)}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// horneado

/** Reconstruye los píxeles de un lienzo falso a partir de las llamadas `fillStyle` y `fillRect` que registró. */
function pixeles(canvas) {
  const mapa = new Map();
  let color = null;
  for (const c of canvas.ctx.calls) {
    if (c[0] === 'set:fillStyle') color = c[1];
    else if (c[0] === 'fillRect')
      for (let y = c[2]; y < c[2] + c[4]; y++) for (let x = c[1]; x < c[1] + c[3]; x++) mapa.set(`${x},${y}`, color);
  }
  return mapa;
}

test('horneado: cuatro lienzos por color (la flecha, normal y espejada, capa de líneas y capa de relleno), una sola vez', () => {
  const f = createFakeCanvasFactory({ record: true });
  const bank = createIconBank({ createCanvas: f.createCanvas });
  assert.equal(bank.bakeCount, 0);
  const t = TEAM_HEX.map((h) => bank.bake(h));
  assert.deepEqual(t, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(f.created.length, 8 * 4);
  for (let i = 0; i < 1000; i++) assert.equal(bank.bake(TEAM_HEX[i % 8]), i % 8);
  assert.equal(bank.bakeCount, 8, 'bakeCount = colores de equipo tras mil llamadas');
  assert.equal(f.created.length, 8 * 4, 'nada se crea de nuevo');
  // la imagen pedida es siempre la misma, nunca una nueva
  assert.equal(bank.layers(0, 'arrow', false), bank.layers(0, 'arrow', false));
  assert.notEqual(bank.layers(0, 'arrow', false).line, bank.layers(0, 'arrow', true).line);
});

test('C2: el lienzo horneado mide 10×8 (el contorno INK está dentro); capa de líneas (o, h) y capa de relleno (T)', () => {
  const f = createFakeCanvasFactory({ record: true });
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const hex = '#E5484D';
  bank.bake(hex);
  const borde = tint(hex, 0.45);
  for (const id of ['arrow']) {
    const ic = ICONS[id];
    for (const espejo of [false, true]) {
      const { line, fill } = bank.layers(0, id, espejo);
      assert.deepEqual([line.width, line.height, fill.width, fill.height], [ic.w, ic.h, ic.w, ic.h], id);
      const L = pixeles(line);
      const T = pixeles(fill);
      assert.deepEqual(new Set(L.values()), new Set([PALETA.ink, borde]), 'líneas: solo INK y borde claro');
      assert.deepEqual(new Set(T.values()), new Set([hex]), 'relleno: solo el color del equipo');
      for (let y = 0; y < ic.h; y++)
        for (let x = 0; x < ic.w; x++) {
          const c = ic.rows[y][x];
          const px = espejo ? ic.w - 1 - x : x;
          assert.equal(L.get(`${px},${y}`), c === 'o' ? PALETA.ink : c === 'h' ? borde : undefined, `${id} ${x},${y}`);
          assert.equal(T.get(`${px},${y}`), c === 'T' ? hex : undefined, `${id} relleno ${x},${y}`);
        }
    }
  }
});

test('dibujo en espacio de UI: tamaño fijo por la escala entera u, sin suavizado, dos capas (líneas y relleno)', () => {
  const f = createFakeCanvasFactory();
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const t = bank.bake('#E5484D');
  const ctx = createFakeCtx({ record: true });
  drawUiIcon(ctx, bank, t, 'arrow', 100, 50, 3, false);
  drawUiIcon(ctx, bank, t, 'arrow', 200, 50, 3, true);
  const dibujos = ctx.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(dibujos.length, 4);
  assert.deepEqual(dibujos[0].slice(2), [100, 50, 30, 24], 'flecha: 10·3 × 8·3 (el contorno está dentro)');
  assert.deepEqual(dibujos[1].slice(2), [100, 50, 30, 24]);
  assert.deepEqual(dibujos[2].slice(2), [200, 50, 30, 24], 'flecha espejada: mismo tamaño');
  assert.equal(ctx.state.imageSmoothingEnabled, false, 'píxeles nítidos');
  const a = bank.layers(t, 'arrow', false);
  assert.deepEqual([dibujos[0][1], dibujos[1][1]], [a.line, a.fill]);
  const e = bank.layers(t, 'arrow', true);
  assert.deepEqual([dibujos[2][1], dibujos[3][1]], [e.line, e.fill]);
});

test('C2: las filas son exactamente las del prototipo v3 aprobado (o = INK, h = aclarado 45 %, T = color del equipo)', () => {
  assert.deepEqual(
    [...ICONS.arrow.rows],
    ['.....oo...', '.....oTo..', 'oooooohTo.', 'ohhhhhhTTo', 'oTTTTTTTTo', 'ooooooTTo.', '.....oTo..', '.....oo...'],
  );
});

test('uiIconRect: el ícono del HUD mide su tamaño por la escala entera u, nunca por el zoom', () => {
  assert.deepEqual(uiIconRect('arrow', 10, 10, 2), { x: 10, y: 10, w: 20, h: 16 });
  assert.deepEqual(uiIconRect('arrow', 0, 0, 3), { x: 0, y: 0, w: 30, h: 24 });
});

test('«en campo»: las unidades vivas por lado salen de world.units; sin mundo o sin unidades no inventa nada', () => {
  const w = mundo();
  seedUnits(w, { side: 0, kind: 'soldado', count: 3, x: 300, y: 300, dy: 10 });
  seedUnits(w, { side: 1, kind: 'jeep', count: 2, x: 900, y: 300, dy: 10 });
  const muerta = seedUnits(w, { side: 1, kind: 'soldado', count: 1, x: 900, y: 500 }).units[0];
  muerta.alive = false;
  assert.deepEqual(inFieldCounts(w), [3, 2]);
  assert.deepEqual(inFieldCounts({}), [0, 0]);
  assert.deepEqual(inFieldCounts(null), [0, 0]);
});
