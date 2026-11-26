import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlashLimiter, FLASH_DEFAULTS, resolveFlash } from '../public/js/render/flash.js';
import { createFx, wreckAlpha } from '../public/js/render/fx.js';
import { createMotion, resolveGraphics } from '../public/js/render/motion.js';
import { S } from '../public/js/ui/strings.js';
import { findForbidden } from './support/forbidden-words.js';
import { createScene } from '../public/js/render/scene.js';
import { createList, createProjector, LIST_CAPS } from '../public/js/render/canvas.js';
import { createFakeCtx } from './support/fake-canvas.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { DEFAULTS } from '../public/js/sim/defaults.js';
import { ConfigError } from '@tienda/kit/sim/config.js';

// CB-20: el limitador de destellos es puro y rige SIEMPRE (con o sin movimiento reducido). Un destello es el núcleo
// blanco de una explosión o el "pop" de una torreta. "Grande" se mide en pantalla, DESPUÉS del zoom.

const VISTA = { W: 1920, H: 1080 };
const AREA_VISTA = VISTA.W * VISTA.H;
const s1 = 1920 / 1440; // k = 1 en 1080p
const s6 = 8; // k = 6 en 1080p
const nucleo = (R) => R * 0.7;

const areaPantalla = (rMundo, s) => Math.PI * (rMundo * s) ** 2;

// ---------------------------------------------------------------------------------------------------------------
// 5b.2: config recortada

test('los límites de destellos de la config se recortan: maxLargePerSecond ≤ 3 y largeArea en [0,002; 0,05]', () => {
  assert.deepEqual({ ...FLASH_DEFAULTS }, { maxLargePerSecond: 3, largeArea: 0.01, frameArea: 0.05 });
  assert.equal(resolveFlash({ maxLargePerSecond: 10 }).maxLargePerSecond, 3, 'los espectadores no pueden subirlo');
  assert.equal(resolveFlash({ maxLargePerSecond: 3 }).maxLargePerSecond, 3);
  assert.equal(resolveFlash({ maxLargePerSecond: 1 }).maxLargePerSecond, 1);
  assert.equal(resolveFlash({ maxLargePerSecond: 0 }).maxLargePerSecond, 0);
  assert.equal(resolveFlash({ maxLargePerSecond: -4 }).maxLargePerSecond, 0);
  assert.equal(resolveFlash({ largeArea: 0.0001 }).largeArea, 0.002);
  assert.equal(resolveFlash({ largeArea: 0.002 }).largeArea, 0.002);
  assert.equal(resolveFlash({ largeArea: 0.5 }).largeArea, 0.05);
  assert.equal(resolveFlash({ largeArea: 0.05 }).largeArea, 0.05);
  assert.equal(resolveFlash({ largeArea: 0.02 }).largeArea, 0.02);
  assert.equal(resolveFlash({ frameArea: 0.5 }).frameArea, 0.05, 'la suma por cuadro nunca pasa del 5 %');
  assert.deepEqual(resolveFlash({}), resolveFlash(undefined));
  assert.equal(resolveFlash({ maxLargePerSecond: 'mucho', largeArea: NaN }).maxLargePerSecond, 3);
  assert.equal(resolveFlash({ largeArea: NaN }).largeArea, 0.01);
});

// ---------------------------------------------------------------------------------------------------------------
// "grande" se mide en pantalla, después del zoom

test('"grande" es el área en pantalla > largeArea de la vista, medida después del zoom', () => {
  const L = createFlashLimiter({});
  const r = nucleo(28);
  L.setView(VISTA.W, VISTA.H, s1);
  assert.equal(L.isLarge(r), false, 'en k = 1 la misma explosión es chica');
  L.setView(VISTA.W, VISTA.H, s6);
  assert.equal(L.isLarge(r), true, 'en k = 6 es grande');
  assert.ok(areaPantalla(r, s6) > 0.01 * AREA_VISTA && areaPantalla(r, s1) < 0.01 * AREA_VISTA);
  // el umbral es el 1 % exacto
  L.setView(VISTA.W, VISTA.H, 1);
  const rUmbral = Math.sqrt((0.01 * AREA_VISTA) / Math.PI);
  assert.equal(L.isLarge(rUmbral * 0.99), false);
  assert.equal(L.isLarge(rUmbral * 1.01), true);
});

test('una explosión chica en pantalla jamás se limita, por muchas que haya', () => {
  const L = createFlashLimiter({});
  L.setView(VISTA.W, VISTA.H, s1);
  for (let i = 0; i < 50; i++) assert.equal(L.admit(nucleo(11), i * 0.01), true);
});

// ---------------------------------------------------------------------------------------------------------------
// ventana deslizante de 1 s

const corrida = (s, nExp = 20, cada = 0.1, R = 28) => {
  const L = createFlashLimiter({});
  L.setView(VISTA.W, VISTA.H, s);
  const log = [];
  for (let i = 0; i < nExp; i++) {
    const t = i * cada;
    const ok = L.admit(nucleo(R), t);
    log.push({ t, ok, large: L.isLarge(nucleo(R)) });
  }
  return log;
};
const maxEnVentana = (log) => {
  let m = 0;
  for (const a of log) {
    if (!a.ok || !a.large) continue;
    const n = log.filter((b) => b.ok && b.large && b.t > a.t - 1 + 1e-9 && b.t <= a.t + 1e-9).length;
    m = Math.max(m, n);
  }
  return m;
};

test('10 explosiones por segundo durante 2 s en k = 1 y en k = 6: como máximo 3 destellos grandes en cualquier ventana de 1 s', () => {
  for (const s of [s1, s6]) {
    const log = corrida(s);
    assert.ok(maxEnVentana(log) <= 3, `s = ${s}: ${maxEnVentana(log)} grandes en 1 s`);
  }
  // en k = 6 todas son grandes y el limitador sí actúa: se degradan unas cuantas
  const g = corrida(s6);
  assert.ok(g.every((e) => e.large));
  assert.equal(maxEnVentana(g), 3, 'llega al tope de 3');
  assert.ok(g.filter((e) => !e.ok).length >= 10, 'el resto se degrada a humo y escombro');
  assert.deepEqual(
    g.slice(0, 4).map((e) => e.ok),
    [true, true, true, false],
  );
  // en k = 1 no hay ninguna grande: no se degrada nada
  assert.ok(corrida(s1).every((e) => e.ok && !e.large));
});

