import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import { createCameraController } from '../public/js/camera/controller.js';
import { resolveView } from '../public/js/camera/config.js';
import { commanderTick } from '../public/js/sim/commander.js';
import { squadBox } from '../public/js/sim/squads.js';
import { contrast } from '../public/js/sim/colors.js';
import { PALETA } from '../public/js/data/paleta.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { createProjector } from '../public/js/render/canvas.js';
import { tint } from '../public/js/render/sprites.js';
import {
  ICONS,
  ICON_ROLE,
  ICON_TINT,
  createIconBank,
  createIconLayer,
  departedCounts,
  drawUiIcon,
  iconScreenRect,
  resolveIcons,
  roleIcons,
  uiIconRect,
} from '../public/js/render/icons.js';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';

// Íconos de rol (CB-21, CB-22, D22): la flecha (ATAQUE) y el ícono de defensa (`shield`), dibujados por código y
// horneados por equipo. Viven en el mundo (crecen con el zoom) y en el HUD (tamaño fijo). Sin DOM ni lienzo real.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const TEAM_HEX = PALETA.colors.map((c) => c.hex);
const mundo = () => createWorld({}, { phase: 'sandbox' });
const AY = { soldado: SPRITES.soldado.ay, jeep: SPRITES.jeep.ay, tanque: SPRITES.tanque.ay, pesado: SPRITES.pesado.ay };

// ---------------------------------------------------------------------------------------------------------------
// formas

test('flecha 10×8 y el ícono de defensa 9×10 con formas distintas; ids en inglés y ningún id ni archivo de escudo', () => {
  assert.deepEqual([ICONS.arrow.w, ICONS.arrow.h], [10, 8]);
  assert.deepEqual([ICONS.shield.w, ICONS.shield.h], [9, 10]);
  for (const id of ['arrow', 'shield']) {
    const rows = ICONS[id].rows;
    assert.equal(rows.length, ICONS[id].h);
    for (const r of rows) assert.equal(r.length, ICONS[id].w, `${id}: filas de igual largo`);
    assert.match(rows.join(''), /^[.ohT]+$/, 'solo contorno INK (o), borde claro (h), relleno del equipo (T) y vacío');
    for (const c of 'ohT') assert.ok(rows.join('').includes(c), c);
  }
  assert.notDeepEqual(ICONS.arrow.rows, ICONS.shield.rows);
  assert.deepEqual(ICON_ROLE, { defensa: 'shield', ataque: 'arrow' });
  assert.deepEqual(Object.keys(ICONS).sort(), ['arrow', 'shield']);
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
    Object.keys(ICONS)
      .concat(Object.values(ICON_ROLE))
      .some((n) => /escudo/i.test(n)),
    false,
  );
});

