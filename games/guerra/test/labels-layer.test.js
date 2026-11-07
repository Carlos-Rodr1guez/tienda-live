import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLabelLayer, LABEL_FADE_SECONDS, LABEL_FONT } from '../public/js/render/labels-layer.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { f2Model } from '../public/js/render/f2.js';
import { createFakeCtx } from './support/fake-canvas.js';

// La capa de dibujo de las etiquetas (CB-16, D22, §10.3): caché de texto medido, fundido de 120 ms, posición idéntica
// a la del sprite, tamaño fijo en px virtuales, nada por encima de la banda del HUD y nada pisando un ícono.
// Todo con un contexto 2D falso que registra llamadas: sin DOM.

const AY = { soldado: SPRITES.soldado.ay, jeep: SPRITES.jeep.ay, tanque: SPRITES.tanque.ay, pesado: SPRITES.pesado.ay };
const INK = '#0B0F17';
let nextId = 1;
const unit = (side, owner, value, x, y, o = {}) => ({
  id: nextId++,
  side,
  owner,
  unitValue: value,
  kind: 'soldado',
  alive: true,
  x,
  y,
  px: x,
  py: y,
  ...o,
});

/** Registro de lectura falso con la misma superficie pública que usa la capa: get, rankOf y displayName. */
function registro(usuarios) {
  const r = {
    lecturas: 0,
    get: (k) => (usuarios[k] ? { xp: { match: usuarios[k].xp ?? 0 } } : undefined),
    rankOf: (k) => ({ index: 2, label: usuarios[k]?.rank ?? 'Cabo' }),
    displayName: (k) => (usuarios[k]?.hidden ? 'anónimo' : (usuarios[k]?.name ?? 'anónimo')),
  };
  return r;
}
const dflt = () => registro({ ana: { name: 'ana_23', xp: 10 } });

function crear(o = {}) {
  return createLabelLayer({
    registry: o.registry === undefined ? dflt() : o.registry,
    teamHex: ['#E5484D', '#5BC8F5'],
    spriteAy: AY,
    marksSize: { soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] },
    cfg: o.cfg,
  });
}
const frame = (o = {}) => ({
  W: 1920,
  H: 1080,
  u: 4,
  units: [unit(0, 'ana', 5, 300.3, 200.6)],
  k: 6,
  screen: { s: 4, ox: 100, oy: 50, device: true, marks: false, x0: 25, y0: 12.5 },
  alpha: 1,
  now: 0,
  spotlight: null,
  onlyRank: false,
  icons: { descs: [], count: 0 },
  ...o,
});
/** Corre `seg` segundos de reloj de vista a 60 cuadros por segundo; devuelve el último contexto de dibujo. */
function correr(layer, ctx, f, seg) {
  const t0 = f.now;
  for (let t = 0; t <= seg + 1e-9; t += 1 / 60) {
    ctx.reset();
    layer.draw(ctx, { ...f, now: t0 + t });
  }
}
const textos = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);

test('contenido: "CABO ana_23" como texto del lienzo; oculto "CABO anónimo"; con N solo el rango', () => {
  const ctx = createFakeCtx({ record: true });
  const layer = crear();
  correr(layer, ctx, frame(), 0.3);
  assert.deepEqual(textos(ctx), ['CABO ana_23']);
  const oculto = crear({ registry: registro({ ana: { name: 'ana_23', xp: 10, hidden: true } }) });
  correr(oculto, ctx, frame(), 0.3);
  assert.deepEqual(textos(ctx), ['CABO anónimo']);
  const rango = crear();
  correr(rango, ctx, frame({ onlyRank: true }), 0.3);
  assert.deepEqual(textos(ctx), ['CABO']);
  // texto INK sobre la pastilla del color del equipo
  const estilos = ctx.calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1]);
  assert.ok(estilos.includes('#E5484D'), 'pastilla del color del equipo izquierdo');
  assert.equal(estilos.at(-1), INK, 'el texto va en INK');
});