test('la ventana es de 1 s y se desliza: pasado 1 s vuelven a salir destellos grandes', () => {
  const L = createFlashLimiter({});
  L.setView(VISTA.W, VISTA.H, s6);
  const r = nucleo(28);
  assert.equal(L.admit(r, 0), true);
  assert.equal(L.admit(r, 0.1), true);
  assert.equal(L.admit(r, 0.2), true);
  assert.equal(L.admit(r, 0.5), false, 'ya hay 3 en la ventana');
  assert.equal(L.admit(r, 0.99), false, 'a 0,99 s el primero sigue dentro');
  assert.equal(L.admit(r, 1.05), true, 'a 1,05 s el primero ya salió de la ventana');
  assert.equal(L.admit(r, 1.06), false, 'y otra vez hay 3: .1, .2 y 1,05 caen dentro (1,06 - 1 = 0,06)');
  assert.equal(L.admit(r, 1.11), true, 'a 1,11 s sale el de 0,1');
});

test('con maxLargePerSecond = 1 solo cabe un grande por ventana', () => {
  const L = createFlashLimiter({ maxLargePerSecond: 1 });
  L.setView(VISTA.W, VISTA.H, s6);
  assert.equal(L.admit(nucleo(28), 0), true);
  assert.equal(L.admit(nucleo(28), 0.2), false);
  const M = createFlashLimiter({ maxLargePerSecond: 99 });
  M.setView(VISTA.W, VISTA.H, s6);
  const oks = [0, 0.1, 0.2, 0.3].map((t) => M.admit(nucleo(28), t));
  assert.deepEqual(oks, [true, true, true, false], 'el tope absoluto es 3 aunque la config pida 99');
});

// ---------------------------------------------------------------------------------------------------------------
// ninguno de pantalla completa; suma de núcleos ≤ 5 % por cuadro

test('un núcleo de pantalla completa jamás se concede, ni en el zoom máximo', () => {
  const L = createFlashLimiter({});
  L.setView(VISTA.W, VISTA.H, s6);
  assert.equal(L.admit(60, 0), false, 'un núcleo de radio 60 a s = 8 cubre más que la vista');
  assert.equal(L.admit(Math.sqrt((0.06 * AREA_VISTA) / Math.PI) / s6, 5), false, 'más del 5 % no cabe en un cuadro');
  assert.equal(L.take(60), false);
});

test('la suma de áreas de núcleos en un cuadro es ≤ 5 % de la vista', () => {
  const L = createFlashLimiter({});
  L.setView(VISTA.W, VISTA.H, s6);
  L.beginFrame();
  const r = nucleo(28); // 3,7 % cada uno a s = 8
  assert.ok(areaPantalla(r, s6) > 0.03 * AREA_VISTA && areaPantalla(r, s6) < 0.05 * AREA_VISTA);
  assert.equal(L.take(r), true);
  assert.equal(L.take(r), false, 'el segundo ya no cabe en el 5 %');
  assert.ok(L.frameArea() <= 0.05 * AREA_VISTA + 1e-6);
  assert.ok(L.frameArea() > 0.03 * AREA_VISTA);
  // los chicos siguen cabiendo hasta llenar el 5 %
  assert.equal(L.take(nucleo(11)), true);
  L.beginFrame();
  assert.equal(L.frameArea(), 0, 'cada cuadro empieza de cero');
  assert.equal(L.take(r), true);
});

// ---------------------------------------------------------------------------------------------------------------
// integración con fx: el limitador gobierna las explosiones reales y degrada a humo y escombro

const mundo = () => ({ step: 0, cfg: {}, units: [], planes: [], bombs: [], bases: [] });

test('fx: 10 explosiones por segundo durante 2 s en k = 6 dejan ≤ 3 núcleos grandes por segundo y degradan el resto a humo y escombro', () => {
  const fx = createFx({ seed: 'efectos:flash' });
  fx.setView({ W: VISTA.W, H: VISTA.H, s: s6 });
  const w = mundo();
  const grandes = [];
  for (let i = 0; i < 20; i++) {
    const antes = fx.stats.largeGranted;
    const spawn0 = fx.stats.spawned;
    fx.boom(300 + i * 5, 400, 'huge', 0);
    if (fx.stats.largeGranted > antes) grandes.push(fx.now);
    const nuevas = fx.stats.spawned - spawn0;
    if (fx.stats.largeGranted === antes)
      assert.ok(nuevas > 33, `la degradada suelta humo y escombro de más (${nuevas})`);
    else assert.equal(nuevas, 33, 'la concedida es la explosión de siempre');
    fx.update(0.1, w);
  }
  for (const t of grandes) assert.ok(grandes.filter((u) => u > t - 1 + 1e-9 && u <= t + 1e-9).length <= 3);
  assert.ok(fx.stats.largeGranted >= 4 && fx.stats.largeGranted <= 6, `se concedieron ${fx.stats.largeGranted}`);
  assert.equal(fx.stats.largeGranted + fx.stats.degraded, 20);
});

test('fx: en k = 1 las mismas 20 explosiones no se degradan', () => {
  const fx = createFx({ seed: 'efectos:flash' });
  fx.setView({ W: VISTA.W, H: VISTA.H, s: s1 });
  for (let i = 0; i < 20; i++) {
    fx.boom(300 + i * 5, 400, 'huge', 0);
    fx.update(0.1, mundo());
  }
  assert.equal(fx.stats.degraded, 0);
  assert.equal(fx.stats.largeGranted, 0, 'ninguna es grande en pantalla');
});

test('fx: al dibujar, la suma de núcleos blancos por cuadro es ≤ 5 % y ninguno cubre la pantalla', async () => {
  const { createProjector, createList, LIST_CAPS } = await import('../public/js/render/canvas.js');
  const { createFakeCtx } = await import('./support/fake-canvas.js');
  const fx = createFx({ seed: 'efectos:cuadro' });
  fx.setView({ W: VISTA.W, H: VISTA.H, s: s6 });
  // varias explosiones enormes al mismo tiempo, en el mismo lugar de la vista
  for (let i = 0; i < 6; i++) fx.boom(700 + i * 3, 400, 'huge', 0);
  const stats = { culled: 0, drawCalls: 0 };
  const P = createProjector(stats, {
    entities: createList(10),
    particles: createList(LIST_CAPS.particles),
    labels: createList(2),
  });
  P.ctx = createFakeCtx({ record: false });
  P.mul = s6;
  P.vx0 = 600;
  P.vy0 = 300;
  P.vx1 = 840;
  P.vy1 = 435;
  P.frame = { alpha: 0, time: 0, reduced: false };
  fx.draw(P);
  assert.ok(fx.stats.coreArea <= 0.05 * AREA_VISTA + 1e-6, `núcleos = ${fx.stats.coreArea / AREA_VISTA}`);
  assert.ok(fx.stats.coreArea > 0.03 * AREA_VISTA, 'al menos uno se concede');
  assert.ok(fx.stats.coresDegraded >= 1);
});

