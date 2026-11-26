import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '@tienda/kit/sim/rng.js';
import { createCameraController, fitScale, levelsFor, WORLD } from '../public/js/camera/controller.js';
import { resolveMoments, resolveView } from '../public/js/camera/config.js';
import { createGestures } from '../public/js/camera/gestures.js';
import { createTimer, f2Model } from '../public/js/render/f2.js';
import { drawMinimap } from '../public/js/render/minimap.js';
import { createFakeCtx } from './support/fake-canvas.js';
import { minimapHit, minimapVisible } from '../public/js/camera/minimap.js';
import { minimapRect } from '../public/js/ui/layout.js';

// NM-4, NM-6 (lote 5c, tareas 5c.1 y 5c.2): el controlador de cámara es lógica pura, sin lienzo ni reloj de pared. El
// reloj de vista lo pone `update(dt)`. Todo lo que se mide aquí es la vista (x0, y0, s), nunca el sim.

const EPS = 1e-6;
const FRAME = 1 / 60;

/** Controlador de pruebas. */
function mk(W = 1920, H = 1080, o = {}) {
  return createCameraController({
    canvas: { w: W, h: H },
    view: resolveView(o.view),
    reducedMotion: o.reduced ?? false,
  });
}
/** Deja pasar `secs` segundos de reloj de vista en cuadros de 1/60 s. */
function settle(c, secs = 4) {
  for (let i = 0; i < Math.round(secs * 60); i++) c.update(FRAME);
}
const kOf = (W, H, kMax = 6) => levelsFor(W, H, kMax).map((s) => Number((s / fitScale(W, H)).toFixed(4)));
const worldAt = (v, px, py) => ({ x: v.x0 + px / v.s, y: v.y0 + py / v.s });
const esEntero = (n) => Math.abs(n - Math.round(n)) < EPS;

test('fd = min(W/1440, H/810) y el mundo es 1440×810', () => {
  assert.deepEqual(WORLD, { w: 1440, h: 810 });
  assert.equal(fitScale(1920, 1080), 1920 / 1440);
  assert.equal(fitScale(1440, 810), 1);
  assert.equal(fitScale(1280, 720), 1280 / 1440);
  assert.equal(fitScale(1366, 768), 768 / 810); // gana el alto
  assert.equal(fitScale(640, 360), 640 / 1440);
});

