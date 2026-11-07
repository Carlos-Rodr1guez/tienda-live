import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, seedSquad } from '../public/js/sim/world.js';
import { createScene } from '../public/js/render/scene.js';
import { createRenderer } from '../public/js/render/frame.js';
import { createSpriteBank } from '../public/js/render/sprites.js';
import { createEntityLayer } from '../public/js/render/units.js';
import { createIconBank, createIconLayer, departedCounts } from '../public/js/render/icons.js';
import { createLabelLayer } from '../public/js/render/labels-layer.js';
import { viewOf } from '../public/js/render/project.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { createFakeCanvasFactory, createFakeCtx, createFakeMain } from './support/fake-canvas.js';
import { arrancar } from './support/fake-main.js';

// Cableado del lote 5d: los íconos en la capa 10, las etiquetas en pantalla tras el mundo y `main.js` con `?donantes`.
// La cadena completa (escena, render, capa de íconos y capa de etiquetas) corre con lienzos falsos.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const HEX = ['#E5484D', '#5BC8F5'];
const AY = { soldado: SPRITES.soldado.ay, jeep: SPRITES.jeep.ay, tanque: SPRITES.tanque.ay, pesado: SPRITES.pesado.ay };
const MARCAS = { soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] };

/** Escena, render, íconos y etiquetas montados como en `main.js`, con un grupo de soldados de "ana" en el lado izquierdo. */
function cadena() {
  const factory = createFakeCanvasFactory({ record: true });
  const main = createFakeMain(1920, 1080);
  const bank = createSpriteBank({ createCanvas: factory.createCanvas, sprites: SPRITES });
  const team = HEX.map((h) => bank.bake(h));
  const iconBank = createIconBank({ createCanvas: factory.createCanvas });
  const iconTeam = HEX.map((h) => iconBank.bake(h));
  const world = createWorld({}, { phase: 'sandbox' });
  seedSquad(world, { side: 0, kind: 'soldado', role: 'ataque' });
  world.units[0].owner = 'ana';
  const scene = createScene({ teamHex: HEX, sprites: SPRITES });
  scene.sync(world);
  const icons = createIconLayer({
    bank: iconBank,
    team: iconTeam,
    spriteAy: AY,
    marksSize: MARCAS,
    formingAlpha: 0.55,
  });
  scene.drawIcons = (P) => icons(P, scene.squads, scene.cfg, scene.field);
  const r = createRenderer({
    createCanvas: factory.createCanvas,
    canvas: main,
    world: { w: 1440, h: 810 },
    layers: { entities: createEntityLayer({ bank, team }) },
  });
  r.resize(1920, 1080);
  r.startMatch(1);
  const registry = {
    get: () => ({ xp: { match: 10 } }),
    rankOf: () => ({ index: 2, label: 'Cabo' }),
    displayName: () => 'ana_23',
  };
  const labels = createLabelLayer({ registry, teamHex: HEX, spriteAy: AY, marksSize: MARCAS });
  return { factory, main, world, scene, r, icons, labels };
}

/** Dibuja un cuadro del mundo y las etiquetas encima; devuelve el contexto de las etiquetas. */
function dibujar(c, view, alpha = 1) {
  c.main.ctx.reset();
  c.r.buffers.lowCtx.reset();
  c.r.draw(view, { alpha, time: 1, scene: c.scene });
  const ctx = createFakeCtx({ record: true });
  const screen = { ...viewOf(c.r.stats), marks: c.r.stats.marks, x0: view.x0, y0: view.y0 };
  for (const now of [0, 0.2]) {
    c.labels.draw(ctx, {
      W: 1920,
      H: 1080,
      u: 4,
      units: c.world.units,
      k: 6,
      screen,
      alpha,
      now,
      icons: { descs: c.icons.descs, count: c.icons.count },
    });
  }
  return ctx;
}
/** Llamadas `drawImage` de 5 argumentos (con tamaño) a un contexto: [dx, dy, dw, dh]. */
const imagenes = (ctx) => ctx.calls.filter((c) => c[0] === 'drawImage' && c.length === 6).map((c) => c.slice(2));