// ---------------------------------------------------------------------------------------------------------------
// 5b.3: movimiento reducido (CB-20, NM-3 `R`)

test('graphics.reducedMotion "auto" sigue al sistema; true lo fuerza; false ignora la preferencia del sistema', () => {
  assert.equal(createMotion({ graphics: { reducedMotion: 'auto' }, systemReduced: true }).reduced, true);
  assert.equal(createMotion({ graphics: { reducedMotion: 'auto' }, systemReduced: false }).reduced, false);
  assert.equal(createMotion({ graphics: {}, systemReduced: true }).reduced, true, 'sin clave es "auto"');
  assert.equal(createMotion({ graphics: { reducedMotion: true }, systemReduced: false }).reduced, true);
  assert.equal(createMotion({ graphics: { reducedMotion: true }, systemReduced: true }).reduced, true);
  assert.equal(
    createMotion({ graphics: { reducedMotion: false }, systemReduced: true }).reduced,
    false,
    'false ignora el sistema',
  );
  assert.equal(createMotion({ graphics: { reducedMotion: false }, systemReduced: false }).reduced, false);
  const m = createMotion({ graphics: { reducedMotion: 'auto' }, systemReduced: false });
  m.setSystem(true); // el usuario cambió la preferencia del sistema en pleno LIVE
  assert.equal(m.reduced, true);
  const f = createMotion({ graphics: { reducedMotion: false }, systemReduced: false });
  f.setSystem(true);
  assert.equal(f.reduced, false, 'con false el cambio del sistema tampoco cuenta');
});

test('graphics.reducedMotion solo acepta "auto", true o false', () => {
  assert.throws(() => resolveGraphics({ reducedMotion: 'siempre' }), ConfigError);
  assert.throws(() => resolveGraphics({ reducedMotion: 1 }), ConfigError);
  assert.equal(resolveGraphics({}).reducedMotion, 'auto');
  assert.equal(resolveGraphics({ shake: 7 }).shake, 1, 'el temblor se recorta a [0, 1]');
  assert.equal(resolveGraphics({ shake: -1 }).shake, 0);
  assert.equal(resolveGraphics({}).shake, 0.5);
  assert.equal(resolveGraphics({}).slowMotion, true);
});

test('R alterna el movimiento reducido y una segunda R lo apaga', () => {
  const m = createMotion({ graphics: { reducedMotion: 'auto' }, systemReduced: false });
  assert.equal(m.reduced, false);
  assert.equal(m.toggle(), true);
  assert.equal(m.reduced, true);
  assert.equal(m.politica.reduced, true);
  assert.equal(m.toggle(), false);
  assert.equal(m.reduced, false);
  assert.equal(m.politica.whiteCores, true);
  // con el sistema pidiendo menos movimiento, R lo apaga y otra R lo vuelve a prender
  const s = createMotion({ graphics: { reducedMotion: 'auto' }, systemReduced: true });
  assert.equal(s.toggle(), false);
  assert.equal(s.toggle(), true);
  // el aviso de R es español neutro y sin las palabras vedadas
  assert.deepEqual({ ...S.motion }, { on: 'Movimiento reducido: activado', off: 'Movimiento reducido: desactivado' });
  for (const t of Object.values(S.motion)) assert.deepEqual(findForbidden(t), []);
});

test('con movimiento reducido: sin temblor, sin cámara lenta, sin núcleos blancos ni parpadeo, cámara automática apagada y banners sin deslizar', () => {
  const normal = createMotion({ graphics: {}, systemReduced: false }).politica;
  assert.deepEqual(
    { ...normal },
    {
      reduced: false,
      shake: 0.5,
      slowMotion: true,
      whiteCores: true,
      flicker: true,
      stillSmoke: false,
      autoCamera: true,
      bannerSlide: true,
    },
  );
  const r = createMotion({ graphics: {}, systemReduced: true }).politica;
  assert.deepEqual(
    { ...r },
    {
      reduced: true,
      shake: 0,
      slowMotion: false,
      whiteCores: false,
      flicker: false,
      stillSmoke: true,
      autoCamera: false,
      bannerSlide: false,
    },
  );
});

test('graphics.shake = 0 apaga el temblor aunque no haya movimiento reducido; graphics.slowMotion:false apaga la cámara lenta', () => {
  const m = createMotion({ graphics: { shake: 0, slowMotion: false }, systemReduced: false });
  assert.equal(m.politica.shake, 0);
  assert.equal(m.politica.slowMotion, false);
  assert.equal(m.politica.whiteCores, true, 'lo demás sigue igual');
});

const mundoVacio = () => ({ step: 0, cfg: DEFAULTS, units: [], planes: [], bombs: [], bases: [], over: null });
const normalMotion = () => createMotion({ graphics: {}, systemReduced: false });

test('temblor: ≤ 2 px de mundo con la config por defecto, solo con golpes fuertes a la base y vehículos destruidos, y se asienta', () => {
  const fx = createFx({ seed: 'efectos:temblor', motion: normalMotion() });
  const w = { ...mundoVacio(), bases: [{ turrets: [] }, { turrets: [] }] };
  const out = { x: 0, y: 0 };
  fx.shakeOffset(out);
  assert.deepEqual(out, { x: 0, y: 0 }, 'en calma no se mueve');
  // un golpe de soldado a la base y una bomba al aire no hacen temblar
  fx.consume({ type: 'baseHit', side: 1, dmg: 6, absorbed: 0 }, w);
  fx.consume({ type: 'bombImpact', x: 300, y: 300, side: 0 }, w);
  fx.shakeOffset(out);
  assert.deepEqual(out, { x: 0, y: 0 });
  // un pesado destruido, sí
  fx.consume({ type: 'death', id: 1, kind: 'pesado', side: 0, x: 300, y: 300 }, w);
  let max = 0;
  for (let i = 0; i < 50; i++) {
    fx.shakeOffset(out);
    max = Math.max(max, Math.abs(out.x), Math.abs(out.y));
    assert.ok(Number.isInteger(out.x) && Number.isInteger(out.y), 'px enteros');
  }
  assert.ok(max >= 1 && max <= 2, `temblor máximo ${max}`);
  for (let i = 0; i < 40; i++) fx.update(0.1, w);
  fx.shakeOffset(out);
  assert.deepEqual(out, { x: 0, y: 0 }, 'se asienta');
  // un golpe fuerte (obús) a la base también hace temblar
  fx.consume({ type: 'baseHit', side: 1, dmg: 900, absorbed: 0 }, w);
  let hubo = false;
  for (let i = 0; i < 30; i++) {
    fx.shakeOffset(out);
    hubo ||= out.x !== 0 || out.y !== 0;
  }
  assert.ok(hubo);
});