test('forma en la pastilla: círculo para el equipo izquierdo y rombo para el derecho', () => {
  const r = registro({ ana: { name: 'ana', xp: 1 }, bea: { name: 'bea', xp: 1 } });
  const izq = createFakeCtx({ record: true });
  correr(crear({ registry: r }), izq, frame({ units: [unit(0, 'ana', 5, 300, 200)] }), 0.3);
  assert.ok(izq.calls.some((c) => c[0] === 'arc'));
  assert.equal(
    izq.calls.some((c) => c[0] === 'lineTo'),
    false,
  );
  const der = createFakeCtx({ record: true });
  correr(crear({ registry: r }), der, frame({ units: [unit(1, 'bea', 5, 300, 200)] }), 0.3);
  assert.equal(
    der.calls.some((c) => c[0] === 'arc'),
    false,
  );
  assert.ok(der.calls.filter((c) => c[0] === 'lineTo').length >= 3, 'rombo');
  assert.ok(der.calls.some((c) => c[0] === 'set:fillStyle' && c[1] === '#5BC8F5'));
});

test('texto medido en una caché por donante: ni un measureText por cuadro; se invalida al cambiar nombre, rango, N o fuente', () => {
  const ctx = createFakeCtx({ record: false });
  const reg = dflt();
  const layer = crear({ registry: reg });
  correr(layer, ctx, frame(), 1);
  const medidas = ctx.byName.measureText ?? 0;
  assert.ok(medidas >= 0);
  const antes = layer.stats.measures;
  assert.ok(antes >= 1, 'midió al menos una vez');
  correr(layer, ctx, frame({ now: 5 }), 2);
  assert.equal(layer.stats.measures, antes, '120 cuadros más no miden otra vez');
  // cambia el nombre (se oculta): mide de nuevo, una vez
  const usuarios = { ana: { name: 'ana_23', xp: 10, hidden: true } };
  reg.displayName = (k) => (usuarios[k].hidden ? 'anónimo' : usuarios[k].name);
  correr(layer, ctx, frame({ now: 10 }), 0.5);
  assert.equal(layer.stats.measures, antes + 1);
  correr(layer, ctx, frame({ now: 12 }), 0.5);
  assert.equal(layer.stats.measures, antes + 1);
  // cambia el rango
  reg.rankOf = () => ({ index: 3, label: 'Sargento' });
  correr(layer, ctx, frame({ now: 14 }), 0.5);
  assert.equal(layer.stats.measures, antes + 2);
  // N (solo el rango) y la escala de la interfaz (la fuente) también invalidan
  correr(layer, ctx, frame({ now: 16, onlyRank: true }), 0.5);
  assert.equal(layer.stats.measures, antes + 3);
  const chica = { s: 2, ox: 0, oy: 0, device: true, marks: false, x0: 0, y0: 0 };
  correr(layer, ctx, frame({ now: 18, onlyRank: true, u: 2, W: 960, H: 540, screen: chica }), 0.5);
  assert.equal(layer.stats.measures, antes + 4);
});

test('fundido de opacidad de 120 ms al entrar y al salir; igual con movimiento reducido', () => {
  assert.equal(LABEL_FADE_SECONDS, 0.12);
  for (const reducido of [false, true]) {
    const ctx = createFakeCtx({ record: true });
    const layer = crear();
    const alfas = [];
    const f = frame({ reduced: reducido });
    for (let t = 0; t <= 0.3; t += 1 / 60) {
      ctx.reset();
      layer.draw(ctx, { ...f, now: t });
      const a = ctx.calls.filter((c) => c[0] === 'set:globalAlpha').map((c) => c[1]);
      alfas.push([t, textos(ctx).length ? Math.min(...a.filter((x) => x > 0)) : 0]);
    }
    const en = (t) => alfas.find(([x]) => x >= t - 1e-9)[1];
    assert.equal(en(0), 0, 'al entrar empieza invisible');
    assert.ok(en(0.06) > 0.3 && en(0.06) < 0.7, `a medio fundido (${en(0.06)})`);
    assert.ok(Math.abs(en(0.13) - 1) < 1e-9, 'a los 120 ms ya es opaca');
    // sale: el donante deja de estar en la selección y se desvanece en 120 ms
    const salida = [];
    for (let t = 0.3; t <= 0.6; t += 1 / 60) {
      ctx.reset();
      layer.draw(ctx, { ...f, units: [], now: t });
      const a = ctx.calls.filter((c) => c[0] === 'set:globalAlpha').map((c) => c[1]);
      salida.push([t, textos(ctx).length ? Math.min(...a.filter((x) => x > 0)) : 0]);
    }
    assert.ok(salida[3][1] > 0 && salida[3][1] < 1, 'se desvanece, no desaparece de golpe');
    assert.equal(salida.at(-1)[1], 0, 'a los 120 ms ya no se dibuja');
    ctx.reset();
    layer.draw(ctx, { ...f, units: [], now: 0.7 });
    assert.equal(textos(ctx).length, 0);
    assert.equal(layer.stats.fading, 0, 'el estado de fundido se libera');
  }
});