test('la flecha apunta hacia el este y no es simétrica (la forma distingue el rol sin depender del color)', () => {
  const alReves = ICONS.arrow.rows.map((r) => [...r].reverse().join(''));
  assert.notDeepEqual(alReves, ICONS.arrow.rows, 'espejarla cambia algo: apunta a un lado');
  // la punta está a la derecha: la última columna con píxeles es la 9, y la primera de la cola es la 0
  assert.ok(ICONS.arrow.rows.some((r) => r[9] !== '.'));
  assert.ok(ICONS.arrow.rows.some((r) => r[0] !== '.'));
  // el ícono de defensa es simétrico de lado a lado
  assert.deepEqual(
    ICONS.shield.rows.map((r) => [...r].reverse().join('')),
    ICONS.shield.rows,
  );
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

/** Mezcla source-over en sRGB, como la hace el lienzo: `fg` con opacidad `a` sobre `bg`. */
const sobre = (fg, bg, a) => {
  const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `#${c(fg)
    .map((v, i) =>
      Math.round(v * a + c(bg)[i] * (1 - a))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

test('C3: el ícono que forma, compuesto como el lienzo (0,55 sobre el terreno), NO daría 3:1; por eso solo el relleno lleva el alfa', () => {
  let minimoOpaco = 99;
  let minimoMezclado = 99;
  for (const hex of TEAM_HEX)
    for (const t of PALETA.terrain) {
      const h = tint(hex, ICON_TINT);
      minimoOpaco = Math.min(minimoOpaco, contrast(h, t.hex));
      minimoMezclado = Math.min(minimoMezclado, contrast(sobre(h, t.hex, 0.55), t.hex));
    }
  assert.ok(minimoOpaco >= 3, `borde claro opaco: ${minimoOpaco.toFixed(2)}`);
  assert.ok(minimoMezclado < 3, `el borde claro a 0,55 daría ${minimoMezclado.toFixed(2)}:1 (< 3)`);
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

test('horneado: ocho lienzos por color (flecha y escudo, normal y espejado, capa de líneas y capa de relleno), una sola vez', () => {
  const f = createFakeCanvasFactory({ record: true });
  const bank = createIconBank({ createCanvas: f.createCanvas });
  assert.equal(bank.bakeCount, 0);
  const t = TEAM_HEX.map((h) => bank.bake(h));
  assert.deepEqual(t, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(f.created.length, 8 * 8);
  for (let i = 0; i < 1000; i++) assert.equal(bank.bake(TEAM_HEX[i % 8]), i % 8);
  assert.equal(bank.bakeCount, 8, 'bakeCount = colores de equipo tras mil llamadas');
  assert.equal(f.created.length, 8 * 8, 'nada se crea de nuevo');
  // la imagen pedida es siempre la misma, nunca una nueva
  assert.equal(bank.layers(0, 'arrow', false), bank.layers(0, 'arrow', false));
  assert.notEqual(bank.layers(0, 'arrow', false).line, bank.layers(0, 'arrow', true).line);
});

test('C2: los lienzos horneados miden 10×8 y 9×10 (el contorno INK está dentro); capa de líneas (o, h) y capa de relleno (T)', () => {
  const f = createFakeCanvasFactory({ record: true });
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const hex = '#E5484D';
  bank.bake(hex);
  const borde = tint(hex, 0.45);
  for (const id of ['arrow', 'shield']) {
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

// ---------------------------------------------------------------------------------------------------------------
// descriptores en el mundo

function mundoConGrupo(o = {}) {
  const w = mundo();
  const r = seedSquad(w, { side: 0, kind: 'soldado', role: 'ataque', ...o });
  return { w, sq: r.squad };
}
const descs = (w, alpha = 1, formingAlpha = 0.55) => {
  const out = [];
  const n = roleIcons({ squads: w.squads, cfg: w.cfg, field: w.field, alpha, spriteAy: AY, formingAlpha, out });
  return out.slice(0, n);
};

test('DEFENSA lleva el ícono de defensa y ATAQUE la flecha; todos los grupos llevan ícono', () => {
  const w = mundo();
  seedSquad(w, { side: 0, kind: 'soldado', role: 'defensa' });
  seedSquad(w, { side: 0, kind: 'jeep', role: 'ataque' });
  seedSquad(w, { side: 1, kind: 'tanque', role: 'ataque' });
  const forma = seedSquad(w, { side: 1, kind: 'soldado', role: 'defensa', state: 'forming' }).squad;
  const d = descs(w);
  assert.equal(d.length, 4, 'uno por grupo, también los que forman');
  assert.deepEqual(
    d.map((x) => x.id),
    ['shield', 'arrow', 'arrow', 'shield'],
  );
  assert.deepEqual(
    d.map((x) => x.role),
    ['defensa', 'ataque', 'ataque', 'defensa'],
  );
  assert.equal(d[3].squad, forma.id);
  // un grupo sin miembros (todavía no hay nadie) no tiene dónde ponerlo
  w.squads.push({ ...w.squads[0], id: 999, members: [] });
  assert.equal(descs(w).length, 4);
});

test('alfa 0,55 mientras el grupo forma y 1 después; formingAlpha se recorta a [0,3, 1]', () => {
  const w = mundo();
  seedSquad(w, { side: 0, kind: 'soldado', state: 'forming' });
  seedSquad(w, { side: 0, kind: 'soldado', state: 'advance' });
  seedSquad(w, { side: 0, kind: 'soldado', state: 'holding' });
  const d = descs(w);
  assert.deepEqual(
    d.map((x) => x.alpha),
    [0.55, 1, 1],
  );
  assert.equal(descs(w, 1, 0.8)[0].alpha, 0.8);
  assert.equal(resolveIcons(undefined).formingAlpha, 0.55);
  assert.equal(resolveIcons({ formingAlpha: 0.1 }).formingAlpha, 0.3);
  assert.equal(resolveIcons({ formingAlpha: 7 }).formingAlpha, 1);
  assert.equal(resolveIcons({ formingAlpha: 'x' }).formingAlpha, 0.55);
});

test('posición: centrado sobre la formación y arriba de su miembro más alto, en el origen de D21', () => {
  for (const [side, kind] of [
    [0, 'soldado'],
    [1, 'soldado'],
    [0, 'jeep'],
    [1, 'tanque'],
    [0, 'pesado'],
  ]) {
    const { w, sq } = mundoConGrupo({ side, kind });
    const [d] = descs(w).filter((x) => x.squad === sq.id);
    const dir = w.field.sides[side].dir;
    const caja = squadBox(w.cfg, sq);
    const ic = ICONS[d.id];
    const foot = w.cfg.units[kind].foot[1];
    assert.equal(d.x, sq.anchor.x - (dir * caja.fondo) / 2 - ic.w / 2, `${kind} ${side}: x`);
    assert.equal(d.y, sq.anchor.y - caja.hw + foot / 2 - AY[kind] - ic.h, `${kind} ${side}: y`);
    assert.deepEqual([d.w, d.h], [ic.w, ic.h]);
    // sobre la formación real: centro de x entre el miembro de más adelante y el de más atrás
    const xs = sq.members.map((m) => m.x);
    const medio = (Math.min(...xs) + Math.max(...xs)) / 2;
    assert.ok(Math.abs(d.x + ic.w / 2 - medio) <= 1, `${kind} ${side}: centrado (${d.x + ic.w / 2} vs ${medio})`);
    // y encima del sprite del miembro más alto
    const cima = Math.min(...sq.members.map((m) => m.y - AY[kind]));
    assert.ok(d.y + ic.h <= cima + 1e-9, `${kind} ${side}: arriba del miembro más alto`);
  }
});

test('la flecha apunta al enemigo: el equipo de la derecha la espeja; el ícono de defensa no cambia', () => {
  const w = mundo();
  seedSquad(w, { side: 0, kind: 'soldado', role: 'ataque' });
  seedSquad(w, { side: 1, kind: 'soldado', role: 'ataque' });
  seedSquad(w, { side: 1, kind: 'soldado', role: 'defensa' });
  const [izq, der, def] = descs(w);
  assert.equal(izq.mirror, false);
  assert.equal(der.mirror, true);
  assert.equal(def.mirror, true, 'se espeja con el lado; el escudo es simétrico y se ve igual');
});

test('interpolación: el ícono usa el ancla del paso anterior hasta el actual, sin saltar a 30 Hz', () => {
  const { w, sq } = mundoConGrupo({});
  sq.anchor.vx = 30; // px/s: 1 px por paso
  const x = (alpha) => descs(w, alpha)[0].x;
  assert.ok(Math.abs(x(1) - x(0) - 1) < 1e-9);
  assert.ok(Math.abs(x(0.5) - (x(1) + x(0)) / 2) < 1e-9);
  assert.equal(x(1), descs(w, 1)[0].x);
});

test('el arreglo de salida se reutiliza: sin reservar descriptores nuevos por cuadro', () => {
  const w = mundo();
  for (let i = 0; i < 6; i++) seedSquad(w, { side: i % 2, kind: 'soldado' });
  const out = [];
  roleIcons({ squads: w.squads, cfg: w.cfg, field: w.field, alpha: 1, spriteAy: AY, formingAlpha: 0.55, out });
  const primeros = out.slice();
  roleIcons({ squads: w.squads, cfg: w.cfg, field: w.field, alpha: 0.5, spriteAy: AY, formingAlpha: 0.55, out });
  for (let i = 0; i < 6; i++) assert.equal(out[i], primeros[i]);
});

// ---------------------------------------------------------------------------------------------------------------
// tamaño: mundo contra HUD

test('en un lienzo de 1440×810 (fd 1) el ícono del mundo mide 4 veces más en k = 4 que en k = 1 y el del HUD mide igual', () => {
  const { w } = mundoConGrupo({});
  const [d] = descs(w);
  const rect = (k) => iconScreenRect(d, { s: 1 * k, ox: 0, oy: 0, device: k >= 2 });
  const r1 = rect(1);
  const r4 = rect(4);
  assert.equal(r4.w / r1.w, 4);
  assert.equal(r4.h / r1.h, 4);
  assert.equal(r1.w, d.w, 'el contorno INK ya está dentro de los 10×8');
  assert.deepEqual(uiIconRect('arrow', 10, 10, 2), { x: 10, y: 10, w: 20, h: 16 });
});

test('C8a: con la cámara en k = 1 y en k = 4 el ícono del mundo crece 4 veces y el dibujado en el HUD no cambia', () => {
  const { w } = mundoConGrupo({});
  const [d] = descs(w);
  const f = createFakeCanvasFactory();
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const t = bank.bake('#E5484D');
  const hud = [];
  const mundoRect = [];
  for (const k of [1, 4]) {
    const cam = createCameraController({ canvas: { w: 1440, h: 810 }, view: resolveView(undefined) });
    cam.jumpTo({ k, cx: 720, cy: 405 });
    assert.equal(cam.state.kShown, k, 'la cámara está de verdad en k');
    const s = cam.fd * cam.state.kShown;
    mundoRect.push(iconScreenRect(d, { s, ox: 0, oy: 0, device: s >= 2 }));
    const ctx = createFakeCtx({ record: true });
    drawUiIcon(ctx, bank, t, 'arrow', 50, 60, 3, false);
    hud.push(ctx.calls.filter((c) => c[0] === 'drawImage').map((c) => c.slice(2)));
  }
  assert.equal(mundoRect[1].w / mundoRect[0].w, 4);
  assert.equal(mundoRect[1].h / mundoRect[0].h, 4);
  assert.deepEqual(hud[0], hud[1], 'el HUD dibuja exactamente lo mismo');
  assert.deepEqual(hud[0][0], [50, 60, 30, 24], 'flecha de 10×8 a escala de interfaz 3');
});

test('la proyección a pantalla coincide con la del proyector del render en las dos pasadas', () => {
  const { w } = mundoConGrupo({});
  const [d] = descs(w);
  // pasada en px de dispositivo (s = 4): round(x·s) − ox
  const ox = 123;
  const oy = 45;
  const r = iconScreenRect(d, { s: 4, ox, oy, device: true });
  assert.equal(r.x, Math.round(d.x * 4) - ox);
  assert.equal(r.y, Math.round(d.y * 4) - oy);
  assert.equal(r.w, d.w * 4);
  // LOW: la entidad va en un px de mundo entero y la copia la multiplica por s
  const r2 = iconScreenRect(d, { s: 1.5, ox, oy, device: false });
  assert.equal(r2.x, Math.round(d.x) * 1.5 - ox);
});

test('dibujo en espacio de UI: tamaño fijo por la escala entera u, sin suavizado, dos capas (líneas y relleno)', () => {
  const f = createFakeCanvasFactory();
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const t = bank.bake('#E5484D');
  const ctx = createFakeCtx({ record: true });
  drawUiIcon(ctx, bank, t, 'arrow', 100, 50, 3, false);
  drawUiIcon(ctx, bank, t, 'shield', 200, 50, 3, true);
  const dibujos = ctx.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(dibujos.length, 4);
  assert.deepEqual(dibujos[0].slice(2), [100, 50, 30, 24], 'flecha: 10·3 × 8·3 (el contorno está dentro)');
  assert.deepEqual(dibujos[1].slice(2), [100, 50, 30, 24]);
  assert.deepEqual(dibujos[2].slice(2), [200, 50, 27, 30], 'escudo: 9·3 × 10·3');
  assert.equal(ctx.state.imageSmoothingEnabled, false, 'píxeles nítidos');
  const a = bank.layers(t, 'arrow', false);
  assert.deepEqual([dibujos[0][1], dibujos[1][1]], [a.line, a.fill]);
  const e = bank.layers(t, 'shield', true);
  assert.deepEqual([dibujos[2][1], dibujos[3][1]], [e.line, e.fill]);
});

// ---------------------------------------------------------------------------------------------------------------
// capa de dibujo

test('la capa dibuja un ícono por grupo, también con marcas (LOD), con su alfa y sin reservar lienzos', () => {
  const f = createFakeCanvasFactory();
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const capa = createIconLayer({ bank, team, spriteAy: AY, formingAlpha: 0.55 });
  const w = mundo();
  seedSquad(w, { side: 0, kind: 'soldado', role: 'defensa' });
  seedSquad(w, { side: 1, kind: 'soldado', role: 'ataque', state: 'forming' });
  const antes = f.created.length;
  for (const marks of [false, true]) {
    const stats = { drawCalls: 0, culled: 0, marks };
    const P = createProjector(stats, {});
    const ctx = createFakeCtx({ record: true });
    Object.assign(P, {
      ctx,
      mul: 1,
      offX: 0,
      offY: 0,
      vx0: 0,
      vy0: 0,
      vx1: 1440,
      vy1: 810,
      frame: { alpha: 1, scene: w },
    });
    capa(P, w.squads, w.cfg, w.field);
    const imgs = ctx.calls.filter((c) => c[0] === 'drawImage');
    assert.equal(imgs.length, 4, `marks = ${marks}: dos capas por ícono`);
    // C3: el grupo que forma dibuja las líneas (o, h) opacas y SOLO el relleno con el alfa de "formando"
    const orden = ctx.calls
      .filter((c) => c[0] === 'drawImage' || c[0] === 'set:globalAlpha')
      .map((c) => (c[0] === 'drawImage' ? 'img' : c[1]));
    assert.deepEqual(orden, [1, 'img', 1, 'img', 1, 'img', 0.55, 'img', 1], `marks = ${marks}`);
    assert.equal(ctx.state.globalAlpha, 1, 'deja el alfa en 1');
    assert.equal(capa.stats.drawn, 2);
  }
  assert.equal(f.created.length, antes, '1000 cuadros no crean lienzos: aquí 2, ninguno');
});

test('C2: las filas son exactamente las del prototipo v3 aprobado (o = INK, h = aclarado 45 %, T = color del equipo)', () => {
  assert.deepEqual(
    [...ICONS.arrow.rows],
    ['.....oo...', '.....oTo..', 'oooooohTo.', 'ohhhhhhTTo', 'oTTTTTTTTo', 'ooooooTTo.', '.....oTo..', '.....oo...'],
  );
  assert.deepEqual(
    [...ICONS.shield.rows],
    [
      'ooooooooo',
      'ohhhhhhho',
      'ohTTTTTho',
      'ohTTTTTho',
      'ohTTTTTho',
      'ohTTTTTho',
      '.ohTTTho.',
      '..ohTho..',
      '...oho...',
      '....o....',
    ],
  );
});

test('la capa pega cada ícono en su esquina, de w×h px de mundo, sin margen extra', () => {
  const f = createFakeCanvasFactory();
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const capa = createIconLayer({ bank, team, spriteAy: AY, formingAlpha: 0.55 });
  const { w } = mundoConGrupo({ role: 'ataque' });
  for (const mul of [1, 4]) {
    const P = createProjector({ drawCalls: 0, culled: 0 }, {});
    const ctx = createFakeCtx({ record: true });
    Object.assign(P, { ctx, mul, offX: 7, offY: 9, vx0: 0, vy0: 0, vx1: 1440, vy1: 810, frame: { alpha: 1 } });
    capa(P, w.squads, w.cfg, w.field);
    const d = capa.descs[0];
    const [, , dx, dy, dw, dh] = ctx.calls.find((c) => c[0] === 'drawImage');
    assert.deepEqual([dx, dy, dw, dh], [Math.round(d.x * mul) + 7, Math.round(d.y * mul) + 9, 10 * mul, 8 * mul]);
  }
});

test('C7: con marcas (LOD) el ícono va arriba de la marca más alta del grupo, no de la cima del sprite', () => {
  const { w, sq } = mundoConGrupo({ kind: 'soldado' });
  const marcas = { soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] };
  const sin = [];
  roleIcons({ squads: w.squads, cfg: w.cfg, field: w.field, alpha: 1, spriteAy: AY, formingAlpha: 0.55, out: sin });
  const con = [];
  roleIcons({
    squads: w.squads,
    cfg: w.cfg,
    field: w.field,
    alpha: 1,
    spriteAy: AY,
    formingAlpha: 0.55,
    marks: true,
    marksSize: marcas,
    out: con,
  });
  const cima = Math.min(...sq.members.map((m) => m.y));
  // la marca mide 2 px de alto más 1 de contorno, igual que las etiquetas
  assert.equal(con[0].y + con[0].h, cima - (marcas.soldado[1] + 1));
  assert.equal(sin[0].y + sin[0].h, cima - AY.soldado);
  assert.notEqual(con[0].y, sin[0].y, 'la marca es más baja que el sprite: el ícono baja con ella');
  // y la capa lo hace según el LOD del cuadro
  const f = createFakeCanvasFactory();
  const bank = createIconBank({ createCanvas: f.createCanvas });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const capa = createIconLayer({ bank, team, spriteAy: AY, marksSize: marcas, formingAlpha: 0.55 });
  for (const marks of [false, true]) {
    const P = createProjector({ drawCalls: 0, culled: 0, marks }, {});
    Object.assign(P, { ctx: createFakeCtx(), mul: 1, vx0: 0, vy0: 0, vx1: 1440, vy1: 810, frame: { alpha: 1 } });
    capa(P, w.squads, w.cfg, w.field);
    assert.equal(capa.descs[0].y, (marks ? con : sin)[0].y, `marks = ${marks}`);
  }
});

test('C8e: con un mundo real que avanza, el centro del ícono sigue el centro interpolado de la formación (≤ 1 px)', () => {
  const w = createWorld({}, { phase: 'sandbox' });
  const { squad } = seedSquad(w, { side: 0, kind: 'soldado', role: 'ataque', pinned: false });
  let maxDif = 0;
  let movio = false;
  for (let paso = 0; paso < 120; paso++) {
    stepWorld(w);
    if (paso < 20) continue;
    for (const alpha of [0.25, 0.5, 0.75]) {
      const [d] = descs(w, alpha);
      const xs = squad.members.map((m) => (m.px ?? m.x) + (m.x - (m.px ?? m.x)) * alpha);
      const centro = (Math.min(...xs) + Math.max(...xs)) / 2;
      maxDif = Math.max(maxDif, Math.abs(d.x + d.w / 2 - centro));
    }
    if (Math.abs(squad.anchor.vx) > 1) movio = true;
  }
  assert.ok(movio, 'el grupo se mueve en el fixture');
  assert.ok(maxDif <= 1, `diferencia máxima ${maxDif.toFixed(3)} px de mundo`);
});

// ---------------------------------------------------------------------------------------------------------------
// conteos del HUD

test('conteos de grupos salidos por lado y rol: iguales a los del sim, que es de donde se leen', () => {
  const w = mundo();
  const pon = (side, role, n, state = 'advance') => {
    for (let i = 0; i < n; i++) seedSquad(w, { side, kind: 'soldado', role, state });
  };
  pon(0, 'defensa', 3);
  pon(0, 'ataque', 7);
  pon(0, 'ataque', 2, 'forming'); // los que forman no cuentan: aún no salieron
  pon(1, 'defensa', 1);
  pon(1, 'ataque', 4);
  commanderTick(w);
  const c = departedCounts(w);
  assert.deepEqual(c, [
    { defensa: 3, ataque: 7 },
    { defensa: 1, ataque: 4 },
  ]);
  assert.equal(c[0].defensa, w.cmd[0].hud.defensa);
  assert.equal(c[1].ataque, w.cmd[1].hud.ataque);
});

test('los conteos se LEEN de los contadores del sim: no se recuentan', () => {
  const w = mundo();
  w.cmd[0].hud = { defensa: 9, ataque: 8, forming: 0 };
  w.cmd[1].hud = { defensa: 5, ataque: 6, forming: 0 };
  assert.deepEqual(departedCounts(w), [
    { defensa: 9, ataque: 8 },
    { defensa: 5, ataque: 6 },
  ]);
  // sin contadores (un mundo viejo o a medias) no inventa nada y no lanza
  assert.deepEqual(departedCounts({}), [
    { defensa: 0, ataque: 0 },
    { defensa: 0, ataque: 0 },
  ]);
});