test('temblor: con movimiento reducido o graphics.shake = 0 la cámara nunca se mueve', () => {
  for (const [graphics, system] of [
    [{}, true],
    [{ shake: 0 }, false],
  ]) {
    const fx = createFx({ seed: 'efectos:temblor', motion: createMotion({ graphics, systemReduced: system }) });
    fx.consume({ type: 'death', id: 1, kind: 'pesado', side: 0, x: 300, y: 300 }, mundoVacio());
    const out = { x: 9, y: 9 };
    for (let i = 0; i < 30; i++) {
      fx.shakeOffset(out);
      assert.deepEqual(out, { x: 0, y: 0 });
    }
  }
});

test('el temblor tiene su propio RNG: pedirlo no cambia los efectos que salen del RNG de partículas', () => {
  const corrida = (conTemblor) => {
    const fx = createFx({ seed: 'efectos:rng', motion: normalMotion() });
    const out = { x: 0, y: 0 };
    fx.boom(300, 300, 'large', 0);
    fx.consume({ type: 'death', id: 1, kind: 'pesado', side: 0, x: 900, y: 300 }, mundoVacio());
    if (conTemblor) for (let i = 0; i < 20; i++) fx.shakeOffset(out);
    fx.boom(500, 300, 'med', 0);
    return JSON.stringify(fx.particles.filter((p) => p.a).map((p) => [p.x, p.y, p.vx, p.vy]));
  };
  assert.equal(corrida(true), corrida(false));
});

test('cámara lenta: 1,2 s a 0,35× del reloj de vista, solo en los efectos, y no existe con movimiento reducido', () => {
  const w = mundoVacio();
  const fx = createFx({ seed: 'efectos:lenta', motion: normalMotion() });
  assert.equal(fx.timeScale(), 1);
  fx.beginSlowMotion();
  assert.equal(fx.timeScale(), 0.35);
  const avanza = (seg) => {
    for (let i = 0; i < Math.round(seg / 0.05); i++) fx.update(0.05, w);
  };
  avanza(0.5);
  assert.ok(Math.abs(fx.now - 0.175) < 1e-9, 'el reloj de vista avanza a 0,35×');
  assert.equal(fx.timeScale(), 0.35);
  avanza(0.6);
  assert.equal(fx.timeScale(), 0.35, '1,1 s reales: sigue lenta');
  avanza(0.1);
  assert.equal(fx.timeScale(), 1, 'pasados 1,2 s reales vuelve a la normalidad');
  const antes = fx.now;
  fx.update(0.1, w);
  assert.ok(Math.abs(fx.now - antes - 0.1) < 1e-9);

  const r = createFx({ seed: 'efectos:lenta', motion: createMotion({ graphics: {}, systemReduced: true }) });
  r.beginSlowMotion();
  assert.equal(r.timeScale(), 1);
  const o = createFx({
    seed: 'efectos:lenta',
    motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
  });
  o.beginSlowMotion();
  assert.equal(o.timeScale(), 1);
});

const nuevoProyector = (reduced) => {
  const stats = { culled: 0, drawCalls: 0 };
  const P = createProjector(stats, {
    entities: createList(10),
    particles: createList(LIST_CAPS.particles),
    labels: createList(2),
  });
  P.ctx = createFakeCtx({ record: true });
  P.mul = 1;
  P.vx0 = 0;
  P.vy0 = 0;
  P.vx1 = 1440;
  P.vy1 = 810;
  P.frame = { alpha: 0, time: 0, reduced };
  return P;
};
const coloresDibujados = (fx, reduced = false) => {
  const P = nuevoProyector(reduced);
  fx.draw(P);
  return P.ctx.calls.filter(([n]) => n === 'set:fillStyle').map(([, c]) => String(c).toUpperCase());
};

const escenaConMovimiento = (systemReduced) => {
  const sc = createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({ seed: 'efectos:rm', motion: createMotion({ graphics: {}, systemReduced }) }),
  });
  const w = {
    ...mundoVacio(),
    bases: [
      { frontX: 90, turrets: [{ x: 100, y: 242 }] },
      { frontX: 1350, turrets: [{ x: 1340, y: 242 }] },
    ],
  };
  sc.consume(
    [
      { type: 'shot', id: 1, kind: 'tanque', x: 300, y: 300, tx: 340, ty: 300 },
      { type: 'hit', id: 5, x: 300, y: 300, dmg: 10, side: 0 },
      { type: 'death', id: 2, kind: 'tanque', side: 0, x: 400, y: 300 },
      { type: 'turretShot', side: 0, k: 0, tx: 140, ty: 250 },
    ],
    w,
  );
  sc.fx.update(0.02, w);
  return sc;
};

test('sin movimiento reducido hay núcleo blanco; con él, ni un píxel blanco, ni fogonazos, chispas o fuego, y el humo sigue', () => {
  assert.ok(coloresDibujados(escenaConMovimiento(false).fx).includes('#FFFFFF'), 'hay núcleo blanco');
  const sc = escenaConMovimiento(true);
  const tipos = (ty) => sc.fx.particles.filter((p) => p.a && p.ty === ty).length;
  assert.equal(tipos(0), 0, 'sin chispas');
  assert.equal(tipos(6), 0, 'sin fogonazos de boca');
  assert.equal(tipos(2), 0, 'sin fuego que titile');
  assert.ok(tipos(1) > 0, 'el humo sigue');
  const colores = coloresDibujados(sc.fx, true);
  assert.ok(!colores.includes('#FFFFFF'), 'ni un píxel blanco');
  assert.ok(!colores.includes('#FFF3A0'), 'ni el fogonazo');
});

test('el escombro no parpadea con movimiento reducido: al final de su vida sigue dibujándose', () => {
  const pintados = (system) => {
    const fx = createFx({ seed: 'efectos:rm2', motion: createMotion({ graphics: {}, systemReduced: system }) });
    fx.debris(300, 300, 40, '#4F5A70', 310);
    for (const p of fx.particles) if (p.a) p.l = 0.2;
    const P = nuevoProyector(system);
    fx.draw(P);
    return P.lists.particles.length;
  };
  assert.equal(pintados(true), 40, 'con movimiento reducido se dibuja todo');
  assert.ok(pintados(false) < 40, 'sin él, la mitad titila');
});