test('el render deja el origen en px de dispositivo (ox, oy) para que las etiquetas usen la misma proyección', () => {
  const c = cadena();
  c.r.draw({ x0: 12.3, y0: 7.6, s: 4 }, { alpha: 1, time: 0, scene: c.scene });
  assert.equal(c.r.stats.ox, Math.round(12.3 * 4));
  assert.equal(c.r.stats.oy, Math.round(7.6 * 4));
  c.r.draw({ x0: 100.4, y0: 3, s: 1.5 }, { alpha: 1, time: 0, scene: c.scene });
  assert.equal(c.r.stats.ox, Math.round(100.4 * 1.5));
  assert.deepEqual(viewOf(c.r.stats), { s: 1.5, ox: Math.round(100.4 * 1.5), oy: 5, device: false });
});

test('la escena apunta a los grupos del mundo (por referencia, sin copiar)', () => {
  const c = cadena();
  assert.equal(c.scene.squads, c.world.squads);
});

test('pasada de dispositivo (s = 4): la pastilla queda centrada sobre el sprite de su unidad y a 2·u sobre su cabeza', () => {
  const c = cadena();
  const view = { x0: 0, y0: 313, s: 4 };
  dibujar(c, view);
  const ctx = c.main.ctx;
  const sp = SPRITES.soldado;
  const r = c.labels.rects[0];
  assert.ok(r, 'hay una etiqueta');
  const pegado = imagenes(ctx).filter(([, , dw, dh]) => dw === sp.w * 4 && dh === sp.h * 4);
  assert.ok(pegado.length >= 1);
  const ok = pegado.some(([dx, dy]) => Math.abs(dx + sp.ax * 4 - (r.x + r.w / 2)) <= 0.5 && r.y + r.h === dy - 8);
  assert.equal(ok, true, 'ningún sprite coincide con la posición de la pastilla');
});

test('LOW (s = 1,333 y cámara desplazada): la pastilla cae donde la copia a pantalla pone el sprite', () => {
  const c = cadena();
  const s = 1920 / 1440;
  const view = { x0: 100.4, y0: 0, s };
  dibujar(c, view);
  const low = c.r.buffers.lowCtx;
  const sp = SPRITES.soldado;
  const r = c.labels.rects[0];
  const xL = Math.max(0, Math.floor(view.x0) - 1);
  const copiaX = Math.round(xL * s) - Math.round(view.x0 * s);
  const ok = imagenes(low)
    .filter(([, , dw, dh]) => dw === sp.w && dh === sp.h)
    .some(([dx]) => Math.abs((dx + sp.ax) * s + copiaX - (r.x + r.w / 2)) <= 1);
  assert.equal(ok, true);
});

test('los íconos van en la capa 10 por la escena, también con marcas, y las etiquetas los esquivan', () => {
  const c = cadena();
  // pasada de dispositivo
  dibujar(c, { x0: 0, y0: 313, s: 4 });
  assert.ok(
    imagenes(c.main.ctx).some(([, , dw, dh]) => dw === 10 * 4 && dh === 8 * 4),
    'flecha de 10×8 ×4',
  );
  assert.equal(c.icons.stats.drawn, 1);
  // con marcas (s < 1): el ícono se dibuja igual
  dibujar(c, { x0: 0, y0: 0, s: 0.8 });
  assert.equal(c.r.stats.marks, true);
  assert.equal(c.icons.stats.drawn, 1);
  assert.ok(imagenes(c.r.buffers.lowCtx).some(([, , dw, dh]) => dw === 10 && dh === 8));
  // ninguna etiqueta pisa el ícono proyectado
  dibujar(c, { x0: 0, y0: 313, s: 4 });
  const d = c.icons.descs[0];
  const ic = { x: Math.round(d.x * 4) - c.r.stats.ox, y: Math.round(d.y * 4) - c.r.stats.oy, w: 40, h: 32 };
  for (const p of c.labels.rects)
    assert.equal(p.x < ic.x + ic.w && ic.x < p.x + p.w && p.y < ic.y + ic.h && ic.y < p.y + p.h, false);
});

/** Copia de solo lectura: cualquier escritura en un objeto del sim lanza (patrón de 5c, `determinism.test.js`). */
function soloLectura(o, cache = new WeakMap()) {
  if (o === null || typeof o !== 'object') return o;
  if (cache.has(o)) return cache.get(o);
  const prohibido = () => {
    throw new Error('la vista escribió en un objeto del sim');
  };
  const p = new Proxy(o, {
    get: (t, k, r) => {
      const v = Reflect.get(t, k, r);
      const d = Reflect.getOwnPropertyDescriptor(t, k);
      return d && d.configurable === false && d.writable === false ? v : soloLectura(v, cache);
    },
    set: prohibido,
    deleteProperty: prohibido,
    defineProperty: prohibido,
    setPrototypeOf: prohibido,
  });
  cache.set(o, p);
  return p;
}