test('la pastilla está sobre la misma posición interpolada del sprite (pasada de dispositivo y LOW)', () => {
  const sy = (kind) => AY[kind];
  // pasada de dispositivo, s = 4: el sprite está en round(x·s) − ox, round(y·s) − oy
  let layer = crear();
  let ctx = createFakeCtx({ record: false });
  correr(layer, ctx, frame(), 0.3);
  let r = layer.rects[0];
  const X = Math.round(300.3 * 4) - 100;
  const Y = Math.round(200.6 * 4) - 50;
  assert.ok(Math.abs(r.x + r.w / 2 - X) <= 0.5, `centrada sobre el sprite (${r.x + r.w / 2} vs ${X})`);
  assert.equal(r.y + r.h, Y - sy('soldado') * 4 - 2 * 4, 'borde inferior un poco sobre la cabeza del sprite');
  // LOW con s fraccional: el sprite está en round(x)·s − ox
  layer = crear();
  ctx = createFakeCtx({ record: false });
  const s = 1.5;
  correr(layer, ctx, frame({ screen: { s, ox: 30, oy: 20, device: false, marks: false, x0: 20, y0: 13.3 } }), 0.3);
  r = layer.rects[0];
  assert.ok(Math.abs(r.x + r.w / 2 - (300 * s - 30)) <= 0.5);
  assert.equal(r.y + r.h, Math.round(201 * s - 20 - sy('soldado') * s - 8));
  // con marcas el borde inferior queda sobre la marca (2 px de alto y 1 de contorno)
  layer = crear();
  const abajo = unit(0, 'ana', 5, 300.3, 600.6);
  correr(
    layer,
    ctx,
    frame({ units: [abajo], screen: { s: 0.8, ox: 0, oy: 0, device: false, marks: true, x0: 0, y0: 0 } }),
    0.3,
  );
  r = layer.rects[0];
  assert.equal(r.y + r.h, Math.round(601 * 0.8 - 3 * 0.8 - 8));
  // la interpolación: con alpha 0,5 usa el punto medio entre el paso anterior y el actual
  layer = crear();
  const u = unit(0, 'ana', 5, 310, 210, { px: 300, py: 200 });
  correr(layer, ctx, frame({ units: [u], alpha: 0.5 }), 0.3);
  r = layer.rects[0];
  assert.ok(Math.abs(r.x + r.w / 2 - (Math.round(305 * 4) - 100)) <= 0.5);
});

test('tamaño fijo en px virtuales: la altura es 10·u y el ancho no cambia con el zoom; cabe en 110·u', () => {
  const ctx = createFakeCtx({ record: false });
  const anchos = new Set();
  for (const s of [1.333, 2, 3, 6]) {
    const layer = crear();
    // la unidad (300, 400) cae siempre en el mismo punto de pantalla, (800, 600)
    const x0 = 300 - 800 / s;
    const y0 = 400 - 600 / s;
    const screen = { s, ox: x0 * s, oy: y0 * s, device: false, marks: false, x0, y0 };
    correr(layer, ctx, frame({ screen, k: 6, units: [unit(0, 'ana', 5, 300, 400)] }), 0.3);
    const r = layer.rects[0];
    assert.equal(r.h, 40, `s = ${s}`);
    anchos.add(r.w);
  }
  assert.equal(anchos.size, 1, 'el mismo ancho a cualquier zoom');
  // nombres extremos en las dos escalas de interfaz
  const nombres = ['xX_el_mas_capo_del_live_Xx', '😀'.repeat(24), '田中太郎さんの動画チャンネル名前', 'ana_23', 'a'];
  for (const [W, H, u] of [
    [480, 270, 1],
    [1920, 1080, 4],
  ]) {
    for (const nombre of nombres) {
      const layer = crear({ registry: registro({ ana: { name: nombre, xp: 1 } }) });
      const f = frame({
        W,
        H,
        u,
        units: [unit(0, 'ana', 5, 200, 200)],
        screen: { s: u, ox: 0, oy: 0, device: false, marks: false, x0: 0, y0: 0 },
      });
      assert.doesNotThrow(() => correr(layer, ctx, f, 0.3), nombre);
      for (const r of layer.rects) assert.ok(r.w <= 110 * u, `${nombre} en u = ${u}: ${r.w}`);
    }
  }
});

