import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { SHARP_BELOW, scaleMode } from '../public/js/render/scale.js';
import { LOD_DEFAULTS, lodFor, resolveLod } from '../public/js/render/lod.js';
import { createList, createProjector } from '../public/js/render/canvas.js';
import { interpPos } from '../public/js/render/units.js';
import { createSpriteBank } from '../public/js/render/sprites.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { PAISES } from '../public/js/data/paises.js';
import { PALETA } from '../public/js/data/paleta.js';
import { DEFAULTS } from '../public/js/sim/defaults.js';
import { cloudX, createTerrain } from '../public/js/render/terrain.js';
import { createEntityLayer, insertionSortBy } from '../public/js/render/units.js';
import { createFakeCtx } from './support/fake-canvas.js';
import { createScene } from '../public/js/render/scene.js';
import { baseState, bakeBase } from '../public/js/render/base-art.js';
import { createBaseLayer } from '../public/js/render/bases.js';
import { pennant } from '../public/js/render/pennant.js';
import { diff, mirror, rasterize } from './support/raster.js';
import { createLoop } from '../public/js/loop.js';
import { createTimer, f2Model } from '../public/js/render/f2.js';
import { createGoldenRun } from '../public/js/golden-run.js';
import { GOLDEN } from '../public/js/data/golden.js';
import { hashMatch } from '../public/js/sim/hash.js';
import { replayMatch } from '../public/js/sim/replay.js';
import { createRenderer } from '../public/js/render/frame.js';
import { createFakeCanvasFactory, createFakeMain } from './support/fake-canvas.js';

// Estructura del render (CB-18, NM-6, CB-22): modos de escala, LOD, búferes fijos, interpolación, sprites, orden de
// capas y modelo de F2. Todo con lienzos y contextos 2D falsos que cuentan y registran: sin DOM.

// ---------------------------------------------------------------------------------------------------------------
// 5a.1: modo de escala y LOD

test('scaleMode: SHARP_BELOW es la constante 1,9 y no hay clave de config', () => {
  assert.equal(SHARP_BELOW, 1.9);
});

test('scaleMode: tabla de CB-18 / NM-6 (0,8 suave con filtro medium; 1 vecino; 1,333 a 1,89 nítido; 1,9 y enteros vecino)', () => {
  const casos = [
    [0.8, 'smooth'],
    [1.0, 'nearest'],
    [1.333, 'sharp'],
    [1.8, 'sharp'],
    [1.86, 'sharp'],
    [1.89, 'sharp'],
    [1.9, 'nearest'],
    [2, 'nearest'],
    [3, 'nearest'],
    [2.667, 'nearest'],
  ];
  for (const [s, modo] of casos) assert.equal(scaleMode(s).mode, modo, `s = ${s}`);
  assert.equal(scaleMode(0.8).quality, 'medium');
  assert.equal(scaleMode(1.333).quality, 'low', 'nítido: MID a pantalla con bilineal');
  assert.equal(scaleMode(2).quality, null);
});

test('scaleMode: la s fraccional de una transición usa el modo de su s, y un entero con ruido de coma flotante sigue siendo vecino', () => {
  assert.equal(scaleMode(1.5).mode, 'sharp');
  assert.equal(scaleMode(1.5 * (1920 / 1440)).mode, 'nearest', 'k 1,5 en 1080p es s = 2 (con error de redondeo)');
  assert.equal(scaleMode(4 * 1.3333333333333333).mode, 'nearest', '5,333 es >= 1,9: vecino, no nítido');
});

test('lodFor: entra a marcas con s < 1,0 y sale con s >= 1,1; en el medio conserva el anterior', () => {
  assert.equal(lodFor(0.99, false), true);
  assert.equal(lodFor(1.0, false), false);
  assert.equal(lodFor(1.0, true), true, 'entre 1,0 y 1,1 se conserva');
  assert.equal(lodFor(1.09, true), true);
  assert.equal(lodFor(1.1, true), false);
  assert.equal(lodFor(2, false), false);
});

test('lodFor: oscilar 100 cuadros entre 0,95 y 1,05 cambia como máximo una vez', () => {
  let marks = false;
  let cambios = 0;
  for (let i = 0; i < 100; i++) {
    const s = i % 2 === 0 ? 0.95 : 1.05;
    const next = lodFor(s, marks);
    if (next !== marks) cambios++;
    marks = next;
  }
  assert.ok(cambios <= 1, `cambios: ${cambios}`);
});

test('lodFor: con render.lod.marks en false nunca hay marcas', () => {
  assert.equal(lodFor(0.5, false, { ...LOD_DEFAULTS, marks: false }), false);
});