test('la vista nunca escribe en el sim: íconos de rol, conteos del HUD y etiquetas con el mundo de solo lectura', () => {
  const c = cadena();
  const w = soloLectura(c.world);
  c.main.ctx.reset();
  c.r.draw({ x0: 0, y0: 313, s: 4 }, { alpha: 0.5, time: 1, scene: c.scene });
  const banco = createIconBank({ createCanvas: c.factory.createCanvas });
  const iconos = createIconLayer({
    bank: banco,
    team: HEX.map((h) => banco.bake(h)),
    spriteAy: AY,
    formingAlpha: 0.55,
  });
  assert.doesNotThrow(() => departedCounts(w));
  const P = {
    frame: { alpha: 0.5 },
    ctx: createFakeCtx(),
    mul: 4,
    x: (v) => v,
    y: (v) => v,
    visible: () => true,
    img() {},
  };
  assert.doesNotThrow(() => iconos(P, w.squads, w.cfg, w.field));
  assert.equal(iconos.count, w.squads.length);
  const ctx = createFakeCtx();
  const screen = { ...viewOf(c.r.stats), marks: false, x0: 0, y0: 313 };
  const frame = {
    W: 1920,
    H: 1080,
    u: 4,
    units: w.units,
    k: 6,
    screen,
    alpha: 0.5,
    now: 0,
    icons: { descs: iconos.descs, count: iconos.count },
  };
  assert.doesNotThrow(() => c.labels.draw(ctx, frame));
  assert.doesNotThrow(() => c.labels.draw(ctx, { ...frame, now: 0.5 }));
});

// ---------------------------------------------------------------------------------------------------------------
// main.js

test('main.js: ?donantes crea donantes sintéticos por los dos equipos por el camino público y se ven sus etiquetas', async () => {
  const e = await arrancar('?f2&donantes&rapido=20');
  for (let i = 0; i < 60; i++) e.cuadros(1, 100);
  const RANGO = /^(RECLUTA|SOLDADO|CABO|SARGENTO|TENIENTE|CAPITÁN|MAYOR|CORONEL|GENERAL)( |$)/;
  const etiquetas = e.textos().filter((t) => RANGO.test(t));
  assert.ok(etiquetas.length >= 4 && etiquetas.length <= 6, `k = 1: top 3 por equipo (hay ${etiquetas.length})`);
  assert.ok(
    etiquetas.some((t) => t.includes('ana_23')),
    'el donante con más XP del equipo izquierdo',
  );
  const f2 = e.f2();
  assert.ok(Number(f2['etiquetas dibujadas']) >= 4);
  assert.ok(Number(f2['íconos de rol dibujados']) >= 1, 'los grupos ya formados llevan ícono');
  assert.ok('etiquetas descartadas por el layout' in f2);
});

test('main.js: la densidad usa el nivel k del controlador, no kShown: en una transición ya cuenta el destino', async () => {
  const e = await arrancar('?f2&donantes&rapido=20');
  for (let i = 0; i < 60; i++) e.cuadros(1, 100);
  const elegidas = () => Number(e.f2()['etiquetas elegidas']);
  assert.equal(elegidas(), 6, `mapa entero: 3 por equipo`);
  // tres pulsaciones en el mismo cuadro: 1 → 1,5 → 2,25 → 3; kShown apenas se movió pero k ya es 3
  e.tecla('+');
  e.tecla('+');
  e.tecla('+');
  e.cuadros(1, 16);
  assert.match(e.f2()['cámara k (objetivo / mostrado)'], /^3\.000 \/ 1\.\d+$/, 'k ya es 3 y kShown va en camino');
  assert.ok(elegidas() > 12, `con k = 3 hay más que los 6 por equipo de los niveles intermedios (hay ${elegidas()})`);
});

const RANGO_ETIQUETA = /^(RECLUTA|SOLDADO|CABO|SARGENTO|TENIENTE|CAPITÁN|MAYOR|CORONEL|GENERAL)( |$)/;