test('ninguna etiqueta sube sobre y = 40·u (la banda del HUD)', () => {
  const ctx = createFakeCtx({ record: false });
  const layer = crear({ registry: registro({ a: { xp: 5 }, b: { xp: 4 }, c: { xp: 3 }, d: { xp: 1 } }) });
  const units = [
    unit(0, 'a', 5, 300, 40),
    unit(0, 'b', 5, 303, 41),
    unit(0, 'c', 5, 306, 39),
    unit(0, 'd', 5, 400, 200),
  ];
  correr(layer, ctx, frame({ units, screen: { s: 4, ox: 0, oy: 0, device: true, marks: false, x0: 0, y0: 0 } }), 0.3);
  assert.deepEqual(
    layer.rects.map((r) => r.key),
    ['d'],
    'las tres de la franja del HUD se descartan, no se bajan',
  );
  assert.equal(layer.stats.dropped, 3, 'y cuentan en las descartadas');
  for (const r of layer.rects) assert.ok(r.y >= 40 * 4, `y = ${r.y}`);
});

test('invalidate() vacía la caché de texto medido: la misma etiqueta se vuelve a medir (llega una fuente)', () => {
  const ctx = createFakeCtx({ record: false });
  const layer = crear();
  correr(layer, ctx, frame(), 0.3);
  const antes = layer.stats.measures;
  correr(layer, ctx, frame({ now: 5 }), 0.3);
  assert.equal(layer.stats.measures, antes, 'sin invalidar no mide otra vez');
  layer.invalidate();
  correr(layer, ctx, frame({ now: 10 }), 0.3);
  assert.equal(layer.stats.measures, antes + 1, 'después de invalidate() se mide de nuevo');
  correr(layer, ctx, frame({ now: 12 }), 0.3);
  assert.equal(layer.stats.measures, antes + 1);
});

test('ninguna etiqueta pisa el rectángulo proyectado de un ícono', () => {
  const ctx = createFakeCtx({ record: false });
  const reg = registro({ a: { name: 'a', xp: 3 }, b: { name: 'b', xp: 2 }, c: { name: 'c', xp: 1 } });
  const units = [unit(0, 'a', 5, 300, 200), unit(0, 'b', 5, 305, 200), unit(1, 'c', 5, 310, 200)];
  const descs = [{ x: 296, y: 170, w: 10, h: 8 }];
  const layer = crear({ registry: reg });
  correr(layer, ctx, frame({ units, icons: { descs, count: 1 } }), 0.3);
  const s = 4;
  const ic = { x: Math.round(296 * s) - 100, y: Math.round(170 * s) - 50, w: 10 * s, h: 8 * s };
  assert.ok(layer.rects.length >= 1);
  for (const r of layer.rects) {
    const pisa = r.x < ic.x + ic.w && ic.x < r.x + r.w && r.y < ic.y + ic.h && ic.y < r.y + r.h;
    assert.equal(pisa, false, r.key);
  }
});

test('el ranking se refresca a 5 Hz del reloj de vista; entre refrescos la XP guardada manda', () => {
  const usuarios = { a: { name: 'a', xp: 10 }, b: { name: 'b', xp: 5 } };
  const reg = registro(usuarios);
  const layer = crear({ registry: reg });
  const ctx = createFakeCtx({ record: false });
  const units = [unit(0, 'a', 5, 300, 200), unit(0, 'b', 5, 340, 200)];
  const f = frame({ units, k: 1 });
  // k = 1 → los 3 mejores por equipo: ambos son del mismo lado, el orden se ve en rects
  correr(layer, ctx, f, 0.05);
  assert.deepEqual(
    layer.rects.map((r) => r.key),
    ['a', 'b'],
  );
  usuarios.b.xp = 999; // b adelanta a a entre refrescos
  correr(layer, ctx, { ...f, now: 0.1 }, 0.05);
  assert.deepEqual(
    layer.rects.map((r) => r.key),
    ['a', 'b'],
    'antes de los 200 ms el orden guardado no cambia',
  );
  correr(layer, ctx, { ...f, now: 0.25 }, 0.1);
  assert.deepEqual(
    layer.rects.map((r) => r.key),
    ['b', 'a'],
  );
  const antes = layer.stats.refreshes;
  correr(layer, ctx, { ...f, now: 1 }, 1);
  assert.ok(layer.stats.refreshes - antes <= 6, `${layer.stats.refreshes - antes} refrescos en 1 s`);
});