test('el golpe de una unidad no parpadea en blanco con movimiento reducido', () => {
  const crea = (system) =>
    createScene({
      teamHex: ['#E5484D', '#5BC8F5'],
      sprites: SPRITES,
      fx: createFx({ seed: 'efectos:rm3', motion: createMotion({ graphics: {}, systemReduced: system }) }),
    });
  const w = { ...mundoVacio(), step: 100 };
  const a = crea(false);
  a.consume([{ type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 }], w);
  assert.equal(a.flashUntil(7), 102);
  const b = crea(true);
  b.consume([{ type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 }], w);
  assert.equal(b.flashUntil(7), 0);
});

test('el resto de un vehículo no parpadea con movimiento reducido: se desvanece', () => {
  assert.ok([0, 1].includes(wreckAlpha('tanque', 6.5, false)), 'sin movimiento reducido parpadea');
  assert.ok(wreckAlpha('tanque', 6.9, true) > 0 && wreckAlpha('tanque', 6.9, true) < 1);
  assert.equal(wreckAlpha('tanque', 7.5, true), 0);
  assert.equal(wreckAlpha('tanque', 6.2, true), 1);
});

test('los límites de destellos rigen también con movimiento reducido: la contabilidad no cambia', () => {
  const corre = (system) => {
    const fx = createFx({ seed: 'efectos:lim', motion: createMotion({ graphics: {}, systemReduced: system }) });
    fx.setView({ W: VISTA.W, H: VISTA.H, s: s6 });
    for (let i = 0; i < 20; i++) {
      fx.boom(300 + i * 5, 400, 'huge', 0);
      fx.update(0.1, mundoVacio());
    }
    return [fx.stats.largeGranted, fx.stats.degraded];
  };
  assert.deepEqual(corre(true), corre(false));
  assert.ok(corre(true)[0] <= 6);
});

// ---------------------------------------------------------------------------------------------------------------
// 5b.4: la secuencia de destrucción de la base (solo vista) y el disco de ruina de la torreta

const mundoBase = (over = {}) => ({
  step: 500,
  cfg: DEFAULTS,
  units: [],
  planes: [],
  bombs: [],
  field: { w: 1440, h: 810, ground: [200, 700] },
  bases: [
    { fell: false, turrets: [0, 1, 2].map((k) => ({ k, x: 100, y: 242 + 206 * k, on: true, hp: 3000 })) },
    { fell: false, turrets: [0, 1, 2].map((k) => ({ k, x: 1340, y: 242 + 206 * k, on: true, hp: 3000 })) },
  ],
  ...over,
});

/** Hace caer la base derecha como lo deja el sim: `fell`, torretas apagadas. */
const cae = (w, side = 1) => {
  w.bases[side].fell = true;
  for (const t of w.bases[side].turrets) t.on = false;
};

const correSecuencia = (fx, w, segundos, dt = 1 / 60) => {
  for (let t = 0; t < segundos; t += dt) fx.update(dt, w);
};

test('secuencia de la base: explosiones cada 0,07 a 0,13 s durante 1,75 s, pop de torretas a 0,8 + 0,3·k s y explosión final a 1,9 s', () => {
  const sc = createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({
      seed: 'efectos:base',
      motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
    }),
  });
  const w = mundoBase();
  cae(w);
  sc.consume([], w);
  const seq = sc.fx.sequence(1);
  assert.ok(seq, 'la secuencia arranca al caer la base');
  correSecuencia(sc.fx, w, 2.2);
  assert.ok(seq.boomTimes.length >= 14 && seq.boomTimes.length <= 26, `${seq.boomTimes.length} explosiones`);
  assert.ok(seq.boomTimes[0] <= 0.001);
  for (let i = 1; i < seq.boomTimes.length; i++) {
    const d = seq.boomTimes[i] - seq.boomTimes[i - 1];
    assert.ok(d >= 0.07 - 1e-9 && d <= 0.13 + 1e-9, `intervalo ${d}`);
  }
  assert.ok(seq.boomTimes.at(-1) < 1.75, 'ninguna después de 1,75 s');
  assert.ok(seq.boomTimes.at(-1) > 1.6, 'llega hasta el final de la ventana');
  // torretas: 0,8 + 0,3·k, con la k del índice de la torreta
  assert.equal(seq.pops.length, 3);
  seq.pops.forEach((t, k) => assert.ok(Math.abs(t - (0.8 + 0.3 * k)) < 0.03, `pop ${k} a ${t}`));
  // final a 1,9 s
  assert.ok(Math.abs(seq.finalAt - 1.9) < 0.03, `final a ${seq.finalAt}`);
  assert.equal(sc.fx.baseRuined(1), true);
  assert.equal(sc.fx.baseRuined(0), false);
});

test('secuencia de la base: la base y las torretas siguen en pie hasta su momento y las explosiones caen dentro de la base', () => {
  const sc = createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({
      seed: 'efectos:base',
      motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
    }),
  });
  const w = mundoBase();
  cae(w);
  sc.consume([], w);
  // recién caída: el sim ya apagó las torretas, la vista aún las muestra y la base no está en ruinas
  assert.equal(sc.baseFell(1, w.bases[1]), false);
  assert.equal(sc.turretShown(1, 0, false), true);
  assert.equal(sc.turretShown(1, 2, false), true);
  correSecuencia(sc.fx, w, 0.85); // pasó el pop de la 0
  assert.equal(sc.turretShown(1, 0, false), false);
  assert.equal(sc.turretShown(1, 1, false), true);
  correSecuencia(sc.fx, w, 0.7); // 1,55 s: pasaron los pops 0, 1 y 2
  assert.equal(sc.turretShown(1, 2, false), false);
  assert.equal(sc.baseFell(1, w.bases[1]), false, 'aún no hubo explosión final');
  correSecuencia(sc.fx, w, 0.4);
  assert.equal(sc.baseFell(1, w.bases[1]), true, 'tras la explosión final, ruinas');
  // las explosiones de la secuencia caen sobre el hangar derecho (x entre 1350 y 1426) o en una torreta (x 1340)
  for (const b of sc.fx.booms) if (b.a) assert.ok(b.x >= 1330 && b.x <= 1440, `x = ${b.x}`);
});

test('secuencia de la base: la torreta que ya había caído no vuelve a hacer pop', () => {
  const sc = createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({
      seed: 'efectos:base',
      motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
    }),
  });
  const w = mundoBase();
  w.bases[1].turrets[1].on = false;
  w.bases[1].turrets[1].hp = 0;
  sc.consume([{ type: 'turretDown', side: 1, k: 1 }], w);
  cae(w);
  sc.consume([], w);
  const seq = sc.fx.sequence(1);
  correSecuencia(sc.fx, w, 2.2);
  assert.equal(seq.pops[1], -1, 'la 1 ya estaba caída');
  assert.ok(seq.pops[0] > 0 && seq.pops[2] > 0);
});