test('C4: al cargar una fuente (loadingdone) main invalida la caché y la etiqueta se mide otra vez', async () => {
  const e = await arrancar('?f2&donantes&rapido=20');
  for (let i = 0; i < 60; i++) e.cuadros(1, 100);
  e.tecla('p'); // pausa: el mundo queda quieto y ninguna etiqueta cambia sola
  e.cuadros(5, 100);
  const medidas = () => e.ctx.byName.measureText ?? 0;
  e.cuadros(1, 100);
  assert.equal(medidas(), 0, 'con la caché llena no se mide nada por cuadro');
  const oyentes = e.fuentes.oyentes.filter(([type]) => type === 'loadingdone');
  assert.equal(oyentes.length, 1, 'main escucha loadingdone de document.fonts');
  oyentes[0][1]();
  e.cuadros(1, 100);
  assert.ok(medidas() > 0, 'tras invalidar se vuelve a medir');
  e.cuadros(1, 100);
  assert.equal(medidas(), 0, 'y la caché se llena de nuevo');
});

test('C8b: con R activo la rampa de opacidad de las etiquetas por cuadro es la misma que sin R (de punta a punta)', async () => {
  const rampa = async (conR) => {
    const e = await arrancar('?f2&donantes&rapido=20');
    e.tecla(conR ? 'r' : 'a'); // en los dos casos la cámara automática queda apagada
    for (let i = 0; i < 60; i++) e.cuadros(1, 100);
    for (let i = 0; i < 3; i++) e.tecla('+'); // k = 3: entran etiquetas nuevas
    const serie = [];
    for (let i = 0; i < 12; i++) {
      e.cuadros(1, 16);
      let alfa = 1;
      const cuadro = [];
      for (const c of e.ctx.calls) {
        if (c[0] === 'set:globalAlpha') alfa = c[1];
        else if (c[0] === 'fillText' && RANGO_ETIQUETA.test(c[1])) cuadro.push(`${c[1]}:${alfa.toFixed(4)}`);
      }
      serie.push(cuadro);
    }
    return serie;
  };
  const sinR = await rampa(false);
  const conR = await rampa(true);
  const alfas = sinR.flat().map((s) => Number(s.split(':').pop()));
  assert.ok(
    alfas.some((a) => a > 0 && a < 1),
    'hay una rampa de verdad',
  );
  assert.deepEqual(conR, sinR);
});

test('C8d: ningún nombre de donante llega al DOM (textContent, innerHTML, innerText, value, atributos, nodos de texto)', async () => {
  const e = await arrancar('?f2&donantes&rapido=20');
  for (let i = 0; i < 60; i++) e.cuadros(1, 100);
  assert.ok(
    e.textos().some((t) => RANGO_ETIQUETA.test(t) && t.includes('ana_23')),
    'la etiqueta existe en el lienzo',
  );
  e.tecla('+');
  e.cuadros(40, 100);
  assert.ok(e.escrituras.length > 0, 'el DOM falso sí registra las escrituras de los botones');
  const nombres = ['ana_23', 'bea_77', 'xX_el_mas', 'Pepe_2000', '田中', String.fromCodePoint(0x1f600), 'Luis'];
  for (const [prop, valor] of e.escrituras)
    for (const n of nombres) assert.equal(valor.includes(n), false, `${prop} = ${valor}`);
});

test('main.js: ?donantes registra a los donantes con comandos del partido y la API del registro, sin tocar objetos del sim', () => {
  const src = fs
    .readFileSync(path.join(GJ, 'main.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(src, /donantes/);
  assert.match(src, /type: 'chat'/);
  assert.match(src, /type: 'gift'/);
  assert.doesNotMatch(src, /registry\.drain|world\.units\.push|\.xp\.(match|live|round)\s*=/);
  assert.equal(src.match(/\.drain\(/g)?.length, 1, 'sigue un solo vaciado de la bandeja');
});

test('main.js con ?golden: sin registro no hay etiquetas, pero los íconos de rol se ven y no se rompe nada', async () => {
  const e = await arrancar('?golden&rapido=60&donantes');
  e.cuadros(30);
  const f2 = e.f2();
  assert.equal(f2['etiquetas dibujadas'], '0');
  assert.ok(Number(f2['íconos de rol dibujados']) > 0, `íconos: ${f2['íconos de rol dibujados']}`);
});