test('la selección y el layout corren en cada cuadro: una unidad que se mueve arrastra su etiqueta', () => {
  const ctx = createFakeCtx({ record: false });
  const layer = crear();
  const u = unit(0, 'ana', 5, 300, 200);
  const f = frame({ units: [u] });
  correr(layer, ctx, f, 0.3);
  const x0 = layer.rects[0].x;
  u.px = u.x;
  u.x = 310; // avanza el sim 10 px de mundo
  correr(layer, ctx, { ...f, now: 0.4 }, 0.01);
  assert.equal(layer.rects[0].x - x0, 40, '10 px de mundo × s = 4');
});

test('estadísticas para F2: seleccionadas, dibujadas y descartadas por el layout', () => {
  const ctx = createFakeCtx({ record: false });
  const reg = registro({ a: { name: 'a', xp: 3 }, b: { name: 'b', xp: 2 } });
  const layer = crear({ registry: reg });
  correr(layer, ctx, frame({ units: [unit(0, 'a', 5, 300, 200), unit(0, 'b', 5, 300, 200)] }), 0.3);
  assert.equal(layer.stats.selected, 2);
  assert.equal(layer.stats.drawn + layer.stats.dropped, 2);
  const timer = { snapshot: () => ({ fps: 60, ms: { sim: 0, world: 0, ui: 0, fx: 0, work: 0 } }) };
  const modelo = f2Model({
    timer,
    stats: {
      particles: 0,
      drawCalls: 0,
      culled: 0,
      s: 1,
      mode: 'nearest',
      marks: false,
      devicePass: false,
      canvasesAllocated: 2,
    },
    counts: { units: 0, squads: 0, planes: 0, hits: 0 },
    bakeCount: 0,
    hash: '',
    labels: { drawn: 5, dropped: 2, selected: 7 },
    icons: { drawn: 11 },
  });
  const v = (key) => modelo.lines.find((l) => l.key === key)?.value;
  assert.equal(v('labels.drawn'), '5');
  assert.equal(v('labels.dropped'), '2');
  assert.equal(v('icons.drawn'), '11');
});

test('sin registro (?golden) no dibuja ni lanza; y la fuente usa la pila del diseño con la pixel primero', () => {
  const ctx = createFakeCtx({ record: true });
  const layer = crear({ registry: null });
  assert.doesNotThrow(() => correr(layer, ctx, frame(), 0.3));
  assert.equal(textos(ctx).length, 0);
  assert.match(LABEL_FONT.family, /^"Pixelify Sans".*system-ui, sans-serif$/);
});

test('la pastilla mide el texto más el borde, la forma y el espacio: 95 px con "CABO ana_23" a 5 px por letra y u = 4', () => {
  const ctx = createFakeCtx({ record: false });
  const layer = crear();
  correr(layer, ctx, frame(), 0.3);
  assert.equal(layer.rects[0].w, 11 * 5 + 10 * 4);
});

/** Copia de solo lectura: cualquier escritura en un objeto del sim lanza (patrón de 5c). */
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

test('la vista nunca escribe en el sim: selección, ranking y capa de etiquetas con un mundo de solo lectura', () => {
  const ctx = createFakeCtx({ record: false });
  const layer = crear({ registry: registro({ ana: { name: 'ana_23', xp: 10 } }) });
  const units = soloLectura([unit(0, 'ana', 5, 300, 200), unit(1, 'ana', 9, 320, 210)]);
  assert.doesNotThrow(() => correr(layer, ctx, frame({ units }), 0.5));
  assert.equal(layer.rects.length, 1);
});