test('secuencia de la base: cámara lenta de 1,2 s a 0,35× (salvo movimiento reducido), y el sim no se entera', () => {
  const crea = (system) =>
    createScene({
      teamHex: ['#E5484D', '#5BC8F5'],
      sprites: SPRITES,
      fx: createFx({ seed: 'efectos:base', motion: createMotion({ graphics: {}, systemReduced: system }) }),
    });
  const sc = crea(false);
  const w = mundoBase();
  cae(w);
  sc.consume([], w);
  assert.equal(sc.fx.timeScale(), 0.35);
  correSecuencia(sc.fx, w, 1.1);
  assert.equal(sc.fx.timeScale(), 0.35);
  correSecuencia(sc.fx, w, 0.15);
  assert.equal(sc.fx.timeScale(), 1);
  // con la cámara lenta la secuencia dura más en tiempo real: 1,2 s a 0,35× + el resto a 1×
  const lenta = crea(false);
  const w2 = mundoBase();
  cae(w2);
  lenta.consume([], w2);
  let real = 0;
  while (!lenta.fx.baseRuined(1) && real < 10) {
    lenta.fx.update(1 / 60, w2);
    real += 1 / 60;
  }
  assert.ok(Math.abs(real - (1.2 + (1.9 - 1.2 * 0.35))) < 0.1, `final tras ${real} s reales`);
  // con movimiento reducido corre al ritmo normal y no hay cámara lenta
  const r = crea(true);
  const w3 = mundoBase();
  cae(w3);
  r.consume([], w3);
  assert.equal(r.fx.timeScale(), 1);
  let real2 = 0;
  while (!r.fx.baseRuined(1) && real2 < 10) {
    r.fx.update(1 / 60, w3);
    real2 += 1 / 60;
  }
  assert.ok(Math.abs(real2 - 1.9) < 0.05, `sin cámara lenta el final llega a ${real2} s`);
});

test('secuencia de la base: pasa toda por el limitador de destellos (≤ 3 grandes por segundo, suma de núcleos ≤ 5 %) en k = 6', () => {
  const fx = createFx({
    seed: 'efectos:base',
    motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
  });
  fx.setView({ W: 1920, H: 1080, s: 8 });
  const w = mundoBase();
  cae(w);
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES, fx });
  sc.consume([], w);
  const grandes = [];
  let previo = 0;
  let maxNucleos = 0;
  for (let t = 0; t < 2.5; t += 1 / 60) {
    fx.update(1 / 60, w);
    if (fx.stats.largeGranted > previo) {
      for (let i = previo; i < fx.stats.largeGranted; i++) grandes.push(fx.now);
      previo = fx.stats.largeGranted;
    }
    const P = nuevoProyector(false);
    P.mul = 8;
    P.vx0 = 1300;
    P.vx1 = 1440;
    P.vy0 = 380;
    P.vy1 = 515;
    fx.draw(P);
    maxNucleos = Math.max(maxNucleos, fx.stats.coreArea);
  }
  assert.ok(grandes.length >= 3, 'hubo destellos grandes');
  for (const t of grandes) assert.ok(grandes.filter((u) => u > t - 1 + 1e-9 && u <= t + 1e-9).length <= 3);
  assert.ok(maxNucleos <= 0.05 * 1920 * 1080 + 1e-6, `núcleos = ${maxNucleos / (1920 * 1080)}`);
  assert.ok(fx.stats.degraded > 0, 'el exceso se degradó a humo y escombro');
});

test('ruina: el humo de la torreta y de la base queda quieto con movimiento reducido y se mueve sin él', () => {
  const humo = (system) => {
    const fx = createFx({ seed: 'efectos:humo', motion: createMotion({ graphics: {}, systemReduced: system }) });
    const w = mundoBase();
    fx.consume({ type: 'turretDown', side: 0, k: 1 }, w);
    for (let i = 0; i < 20; i++) fx.update(1 / 30, w);
    return fx.particles.filter((p) => p.a && p.ty === 1 && p.gr !== undefined);
  };
  const quieto = humo(true);
  const vivo = humo(false);
  assert.ok(
    quieto.some((p) => p.vx === 0 && p.vy === 0 && p.gr === 0),
    'humo quieto',
  );
  assert.ok(
    vivo.some((p) => p.vy < 0),
    'humo que sube',
  );
  assert.ok(
    vivo.some((p) => p.gr > 0),
    'y se ensancha',
  );
});

test('ruina: sin movimiento reducido la explosión de la torreta tiene núcleo; con él, ninguno blanco', () => {
  const crea = (system) => {
    const fx = createFx({ seed: 'efectos:nucleo', motion: createMotion({ graphics: {}, systemReduced: system }) });
    fx.consume({ type: 'turretDown', side: 0, k: 1 }, mundoBase());
    return fx;
  };
  const normal = crea(false);
  assert.equal(normal.booms.find((b) => b.a).core, true);
  assert.ok(coloresDibujados(normal).includes('#FFFFFF'));
  const reducido = crea(true);
  assert.ok(!coloresDibujados(reducido, true).includes('#FFFFFF'), 'sin núcleo blanco con movimiento reducido');
});

test('la capa de bases dibuja el disco de ruina #141A26 de la torreta caída y el cañón de las que siguen en pie', async () => {
  const { createBaseLayer } = await import('../public/js/render/bases.js');
  const { createFakeCanvasFactory } = await import('./support/fake-canvas.js');
  const factory = createFakeCanvasFactory({ record: true });
  const capa = createBaseLayer({ createCanvas: factory.createCanvas, worldW: 1440 });
  capa.bake(['#E5484D', '#5BC8F5'], ['base-fortin', 'base-ciudadela']);
  const w = mundoBase();
  const sc = createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({
      seed: 'efectos:capa',
      motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
    }),
  });
  const bases = w.bases.map((b) => ({
    ...b,
    maxHp: 8000,
    hp: 8000,
    turrets: b.turrets.map((t) => ({ ...t, maxHp: 3000, tgt: null, cd: 0 })),
  }));
  sc.sync({ ...w, bases });
  const dibuja = () => {
    const P = nuevoProyector(false);
    P.vx1 = 1440;
    P.vy1 = 810;
    P.frame = { alpha: 0, time: 0, reduced: false, scene: sc };
    P.ctx = factory.createCanvas(10, 10).ctx;
    capa.layer(P);
    return P.ctx.calls.filter(([n]) => n === 'set:fillStyle').map(([, c]) => String(c).toUpperCase());
  };
  const antes = dibuja();
  assert.ok(!antes.includes('#141A26'), 'con las torretas en pie no hay disco de ruina');
  sc.consume([{ type: 'turretDown', side: 0, k: 1 }], { ...w, bases });
  bases[0].turrets[1].on = false;
  bases[0].turrets[1].hp = 0;
  const despues = dibuja();
  assert.ok(despues.includes('#141A26'), 'la torreta caída es un disco oscuro');
});

