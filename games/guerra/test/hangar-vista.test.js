import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../public/js/sim/defaults.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { bakeBase, HANGAR_ART, DEPOT_Y } from '../public/js/render/base-art.js';
import { createFx } from '../public/js/render/fx.js';
import { createMotion } from '../public/js/render/motion.js';
import { createScene } from '../public/js/render/scene.js';
import { pennant } from '../public/js/render/pennant.js';
import { createHeat } from '../public/js/camera/auto.js';
import { createFakeCanvasFactory } from './support/fake-canvas.js';
import { diff, mirror, rasterize } from './support/raster.js';

// v2.8 (lote 3): la base se ve como un HANGAR (x 14–90, y 348–548 del lado izquierdo, espejado en el derecho), sin la
// muralla de antes: ni muro de fondo, ni columna con almenas, ni torres de esquina, ni bolsas de arena. Quedan los
// depósitos y las plataformas de las torretas. El daño se ve con los 4 estados del arte más chispas y humo en la cara.

const TAM = { w: 110, h: 669 };
const Y0 = 112; // la imagen empieza en y 112 del mundo
const ESTADOS = [0, 1, 2, 3];
const KINDS = ['base-fortin', 'base-ciudadela'];
const TURY = [242, 448, 655];

const raster = (kind, state, espejo = false) => {
  const factory = createFakeCanvasFactory({ record: true });
  const estados = bakeBase({ createCanvas: factory.createCanvas }, kind, '#E5484D', espejo);
  return rasterize(estados[state].ctx.calls, TAM);
};
const en = (px, x, y) => px.get((y - Y0) * TAM.w + x);

test('el hangar es x 14–90 y y 348–548, como la zona de asalto', () => {
  assert.deepEqual({ ...HANGAR_ART }, { x0: 14, x1: 90, y0: 348, y1: 548 });
});

test('sin muralla: solo se pinta el hangar, los depósitos y las plataformas de las torretas', () => {
  const permitido = (x, y) => {
    if (x >= 12 && x <= 91 && y >= 346 && y <= 550) return true; // hangar (con su contorno)
    if (x >= 84 && TURY.some((t) => y >= t - 14 && y <= t + 14)) return true; // plataforma y sombra de torreta
    if (x >= 16 && x <= 78 && DEPOT_Y.some((d) => y >= d - 12 && y <= d + 38)) return true; // depósitos y cajas
    return false;
  };
  for (const kind of KINDS) {
    for (const st of ESTADOS) {
      const px = raster(kind, st);
      const fuera = [];
      for (const i of px.keys()) {
        const x = i % TAM.w;
        const y = (i - x) / TAM.w + Y0;
        if (!permitido(x, y)) fuera.push(`(${x},${y})`);
      }
      assert.equal(fuera.length, 0, `${kind} estado ${st}: ${fuera.length} píxeles fuera, p. ej. ${fuera.slice(0, 4)}`);
    }
  }
});

test('el hangar entero está pintado (estados 0 a 2) y en ruinas queda un campo de escombros dentro del mismo rectángulo', () => {
  const { x0, x1, y0, y1 } = HANGAR_ART;
  for (const kind of KINDS) {
    for (const st of [0, 1, 2]) {
      const px = raster(kind, st);
      let sin = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (en(px, x, y) === undefined) sin++;
      assert.equal(sin, 0, `${kind} estado ${st}: ${sin} píxeles del hangar sin pintar`);
    }
    const ruina = raster(kind, 3);
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (en(ruina, x, y) !== undefined) n++;
    assert.ok(n >= 0.5 * (x1 - x0) * (y1 - y0), `${kind}: la ruina cubre ${n} px`);
  }
});

test('dos portones en la cara del hangar, en y 400 y 496', () => {
  for (const kind of KINDS) {
    const px = raster(kind, 0);
    for (const y of [400, 496]) assert.equal(en(px, 88, y), '#141A26@1', `${kind}: portón en y ${y}`);
    assert.notEqual(en(px, 88, 448), '#141A26@1', `${kind}: entre los portones hay pared`);
  }
});