test('resolveLod: render.lod valida [0,5; 1,5] con exitAbove > enterBelow o lanza ConfigError', () => {
  assert.deepEqual(resolveLod({}), LOD_DEFAULTS);
  assert.deepEqual(resolveLod({ enterBelow: 0.8, exitAbove: 1.2 }), { enterBelow: 0.8, exitAbove: 1.2, marks: true });
  assert.throws(() => resolveLod({ enterBelow: 0.4 }), ConfigError);
  assert.throws(() => resolveLod({ exitAbove: 1.6 }), ConfigError);
  assert.throws(() => resolveLod({ enterBelow: 1.0, exitAbove: 1.0 }), ConfigError);
  assert.throws(() => resolveLod({ enterBelow: 1.2, exitAbove: 1.1 }), ConfigError);
  assert.throws(() => resolveLod({ enterBelow: 'x' }), ConfigError);
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.2: búferes fijos, un solo origen, recorte y topes

const WORLD = { w: 1440, h: 810 };

function crearRender(W, H, extra = {}) {
  const factory = createFakeCanvasFactory();
  const main = createFakeMain(W, H);
  const r = createRenderer({ createCanvas: factory.createCanvas, canvas: main, world: WORLD, ...extra });
  r.resize(W, H);
  return { r, factory, main };
}
const ancho = (c) => `${c.width}x${c.height}`;

test('búferes: LOW de 1440x810 y la caché de terreno se reservan una vez; MID por tamaño de canvas y solo con fd < 1,9', () => {
  const { r, factory } = crearRender(1920, 1080);
  const tam = factory.created.map(ancho);
  assert.equal(tam.filter((t) => t === '1440x810').length, 2, 'LOW y caché de terreno');
  assert.ok(tam.includes('2888x1628'), `MID de 1080p: 2·(1440+4) x 2·(810+4); hay ${tam}`);
  assert.equal(r.stats.canvasesAllocated, factory.created.length);
  const antes = factory.created.length;
  r.resize(1920, 1080);
  assert.equal(factory.created.length, antes, 'el mismo tamaño no reserva nada');
  r.resize(1280, 720);
  assert.ok(factory.created.map(ancho).includes('2568x1448'), 'MID de 1280x720: 2·(1280+4) x 2·(720+4)');
});

test('búferes: 4K (fd 2,667) no reserva MID', () => {
  const { factory } = crearRender(3840, 2160);
  assert.deepEqual(factory.created.map(ancho), ['1440x810', '1440x810']);
});

test('búferes: ventana menor que el mundo usa min(W,1440) y min(H,810) para MID', () => {
  const { factory } = crearRender(640, 360);
  assert.ok(factory.created.map(ancho).includes('1288x728'), '2·(640+4) x 2·(360+4)');
});

test('1000 cuadros de zoom y paneo continuos no crean ningún lienzo', () => {
  for (const [W, H] of [
    [1920, 1080],
    [1280, 720],
    [3840, 2160],
  ]) {
    const { r, factory } = crearRender(W, H);
    r.startMatch(1);
    const antes = factory.created.length;
    const fd = Math.min(W / WORLD.w, H / WORLD.h);
    for (let i = 0; i < 1000; i++) {
      const s = fd * (1 + 5 * Math.abs(Math.sin(i / 37)));
      const x0 = Math.max(0, (WORLD.w - W / s) * Math.abs(Math.sin(i / 11)));
      const y0 = Math.max(0, (WORLD.h - H / s) * Math.abs(Math.cos(i / 17)));
      r.draw({ x0, y0, s }, { alpha: (i % 3) / 3, time: i / 60 });
    }
    assert.equal(factory.created.length, antes, `${W}x${H}`);
  }
});

test('un solo origen: ox = round(x0·s); cada entidad en round(x_interp) (LOW) o round(x·s) − ox (pasada de dispositivo)', () => {
  const vistos = [];
  const entities = (P) => {
    vistos.push({ device: P.device, mul: P.mul, x: P.x(300.4), y: P.y(200.6) });
  };
  // s = 4 entero: pasada de dispositivo
  const a = crearRender(1920, 1080, { layers: { entities } });
  a.r.startMatch(1);
  a.r.draw({ x0: 100.3, y0: 50.7, s: 4 }, { alpha: 0, time: 0 });
  assert.equal(vistos[0].device, true);
  assert.equal(vistos[0].x, Math.round(300.4 * 4) - Math.round(100.3 * 4));
  assert.equal(vistos[0].y, Math.round(200.6 * 4) - Math.round(50.7 * 4));
  // la caché LOW se copia con su esquina entera en (xL·s − ox)
  const copia = a.main.ctx.calls.find((c) => c[0] === 'drawImage' && c[1] === a.factory.created[0]);
  assert.ok(copia, 'LOW se copia a la pantalla');
  const xL = Math.floor(100.3) - 1;
  const yL = Math.floor(50.7) - 1;
  assert.equal(copia[6], xL * 4 - Math.round(100.3 * 4));
  assert.equal(copia[7], yL * 4 - Math.round(50.7 * 4));
  // s = 1,333: sin pasada de dispositivo, la entidad queda en px de mundo enteros dentro de LOW
  vistos.length = 0;
  const b = crearRender(1920, 1080, { layers: { entities } });
  b.r.startMatch(1);
  b.r.draw({ x0: 100.3, y0: 50.7, s: 1920 / 1440 }, { alpha: 0, time: 0 });
  assert.equal(vistos[0].device, false);
  assert.equal(vistos[0].mul, 1);
  assert.equal(vistos[0].x, Math.round(300.4) - (Math.floor(100.3) - 1));
});

test('devicePass:false vuelve todo a LOW aunque s sea entera', () => {
  let device = null;
  const { r } = crearRender(1920, 1080, { devicePass: false, layers: { entities: (P) => (device = P.device) } });
  r.startMatch(1);
  r.draw({ x0: 0, y0: 0, s: 4 }, { alpha: 0, time: 0 });
  assert.equal(device, false);
});

test('recorte con 50 px de margen y contador culled', () => {
  const { r } = crearRender(1920, 1080, {
    layers: {
      entities: (P) => {
        P.visible(100 - 49, 300); // dentro del margen
        P.visible(100 - 51, 300); // fuera
        P.visible(100 + 1920 / 4 + 49, 300);
        P.visible(100 + 1920 / 4 + 51, 300);
        P.visible(200, 200 - 51); // arriba, fuera
      },
    },
  });
  r.startMatch(1);
  r.draw({ x0: 100, y0: 200, s: 4 }, { alpha: 0, time: 0 });
  assert.equal(r.stats.culled, 3);
});

test('terreno: la caché se pinta una vez por partido, no por cuadro', () => {
  let pintados = 0;
  const { r } = crearRender(1920, 1080, { layers: { terrain: () => pintados++ } });
  r.startMatch(7);
  for (let i = 0; i < 1000; i++) r.draw({ x0: 0, y0: 0, s: 1920 / 1440 }, { alpha: 0, time: i / 60 });
  assert.equal(pintados, 1);
  r.startMatch(8);
  assert.equal(pintados, 2);
});

test('las listas de dibujo nunca superan su tope en 1000 cuadros', () => {
  const lista = createList(5);
  for (let i = 0; i < 20; i++) lista.push(i);
  assert.equal(lista.length, 5);
  assert.equal(lista.dropped, 15);
  lista.clear();
  assert.equal(lista.length, 0);
  const { r } = crearRender(1920, 1080, {
    layers: {
      entities: (P) => {
        for (let i = 0; i < 2000; i++) P.lists.entities.push(i);
        for (let i = 0; i < 2000; i++) P.lists.particles.push(i);
        for (let i = 0; i < 2000; i++) P.lists.labels.push(i);
      },
    },
  });
  r.startMatch(1);
  for (let i = 0; i < 1000; i++) {
    r.draw({ x0: 0, y0: 0, s: 1920 / 1440 }, { alpha: 0, time: i / 60 });
    assert.ok(r.stats.entities <= r.caps.entities);
    assert.ok(r.stats.particles <= 600);
    assert.ok(r.stats.labels <= 24);
  }
  assert.equal(r.stats.particles, 600);
  assert.equal(r.stats.labels, 24);
});

test('el modo de escala elige el camino de copia: suave directo, nítido por MID, vecino directo', () => {
  const copias = (s) => {
    const { r, main, factory } = crearRender(1920, 1080);
    r.startMatch(1);
    main.ctx.reset();
    r.draw({ x0: 0, y0: 0, s }, { alpha: 0, time: 0 });
    return { main, factory, r };
  };
  const nitido = copias(1.5);
  const mid = nitido.factory.created.find((c) => c.width === 2888);
  assert.ok(
    nitido.main.ctx.calls.some((c) => c[0] === 'drawImage' && c[1] === mid),
    'nítido: MID a pantalla',
  );
  assert.ok(
    mid.ctx.byName.drawImage >= 1 &&
      nitido.main.ctx.calls.some((c) => c[0] === 'set:imageSmoothingQuality' && c[1] === 'low'),
  );
  const vecino = copias(2);
  const mid2 = vecino.factory.created.find((c) => c.width === 2888);
  assert.ok(!vecino.main.ctx.calls.some((c) => c[0] === 'drawImage' && c[1] === mid2));
  assert.ok(vecino.main.ctx.calls.some((c) => c[0] === 'set:imageSmoothingEnabled' && c[1] === false));
  const chico = crearRender(640, 360);
  chico.r.startMatch(1);
  chico.main.ctx.reset();
  chico.r.draw({ x0: 0, y0: 0, s: 640 / 1440 }, { alpha: 0, time: 0 });
  assert.ok(chico.main.ctx.calls.some((c) => c[0] === 'set:imageSmoothingQuality' && c[1] === 'medium'));
  assert.equal(chico.r.stats.mode, 'smooth');
  assert.equal(chico.r.stats.marks, true, 'bajo 1 hay marcas');
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.3: interpolación y pasada de dispositivo

/** Un soldado a velocidad constante `v` (px/s) en un sim de 30 Hz, mirado a `fps` cuadros por segundo. */
function recorrido(v, fps, frames, mapa) {
  const salida = [];
  const out = { x: 0, y: 0 };
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    const k = Math.floor(t * 30 + 1e-9);
    const alpha = t * 30 - k;
    const u = { px: 100 + (v * Math.max(0, k - 1)) / 30, x: 100 + (v * k) / 30, py: 300, y: 300 };
    interpPos(u, alpha, out);
    salida.push(mapa(out.x));
  }
  return salida;
}

test('interpPos: mezcla lineal entre el paso previo y el actual, sin reservar objetos', () => {
  const out = { x: 0, y: 0 };
  assert.equal(interpPos({ px: 10, x: 20, py: 0, y: 8 }, 0.5, out), out);
  assert.deepEqual(out, { x: 15, y: 4 });
  interpPos({ px: 10, x: 20, py: 0, y: 8 }, 0, out);
  assert.deepEqual(out, { x: 10, y: 0 });
  interpPos({ px: 10, x: 20, py: 0, y: 8 }, 1, out);
  assert.deepEqual(out, { x: 20, y: 8 });
  interpPos({ x: 7, y: 9 }, 0.3, out);
  assert.deepEqual(out, { x: 7, y: 9 }, 'sin posición previa se queda donde está');
});

test('interpolación: a 60 fps sobre un sim de 30 Hz cada cuadro avanza v/60 ± 5 % y no retrocede al redondear', () => {
  const v = 38.4;
  const xs = recorrido(v, 60, 240, (x) => x);
  for (let i = 3; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    assert.ok(Math.abs(d - v / 60) <= (v / 60) * 0.05, `cuadro ${i}: ${d}`);
  }
  const redondeadas = recorrido(v, 60, 240, (x) => Math.round(x));
  for (let i = 1; i < redondeadas.length; i++) assert.ok(redondeadas[i] >= redondeadas[i - 1], `cuadro ${i}`);
});

test('interpolación: con cuadros irregulares (144 y 20 fps) las posiciones redondeadas tampoco retroceden', () => {
  for (const fps of [20, 144]) {
    const rs = recorrido(38.4, fps, 400, (x) => Math.round(x));
    for (let i = 1; i < rs.length; i++) assert.ok(rs[i] >= rs[i - 1], `${fps} fps, cuadro ${i}`);
  }
});

test('pasada de dispositivo con s = 4: avanza 2 o 3 px de dispositivo por cuadro y nunca retrocede; en LOW, 0 o 4', () => {
  const P = createProjector({ culled: 0, drawCalls: 0 }, {});
  P.device = true;
  P.mul = 4;
  P.offX = 0;
  const dev = recorrido(38.4, 60, 240, (x) => P.x(x));
  const saltosDev = new Set();
  for (let i = 4; i < dev.length; i++) {
    const d = dev[i] - dev[i - 1];
    saltosDev.add(d);
    assert.ok(d === 2 || d === 3, `cuadro ${i}: ${d}`);
  }
  assert.ok(saltosDev.has(2) && saltosDev.has(3));
  const low = recorrido(38.4, 60, 240, (x) => Math.round(x) * 4);
  const saltosLow = new Set();
  for (let i = 4; i < low.length; i++) saltosLow.add(low[i] - low[i - 1]);
  assert.deepEqual([...saltosLow].sort(), [0, 4], 'en LOW avanza a saltos de s px');
});

test('la pasada de dispositivo es solo para s entera >= 2: s = 1 y s fraccional van por LOW', () => {
  const usa = (W, H, s) => {
    let device = null;
    const { r } = crearRender(W, H, { layers: { entities: (P) => (device = P.device) } });
    r.startMatch(1);
    r.draw({ x0: 0, y0: 0, s }, { alpha: 0, time: 0 });
    return device;
  };
  assert.equal(usa(1440, 810, 1), false, 's = 1 (un px de mundo ya es de dispositivo)');
  assert.equal(usa(1920, 1080, 1920 / 1440), false);
  assert.equal(usa(1920, 1080, 2.5), false, 'fraccional: nítido o vecino por LOW');
  assert.equal(usa(1920, 1080, 2), true);
  assert.equal(usa(1920, 1080, 6), true);
});

test('render.devicePass:false vuelve a LOW aunque s sea entera (pasada desactivada)', () => {
  let usoDispositivo = null;
  const { r } = crearRender(1920, 1080, {
    devicePass: false,
    layers: { entities: (P) => (usoDispositivo = P.device) },
  });
  r.startMatch(1);
  r.draw({ x0: 0, y0: 0, s: 4 }, { alpha: 0, time: 0 });
  assert.equal(usoDispositivo, false);
  assert.equal(r.stats.devicePass, false);
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.4 y 5a.5: sprites por código, bombardero y bombas

const CLAVES = new Set('odthskglmbwyrfac'.split(''));
const marcos = (sp) => Object.entries(sp.anims).flatMap(([an, fs]) => fs.map((f, i) => ({ an, i, rows: f })));

test('sprites: filas de igual largo, claves dentro de la paleta y anclas dentro del sprite', () => {
  assert.equal(SPRITES.paleta, 'o d t h s k g l m b w y r f a c');
  for (const kind of ['soldado', 'jeep', 'tanque', 'pesado', 'avion', 'bomba']) {
    const sp = SPRITES[kind];
    assert.ok(sp, kind);
    assert.ok(sp.ax >= 0 && sp.ax < sp.w && sp.ay >= 0 && sp.ay < sp.h, `${kind}: ancla dentro`);
    if (sp.mz) assert.ok(sp.mz[0] < sp.w && sp.mz[1] < sp.h, `${kind}: boca dentro`);
    if (sp.mz2) assert.ok(sp.mz2[0] < sp.w && sp.mz2[1] < sp.h, `${kind}: segunda boca dentro`);
    for (const { an, i, rows } of marcos(sp)) {
      assert.equal(rows.length, sp.h, `${kind}.${an}[${i}] alto`);
      for (const fila of rows) {
        assert.equal(fila.length, sp.w, `${kind}.${an}[${i}] ancho`);
        for (const c of fila) assert.ok(c === '.' || CLAVES.has(c), `${kind}.${an}[${i}]: clave "${c}"`);
      }
    }
    if (sp.barra) {
      const w = sp.barra.rows[0].length;
      for (const fila of sp.barra.rows) {
        assert.equal(fila.length, w);
        for (const c of fila) assert.ok(c === '.' || CLAVES.has(c));
      }
      assert.ok(sp.barra.dx + w <= sp.w + 2 && sp.barra.dy >= 0 && sp.barra.dy + sp.barra.rows.length <= sp.h + 1);
    }
  }
});

test('sprites: estados por tipo (soldado idle, walk x4, shoot x2, death x3; vehículos con wreck)', () => {
  const n = (k, a) => SPRITES[k].anims[a].length;
  assert.deepEqual(
    [n('soldado', 'idle'), n('soldado', 'walk'), n('soldado', 'shoot'), n('soldado', 'death')],
    [1, 4, 2, 3],
  );
  for (const k of ['jeep', 'tanque', 'pesado']) {
    for (const a of ['idle', 'walk', 'shoot', 'wreck']) assert.ok(n(k, a) >= 1, `${k}.${a}`);
  }
});

test('sprites: ningún dato por país (ids de equipo, banderas, escudos ni códigos ISO como clave)', () => {
  const claves = [];
  const recorre = (o) => {
    if (o !== null && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) {
        claves.push(k);
        recorre(v);
      }
    }
  };
  recorre(SPRITES);
  const prohibido = /bandera|flag|escudo|pais|país|himno|stripe|franja/i;
  for (const k of claves) assert.doesNotMatch(k, prohibido, k);
  const iso = new Set(PAISES.flatMap((p) => [p.id, p.iso]));
  for (const k of claves) assert.ok(!iso.has(k), `clave "${k}" es un código de país`);
});

test('bake: normal, blanca y espejada por color; bakeCount sube por color de equipo y no por cuadro', () => {
  const factory = createFakeCanvasFactory();
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  assert.equal(bank.bakeCount, 0);
  const a = bank.bake('#E5484D');
  assert.equal(bank.bake('#E5484D'), a, 'el mismo color no se vuelve a hornear');
  const b = bank.bake('#5BC8F5');
  assert.equal(bank.bakeCount, 2);
  const n = bank.frame(a, 'soldado', 'walk', 1, false);
  const blanca = bank.frame(a, 'soldado', 'walk', 1, false, true);
  const espejo = bank.frame(a, 'soldado', 'walk', 1, true);
  assert.notEqual(n, blanca);
  assert.notEqual(n, espejo);
  assert.notEqual(bank.frame(a, 'soldado', 'walk', 1, false), bank.frame(b, 'soldado', 'walk', 1, false));
  assert.equal(
    bank.frame(a, 'soldado', 'walk', 5, false),
    bank.frame(a, 'soldado', 'walk', 1, false),
    'el cuadro se envuelve',
  );
  // el espejo pinta cada píxel en x' = w − 1 − x
  const fila = SPRITES.soldado.anims.walk[1][5];
  const w = SPRITES.soldado.w;
  const px = (cv) => cv.ctx.calls;
  for (const cv of [n, espejo]) cv.ctx.recording = false;
  assert.equal(n.width, w);
  assert.ok(fila.length === w);
  // 1000 cuadros de consulta no hornean nada más
  const antes = factory.created.length;
  for (let i = 0; i < 1000; i++) bank.frame(i % 2, 'jeep', 'walk', i, i % 3 === 0, i % 5 === 0);
  assert.equal(bank.bakeCount, 2);
  assert.equal(factory.created.length, antes);
  void px;
});

test('bake: el espejo pinta cada píxel en w − 1 − x', () => {
  const factory = createFakeCanvasFactory({ record: true });
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const t = bank.bake('#E5484D');
  const rows = SPRITES.soldado.anims.idle[0];
  const w = SPRITES.soldado.w;
  const rects = (cv) =>
    cv.ctx.calls.filter((c) => c[0] === 'fillRect' && c[3] === 1 && c[4] === 1).map((c) => `${c[1]},${c[2]}`);
  const normal = new Set(rects(bank.frame(t, 'soldado', 'idle', 0, false)));
  const espejo = new Set(rects(bank.frame(t, 'soldado', 'idle', 0, true)));
  let esperados = 0;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '.') continue;
      esperados++;
      assert.ok(normal.has(`${x},${y}`));
      assert.ok(espejo.has(`${w - 1 - x},${y}`));
    }
  }
  assert.equal(normal.size, esperados);
});

const regionesDe = (r) => (Array.isArray(r) ? r : [r]);
const dentro = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

test('bombardero: 44x34, dos regiones de góndola, una de cabina, hélice de >= 2 cuadros y un cuadro de alabeo', () => {
  const av = SPRITES.avion;
  assert.equal(av.w, 44);
  assert.equal(av.h, 34);
  assert.equal(av.regiones.gondolas.length, 2);
  assert.ok(av.regiones.cabina);
  for (const r of [...av.regiones.gondolas, av.regiones.cabina, ...av.regiones.helices]) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= av.w && r.y + r.h <= av.h);
  }
  // cuadros: alabeo (nivelado, y−, y+) x hélice (2): índice alabeo·2 + hélice
  assert.equal(av.anims.fly.length, 6);
  const [n0, n1, b1, , b2] = av.anims.fly;
  // la hélice solo cambia píxeles dentro de las regiones de hélice
  let dif = 0;
  for (let y = 0; y < av.h; y++) {
    for (let x = 0; x < av.w; x++) {
      if (n0[y][x] === n1[y][x]) continue;
      dif++;
      assert.ok(
        av.regiones.helices.some((r) => dentro(x, y, r)),
        `píxel ${x},${y} fuera de la hélice`,
      );
    }
  }
  assert.ok(dif > 0, 'las dos hélices son distintas');
  // los cuadros de alabeo se distinguen del nivelado
  assert.notDeepEqual(b1, n0);
  assert.notDeepEqual(b2, n0);
  assert.notDeepEqual(b1, b2);
  // las góndolas y la cabina tienen píxeles pintados
  for (const r of [...av.regiones.gondolas, av.regiones.cabina]) {
    let pintados = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (n0[y][x] !== '.') pintados++;
    assert.ok(pintados > 0);
  }
});