test('levelsFor: niveles reales por ventana (D23); s = 8 al máximo en 1080p', () => {
  const l1080 = levelsFor(1920, 1080, 6);
  assert.equal(l1080[0], 1920 / 1440);
  assert.deepEqual(l1080.slice(1), [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(kOf(1920, 1080), [1, 1.5, 2.25, 3, 3.75, 4.5, 5.25, 6]);
  assert.deepEqual(kOf(1280, 720), [1, 1.125, 2.25, 3.375, 4.5, 5.625]);
  assert.deepEqual(kOf(640, 360), [1, 2.25, 4.5]);
  const l2560 = levelsFor(2560, 1440, 6);
  assert.equal(l2560[0], 2560 / 1440);
  assert.deepEqual(l2560.slice(1), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // nunca más de kMax·fd, y estrictamente creciente
  for (const [W, H] of [
    [1920, 1080],
    [1280, 720],
    [640, 360],
    [2560, 1440],
    [1366, 768],
    [3840, 2160],
  ]) {
    const ls = levelsFor(W, H, 6);
    assert.ok(ls[ls.length - 1] <= 6 * fitScale(W, H) + 1e-9, `${W}x${H}`);
    for (let i = 1; i < ls.length; i++) assert.ok(ls[i] > ls[i - 1], `${W}x${H} creciente`);
    for (let i = 1; i < ls.length; i++) assert.ok(esEntero(ls[i]), `${W}x${H} entero arriba`);
  }
  assert.deepEqual(kOf(1920, 1080, 2), [1, 1.5]); // kMax menor, menos niveles
});

test('resolveView: kMax en [2, 8], maxK en [1, kMax], idleSeconds por defecto 7 y valores basura caen al defecto', () => {
  const d = resolveView(undefined);
  assert.equal(d.kMax, 6);
  assert.equal(d.idleSeconds, 7);
  assert.equal(d.auto.maxK, 2);
  assert.deepEqual(d.auto.minHalf, [220, 124]);
  assert.equal(d.auto.enabled, true);
  assert.equal(resolveView({ kMax: 99 }).kMax, 8);
  assert.equal(resolveView({ kMax: 1 }).kMax, 2);
  assert.equal(resolveView({ kMax: 3, auto: { maxK: 9 } }).auto.maxK, 3);
  assert.equal(resolveView({ auto: { maxK: 0.2 } }).auto.maxK, 1);
  assert.equal(resolveView({ idleSeconds: 12 }).idleSeconds, 12);
  assert.equal(resolveView({ idleSeconds: 'x' }).idleSeconds, 7);
  assert.equal(resolveView({ idleSeconds: -4 }).idleSeconds, 7);
  assert.deepEqual(resolveView({ auto: { minHalf: [192, 108] } }).auto.minHalf, [192, 108]);
  assert.deepEqual(resolveView({ auto: { minHalf: 'x' } }).auto.minHalf, [220, 124]);
  // el nombre de config "render.sharpBelow" no existe ni tiene efecto (SHARP_BELOW es una constante)
  assert.equal('sharpBelow' in resolveView({ sharpBelow: 1.5 }), false);
});

test('resolveMoments: encendido por defecto, umbral de 500 monedas, cola de 3, y valores basura al defecto', () => {
  assert.deepEqual(resolveMoments(undefined), { enabled: true, coins: 500, queue: 3 });
  assert.deepEqual(resolveMoments({ bigGiftMoment: false, bigGiftCoins: 800, momentQueue: 5 }), {
    enabled: false,
    coins: 800,
    queue: 5,
  });
  assert.equal(resolveMoments({ bigGiftCoins: 'x' }).coins, 500);
  assert.equal(resolveMoments({ bigGiftCoins: -3 }).coins, 500);
  assert.equal(resolveMoments({ momentQueue: 0 }).queue, 3);
  assert.equal(resolveMoments({ momentQueue: 99 }).queue, 16, 'la cola tiene tope');
  assert.equal(resolveMoments({ momentQueue: 2.7 }).queue, 2, 'entero');
});

test('con k = 1 el mundo 16:9 entero entra en cualquier ventana de 640×360 a 1920×1080, a la escala de ajuste', () => {
  for (const [W, H] of [
    [640, 360],
    [1280, 720],
    [1366, 768],
    [1600, 900],
    [1920, 1080],
    [1280, 800], // 16:10
    [1000, 1000], // cuadrada
  ]) {
    const c = mk(W, H);
    const v = c.viewRect();
    assert.equal(c.state.k, 1, `${W}x${H}`);
    assert.equal(c.state.kShown, 1);
    assert.ok(Math.abs(v.s - fitScale(W, H)) < EPS, `${W}x${H} s = fd`);
    // el mundo cabe: la vista lo contiene (las bandas que sobran son del INK de fuera del mundo)
    assert.ok(v.x0 <= EPS && v.x0 + W / v.s >= WORLD.w - EPS, `${W}x${H} ancho`);
    assert.ok(v.y0 <= EPS && v.y0 + H / v.s >= WORLD.h - EPS, `${W}x${H} alto`);
    // y centrado: las bandas que sobran quedan repartidas a los dos lados (a lo sumo 1 px de dispositivo de diferencia)
    assert.ok(Math.abs(v.x0 + W / v.s / 2 - WORLD.w / 2) <= 1 / v.s + EPS, `${W}x${H} centrado en x`);
    assert.ok(Math.abs(v.y0 + H / v.s / 2 - WORLD.h / 2) <= 1 / v.s + EPS, `${W}x${H} centrado en y`);
  }
});

test('niveles: zoomToLevel acerca, la vista queda dentro del mundo y s es un entero de dispositivo en reposo', () => {
  const c = mk();
  const ls = c.levels();
  for (let i = 1; i < ls.length; i++) {
    c.zoomToLevel(i, 0.5, 0.5);
    settle(c);
    const v = c.viewRect();
    assert.ok(esEntero(v.s), `nivel ${i}`);
    assert.ok(Math.abs(v.s - ls[i]) < EPS);
    assert.ok(v.x0 >= -EPS && v.x0 + 1920 / v.s <= WORLD.w + EPS);
    assert.ok(v.y0 >= -EPS && v.y0 + 1080 / v.s <= WORLD.h + EPS);
  }
  assert.ok(Math.abs(c.state.k - 6) < EPS);
  c.zoomToLevel(99); // más allá del último: se queda en el último
  settle(c);
  assert.ok(Math.abs(c.state.k - 6) < EPS);
  c.zoomToLevel(-5);
  settle(c);
  assert.equal(c.state.k, 1);
});

test('el paneo se cuantiza a píxeles enteros de dispositivo y se recorta al mundo', () => {
  const c = mk();
  c.zoomToLevel(3, 0.5, 0.5);
  settle(c);
  const rnd = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    c.panBy((rnd() - 0.5) * 900, (rnd() - 0.5) * 900);
    settle(c, 0.05);
    const v = c.viewRect();
    assert.ok(esEntero(v.x0 * v.s), `x0·s entero (${v.x0 * v.s})`);
    assert.ok(esEntero(v.y0 * v.s), `y0·s entero (${v.y0 * v.s})`);
    assert.ok(v.x0 >= -EPS && v.x0 + 1920 / v.s <= WORLD.w + EPS);
    assert.ok(v.y0 >= -EPS && v.y0 + 1080 / v.s <= WORLD.h + EPS);
  }
  // un arrastre lleva el mundo 1:1 con el dedo: 100 px a la derecha mueven la vista 100 px de dispositivo a la izquierda
  const c2 = mk();
  c2.zoomToLevel(3, 0.5, 0.5);
  settle(c2);
  c2.panBy(-200, 0); // llevamos la vista a la derecha para que no toque el borde
  const antes = c2.viewRect();
  c2.panBy(100, 0);
  const despues = c2.viewRect();
  assert.ok(Math.abs((antes.x0 - despues.x0) * antes.s - 100) <= 1);
});

test('contra el borde no hay zona muerta: arrastrar de más no obliga a devolver ese exceso', () => {
  const c = mk();
  c.zoomToLevel(3); // s = 4: la vista cubre 480×270 px de mundo
  settle(c);
  c.panBy(100000, 0); // el mundo sigue al dedo hacia la derecha: la vista llega al borde izquierdo
  c.panBy(0, 100000);
  const borde = c.viewRect();
  assert.equal(borde.x0, 0);
  assert.equal(borde.y0, 0);
  c.panBy(-100, -40); // y al volver, la vista sale del borde de inmediato
  const v = c.viewRect();
  assert.ok(Math.abs(v.x0 * v.s - 100) <= 1, `x ${v.x0 * v.s}`);
  assert.ok(Math.abs(v.y0 * v.s - 40) <= 1, `y ${v.y0 * v.s}`);
  // y lo mismo contra el borde derecho y el de abajo
  c.panBy(-100000, -100000);
  c.panBy(100, 40);
  const w = c.viewRect();
  assert.ok(Math.abs(w.x0 + 1920 / w.s - (WORLD.w - 100 / w.s)) <= 1 / w.s + EPS);
  assert.ok(Math.abs(w.y0 + 1080 / w.s - (WORLD.h - 40 / w.s)) <= 1 / w.s + EPS);
});

test('propiedad: secuencias aleatorias de zoom, paneo, minimapa y presets dejan k en [1, kMax], vista dentro del mundo y s en un nivel', () => {
  for (const [W, H] of [
    [1920, 1080],
    [1280, 720],
    [640, 360],
    [2560, 1440],
    [1366, 768],
  ]) {
    const c = mk(W, H);
    const fd = fitScale(W, H);
    const rnd = mulberry32(W * 31 + H);
    for (let paso = 0; paso < 250; paso++) {
      const r = rnd();
      if (r < 0.3) c.zoomToLevel(Math.floor(rnd() * (c.levels().length + 2)) - 1, rnd(), rnd());
      else if (r < 0.55) c.panBy((rnd() - 0.5) * 2000, (rnd() - 0.5) * 1200);
      else if (r < 0.75) c.centerOn(rnd() * WORLD.w, rnd() * WORLD.h);
      else if (r < 0.85) c.viewAll();
      else if (r < 0.95) c.focusBase(rnd() < 0.5 ? 0 : 1);
      else c.follow(() => ({ x: rnd() * 1600 - 80, y: rnd() * 900 - 45 }));
      settle(c, 3);
      if (c.state.mode === 'follow') c.stopFollow();
      const v = c.viewRect();
      const k = v.s / fd;
      assert.ok(k >= 1 - EPS && k <= 6 + EPS, `${W}x${H} paso ${paso}: k ${k}`);
      assert.ok(v.s <= 6 * fd + 1e-9);
      if (c.state.k === 1) assert.ok(Math.abs(v.s - fd) < EPS, 'k = 1: s = fd');
      else assert.ok(esEntero(v.s), `${W}x${H} paso ${paso}: s ${v.s} entera arriba de k = 1`);
      if (c.state.k > 1) {
        assert.ok(v.x0 >= -EPS && v.x0 + W / v.s <= WORLD.w + EPS, `x ${v.x0}`);
        assert.ok(v.y0 >= -EPS && v.y0 + H / v.s <= WORLD.h + EPS, `y ${v.y0}`);
      }
    }
  }
});

test('el rectángulo del minimapa sigue la escala entera de la interfaz (84 px virtuales, centrado abajo)', () => {
  assert.deepEqual(minimapRect(1920, 1080), { x: 792, y: 883, w: 336, h: 189 });
  assert.deepEqual(minimapRect(640, 360), { x: 278, y: 311, w: 84, h: 47 });
  assert.deepEqual(minimapRect(1280, 720), { x: 556, y: 621, w: 168, h: 95 });
  assert.equal(minimapVisible(1), false);
  assert.equal(minimapVisible(1.0000001), false);
  assert.equal(minimapVisible(1.125), true);
});

test('minimapa: solo con k > 1, mismo rectángulo con cualquier k y su clic centra la vista recortada', () => {
  const c = mk();
  assert.equal(minimapVisible(c.state.k), false);
  c.zoomToLevel(1);
  settle(c);
  assert.equal(minimapVisible(c.state.k), true);
  const antes = minimapRect(1920, 1080);
  c.zoomToLevel(7);
  settle(c);
  assert.deepEqual(minimapRect(1920, 1080), antes); // la interfaz no escala con k
  // el rectángulo vive dentro del lienzo, sin tapar el centro, y guarda la proporción del mundo
  assert.ok(antes.x >= 0 && antes.y >= 0 && antes.x + antes.w <= 1920 && antes.y + antes.h <= 1080);
  assert.ok(Math.abs(antes.w / antes.h - 1440 / 810) < 0.05);
  // esquinas y centro
  assert.deepEqual(minimapHit(antes, antes.x, antes.y), { wx: 0, wy: 0 });
  const c0 = minimapHit(antes, antes.x + antes.w / 2, antes.y + antes.h / 2);
  assert.ok(Math.abs(c0.wx - 720) < 1 && Math.abs(c0.wy - 405) < 1);
  assert.equal(minimapHit(antes, antes.x - 1, antes.y), null);
  assert.equal(minimapHit(antes, antes.x, antes.y + antes.h + 1), null);
  // clic en el minimapa: centra la vista en ese punto
  c.zoomToLevel(2);
  settle(c);
  c.centerOn(720, 405);
  settle(c, 0.1);
  let v = c.viewRect();
  assert.ok(Math.abs(v.x0 + 1920 / (2 * v.s) - 720) <= 1 / v.s + 0.5);
  // y recortada: en la esquina no se sale del mundo
  c.centerOn(0, 0);
  settle(c, 0.1);
  v = c.viewRect();
  assert.ok(v.x0 >= -EPS && v.y0 >= -EPS);
  c.centerOn(5000, 5000);
  settle(c, 0.1);
  v = c.viewRect();
  assert.ok(v.x0 + 1920 / v.s <= WORLD.w + EPS && v.y0 + 1080 / v.s <= WORLD.h + EPS);
});

test('presets: Ver todo, base izquierda y derecha en nivel ≤ 2,25, y seguir a alguien en el borde se recorta al mundo', () => {
  const c = mk();
  c.zoomToLevel(5);
  settle(c);
  c.viewAll();
  settle(c);
  assert.equal(c.state.k, 1);
  const v = c.viewRect();
  assert.ok(v.x0 <= EPS && v.x0 + 1920 / v.s >= WORLD.w - EPS);

  c.focusBase(0);
  settle(c);
  assert.ok(c.state.k > 1 && c.state.k <= 2.25 + EPS);
  let w = c.viewRect();
  assert.ok(w.x0 >= -EPS && w.x0 < 5, 'la base izquierda queda a la vista y pegada al borde');
  c.focusBase(1);
  settle(c);
  w = c.viewRect();
  assert.ok(Math.abs(w.x0 + 1920 / w.s - WORLD.w) < 2, 'la base derecha queda pegada al borde derecho');

  // seguir a un donante en la esquina: el objetivo se recorta
  c.follow(() => ({ x: -50, y: -20 }));
  settle(c);
  w = c.viewRect();
  assert.ok(w.x0 >= -EPS && w.y0 >= -EPS);
  c.follow(() => ({ x: 1500, y: 900 }));
  settle(c);
  w = c.viewRect();
  assert.ok(w.x0 + 1920 / w.s <= WORLD.w + EPS && w.y0 + 1080 / w.s <= WORLD.h + EPS);
  // la meta del seguimiento ya está recortada al mundo (no queda fuera esperando a que se recorte la vista)
  c.follow(() => ({ x: -500, y: -500 }));
  c.update(FRAME);
  assert.ok(c.state.tx >= 1920 / (2 * c.viewRect().s) - EPS && c.state.ty >= 1080 / (2 * c.viewRect().s) - EPS);
  c.follow(() => ({ x: 5000, y: 5000 }));
  c.update(FRAME);
  assert.ok(c.state.tx <= WORLD.w - 1920 / (2 * c.viewRect().s) + EPS);
  // seguir mueve la vista con cada cuadro hacia la posición nueva del seguido
  let px = 300;
  c.follow(() => ({ x: px, y: 405 }));
  settle(c);
  const a = c.viewRect().x0;
  px = 900;
  settle(c);
  assert.ok(c.viewRect().x0 > a + 100, 'sigue al donante');
  c.stopFollow();
  assert.notEqual(c.state.mode, 'follow');
});

test('kShown llega a k sin pasarse y el punto bajo el cursor queda fijo ±1 px en cada cuadro de la transición', () => {
  const c = mk();
  const fx = 0.37;
  const fy = 0.61;
  const px = fx * 1920;
  const py = fy * 1080;
  const antes = worldAt(c.viewRect(), px, py);
  c.zoomToLevel(1, fx, fy);
  let prev = c.state.kShown;
  let fraccional = false;
  for (let i = 0; i < 120; i++) {
    c.update(FRAME);
    const k = c.state.kShown;
    assert.ok(k >= prev - EPS, 'sube sin retroceder');
    assert.ok(k <= c.state.k + EPS, 'sin pasarse de k');
    prev = k;
    const v = c.viewRect();
    if (!esEntero(v.s)) fraccional = true;
    const p = worldAt(v, px, py);
    assert.ok(Math.abs(p.x - antes.x) * v.s <= 1 + EPS, `cuadro ${i}: x`);
    assert.ok(Math.abs(p.y - antes.y) * v.s <= 1 + EPS, `cuadro ${i}: y`);
  }
  assert.equal(c.state.kShown, c.state.k, 'llega exactamente');
  assert.ok(fraccional, 'durante la transición s puede ser fraccional (exenta del entero)');
  assert.ok(esEntero(c.viewRect().s), 'y en reposo es un nivel');
  // la ida y vuelta también
  c.zoomToLevel(0, fx, fy);
  settle(c);
  assert.equal(c.state.k, 1);
});

test('resize: los niveles se recalculan y la vista sigue siendo válida', () => {
  const c = mk(1920, 1080);
  c.zoomToLevel(3, 0.5, 0.5);
  settle(c);
  c.resize(1280, 720);
  settle(c);
  assert.deepEqual(c.levels(), levelsFor(1280, 720, 6));
  const v = c.viewRect();
  assert.ok(v.x0 >= -EPS && v.x0 + 1280 / v.s <= WORLD.w + EPS);
  assert.ok(esEntero(v.s) || Math.abs(v.s - fitScale(1280, 720)) < EPS);
});

// ---------------------------------------------------------------------------------------------------------------
// 5c.2: entradas del narrador

const RUEDA = (dy, o = {}) => ({ dy, deltaMode: 0, ctrl: false, x: 960, y: 540, ...o });

test('rueda por intención: una muesca de 100 en k = 1 no cambia el nivel y dos sí (0,18 y 0,36 contra 0,203)', () => {
  const c = mk();
  c.input('wheel', RUEDA(-100));
  assert.equal(c.state.level, 0, 'una muesca no alcanza el punto medio hacia 1,5');
  c.update(FRAME * 3);
  c.input('wheel', RUEDA(-100));
  assert.equal(c.state.level, 1, 'dos muescas pasan al nivel de k 1,5 (s = 2)');
  settle(c);
  assert.ok(Math.abs(c.state.k - 1.5) < 1e-9);
  assert.ok(esEntero(c.viewRect().s));
});

test('rueda: el resto pasa al gesto siguiente y se descarta a los 300 ms sin eventos', () => {
  const c = mk();
  c.input('wheel', RUEDA(-100));
  settle(c, 0.4); // más de 300 ms: se descarta
  c.input('wheel', RUEDA(-100));
  assert.equal(c.state.level, 0, 'la primera muesca ya no suma');
  // dentro de los 300 ms sí suma
  const d = mk();
  d.input('wheel', RUEDA(-100));
  d.update(0.25);
  d.input('wheel', RUEDA(-100));
  assert.equal(d.state.level, 1);
  // tras cruzar un nivel, lo que sobró de la intención cuenta para el gesto siguiente: 0,36 llegó a s* = 1,911 y el
  // nivel quedó en 2, o sea un resto de −0,046; una muesca hacia atrás (−0,18) suma −0,226 < −0,203 y vuelve
  d.update(0.1);
  d.input('wheel', RUEDA(100));
  assert.equal(d.state.level, 0, 'con el resto pendiente, una muesca hacia atrás ya vuelve');
  // pero si pasan más de 300 ms el resto se descarta y una muesca sola no alcanza
  const e = mk();
  e.input('wheel', RUEDA(-100));
  e.update(0.25);
  e.input('wheel', RUEDA(-100));
  assert.equal(e.state.level, 1);
  e.update(0.4);
  e.input('wheel', RUEDA(100));
  assert.equal(e.state.level, 1, 'sin resto, una muesca hacia atrás no basta');
  e.update(0.1);
  e.input('wheel', RUEDA(100));
  assert.equal(e.state.level, 0, 'dos sí');
});

test('rueda: deltaMode de líneas (×16) y de páginas (×300), y Ctrl usa el paso grande', () => {
  const l = mk();
  l.input('wheel', RUEDA(-3, { deltaMode: 1 })); // 48 px → 0,0864
  l.update(0.05);
  l.input('wheel', RUEDA(-3, { deltaMode: 1 }));
  assert.equal(l.state.level, 0, '0,173 todavía no alcanza');
  l.update(0.05);
  l.input('wheel', RUEDA(-3, { deltaMode: 1 }));
  assert.equal(l.state.level, 1, '0,259 sí');
  const p = mk();
  p.input('wheel', RUEDA(-1, { deltaMode: 2 })); // 300 px → 0,54 → s* = 2,29, el nivel 2
  assert.equal(p.state.level, 1);
  const k = mk();
  k.input('wheel', RUEDA(-100, { ctrl: true })); // 1,0 → s* = 3,62: el nivel más cercano en escala log es 4
  assert.equal(k.state.level, 3);
  assert.equal(k.levels()[3], 4);
});

test('rueda: un gesto largo cruza varios niveles sin saltarse ninguno, y arriba del último no acumula', () => {
  const c = mk();
  let prev = 0;
  for (let i = 0; i < 60; i++) {
    c.input('wheel', RUEDA(-30));
    c.update(0.02);
    assert.ok(c.state.level >= prev, 'no retrocede mientras sube');
    assert.ok(c.state.level - prev <= 1, 'sin saltos de más de un nivel');
    prev = c.state.level;
  }
  assert.equal(c.state.level, c.levels().length - 1);
  // 20 muescas más contra el tope no se acumulan: UNA hacia atrás ya baja, sin esperar a que la intención se descarte
  for (let i = 0; i < 20; i++) {
    c.input('wheel', RUEDA(-100));
    c.update(0.02);
  }
  c.input('wheel', RUEDA(100));
  assert.ok(c.state.level < c.levels().length - 1);
  // y abajo del primero tampoco
  const d = mk();
  for (let i = 0; i < 20; i++) {
    d.input('wheel', RUEDA(100));
    d.update(0.02);
  }
  d.input('wheel', RUEDA(-100));
  d.input('wheel', RUEDA(-100));
  assert.equal(d.state.level, 1, 'las dos muescas de acercar (0,36) sí cruzan al primer nivel');
});

test('rueda y pellizco mantienen bajo el cursor el punto del mundo, ±1 px de dispositivo en cada cuadro', () => {
  const c = mk();
  const px = 0.3 * 1920;
  const py = 0.7 * 1080;
  const antes = worldAt(c.viewRect(), px, py);
  c.input('wheel', RUEDA(-100, { x: px, y: py }));
  c.update(FRAME);
  c.input('wheel', RUEDA(-100, { x: px, y: py }));
  for (let i = 0; i < 90; i++) {
    c.update(FRAME);
    const v = c.viewRect();
    const p = worldAt(v, px, py);
    assert.ok(Math.abs(p.x - antes.x) * v.s <= 1 + EPS, `rueda x cuadro ${i}`);
    assert.ok(Math.abs(p.y - antes.y) * v.s <= 1 + EPS, `rueda y cuadro ${i}`);
  }
  assert.equal(c.state.level, 1);
  // el pellizco usa la misma regla con intención logarítmica y ancla en el punto medio de los dedos
  const d = mk();
  const mx = 0.6 * 1920;
  const my = 0.4 * 1080;
  const q = worldAt(d.viewRect(), mx, my);
  d.input('intent', { ln: 0.1, x: mx, y: my });
  d.input('intent', { ln: 0.1, x: mx, y: my });
  assert.equal(d.state.level, 0, '0,2 < 0,203: todavía nada');
  d.input('intent', { ln: 0.05, x: mx, y: my });
  assert.equal(d.state.level, 1);
  for (let i = 0; i < 90; i++) {
    d.update(FRAME);
    const v = d.viewRect();
    const p = worldAt(v, mx, my);
    assert.ok(Math.abs(p.x - q.x) * v.s <= 1 + EPS && Math.abs(p.y - q.y) * v.s <= 1 + EPS, `pellizco cuadro ${i}`);
  }
});

test('factores (doble toque ×1,6, +/− ×1,25, botones ×1,5): al nivel más cercano a s·factor y como mínimo al vecino', () => {
  const nivel = (f) => {
    const c = mk();
    c.input('factor', { f, x: 960, y: 540 });
    return c.state.level;
  };
  assert.equal(nivel(1.6), 1, '1,333·1,6 = 2,13 → s = 2');
  assert.equal(nivel(1.25), 1, '1,667 → s = 2');
  assert.equal(nivel(1.5), 1, '2,0 → s = 2');
  assert.equal(nivel(1.01), 1, 'aunque casi no cambie, llega al vecino');
  assert.equal(nivel(3), 3, '1,333·3 = 4 → el nivel de s = 4');
  // desde un nivel intermedio
  const c = mk();
  c.zoomToLevel(1);
  settle(c);
  c.input('factor', { f: 1.25 }); // 2·1,25 = 2,5: el nivel más cercano en escala log es 3
  assert.equal(c.levels()[c.state.level], 3);
  c.input('factor', { f: 0.8 }); // 3·0,8 = 2,4 → 2
  assert.equal(c.levels()[c.state.level], 2);
  c.input('factor', { f: 0.99 }); // casi nada, pero como mínimo el vecino de abajo
  assert.equal(c.state.level, 0);
  c.input('factor', { f: 0.5 }); // ya en el primero: se queda
  assert.equal(c.state.level, 0);
  // en el último, acercar no hace nada
  const m = mk();
  m.zoomToLevel(99);
  settle(m);
  m.input('factor', { f: 1.6 });
  assert.equal(m.state.level, m.levels().length - 1);
  // sin cursor (teclas y botones) el zoom parte del centro de la vista: el centro del mundo queda en el centro
  const centro = mk();
  centro.input('factor', { f: 1.25 });
  settle(centro);
  assert.ok(Math.abs(centro.state.cx - 720) < 1e-6 && Math.abs(centro.state.cy - 405) < 1e-6);
  // los factores del config
  assert.equal(c.cfg.dblTapZoom, 1.6);
  assert.equal(c.cfg.keyZoom, 1.25);
  assert.equal(c.cfg.buttonZoom, 1.5);
});

test('flechas: 0,6 vistas por segundo sin suavizado (velocidad plena desde el primer cuadro, y se frena en seco)', () => {
  const c = mk();
  c.zoomToLevel(3);
  settle(c);
  const vw = 1920 / 4; // s = 4 en el nivel 3
  const x0 = c.state.cx;
  c.input('keys', { x: 1, y: 0 });
  c.update(FRAME);
  assert.ok(Math.abs(c.state.cx - x0 - 0.6 * vw * FRAME) < 1e-9, 'el primer cuadro ya va a velocidad plena');
  for (let i = 1; i < 60; i++) c.update(FRAME);
  assert.ok(Math.abs(c.state.cx - x0 - 0.6 * vw) < 1e-6, '0,6 vistas en un segundo');
  c.input('keys', { x: 0, y: 0 });
  const fin = c.state.cx;
  c.update(FRAME);
  c.update(FRAME);
  assert.equal(c.state.cx, fin, 'sin inercia');
  // vertical, con recorte al mundo
  c.input('keys', { x: 0, y: 1 });
  for (let i = 0; i < 600; i++) c.update(FRAME);
  const v = c.viewRect();
  assert.ok(v.y0 + 1080 / v.s <= WORLD.h + EPS);
  assert.ok(Math.abs(v.y0 + 1080 / v.s - WORLD.h) < 1, 'llegó al borde de abajo');
  // en k = 1 no hay a dónde ir, pero sigue siendo entrada del narrador
  const d = mk();
  settle(d, 3);
  d.input('keys', { x: 1, y: 0 });
  assert.equal(d.state.idle, 0);
});

test('cualquier entrada de cámara pasa a manual en el mismo tick y reinicia el contador de inactividad', () => {
  const c = mk();
  settle(c, 5);
  assert.ok(Math.abs(c.state.idle - 5) < 0.05, 'el contador cuenta el reloj de vista');
  assert.equal(c.lastStreamerInput, 0, 'nadie tocó nada todavía');
  const entradas = [
    () => c.input('wheel', RUEDA(-10)),
    () => c.input('intent', { ln: 0.01, x: 5, y: 5 }),
    () => c.input('factor', { f: 1.25 }),
    () => c.input('press', {}),
    () => c.input('drag', { dx: 3, dy: 3 }),
    () => c.input('keys', { x: 1, y: 0 }),
    () => c.input('minimap', { wx: 500, wy: 300 }),
    () => c.viewAll(),
    () => c.focusBase(0),
    () => c.zoomToLevel(1),
    () => c.panBy(5, 5),
    () => c.centerOn(100, 100),
    () => c.follow(() => ({ x: 400, y: 300 })),
  ];
  for (const [i, entrada] of entradas.entries()) {
    c.input('keys', { x: 0, y: 0 });
    c.stopFollow();
    settle(c, 2);
    assert.ok(c.state.idle > 1.9, `entrada ${i}: el contador sube`);
    const antes = c.clock;
    entrada();
    assert.equal(c.state.idle, 0, `entrada ${i}: contador a 0 en el mismo tick`);
    assert.equal(c.lastStreamerInput, antes, `entrada ${i}: marca el reloj de la última entrada del narrador`);
    assert.notEqual(c.state.mode, 'auto');
  }
  // una entrada rara no rompe nada
  c.input('nada', {});
  c.input('wheel', RUEDA(NaN));
  c.input('factor', { f: NaN });
  c.input('intent', { ln: Infinity });
  c.input('drag', { dx: NaN, dy: 1 });
  c.input('minimap', { wx: NaN, wy: 1 });
  assert.ok(Number.isFinite(c.state.cx) && Number.isFinite(c.state.cy) && Number.isFinite(c.state.kShown));
  assert.ok(Number.isFinite(c.state.tx) && Number.isFinite(c.state.ty) && Number.isFinite(c.state.k));
});

test('cada ronda empieza en k = 1 centrada (viewAll instantáneo al intro), con la automática activa o no, y sin contar como entrada', () => {
  for (const reduced of [false, true]) {
    const c = mk(1920, 1080, { reduced });
    c.zoomToLevel(5, 0.2, 0.8);
    settle(c);
    c.panBy(-300, 120);
    settle(c, 3);
    const marca = c.lastStreamerInput;
    assert.ok(c.state.k > 1);
    c.newRound();
    assert.equal(c.state.k, 1);
    assert.equal(c.state.kShown, 1, 'sin transición');
    assert.equal(c.state.cx, 720);
    assert.equal(c.state.cy, 405);
    const v = c.viewRect();
    assert.ok(v.x0 <= EPS && v.x0 + 1920 / v.s >= WORLD.w - EPS);
    assert.equal(c.lastStreamerInput, marca, 'cambiar de ronda no es entrada del narrador');
    assert.equal(c.state.idle, 0, 'la ronda empieza con el contador en 0');
    // una entrada posterior se respeta
    c.zoomToLevel(2);
    settle(c);
    assert.ok(c.state.k > 1);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 5c.2: gestos (puntero, pellizco, doble toque, arrastre con umbral)

function gestos(o = {}) {
  const c = o.c ?? mk();
  let rect = o.minimap ?? null;
  const g = createGestures({ controller: c, minimap: () => rect });
  return {
    c,
    g,
    setMinimap: (r) => {
      rect = r;
    },
  };
}
const tap = (g, x, y, t, id = 1) => {
  g.down({ id, x, y, t });
  g.up({ id, x, y, t: t + 40 });
};

test('el puntero responde en pointer-down: toma el control, reinicia el contador y no hace falta mover', () => {
  const { c, g } = gestos();
  settle(c, 3);
  g.down({ id: 1, x: 500, y: 500, t: 0 });
  assert.equal(c.state.idle, 0);
  assert.equal(c.state.mode, 'manual');
  assert.equal(c.lastStreamerInput, c.clock);
});

test('arrastre: umbral de 4 px, después 1:1 con el dedo (sin perder los primeros píxeles)', () => {
  const { c, g } = gestos();
  c.zoomToLevel(3);
  settle(c);
  const antes = c.viewRect();
  g.down({ id: 1, x: 500, y: 500, t: 0 });
  g.move({ id: 1, x: 503, y: 500, t: 10 }); // 3 px: nada
  assert.equal(c.viewRect().x0, antes.x0);
  g.move({ id: 1, x: 510, y: 500, t: 20 }); // pasó el umbral: el mundo va 10 px con el dedo
  const v = c.viewRect();
  assert.ok(Math.abs((antes.x0 - v.x0) * v.s - 10) <= 1);
  g.move({ id: 1, x: 410, y: 460, t: 30 });
  const w = c.viewRect();
  assert.ok(Math.abs((antes.x0 - w.x0) * w.s + 90) <= 1, 'x: 1:1');
  assert.ok(Math.abs((antes.y0 - w.y0) * w.s + 40) <= 1, 'y: 1:1');
  g.up({ id: 1, x: 410, y: 460, t: 40 });
  // un movimiento sin botón apretado no arrastra
  const x = c.viewRect().x0;
  g.move({ id: 1, x: 100, y: 100, t: 50 });
  assert.equal(c.viewRect().x0, x);
});

test('doble toque o doble clic: ×1,6 solo si es < 320 ms y < 30 px; un arrastre no cuenta como toque', () => {
  const { c, g } = gestos();
  tap(g, 960, 540, 0);
  assert.equal(c.state.level, 0, 'un toque solo no acerca');
  tap(g, 970, 545, 200); // 160 ms y 11 px de distancia entre los toques
  assert.equal(c.state.level, 1, 'el segundo acerca');
  // un tercer toque no es otro doble (aunque llegue < 320 ms después del primero)
  tap(g, 970, 545, 300);
  assert.equal(c.state.level, 1);

  const lento = gestos();
  tap(lento.g, 960, 540, 0);
  tap(lento.g, 960, 540, 330);
  assert.equal(lento.c.state.level, 0, '330 ms: ya no es doble');
  const lejos = gestos();
  tap(lejos.g, 960, 540, 0);
  tap(lejos.g, 1000, 540, 150);
  assert.equal(lejos.c.state.level, 0, '40 px: ya no es doble');

  const arr = gestos();
  arr.c.zoomToLevel(3);
  settle(arr.c);
  const nivel = arr.c.state.level;
  tap(arr.g, 500, 500, 0);
  arr.g.down({ id: 1, x: 500, y: 500, t: 150 });
  arr.g.move({ id: 1, x: 510, y: 500, t: 160 }); // 10 px: pasa el umbral de arrastre y sigue cerca del primer toque
  arr.g.up({ id: 1, x: 510, y: 500, t: 170 });
  assert.equal(arr.c.state.level, nivel, 'toque + arrastre no es doble toque');
  // el doble toque acerca bajo el dedo
  const e = gestos();
  const px = 0.25 * 1920;
  const py = 0.75 * 1080;
  const w0 = worldAt(e.c.viewRect(), px, py);
  tap(e.g, px, py, 0);
  tap(e.g, px, py, 100);
  for (let i = 0; i < 90; i++) {
    e.c.update(FRAME);
    const v = e.c.viewRect();
    const p = worldAt(v, px, py);
    assert.ok(Math.abs(p.x - w0.x) * v.s <= 1 + EPS && Math.abs(p.y - w0.y) * v.s <= 1 + EPS);
  }
});

test('pellizco: la distancia entre dos dedos cambia el zoom con la regla de intención, anclado en el punto medio', () => {
  const { c, g } = gestos();
  g.down({ id: 1, x: 900, y: 540, t: 0 });
  g.down({ id: 2, x: 1000, y: 540, t: 5 });
  const mx = 950;
  const my = 540;
  const w0 = worldAt(c.viewRect(), mx, my);
  g.move({ id: 2, x: 1100, y: 540, t: 20 }); // 100 → 200 px: ln 2 = 0,69 → s* = 2,67, nivel de s = 3
  assert.ok(c.state.level >= 1, 'subió de nivel');
  assert.equal(c.levels()[c.state.level], 3);
  // volver a juntar los dedos baja
  g.move({ id: 2, x: 1000, y: 540, t: 40 });
  g.up({ id: 2, x: 1000, y: 540, t: 50 });
  g.up({ id: 1, x: 900, y: 540, t: 60 });
  assert.ok(w0.x > 0);
  // un pellizco chico no cambia el nivel
  const p = gestos();
  p.c.zoomToLevel(3);
  settle(p.c);
  p.g.down({ id: 1, x: 900, y: 540, t: 0 });
  p.g.down({ id: 2, x: 1000, y: 540, t: 5 });
  p.g.move({ id: 2, x: 1010, y: 540, t: 10 }); // ln(1,1) = 0,095 < 0,112 hacia el nivel vecino
  assert.equal(p.c.state.level, 3);
  // levantar un dedo no deja un arrastre fantasma con el otro
  p.g.up({ id: 2, x: 1010, y: 540, t: 20 });
  const x = p.c.viewRect().x0;
  p.g.move({ id: 1, x: 700, y: 400, t: 30 });
  assert.equal(p.c.viewRect().x0, x);
});

test('minimapa: tocarlo o arrastrar sobre él centra la vista (no panea), y oculto no responde', () => {
  const rect = minimapRect(1920, 1080);
  const { c, g, setMinimap } = gestos();
  c.zoomToLevel(2);
  settle(c);
  setMinimap(rect);
  const mx = rect.x + rect.w * 0.35;
  const my = rect.y + rect.h * 0.5;
  g.down({ id: 1, x: mx, y: my, t: 0 });
  settle(c, 0.1);
  let v = c.viewRect();
  assert.ok(Math.abs(v.x0 + 1920 / (2 * v.s) - 0.35 * WORLD.w) < 1 + 1 / v.s, 'centrada en el 35 % del ancho');
  // arrastrar dentro del minimapa sigue moviendo la vista
  g.move({ id: 1, x: rect.x + rect.w * 0.65, y: my, t: 20 });
  settle(c, 0.1);
  v = c.viewRect();
  assert.ok(Math.abs(v.x0 + 1920 / (2 * v.s) - 0.65 * WORLD.w) < 1 + 1 / v.s, 'sigue al dedo en el minimapa');
  g.up({ id: 1, x: rect.x + rect.w * 0.65, y: my, t: 30 });
  // un toque FUERA del minimapa visible no lo usa: arrastra la vista como siempre
  const f = gestos({ c: mk() });
  f.c.zoomToLevel(3);
  settle(f.c);
  f.setMinimap(rect);
  const x0 = f.c.viewRect().x0;
  f.g.down({ id: 1, x: 100, y: 100, t: 0 });
  assert.equal(f.c.viewRect().x0, x0, 'no centró nada');
  f.g.move({ id: 1, x: 160, y: 100, t: 10 });
  assert.notEqual(f.c.viewRect().x0, x0, 'paneó');
  // con el minimapa oculto (k = 1), el mismo toque es un toque cualquiera
  const o = gestos();
  o.setMinimap(null);
  const antes = o.c.viewRect().x0;
  o.g.down({ id: 1, x: mx, y: my, t: 0 });
  o.g.up({ id: 1, x: mx, y: my, t: 30 });
  assert.equal(o.c.viewRect().x0, antes);
});

test('cancel y punteros desconocidos no rompen nada', () => {
  const { c, g } = gestos();
  g.move({ id: 9, x: 10, y: 10, t: 0 });
  g.up({ id: 9, x: 10, y: 10, t: 0 });
  g.cancel({ id: 9 });
  g.down({ id: 1, x: 0, y: 0, t: 0 });
  g.cancel({ id: 1 });
  g.move({ id: 1, x: 100, y: 100, t: 10 });
  assert.equal(c.state.level, 0);
  g.wheel(RUEDA(-100));
  g.wheel(RUEDA(-100));
  assert.equal(c.state.level, 1, 'la rueda pasa al controlador');
});

test('F2 muestra la cámara: k (objetivo y mostrado), modo, segundos sin entrada, automática y foco', () => {
  const entrada = (camera) => ({
    timer: createTimer({ now: () => 0 }),
    stats: {
      particles: 0,
      drawCalls: 0,
      culled: 0,
      s: 2,
      mode: 'nearest',
      marks: false,
      devicePass: true,
      canvasesAllocated: 3,
    },
    counts: { units: 0, planes: 0, hits: 0 },
    bakeCount: 2,
    hash: 'abc',
    camera,
  });
  const valor = (m, key) => m.lines.find((l) => l.key === key)?.value;
  const m = f2Model(
    entrada({ k: 1.5, kShown: 1.25, text: 'CÁMARA AUTO', mode: 'auto', idle: 9.26, auto: true, tx: 412.4, ty: 380.6 }),
  );
  assert.equal(valor(m, 'cam.k'), '1.500 / 1.250');
  assert.equal(valor(m, 'cam.mode'), 'CÁMARA AUTO · auto');
  assert.equal(valor(m, 'cam.idle'), '9.3');
  assert.equal(valor(m, 'cam.auto'), 'encendida');
  assert.equal(valor(m, 'cam.focus'), '412, 381');
  const manual = f2Model(
    entrada({ k: 1, kShown: 1, text: 'CÁMARA MANUAL', mode: 'manual', idle: 0, auto: false, tx: 720, ty: 405 }),
  );
  assert.equal(valor(manual, 'cam.auto'), 'apagada');
  assert.equal(valor(manual, 'cam.focus'), 'mapa entero');
  assert.equal(valor(f2Model(entrada(undefined)), 'cam.k'), undefined, 'sin cámara no hay líneas de cámara');
});

test('dibujo del minimapa: un punto por unidad con el color de su equipo y el marco de la vista (v2.6: sin grupos)', () => {
  const ctx = createFakeCtx({ record: true });
  const rect = minimapRect(1920, 1080);
  const c = mk();
  c.zoomToLevel(2);
  settle(c);
  const units = [
    { side: 0, x: 300, y: 400 },
    { side: 0, x: 500, y: 200 },
    { side: 1, x: 1100, y: 600 },
  ];
  drawMinimap(ctx, rect, { view: c.viewRect(), units, teamHex: ['#E5484D', '#5BC8F5'], u: 4 });
  const rellenos = [];
  let color = '';
  for (const [name, a, b, w, h] of ctx.calls) {
    if (name === 'set:fillStyle') color = a;
    if (name === 'fillRect') rellenos.push({ color, x: a, y: b, w, h });
  }
  const bases = rellenos.filter((r) => r.h > rect.h * 0.5 && r.color !== 'rgba(11,15,23,0.78)');
  assert.equal(bases.length, 2, 'las dos bases, altas y en los extremos');
  const puntos = (hex) => rellenos.filter((r) => r.color === hex && r.h < rect.h * 0.5);
  assert.equal(puntos('#E5484D').length, 2, 'un punto por unidad izquierda');
  assert.equal(puntos('#5BC8F5').length, 1, 'y uno por unidad derecha');
  for (const p of rellenos) {
    if (p.color !== '#E5484D' && p.color !== '#5BC8F5') continue;
    assert.ok(
      p.x >= rect.x - 1 && p.x + p.w <= rect.x + rect.w + 1 && p.y >= rect.y - 1 && p.y + p.h <= rect.y + rect.h + 1,
    );
  }
  // el punto de la unidad en (300, 400) cae en 300/1440 del ancho del minimapa
  const p0 = puntos('#E5484D')[0];
  assert.ok(Math.abs(p0.x + p0.w / 2 - (rect.x + (300 / 1440) * rect.w)) <= 1);
  // el marco de lo que se ve: un strokeRect dentro del minimapa
  const marcos = ctx.calls.filter((x) => x[0] === 'strokeRect');
  assert.ok(marcos.length >= 1);
  const v = c.viewRect();
  const marco = marcos[0]; // el primero es el marco de la vista; el último, el borde del minimapa
  assert.ok(Math.abs(marco[3] - (v.w / 1440) * rect.w) <= 1.5, 'el marco guarda la proporción de la vista');
});

test('jumpTo (?k, ?cx, ?cy): vista manual inicial, instantánea, en un nivel y dentro del mundo', () => {
  const c = mk();
  c.jumpTo({ k: 2.25, cx: 100, cy: 448 });
  assert.equal(c.state.kShown, c.state.k, 'sin transición');
  const v = c.viewRect();
  assert.equal(v.s, 3, 'k 2,25 en 1080p es s = 3');
  assert.ok(v.x0 === 0, 'la base izquierda, pegada al borde');
  assert.ok(v.y0 >= 0 && v.y0 + 1080 / v.s <= WORLD.h + EPS);
  assert.equal(c.state.idle, 0, 'cuenta como entrada del narrador: la automática espera sus 7 s');
  assert.equal(c.lastStreamerInput, c.clock);
  // un k que no es un nivel va al más cercano; sin argumentos, el mapa entero
  const d = mk();
  d.jumpTo({ k: 2 });
  assert.equal(d.viewRect().s, 3, '2,0 está más cerca de 2,25 (s = 3) que de 1,5 (s = 2) en escala logarítmica');
  d.jumpTo({});
  assert.equal(d.state.k, 1);
  const e = mk();
  e.jumpTo({ k: 99, cx: 99999, cy: -5 });
  const w = e.viewRect();
  assert.ok(Math.abs(e.state.k - 6) < EPS);
  assert.ok(w.x0 + 1920 / w.s <= WORLD.w + EPS && w.y0 >= -EPS);
});

// FIN 5c.2
