import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRITES } from '../public/js/data/sprites.js';
import { DEFAULTS } from '../public/js/sim/defaults.js';
import { createSpriteBank } from '../public/js/render/sprites.js';
import { PLANE_SCALE, createEntityLayer, resolvePlaneScale, soportesVisibles } from '../public/js/render/units.js';
import { createRenderer } from '../public/js/render/frame.js';
import { createFakeCanvasFactory, createFakeMain } from './support/fake-canvas.js';

// v2.6 (D-R3, D-R5), vista del bombardero: se dibuja ×2 con píxel doble (88×68, entero y nítido) sin tocar los datos
// horneados, con soportes proporcionales ceil(5·bombsLeft/N), sin alabeo por vy, culling de 90 y sombra acorde.

const WORLD = { w: 1440, h: 810 };
const S = 1920 / 1440; // todo en LOW (mul 1): los tamaños de drawImage son los de mundo

function dibuja(planes, { planeScale, W = 1920, H = 1080, s = S, x0 = 0 } = {}) {
  const factory = createFakeCanvasFactory({ record: true });
  const main = createFakeMain(W, H);
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const r = createRenderer({
    createCanvas: factory.createCanvas,
    canvas: main,
    world: WORLD,
    layers: { entities: createEntityLayer({ bank, team, ...(planeScale === undefined ? {} : { planeScale }) }) },
  });
  r.resize(W, H);
  r.startMatch(1);
  const scene = {
    step: 100,
    cfg: DEFAULTS,
    units: [],
    planes,
    bombs: [],
    wrecks: [],
    projectiles: [],
    craters: [],
    teamHex: ['#E5484D', '#5BC8F5'],
    flashUntil: () => 0,
  };
  r.buffers.lowCtx.recording = true;
  r.draw({ x0, y0: 0, s }, { alpha: 1, time: 1, scene });
  return { calls: r.buffers.lowCtx.calls, bank, team };
}
const avion = (o = {}) => ({
  id: 9,
  side: 0,
  x: 500,
  y: 300,
  px: 496,
  py: 300,
  z: 48,
  vx: 120,
  vy: 0,
  bombsLeft: 34,
  bombsTotal: 34,
  ...o,
});
const imagenes = (calls, lista) => calls.filter((c) => c[0] === 'drawImage' && lista.includes(c[1]));
const cuadros = (bank, team, espejo = false) => [0, 1, 2, 3].map((i) => bank.frame(team, 'avion', 'fly', i, espejo));

test('los datos del bombardero no cambian: 44×34, y render.planeScale 2 es solo de la vista', () => {
  assert.equal(SPRITES.avion.w, 44);
  assert.equal(SPRITES.avion.h, 34);
});

test('el bombardero se dibuja ×2 con píxel doble: 88×68 enteros, en los dos lados', () => {
  const { calls, bank, team } = dibuja([avion(), avion({ id: 10, side: 1, x: 900, y: 500 })]);
  const a = imagenes(calls, cuadros(bank, team[0]));
  const b = imagenes(calls, cuadros(bank, team[1], true));
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  for (const c of [a[0], b[0]]) {
    assert.deepEqual([c[4], c[5]], [88, 68]);
    assert.ok(Number.isInteger(c[2]) && Number.isInteger(c[3]), 'posición entera: píxel nítido');
  }
});

test('planeScale 1 vuelve al tamaño de los datos (44×34): la escala es de la vista y viene por parámetro', () => {
  const { calls, bank, team } = dibuja([avion()], { planeScale: 1 });
  const a = imagenes(calls, cuadros(bank, team[0]));
  assert.deepEqual([a[0][4], a[0][5]], [44, 34]);
  const dos = dibuja([avion()], { planeScale: 3 });
  const c = imagenes(dos.calls, cuadros(dos.bank, dos.team[0]));
  assert.deepEqual([c[0][4], c[0][5]], [132, 102]);
});

test('la escala del cuerpo, de la sombra y de los soportes es la misma y los soportes siguen anclados al cuerpo', () => {
  const { calls, bank, team } = dibuja([avion()]);
  const cuerpo = imagenes(calls, cuadros(bank, team[0]))[0];
  const sombra = imagenes(calls, [bank.sombraAvion(false)])[0];
  assert.deepEqual([sombra[4], sombra[5]], [88, 34], 'sombra: 44·2 por 17·2');
  const sops = [0, 1, 2, 3, 4].map((i) => imagenes(calls, [bank.soporte(team[0], i, false)])[0]);
  assert.ok(sops.every(Boolean));
  const av = SPRITES.avion;
  av.soportes.forEach((sp, i) => {
    assert.equal(sops[i][2], cuerpo[2] + sp.x * 2);
    assert.equal(sops[i][3], cuerpo[3] + sp.y * 2);
    assert.deepEqual([sops[i][4], sops[i][5]], [sp.rows[0].length * 2, sp.rows.length * 2]);
  });
});