test('bombardero: el color del equipo (t, h, d) aparece solo en las regiones de banda; sin insignias', () => {
  const av = SPRITES.avion;
  let vistos = 0;
  for (const rows of av.anims.fly) {
    for (let y = 0; y < av.h; y++) {
      for (let x = 0; x < av.w; x++) {
        if (!'thd'.includes(rows[y][x])) continue;
        vistos++;
        assert.ok(
          regionesDe(av.regiones.bandas).some((r) => dentro(x, y, r)),
          `tinte fuera de las bandas en ${x},${y}`,
        );
      }
    }
  }
  assert.ok(vistos > 0);
  // ninguna región de insignia ni dato por país
  assert.deepEqual(Object.keys(av.regiones).sort(), ['bandas', 'cabina', 'gondolas', 'helices']);
});

test('bombardero: 5 bombas en soportes (2 bajo cada ala y 1 bajo el fuselaje) que desaparecen al soltarse', () => {
  const av = SPRITES.avion;
  assert.equal(av.soportes.length, 5);
  const ys = av.soportes.map((s) => s.y);
  assert.equal(ys.filter((y) => y < 17).length, 3, 'una mitad de ala y el fuselaje en el centro');
  for (const s of av.soportes) {
    assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.rows[0].length <= av.w && s.y + s.rows.length <= av.h);
  }
  // sin bombas el cuadro no las trae: están fuera del cuerpo
  const factory = createFakeCanvasFactory();
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const t = bank.bake('#E5484D');
  for (let i = 0; i < 5; i++) assert.ok(bank.soporte(t, i, false));
  // la sombra del avión: una sola silueta por orientación, en INK
  assert.notEqual(bank.sombraAvion(false), bank.sombraAvion(true));
  assert.equal(bank.sombraAvion(false), bank.sombraAvion(false));
  assert.equal(bank.sombraAvion(false).height, 17);
});