test('los 4 estados del hangar son distintos DENTRO del rectángulo (grietas, techo hundido, ruinas)', () => {
  const { x0, x1, y0, y1 } = HANGAR_ART;
  const dentro = (px) => {
    const out = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.set(y * 1000 + x, en(px, x, y));
    return out;
  };
  for (const kind of KINDS) {
    const rs = ESTADOS.map((s) => dentro(raster(kind, s)));
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) assert.ok(diff(rs[i], rs[j]).n > 150, `${kind}: ${i} y ${j}`);
  }
});

test('CB-3: el techo del hangar abovedado de la ciudadela no es el espejo del plano del fortín', () => {
  const { x0, x1, y0, y1 } = HANGAR_ART;
  const recorta = (px) => {
    const out = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.set(y * 1000 + x, en(px, x, y));
    return out;
  };
  for (const st of [0, 1, 2]) {
    const izq = raster('base-fortin', st, false);
    const der = raster('base-ciudadela', st, true);
    const { n } = diff(recorta(der), recorta(mirror(izq, TAM)));
    assert.ok(n > 0.1 * (x1 - x0) * (y1 - y0), `estado ${st}: ${n} píxeles distintos`);
  }
});

// ------------------------------------------------------------------------------------------------ efectos

const mundo = (over = {}) => ({
  step: 500,
  cfg: DEFAULTS,
  units: [],
  planes: [],
  bombs: [],
  field: {
    w: 1440,
    h: 810,
    ground: [138, 758],
    sides: [
      { frontX: 90, hangar: { x0: 14, x1: 90, y0: 348, y1: 548, faceX: 90 } },
      { frontX: 1350, hangar: { x0: 1350, x1: 1426, y0: 348, y1: 548, faceX: 1350 } },
    ],
  },
  bases: [
    {
      frontX: 90,
      hp: 60000,
      maxHp: 60000,
      fell: false,
      turrets: TURY.map((y, k) => ({ k, x: 100, y, on: true, hp: 3000 })),
    },
    {
      frontX: 1350,
      hp: 60000,
      maxHp: 60000,
      fell: false,
      turrets: TURY.map((y, k) => ({ k, x: 1340, y, on: true, hp: 3000 })),
    },
  ],
  ...over,
});
const escena = () =>
  createScene({
    teamHex: ['#E5484D', '#5BC8F5'],
    sprites: SPRITES,
    fx: createFx({
      seed: 'efectos:hangar',
      motion: createMotion({ graphics: { slowMotion: false }, systemReduced: false }),
    }),
  });
const activas = (fx, ty) => fx.particles.filter((p) => p.a && p.ty === ty);
const SPARK = 0;
const SMOKE = 1;

test('la secuencia de caída ocurre DENTRO del hangar (explosiones, estallido final y fuego), salvo el pop de cada torreta', () => {
  for (const side of [0, 1]) {
    const sc = escena();
    const w = mundo();
    w.bases[side].fell = true;
    for (const t of w.bases[side].turrets) t.on = false;
    sc.consume([], w);
    const h = w.field.sides[side].hangar;
    const vistas = [];
    for (let t = 0; t < 2.2; t += 1 / 60) {
      sc.fx.update(1 / 60, w);
      for (const b of sc.fx.booms) if (b.a && !vistas.includes(b)) vistas.push(b);
    }
    assert.ok(vistas.length >= 14, `${vistas.length} explosiones`);
    for (const b of vistas) {
      const deTorreta = w.bases[side].turrets.some((t) => Math.abs(t.x - b.x) < 1.5 && Math.abs(t.y - b.gy) < 1.5);
      if (deTorreta) continue;
      assert.ok(b.x >= h.x0 && b.x <= h.x1, `lado ${side}: explosión en x ${b.x} fuera del hangar`);
      assert.ok(b.gy >= h.y0 && b.gy <= h.y1, `lado ${side}: explosión en y ${b.gy} fuera del hangar`);
    }
    assert.equal(sc.fx.baseRuined(side), true);
  }
});