test('soportes proporcionales: se dibujan ceil(5·bombsLeft/N), los primeros', () => {
  const casos = [
    [34, 34, 5],
    [33, 34, 5],
    [27, 34, 4],
    [17, 34, 3],
    [14, 34, 3],
    [7, 34, 2],
    [1, 34, 1],
    [0, 34, 0],
    [3, 5, 3],
  ];
  for (const [left, total, esperados] of casos) {
    const { calls, bank, team } = dibuja([avion({ bombsLeft: left, bombsTotal: total })]);
    const vistos = [0, 1, 2, 3, 4].filter((i) => imagenes(calls, [bank.soporte(team[0], i, false)]).length === 1);
    assert.deepEqual(
      vistos,
      [0, 1, 2, 3, 4].slice(0, esperados),
      `${left}/${total}: ${esperados} soportes, y son los primeros`,
    );
  }
  // un avión sin N (dato roto) no dibuja de más: cae a bombsLeft acotado
  const roto = dibuja([avion({ bombsLeft: 9, bombsTotal: undefined })]);
  const n = [0, 1, 2, 3, 4].filter(
    (i) => imagenes(roto.calls, [roto.bank.soporte(roto.team[0], i, false)]).length,
  ).length;
  assert.equal(n, 5);
});

test('sin alabeo: aunque vy sea grande el cuadro es siempre uno de los dos de vuelo recto (hélice)', () => {
  for (const vy of [-60, -19, 0, 19, 60]) {
    const { calls, bank, team } = dibuja([avion({ vy })]);
    const rectos = imagenes(calls, [
      bank.frame(team[0], 'avion', 'fly', 0, false),
      bank.frame(team[0], 'avion', 'fly', 1, false),
    ]);
    const alabeados = imagenes(calls, [
      bank.frame(team[0], 'avion', 'fly', 2, false),
      bank.frame(team[0], 'avion', 'fly', 3, false),
    ]);
    assert.equal(rectos.length, 1, `vy ${vy}`);
    assert.equal(alabeados.length, 0, `vy ${vy} no alabea`);
  }
});

test('culling de 90 px: un avión ×2 a 80 px del borde se ve entero; a 100 px ya no', () => {
  const borde = 1440; // el visible llega a x 1440 con x0 = 0 y s = 1920/1440
  const dentro = dibuja([avion({ x: borde + 80, px: borde + 80 })]);
  assert.equal(imagenes(dentro.calls, cuadros(dentro.bank, dentro.team[0])).length, 1);
  const fuera = dibuja([avion({ x: borde + 100, px: borde + 100 })]);
  assert.equal(imagenes(fuera.calls, cuadros(fuera.bank, fuera.team[0])).length, 0);
  // y la sombra usa el mismo criterio
  const sombraFuera = dibuja([avion({ x: borde + 100, px: borde + 100 })]);
  assert.equal(imagenes(sombraFuera.calls, [sombraFuera.bank.sombraAvion(false)]).length, 0);
});

test('render.planeScale: por defecto 2; solo enteros de 1 a 4 (si no, ConfigError)', () => {
  assert.equal(PLANE_SCALE, 2);
  assert.equal(resolvePlaneScale(undefined), 2);
  for (const v of [1, 2, 3, 4]) assert.equal(resolvePlaneScale(v), v);
  for (const v of [0, 5, 1.5, -2, NaN, '2', null])
    assert.throws(() => resolvePlaneScale(v), /render\.planeScale/, String(v));
  assert.throws(() => createEntityLayer({ bank: {}, team: [0, 1], planeScale: 0 }), /render\.planeScale/);
});

test('soportesVisibles: ceil(n·quedan/total), acotado a n y a 0, y robusto a datos rotos', () => {
  assert.equal(soportesVisibles(5, 34, 34), 5);
  assert.equal(soportesVisibles(5, 17, 34), 3);
  assert.equal(soportesVisibles(5, 0, 34), 0);
  assert.equal(soportesVisibles(5, 99, 34), 5, 'más que el total: no pasa de n');
  assert.equal(soportesVisibles(5, -3, 34), 0);
  assert.equal(soportesVisibles(5, NaN, 34), 0);
  assert.equal(soportesVisibles(5, 3, 0), 3);
  assert.equal(soportesVisibles(5, 9, undefined), 5);
});