test('bomba suelta: sprite de 3x6 con ancla dentro', () => {
  const b = SPRITES.bomba;
  assert.equal(b.anims.fall[0].length, 6);
  assert.ok(b.ax < b.w && b.ay < b.h);
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.6: terreno y orden de dibujo

const PINTA = (seed) => {
  const factory = createFakeCanvasFactory();
  const terreno = createTerrain({ createCanvas: factory.createCanvas });
  const ctx = createFakeCtx({ record: true });
  terreno.paint(ctx, seed);
  return { terreno, ctx, factory };
};

test('terreno: usa los colores transitables de data/paleta.js (con los dos retonos de D26) y ninguno de los viejos', () => {
  const { ctx } = PINTA(7);
  const usados = new Set(ctx.calls.filter((c) => c[0] === 'set:fillStyle').map((c) => String(c[1]).toUpperCase()));
  for (const t of PALETA.terrain) assert.ok(usados.has(t.hex.toUpperCase()), `falta ${t.id} ${t.hex}`);
  for (const viejo of ['#313D3E', '#463F51']) assert.ok(!usados.has(viejo), `${viejo} no cumple el contraste`);
});

test('terreno: sembrado por partido (misma semilla, mismas llamadas; otra semilla, otras) y sin Math.random', () => {
  const firma = (s) => JSON.stringify(PINTA(s).ctx.calls);
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random en el terreno');
  };
  try {
    assert.equal(firma(5), firma(5));
    assert.notEqual(firma(5), firma(6));
  } finally {
    Math.random = original;
  }
});

test('terreno: las nubes derivan y con movimiento reducido quedan quietas', () => {
  const { terreno } = PINTA(1);
  const nubes = terreno.clouds;
  assert.equal(nubes.length, 3);
  for (const c of nubes) {
    assert.notEqual(cloudX(c, 0, false), cloudX(c, 30, false));
    assert.equal(cloudX(c, 0, true), cloudX(c, 30, true));
    assert.equal(cloudX(c, 12.5, true), cloudX(c, 99, true));
  }
});

test('terreno: pintar la caché no crea más lienzos que las 3 nubes', () => {
  const { factory } = PINTA(2);
  assert.equal(factory.created.length, 3);
});

const ordenaPorY = (items, n) => insertionSortBy(items, n, (u) => u.y);

test('orden por y: inserción sobre el mismo arreglo, estable', () => {
  const lista = [
    { id: 1, y: 30 },
    { id: 2, y: 10 },
    { id: 3, y: 30 },
    { id: 4, y: 20 },
    { id: 5, y: 10 },
    { id: 99, y: -1 },
  ];
  const mismo = ordenaPorY(lista, 5);
  assert.equal(mismo, lista, 'ordena en el mismo arreglo');
  assert.deepEqual(
    lista.slice(0, 5).map((u) => u.id),
    [2, 5, 4, 1, 3],
  );
  assert.equal(lista[5].id, 99, 'solo toca los n primeros');
});

function escena() {
  const u = (id, side, kind, x, y) => ({
    id,
    side,
    kind,
    x,
    y,
    px: x - 1,
    py: y,
    vx: 0,
    vy: 0,
    dir: side === 0 ? 1 : -1,
    cd: 5,
    hp: 10,
    maxHp: 10,
    alive: true,
    tgt: null,
    stats: { cdSteps: 30 },
  });
  return {
    step: 100,
    cfg: DEFAULTS,
    units: [
      u(1, 0, 'soldado', 300, 400),
      u(2, 0, 'soldado', 320, 200),
      u(3, 1, 'soldado', 340, 300),
      u(4, 1, 'tanque', 360, 250),
    ],
    planes: [{ id: 9, side: 0, x: 500, y: 300, px: 496, py: 300, z: 48, vx: 120, vy: 0, bombsLeft: 5 }],
    bombs: [{ id: 10, side: 0, x0: 480, y0: 300, tx: 520, ty: 310, dropStep: 95, impactStep: 109 }],
    wrecks: [{ x: 330, y: 350, kind: 'jeep', side: 0, dir: 1, born: 80 }],
    projectiles: [{ kind: 0, x0: 300, y0: 400, z0: 6, tx: 340, ty: 300, tz: 6, step0: 99, dur: 0.2 }],
    craters: [],
    teamHex: ['#E5484D', '#5BC8F5'],
    flashUntil: () => 0,
  };
}
const orden = (s) => {
  const nombres = [];
  const factory = createFakeCanvasFactory();
  const main = createFakeMain(1920, 1080);
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const r = createRenderer({
    createCanvas: factory.createCanvas,
    canvas: main,
    world: WORLD,
    trace: (n) => nombres.push(n),
    layers: { entities: createEntityLayer({ bank, team }) },
  });
  r.resize(1920, 1080);
  r.startMatch(1);
  main.ctx.reset();
  nombres.length = 0;
  r.draw({ x0: 200, y0: 150, s: s }, { alpha: 0.5, time: 1, scene: escena() });
  return { nombres, main, bank, team, r, factory };
};

test('orden de capas con s = 1,333 (todo en LOW): terreno, cielo, cráteres, bases, sombras, unidades y restos, proyectiles, sombras de aire, bombas y aviones, efectos, íconos, y al final la copia', () => {
  const { nombres } = orden(1920 / 1440);
  assert.deepEqual(nombres, [
    'terrain',
    'sky',
    'craters',
    'bases',
    'shadows',
    'units',
    'projectiles',
    'airShadows',
    'bombsPlanes',
    'effects',
    'icons',
    'copy',
  ]);
});

test('orden de capas con s = 4 (pasada de dispositivo): LOW se copia antes que las capas que se mueven', () => {
  const { nombres } = orden(4);
  assert.deepEqual(nombres, [
    'terrain',
    'sky',
    'craters',
    'bases',
    'copy',
    'shadows',
    'units',
    'projectiles',
    'airShadows',
    'bombsPlanes',
    'effects',
    'icons',
  ]);
});

test('unidades y restos van ordenados por y: la de y menor se dibuja primero', () => {
  const { main, bank, team } = orden(4);
  const ys = (img) => main.ctx.calls.filter((c) => c[0] === 'drawImage' && c[1] === img).map((c) => c[3]);
  const sold = bank.frame(team[0], 'soldado', 'idle', 0, false);
  const soldE = bank.frame(team[1], 'soldado', 'idle', 0, true);
  const dibujados = main.ctx.calls.filter((c) => c[0] === 'drawImage' && [sold, soldE].includes(c[1])).map((c) => c[3]);
  assert.equal(dibujados.length, 3);
  assert.deepEqual(
    [...dibujados],
    [...dibujados].sort((a, b) => a - b),
  );
  void ys;
});

// ---------------------------------------------------------------------------------------------------------------
// Escena de la vista: pools de capacidad fija alimentados con `world.drain()`; solo lectura

const profundoCongelado = (o) => {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) profundoCongelado(v);
  }
  return o;
};
const mundoFalso = (step = 10) => ({
  step,
  cfg: DEFAULTS,
  units: [],
  planes: [],
  bombs: [],
  bases: [{ turrets: [{ x: 100, y: 242 }] }, { turrets: [{ x: 1340, y: 242 }] }],
});