test('una bala que llega a la cara del hangar suelta chispas en la cara, dentro de su franja', () => {
  for (const [side, faceX, desde] of [
    [1, 1350, 1300],
    [0, 90, 140],
  ]) {
    const sc = escena();
    const w = mundo();
    sc.consume([{ type: 'shot', id: 1, kind: 'soldado', x: desde, y: 450, tx: faceX, ty: 450 }], w);
    const dur = Math.round(sc.projectiles[0].dur * 30);
    assert.equal(sc.fx.stats.faceSparks, 0, 'no antes de llegar');
    w.step += dur;
    sc.consume([], w);
    assert.equal(sc.fx.stats.faceSparks, 1, `lado ${side}`);
    // (el fogonazo del que dispara también suelta chispas, pero en su boca: aquí cuentan solo las de la cara)
    const ch = activas(sc.fx, SPARK).filter((p) => Math.abs(p.x - faceX) <= 3);
    assert.ok(ch.length >= 1, 'hay chispas pegadas a la cara');
    for (const p of ch) assert.ok(p.y >= 348 && p.y <= 548, `chispa en y ${p.y}`);
    w.step += 1;
    sc.consume([], w);
    assert.equal(sc.fx.stats.faceSparks, 1, 'una sola vez');
  }
});

test('un hangar dañado echa humo en su cara; entero no, y caído lo deja a la secuencia', () => {
  const humo = (pct) => {
    const sc = escena();
    const w = mundo();
    w.bases[1].hp = w.bases[1].maxHp * pct;
    sc.fx.update(0.01, w);
    const antes = sc.fx.stats.hangarSmoke ?? 0;
    for (let i = 0; i < 90; i++) {
      w.step += 1;
      sc.fx.update(1 / 30, w);
    }
    return { n: (sc.fx.stats.hangarSmoke ?? 0) - antes, sc };
  };
  assert.equal(humo(1).n, 0, 'entero: sin humo');
  assert.equal(humo(0.7).n, 0, 'sin grietas (≥ 0,66): sin humo');
  const g = humo(0.5);
  assert.ok(g.n >= 4, `con grietas hay humo (${g.n})`);
  const fuerte = humo(0.2);
  assert.ok(fuerte.n > g.n, 'más dañado, más humo');
  // el humo nace sobre el hangar derecho
  for (const p of activas(g.sc.fx, SMOKE)) assert.ok(p.x >= 1330 && p.x <= 1440, `humo en x ${p.x}`);
});

test('el banderín queda sobre el hangar (mástil entre x 14 y 90, y entre 348 y 548) en los dos lados', () => {
  for (const side of [0, 1]) {
    const partes = [];
    pennant((parte, c, x, y, w, h) => partes.push({ parte, x, y, w, h }), {
      hex: '#E5484D',
      side,
      worldW: 1440,
      time: 0,
      ruined: false,
      reduced: true,
    });
    for (const p of partes) {
      const x = side === 0 ? p.x : 1440 - p.x - p.w;
      assert.ok(x >= 14 && x + p.w <= 90, `${p.parte} en x ${p.x}`);
      assert.ok(p.y >= 348 && p.y + p.h <= 548, `${p.parte} en y ${p.y}`);
    }
  }
});

test('la cámara automática calienta el centro del hangar al recibir un golpe la base', () => {
  const heat = createHeat();
  const w = mundo({ step: 100 });
  heat.consume([{ type: 'baseHit', side: 0, dmg: 10, absorbed: 0 }], w);
  heat.consume([{ type: 'baseHit', side: 1, dmg: 10, absorbed: 0 }], w);
  const xs = heat.slots.filter((s) => s.w > 0).map((s) => [s.x, s.y]);
  assert.deepEqual(xs, [
    [52, 448],
    [1388, 448],
  ]);
});