// ---------------------------------------------------------------------------------------------------------------
// F2: etapa de efectos y uso de los pools

test('el limitador cuenta los destellos grandes del último segundo (para F2)', () => {
  const L = createFlashLimiter({});
  L.setView(VISTA.W, VISTA.H, s6);
  assert.equal(L.recent(0), 0);
  L.admit(nucleo(28), 0);
  L.admit(nucleo(28), 0.1);
  assert.equal(L.recent(0.5), 2);
  assert.equal(L.recent(1.05), 1, 'a 1,05 s el de 0 ya no cuenta');
  assert.equal(L.recent(2), 0);
});

test('F2 muestra el tiempo de efectos (aparte del trabajo), el uso de cada pool y los destellos grandes del último segundo', async () => {
  const { createTimer, f2Model } = await import('../public/js/render/f2.js');
  const { FX_CAPS } = await import('../public/js/render/fx.js');
  let t = 0;
  const timer = createTimer({ now: () => t, window: 4 });
  for (let i = 0; i < 3; i++) {
    timer.beginFrame();
    timer.begin('sim');
    t += 1;
    timer.end('sim');
    timer.begin('world');
    timer.begin('fx');
    t += 2;
    timer.end('fx');
    t += 1;
    timer.end('world');
    timer.begin('ui');
    t += 0.5;
    timer.end('ui');
    t += 12;
  }
  timer.beginFrame();
  const fx = createFx({ seed: 'efectos:f2' });
  fx.boom(300, 300, 'huge', 0);
  const m = f2Model({
    timer,
    stats: {
      particles: 7,
      drawCalls: 1,
      culled: 0,
      s: 1,
      mode: 'nearest',
      marks: false,
      devicePass: false,
      canvasesAllocated: 2,
    },
    counts: { units: 1, planes: 0, hits: 0 },
    bakeCount: 2,
    hash: 'abc',
    fx: { usage: { particles: 12, booms: 3, craters: 4, wrecks: 5 }, caps: FX_CAPS, recentLarge: 2 },
  });
  const v = (k) => m.lines.find((l) => l.key === k)?.value;
  assert.equal(v('ms.fx'), '2.00', 'efectos, medido dentro de la etapa del mundo');
  assert.equal(v('ms.work'), '4.50', 'el trabajo es sim + mundo + interfaz: los efectos no se cuentan dos veces');
  assert.equal(v('fx.particles'), '12/600');
  assert.equal(v('fx.booms'), '3/40');
  assert.equal(v('fx.craters'), '4/60');
  assert.equal(v('fx.wrecks'), '5/24');
  assert.equal(v('fx.large'), '2');
  const sin = f2Model({
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
    counts: { units: 0, planes: 0, hits: 0 },
    bakeCount: 0,
    hash: '',
  });
  assert.equal(
    sin.lines.find((l) => l.key === 'fx.particles'),
    undefined,
    'sin efectos no hay líneas de pools',
  );
  assert.equal(fx.recentLarge(), fx.limiter.recent(fx.now));
});

// ---------------------------------------------------------------------------------------------------------------
// CB-20 (corrección del coordinador): una explosión degradada NO destella, ni siquiera en naranja

const BRILLANTES = ['#FFFFFF', '#FFD84A', '#FFE680', '#FF9A3C', '#D9392B'];
const BOLA = ['#D9392B', '#FF9A3C'];

/** Dibuja `frames` cuadros de vida de las explosiones y junta, por cuadro, los colores de relleno usados. */
const vidaDibujada = (fx, frames = 60, antes = () => {}) => {
  const porCuadro = [];
  for (let i = 0; i < frames; i++) {
    antes(i);
    const P = nuevoProyector(false);
    P.mul = s6;
    P.vx0 = 600;
    P.vy0 = 300;
    P.vx1 = 840;
    P.vy1 = 435;
    fx.draw(P);
    porCuadro.push(P.ctx.calls.filter(([n]) => n === 'set:fillStyle').map(([, c]) => String(c).toUpperCase()));
    fx.update(1 / 60, mundoVacio());
  }
  return porCuadro;
};
const fxK6 = (motion = normalMotion()) => {
  const fx = createFx({ seed: 'efectos:degradada', motion });
  fx.setView({ W: VISTA.W, H: VISTA.H, s: s6 });
  return fx;
};

test('una explosión negada al nacer no pinta ni núcleo, ni bola de fuego, ni brillo naranja en ningún cuadro de su vida', () => {
  const fx = fxK6();
  for (let i = 0; i < 3; i++) assert.equal(fx.limiter.admit(nucleo(28), fx.now), true); // la ventana ya está llena
  const b = fx.boom(700, 400, 'huge', 0);
  assert.equal(b.core, false, 'el limitador la negó');
  const cuadros = vidaDibujada(fx, 60);
  const usados = new Set(cuadros.flat());
  for (const c of BRILLANTES) assert.ok(!usados.has(c), `la degradada pintó ${c}`);
  assert.ok(fx.stats.degraded >= 1);
});

test('una explosión concedida sí pinta su bola de fuego', () => {
  const fx = fxK6();
  fx.boom(700, 400, 'huge', 0);
  const usados = new Set(vidaDibujada(fx, 40).flat());
  assert.ok(
    BOLA.some((c) => usados.has(c)),
    'se ve la bola de fuego',
  );
  assert.ok(usados.has('#FFFFFF'), 'y el núcleo blanco');
});

test('si el presupuesto del cuadro le niega el núcleo, esa explosión queda degradada el resto de su vida (nunca alterna)', () => {
  const fx = fxK6();
  const a = fx.boom(700, 400, 'huge', 0);
  const b = fx.boom(704, 402, 'huge', 0);
  assert.equal(a.core && b.core, true, 'las dos se concedieron al nacer (2 de 3 en la ventana)');
  const cuadros = vidaDibujada(fx, 40, (i) => {
    if (i === 1) a.a = 0; // la primera desaparece: la segunda quedaría sola y SIN presupuesto que se lo niegue
  });
  assert.equal(a.degraded, false, 'la primera cupo en el 5 %');
  assert.equal(b.degraded, true, 'la segunda no cupo en el cuadro: degradada');
  // a partir del cuadro 1 solo queda la segunda: ni un color brillante, aunque ya haya presupuesto de sobra
  const usados = new Set(cuadros.slice(1).flat());
  for (const c of BRILLANTES) assert.ok(!usados.has(c), `siguió pintando ${c}`);
});