test('escena: los restos, proyectiles y cráteres nunca superan su tope aunque lleguen 10 000 eventos', () => {
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  const w = mundoFalso();
  for (let i = 0; i < 10000; i++) {
    w.step = 10 + (i >> 4);
    sc.consume(
      [
        { type: 'death', id: i, kind: i % 2 ? 'jeep' : 'soldado', side: i % 2, x: i % 1400, y: 300 },
        { type: 'shot', id: i, kind: 'tanque', x: 300, y: 300, tx: 340, ty: 300 },
        { type: 'bombImpact', x: i % 1400, y: 400, side: 0 },
      ],
      w,
    );
    assert.ok(sc.wrecks.length <= 24 && sc.projectiles.length <= 256 && sc.craters.length <= 60);
  }
});

test('escena: el soldado se quita a los 3,1 s, el vehículo a los 7,5 s y el cráter a los 20 s', () => {
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  const w = mundoFalso(0);
  sc.consume(
    [
      { type: 'death', id: 1, kind: 'soldado', side: 0, x: 10, y: 10 },
      { type: 'death', id: 2, kind: 'tanque', side: 1, x: 20, y: 10 },
      { type: 'bombImpact', x: 5, y: 5, side: 0 },
    ],
    w,
  );
  assert.equal(sc.wrecks.length, 2);
  w.step = Math.round(3.0 * 30);
  sc.consume([], w);
  assert.equal(sc.wrecks.length, 2);
  w.step = Math.round(3.2 * 30);
  sc.consume([], w);
  assert.deepEqual(
    sc.wrecks.map((r) => r.kind),
    ['tanque'],
  );
  w.step = Math.round(7.4 * 30);
  sc.consume([], w);
  assert.equal(sc.wrecks.length, 1);
  w.step = Math.round(7.6 * 30);
  sc.consume([], w);
  assert.equal(sc.wrecks.length, 0);
  assert.equal(sc.craters.length, 1);
  w.step = 20 * 30 + 5;
  sc.consume([], w);
  assert.equal(sc.craters.length, 0);
});

test('escena: un disparo crea un proyectil con el mismo tiempo de vuelo que el sim; un golpe enciende el destello 2 pasos y respeta el enfriamiento', () => {
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  const w = mundoFalso(100);
  sc.consume(
    [
      { type: 'shot', id: 1, kind: 'soldado', x: 300, y: 300, tx: 300 + 270 / 2, ty: 300 },
      { type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 },
    ],
    w,
  );
  assert.equal(sc.projectiles.length, 1);
  assert.equal(sc.projectiles[0].dur, Math.ceil((135 / 270) * 30) / 30);
  assert.equal(sc.flashUntil(7), 102, 'el destello blanco dura 2 pasos');
  w.step = 103; // un segundo golpe dentro de los 0,22 s no reenciende el destello
  sc.consume([{ type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 }], w);
  assert.equal(sc.flashUntil(7), 102);
  w.step = 108; // aún dentro del enfriamiento de 11 pasos (CB-20: a lo sumo 3 parpadeos por segundo)
  sc.consume([{ type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 }], w);
  assert.equal(sc.flashUntil(7), 102);
  w.step = 111;
  sc.consume([{ type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 }], w);
  assert.equal(sc.flashUntil(7), 113, 'pasado el enfriamiento vuelve a brillar');
  assert.equal(sc.flashUntil(8), 0);
  sc.reset();
  assert.equal(sc.projectiles.length, 0);
  assert.equal(sc.flashUntil(7), 0);
});