test('con movimiento reducido una explosión concedida conserva su bola de fuego, con núcleo amarillo y sin un píxel blanco', () => {
  const fx = fxK6(createMotion({ graphics: {}, systemReduced: true }));
  const b = fx.boom(700, 400, 'huge', 0);
  const usados = new Set(vidaDibujada(fx, 40).flat());
  assert.equal(b.degraded, false, 'reducido no es degradado');
  assert.ok(
    BOLA.some((c) => usados.has(c)),
    'la bola de fuego sigue',
  );
  assert.ok(usados.has('#FFD84A'), 'núcleo amarillo');
  assert.ok(!usados.has('#FFFFFF'), 'sin blanco');
});

// ---------------------------------------------------------------------------------------------------------------
// CB-20 (corrección del coordinador): el parpadeo de golpe, a lo sumo 3 por segundo por unidad

test('una unidad golpeada en cada paso durante 2 s inicia como máximo 3 parpadeos en cualquier ventana cerrada de 1 s (31 pasos)', () => {
  const sc = createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({ seed: 'efectos:parpadeo' }),
  });
  const inicios = [];
  let previo = 0;
  for (let paso = 100; paso < 160; paso++) {
    sc.consume([{ type: 'hit', id: 7, x: 0, y: 0, dmg: 1, side: 0 }], { ...mundoVacio(), step: paso });
    const hasta = sc.flashUntil(7);
    if (hasta !== previo) {
      inicios.push(hasta - 2);
      previo = hasta;
    }
  }
  assert.ok(inicios.length >= 5, `hubo parpadeos (${inicios.length})`);
  for (const p of inicios) {
    const n = inicios.filter((q) => q >= p && q <= p + 30).length;
    assert.ok(n <= 3, `${n} parpadeos desde el paso ${p}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// v2.6: la alfombra del bombardero (una bomba cada 40 px, 3 por segundo por avión)

const impactos = (fx, evs) => {
  for (const e of evs) fx.consume(e, mundoVacio());
};

test('bombImpact sin unidades dañadas (hits 0): estallido pequeño y sin cráter; con hits > 0: mediano y con cráter', () => {
  const fx = createFx({ seed: 'efectos:alfombra', motion: normalMotion() });
  impactos(fx, [{ type: 'bombImpact', x: 300, y: 300, side: 0, hits: 0 }]);
  assert.equal(fx.booms.filter((b) => b.a).length, 1);
  assert.equal(fx.booms.find((b) => b.a).R, 5, 'small');
  assert.equal(fx.craters.length, 0, 'sin cráter');
  const fx2 = createFx({ seed: 'efectos:alfombra', motion: normalMotion() });
  impactos(fx2, [{ type: 'bombImpact', x: 300, y: 300, side: 0, hits: 2 }]);
  assert.equal(fx2.booms.find((b) => b.a).R, 11, 'med');
  assert.equal(fx2.craters.length, 1, 'con cráter');
  // un evento viejo sin `hits` no cava cráter ni sube a mediano (dato ausente = ninguna unidad)
  const fx3 = createFx({ seed: 'efectos:alfombra', motion: normalMotion() });
  impactos(fx3, [{ type: 'bombImpact', x: 300, y: 300, side: 0 }]);
  assert.equal(fx3.booms.find((b) => b.a).R, 5);
  assert.equal(fx3.craters.length, 0);
});

test('alfombra con 4 aviones a la vez en k = 6: nunca más de 3 destellos grandes por segundo, y el resto se degrada', () => {
  const fx = createFx({ seed: 'efectos:alfombra4', motion: normalMotion() });
  fx.setView({ W: VISTA.W, H: VISTA.H, s: s6 });
  const w = mundoVacio();
  const fases = [0, 3, 5, 8]; // cuatro aviones desfasados: 12 impactos por segundo en total
  const concedidos = [];
  let max = 0;
  let total = 0;
  for (let paso = 0; paso < 150; paso++) {
    for (const f of fases) {
      if (paso % 10 === f) {
        const antes = fx.stats.largeGranted;
        // los impactos de la alfombra con unidades debajo son 'med'; para estresar el límite también 'large'
        fx.consume({ type: 'bombImpact', x: 300 + paso * 4, y: 300 + f * 20, side: 0, hits: 1 }, w);
        fx.boom(300 + paso * 4, 500 + f * 10, 'huge', 0); // un pesado muerto en la misma pasada
        total++;
        if (fx.stats.largeGranted > antes) concedidos.push(fx.now);
      }
    }
    fx.update(1 / 30, w);
    max = Math.max(max, fx.recentLarge());
    assert.ok(fx.recentLarge() <= 3, `paso ${paso}: ${fx.recentLarge()} destellos grandes en el último segundo`);
  }
  for (const t of concedidos) {
    assert.ok(concedidos.filter((u) => u > t - 1 + 1e-9 && u <= t + 1e-9).length <= 3, `ventana de 1 s en t = ${t}`);
  }
  assert.ok(total >= 60, 'hubo carga de verdad');
  assert.ok(fx.stats.degraded > 0, 'el exceso se degradó a humo y escombro');
  assert.ok(max === 3, `el límite se tocó (${max})`);
});

test('alfombra con 4 aviones en k = 1: 12 estallidos por segundo no degradan nada y los pools no se desbordan', () => {
  const fx = createFx({ seed: 'efectos:alfombra1', motion: normalMotion() });
  fx.setView({ W: VISTA.W, H: VISTA.H, s: s1 });
  const w = mundoVacio();
  for (let paso = 0; paso < 300; paso++) {
    for (const f of [0, 3, 5, 8]) {
      if (paso % 10 === f) {
        fx.consume(
          { type: 'bombImpact', x: 200 + (paso % 90) * 12, y: 300 + f * 30, side: 0, hits: paso % 20 === 0 ? 0 : 2 },
          w,
        );
      }
    }
    fx.update(1 / 30, w);
    assert.ok(fx.booms.length <= 40 && fx.craters.length <= 60);
  }
  assert.equal(fx.stats.degraded, 0);
  assert.equal(fx.recentLarge(), 0);
});