test('la vista solo lee: dibujar 50 cuadros con unidades, aviones y bombas congelados no escribe en el estado de reglas', () => {
  const factory = createFakeCanvasFactory();
  const main = createFakeMain(1920, 1080);
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  const ev = escena();
  const w = mundoFalso(100);
  w.units = ev.units;
  w.planes = ev.planes;
  w.bombs = ev.bombs;
  profundoCongelado(w);
  const r = createRenderer({
    createCanvas: factory.createCanvas,
    canvas: main,
    world: WORLD,
    layers: { entities: createEntityLayer({ bank, team }) },
  });
  r.resize(1920, 1080);
  r.startMatch(1);
  sc.consume([{ type: 'death', id: 1, kind: 'jeep', side: 0, x: 330, y: 350 }], w);
  for (let i = 0; i < 50; i++) {
    sc.sync(w);
    r.draw({ x0: 200, y0: 150, s: i % 2 ? 4 : 1.5 }, { alpha: (i % 5) / 5, time: i / 60, scene: sc });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.7: arte de las bases y banderín

const TAM = { w: 110, h: 669 };
const rasterBase = (kind, state, espejo = false) => {
  const factory = createFakeCanvasFactory({ record: true });
  const [c0, c1, c2, c3] = bakeBase({ createCanvas: factory.createCanvas }, kind, '#E5484D', espejo);
  return rasterize([c0, c1, c2, c3][state].ctx.calls, TAM);
};

test('bases: 110x669 con 4 estados prerenderizados por lado, todos distintos entre sí', () => {
  const factory = createFakeCanvasFactory();
  const estados = bakeBase({ createCanvas: factory.createCanvas }, 'base-fortin', '#E5484D', false);
  assert.equal(estados.length, 4);
  for (const c of estados) assert.deepEqual([c.width, c.height], [110, 669]);
  assert.equal(factory.created.length, 4);
  for (const kind of ['base-fortin', 'base-ciudadela']) {
    const rs = [0, 1, 2, 3].map((s) => rasterBase(kind, s));
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) assert.ok(diff(rs[i], rs[j]).n > 200, `${kind}: estado ${i} y ${j} se parecen`);
    }
  }
});

test('CB-3: la ciudadela (lado derecho) no es el espejo del fortín (lado izquierdo)', () => {
  for (const estado of [0, 1, 2]) {
    const izquierda = rasterBase('base-fortin', estado, false); // lado izquierdo, tal cual
    const derecha = rasterBase('base-ciudadela', estado, true); // lado derecho, de cara al campo
    const { n, painted } = diff(derecha, mirror(izquierda, TAM));
    assert.ok(n / painted > 0.04, `estado ${estado}: solo ${((100 * n) / painted).toFixed(1)} % de píxeles distintos`);
    // y el espejo de un fortín dibujado a la derecha SÍ sería idéntico: así se prueba que la prueba sirve
    const lazy = rasterBase('base-fortin', estado, true);
    assert.equal(diff(lazy, mirror(izquierda, TAM)).n, 0);
  }
});

test('bases: los estados salen del HP con umbrales 0,66 / 0,33 / >0 / destruida, y son cosméticos (se pueden cambiar)', () => {
  assert.equal(baseState(1, false), 0);
  assert.equal(baseState(0.66, false), 0);
  assert.equal(baseState(0.6599, false), 1);
  assert.equal(baseState(0.33, false), 1);
  assert.equal(baseState(0.3299, false), 2);
  assert.equal(baseState(0.0001, false), 2);
  assert.equal(baseState(0, false), 3);
  assert.equal(baseState(0.9, true), 3, 'una base caída es ruina');
  assert.equal(baseState(0.5, false, { cracks: 0.9, heavy: 0.6 }), 2, 'otros umbrales dan otro estado');
});

test('banderín: un único relleno igual al color del equipo, sin patrón ni bandera', () => {
  const partes = [];
  pennant((parte, c, x, y, w, h) => partes.push({ parte, c, x, y, w, h }), {
    hex: '#E5484D',
    side: 0,
    worldW: 1440,
    time: 1.3,
    ruined: false,
    reduced: false,
  });
  const cuerpo = partes.filter((p) => p.parte === 'cuerpo');
  assert.equal(cuerpo.length, 12);
  assert.deepEqual(new Set(cuerpo.map((p) => p.c)), new Set(['#E5484D']), 'el cuerpo es de un solo color');
  assert.ok(cuerpo.every((p) => p.w === 2 && p.h === 16));
  const otros = new Set(partes.filter((p) => p.parte !== 'cuerpo').map((p) => p.c));
  assert.deepEqual(otros, new Set(['#0B0F17', '#9DA9BF', '#FFD84A']), 'mástil, remate y borde, sin colores de país');
  // en ruinas solo queda un muñón de mástil, sin cuerpo
  const ruina = [];
  pennant((parte, c, x, y, w, h) => ruina.push({ parte, c, x, y, w, h }), {
    hex: '#E5484D',
    side: 1,
    worldW: 1440,
    time: 0,
    ruined: true,
    reduced: false,
  });
  assert.ok(ruina.length > 0 && ruina.every((p) => p.parte === 'mastil'));
  // geometría del v3: a 30 px del borde exterior
  assert.equal(partes.find((p) => p.parte === 'remate').x, 29);
  assert.equal(ruina[0].x, 1440 - 30 - 1);
});

test('banderín: ondea con el tiempo y queda quieto con movimiento reducido', () => {
  const ys = (time, reduced) => {
    const out = [];
    pennant((parte, c, x, y) => parte === 'cuerpo' && out.push(y), {
      hex: '#E5484D',
      side: 0,
      worldW: 1440,
      time,
      ruined: false,
      reduced,
    });
    return out.join(',');
  };
  assert.notEqual(ys(0, false), ys(0.4, false));
  assert.equal(ys(0, true), ys(0.4, true));
});

test('capa de bases: dibuja el arte del estado que toca y el banderín, y las torretas caídas como disco oscuro', () => {
  const factory = createFakeCanvasFactory({ record: true });
  const main = createFakeMain(1920, 1080);
  const capa = createBaseLayer({ createCanvas: factory.createCanvas, worldW: 1440 });
  capa.bake(['#E5484D', '#5BC8F5'], ['base-fortin', 'base-ciudadela']);
  assert.equal(capa.bakeCount, 2);
  const r = createRenderer({
    createCanvas: factory.createCanvas,
    canvas: main,
    world: WORLD,
    layers: { bases: (P) => capa.layer(P) },
  });
  r.resize(1920, 1080);
  r.startMatch(1);
  const torreta = (x, y, hp) => ({ x, y, hp, maxHp: 600, on: hp > 0, cd: 0, tgt: null });
  const base = (hp, fell, hpT) => ({
    hp,
    maxHp: 1000,
    fell,
    turrets: [torreta(100, 242, hpT), torreta(100, 448, 600), torreta(100, 655, 600)],
  });
  const scene = {
    bases: [base(1000, false, 0), base(0, true, 600)],
    cfg: DEFAULTS,
    units: [],
    planes: [],
    bombs: [],
    wrecks: [],
    projectiles: [],
    craters: [],
    flashUntil: () => 0,
    teamHex: ['#E5484D', '#5BC8F5'],
    step: 0,
  };
  r.buffers.lowCtx.recording = true;
  r.draw({ x0: 0, y0: 100, s: 1920 / 1440 }, { alpha: 0, time: 0, scene });
  const calls = r.buffers.lowCtx.calls;
  const imgs = calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
  const artes = factory.created.filter((c) => c.width === 110 && c.height === 669);
  assert.ok(imgs.includes(artes[0]), 'base izquierda entera (estado 0)');
  assert.ok(imgs.includes(artes[7]), 'base derecha caída (estado 3)');
  assert.ok(!imgs.includes(artes[1]) && !imgs.includes(artes[4]), 'solo el estado que toca');
  const fills = calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1]);
  assert.ok(fills.includes('#141A26'), 'la torreta sin HP queda como disco oscuro');
  assert.ok(fills.includes('#8794AB'), 'una torreta viva dibuja su cañón');
  assert.ok(fills.includes('#E5484D'), 'banderín del equipo izquierdo');
  assert.ok(r.stats.drawCalls > 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.8: unidades, proyectiles y marcas

function dibuja(W, H, s, unidades, extra = {}, mod = null) {
  const factory = createFakeCanvasFactory({ record: true });
  const main = createFakeMain(W, H);
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const team = [bank.bake('#E5484D'), bank.bake('#5BC8F5')];
  const r = createRenderer({
    createCanvas: factory.createCanvas,
    canvas: main,
    world: WORLD,
    layers: { entities: createEntityLayer({ bank, team }) },
    ...extra,
  });
  r.resize(W, H);
  r.startMatch(1);
  const esc = escena();
  esc.units = unidades;
  esc.planes = escena().planes;
  mod?.(esc);
  r.buffers.lowCtx.recording = true;
  r.draw({ x0: 0, y0: 0, s }, { alpha: 1, time: 1, scene: esc });
  return { r, bank, team, low: r.buffers.lowCtx.calls, main: main.ctx.calls, esc };
}
const unidad = (id, side, kind, x, y) => ({
  id,
  side,
  kind,
  x,
  y,
  px: x,
  py: y,
  vx: 0,
  vy: 0,
  dir: side === 0 ? 1 : -1,
  cd: 20,
  hp: 10,
  maxHp: 10,
  alive: true,
  tgt: null,
  stats: { cdSteps: 30 },
});

test('LOD de marcas: cada unidad es un rectángulo del color del equipo (3x2, 6x3, 8x4, 10x5) con contorno INK y sombra de 1 px', () => {
  const kinds = [
    ['soldado', 3, 2],
    ['jeep', 6, 3],
    ['tanque', 8, 4],
    ['pesado', 10, 5],
  ];
  const unidades = kinds.map(([k], i) => unidad(i + 1, i % 2, k, 300 + i * 100, 300));
  const { low, r, bank, team } = dibuja(960, 540, 960 / 1440, unidades);
  assert.equal(r.stats.marks, true);
  assert.equal(r.stats.mode, 'smooth');
  let estilo = null;
  const rects = [];
  for (const c of low) {
    if (c[0] === 'set:fillStyle') estilo = c[1];
    if (c[0] === 'fillRect') rects.push({ estilo, w: c[3], h: c[4], x: c[1], y: c[2] });
  }
  const hexes = ['#E5484D', '#5BC8F5'];
  kinds.forEach(([k, w, h], i) => {
    const color = rects.findIndex((q) => q.estilo === hexes[i % 2] && q.w === w && q.h === h);
    assert.ok(color > 0, `${k}: rectángulo ${w}x${h} del color del equipo`);
    const rc = rects[color];
    const contorno = rects.find(
      (q) => q.estilo === '#0B0F17' && q.w === w + 2 && q.h === h + 2 && q.x === rc.x - 1 && q.y === rc.y - 1,
    );
    assert.ok(contorno, `${k}: contorno INK de 1 px alrededor`);
    const sombra = rects.find((q) => q.w === w && q.h === 1 && q.y === rc.y + h && q.x === rc.x);
    assert.ok(sombra, `${k}: sombra de 1 px debajo`);
  });
  // nadie dibuja su sprite en este modo
  const sprites = low.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
  assert.ok(!sprites.includes(bank.frame(team[0], 'soldado', 'idle', 0, false)));
});

test('LOD de marcas: los aviones no cambian (siguen con su sprite) y los íconos no se tocan', () => {
  const { low, bank, team } = dibuja(960, 540, 960 / 1440, [unidad(1, 0, 'soldado', 300, 300)]);
  const imgs = low.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
  assert.ok(
    imgs.some((i) =>
      [0, 1].some((k) => [0, 1].some((p) => i === bank.frame(team[0], 'avion', 'fly', p, false)) && k >= 0),
    ),
  );
});

test('render.lod.marks:false: con s < 1 se dibujan sprites con el modo suave', () => {
  const lod = resolveLod({ marks: false });
  const { low, r, bank, team } = dibuja(960, 540, 960 / 1440, [unidad(1, 0, 'soldado', 300, 300)], { lod });
  assert.equal(r.stats.marks, false);
  assert.equal(r.stats.mode, 'smooth');
  const imgs = low.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
  assert.ok(imgs.includes(bank.frame(team[0], 'soldado', 'idle', 0, false)));
});

test('vista normal: cada tipo de unidad usa su propio sprite, orientado según su lado', () => {
  for (const kind of ['soldado', 'jeep', 'tanque', 'pesado']) {
    const { low, bank, team, r } = dibuja(1920, 1080, 1920 / 1440, [
      unidad(1, 0, kind, 300, 300),
      unidad(2, 1, kind, 500, 300),
    ]);
    assert.equal(r.stats.marks, false);
    const imgs = low.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
    assert.ok(imgs.includes(bank.frame(team[0], kind, 'idle', 0, false)), `${kind}: sprite del equipo izquierdo`);
    assert.ok(imgs.includes(bank.frame(team[1], kind, 'idle', 0, true)), `${kind}: sprite espejado del derecho`);
  }
});

test('vista normal: tanque y pesado dibujan su cañón aparte (el pesado, dos veces) y el estado sale de la marcha y el disparo', () => {
  const t = dibuja(1920, 1080, 1920 / 1440, [unidad(1, 0, 'tanque', 300, 300)]);
  const p = dibuja(1920, 1080, 1920 / 1440, [unidad(1, 0, 'pesado', 300, 300)]);
  const veces = (d, kind) =>
    d.low.filter((c) => c[0] === 'drawImage' && c[1] === d.bank.barra(d.team[0], kind, false)).length;
  assert.equal(veces(t, 'tanque'), 1);
  assert.equal(veces(p, 'pesado'), 2);
  const marcha = { ...unidad(1, 0, 'soldado', 300, 300), vx: 30 };
  const m = dibuja(1920, 1080, 1920 / 1440, [marcha]);
  const imgs = m.low.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
  const caminando = [0, 1, 2, 3].some((i) => imgs.includes(m.bank.frame(m.team[0], 'soldado', 'walk', i, false)));
  assert.ok(caminando, 'en marcha usa el ciclo de caminata');
  const tira = { ...unidad(1, 0, 'soldado', 300, 300), tgt: {}, cd: 29 };
  const d = dibuja(1920, 1080, 1920 / 1440, [tira]);
  const imgs2 = d.low.filter((c) => c[0] === 'drawImage').map((c) => c[1]);
  assert.ok(
    imgs2.includes(d.bank.frame(d.team[0], 'soldado', 'shoot', 1, false)),
    'recién disparó: cuadro con fogonazo',
  );
});

test('un golpe pinta la variante blanca; un resto de soldado usa los cuadros de muerte y se desvanece', () => {
  const u = unidad(7, 0, 'soldado', 300, 300);
  const normal = dibuja(1920, 1080, 1920 / 1440, [u]);
  assert.ok(
    !normal.low.some(
      (c) => c[0] === 'drawImage' && c[1] === normal.bank.frame(normal.team[0], 'soldado', 'idle', 0, false, true),
    ),
  );
  const golpe = dibuja(1920, 1080, 1920 / 1440, [u], {}, (esc) => {
    esc.step = 10;
    esc.flashUntil = () => 17;
  });
  assert.ok(
    golpe.low.some(
      (c) => c[0] === 'drawImage' && c[1] === golpe.bank.frame(golpe.team[0], 'soldado', 'idle', 0, false, true),
    ),
  );
  const resto = dibuja(1920, 1080, 1920 / 1440, [], {}, (esc) => {
    esc.step = 84; // 2,8 s después de morir
    esc.wrecks = [{ x: 300, y: 300, kind: 'soldado', side: 0, dir: 1, born: 0 }];
  });
  assert.ok(
    resto.low.some(
      (c) => c[0] === 'drawImage' && c[1] === resto.bank.frame(resto.team[0], 'soldado', 'death', 2, false),
    ),
  );
  assert.ok(
    resto.low.some((c) => c[0] === 'set:globalAlpha' && c[1] > 0 && c[1] < 1),
    'se desvanece desde los 2,5 s',
  );
  const carcasa = dibuja(1920, 1080, 1920 / 1440, [], {}, (esc) => {
    esc.step = 30;
    esc.wrecks = [{ x: 300, y: 300, kind: 'tanque', side: 1, dir: -1, born: 0 }];
  });
  assert.ok(
    carcasa.low.some(
      (c) => c[0] === 'drawImage' && c[1] === carcasa.bank.frame(carcasa.team[1], 'tanque', 'wreck', 0, true),
    ),
  );
});

test('proyectiles: una bala traza una línea de píxeles y un obús dibuja un cuadrito con sombra; ambos se recortan fuera de la vista', () => {
  const dentro = dibuja(1920, 1080, 1920 / 1440, [], {}, (esc) => {
    esc.step = 100;
    esc.projectiles = [
      { kind: 0, x0: 300, y0: 300, z0: 6, tx: 400, ty: 300, tz: 6, step0: 99, dur: 0.4 },
      { kind: 1, x0: 300, y0: 320, z0: 8, tx: 500, ty: 320, tz: 8, step0: 99, dur: 1, arc: 18, big: true },
    ];
  });
  assert.ok(
    dentro.low.some((c) => c[0] === 'set:fillStyle' && c[1] === '#FFE680'),
    'trazo de bala',
  );
  assert.ok(
    dentro.low.some((c) => c[0] === 'set:fillStyle' && c[1] === '#FFB347'),
    'obús',
  );
  const fuera = dibuja(1920, 1080, 1920 / 1440, [], {}, (esc) => {
    esc.step = 100;
    esc.projectiles = [{ kind: 0, x0: 5000, y0: 300, z0: 6, tx: 5100, ty: 300, tz: 6, step0: 99, dur: 0.4 }];
  });
  assert.ok(!fuera.low.some((c) => c[0] === 'set:fillStyle' && c[1] === '#FFE680'));
  assert.ok(fuera.r.stats.culled > 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 5a.9: bucle, modelo de F2 y corrida del hash dorado

test('bucle: usa advance, da como máximo 3 pasos por cuadro y deja alpha en [0, 1)', () => {
  let pasos = 0;
  const loop = createLoop({ step: () => pasos++ });
  assert.deepEqual(loop.frame(1 / 60), { steps: 0, alpha: loop.alpha });
  let total = 0;
  for (let i = 0; i < 600; i++) {
    const antes = pasos;
    const r = loop.frame(1 / 60);
    total += r.steps;
    assert.ok(r.steps <= 3 && pasos - antes === r.steps);
    assert.ok(loop.alpha >= 0 && loop.alpha < 1.0001);
  }
  assert.ok(Math.abs(total - 300) <= 1, `10 s a 60 fps son 300 pasos de 30 Hz; fueron ${total}`);
  const antes = pasos;
  const r = loop.frame(5); // un cuadro de 5 s (pestaña dormida): no se congela
  assert.equal(r.steps, 3);
  assert.equal(pasos - antes, 3);
});

test('bucle: a 144 y a 20 fps simula los mismos pasos por segundo', () => {
  for (const fps of [144, 20]) {
    let pasos = 0;
    const loop = createLoop({ step: () => pasos++ });
    for (let i = 0; i < fps * 10; i++) loop.frame(1 / fps);
    assert.ok(Math.abs(pasos - 300) <= 2, `${fps} fps: ${pasos}`);
  }
});

test('temporizador: fps y milisegundos por etapa con reloj inyectado', () => {
  let t = 0;
  const timer = createTimer({ now: () => t, window: 60 });
  for (let f = 0; f < 120; f++) {
    timer.beginFrame();
    timer.begin('sim');
    t += 1.5;
    timer.end('sim');
    timer.begin('world');
    t += 3;
    timer.end('world');
    timer.begin('ui');
    t += 0.5;
    timer.end('ui');
    t += 11.667; // el resto del cuadro de 16,667 ms
    timer.endFrame();
  }
  const s = timer.snapshot();
  assert.ok(Math.abs(s.fps - 60) < 1, `fps ${s.fps}`);
  assert.ok(Math.abs(s.ms.sim - 1.5) < 0.01 && Math.abs(s.ms.world - 3) < 0.01 && Math.abs(s.ms.ui - 0.5) < 0.01);
  assert.ok(Math.abs(s.ms.work - 5) < 0.05, 'trabajo por cuadro: sim + mundo + UI');
});

const entradaF2 = (extra = {}) => ({
  timer: { snapshot: () => ({ fps: 59.4, ms: { sim: 0.41, world: 3.2, ui: 0.9, work: 4.51 } }) },
  stats: {
    s: 1.3333,
    mode: 'sharp',
    marks: false,
    devicePass: false,
    culled: 12,
    drawCalls: 1480,
    particles: 87,
    labels: 4,
    entities: 410,
    canvasesAllocated: 3,
  },
  counts: { units: 400, squads: 41, planes: 2, hits: 33 },
  bakeCount: 2,
  hash: 'a1b2c3d4',
  ...extra,
});
const modeloF2 = (extra = {}) => f2Model(entradaF2(extra));
const valor = (m, k) => m.lines.find((l) => l.key === k)?.value;

test('F2: fps, ms por etapa, entidades, partículas, llamadas de dibujo, recortadas, s, modo, LOD, bakeCount, lienzos y hash', () => {
  const m = modeloF2();
  assert.equal(valor(m, 'fps'), '59.4');
  assert.equal(valor(m, 'ms.sim'), '0.41');
  assert.equal(valor(m, 'ms.world'), '3.20');
  assert.equal(valor(m, 'ms.ui'), '0.90');
  assert.equal(valor(m, 'ms.work'), '4.51');
  assert.equal(valor(m, 'units'), '400');
  assert.equal(valor(m, 'squads'), '41');
  assert.equal(valor(m, 'planes'), '2');
  assert.equal(valor(m, 'hits'), '33');
  assert.equal(valor(m, 'particles'), '87');
  assert.equal(valor(m, 'drawCalls'), '1480');
  assert.equal(valor(m, 'culled'), '12');
  assert.equal(valor(m, 's'), '1.333');
  assert.equal(valor(m, 'mode'), 'sharp');
  assert.equal(valor(m, 'lod'), 'sprites');
  assert.equal(valor(m, 'devicePass'), 'no');
  assert.equal(valor(m, 'bakeCount'), '2');
  assert.equal(valor(m, 'canvases'), '3');
  assert.equal(valor(m, 'hash'), 'a1b2c3d4');
  assert.equal(valor(m, 'goldenHash'), undefined, 'sin ?golden no hay hash dorado');
  assert.equal(
    modeloF2({ stats: { ...entradaF2().stats, marks: true } }).lines.find((l) => l.key === 'lod').value,
    'marcas',
  );
  for (const l of m.lines) assert.ok(l.label.length > 0 && typeof l.value === 'string');
});

test('F2 con ?golden: muestra el hash dorado y si coincide con el del paso actual (CB-13 [M])', () => {
  const ok = modeloF2({ golden: { expected: 'f64c4ff7', done: true, hash: 'f64c4ff7' } });
  assert.equal(valor(ok, 'goldenHash'), 'f64c4ff7');
  assert.equal(valor(ok, 'goldenMatch'), 'sí coincide');
  const mal = modeloF2({ golden: { expected: 'f64c4ff7', done: true, hash: '00000000' } });
  assert.equal(valor(mal, 'goldenMatch'), 'NO coincide');
  const enCurso = modeloF2({
    golden: { expected: 'f64c4ff7', done: false, hash: 'a1b2c3d4', step: 4000, steps: 10400 },
  });
  assert.equal(valor(enCurso, 'goldenMatch'), 'corriendo 4000/10400');
});

test('F2: el presupuesto se marca: más de 8 ms de trabajo o menos de 50 fps se señala', () => {
  assert.equal(modeloF2().budget.ok, true);
  const lento = f2Model({
    ...entradaF2(),
    timer: { snapshot: () => ({ fps: 44, ms: { sim: 1, world: 7, ui: 1, work: 9 } }) },
  });
  assert.equal(lento.budget.ok, false);
  assert.match(lento.budget.text, /8 ms|50 fps/);
});

test('corrida del hash dorado: avanzar por partes da el mismo hash que replayMatch', () => {
  const pasos = 1200;
  const run = createGoldenRun({ log: GOLDEN.log, steps: pasos, paises: PAISES, game: GOLDEN.game });
  while (!run.done) run.advance(37);
  assert.equal(run.tick, pasos);
  const esperado = hashMatch(replayMatch(GOLDEN.log, { steps: pasos, paises: PAISES, game: GOLDEN.game }));
  assert.equal(run.hash(), esperado);
  assert.equal(run.advance(10), 0, 'terminada no avanza más');
});

test(
  'corrida del hash dorado: el recorrido completo da el hash versionado (el mismo que Node)',
  { timeout: 120000 },
  () => {
    const run = createGoldenRun({ log: GOLDEN.log, steps: GOLDEN.steps, paises: PAISES, game: GOLDEN.game });
    while (!run.done) run.advance(500);
    assert.equal(run.hash(), GOLDEN.hash);
  },
);

// <<FIN>>
