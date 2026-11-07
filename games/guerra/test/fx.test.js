import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFx, FX_CAPS, FX_IDS, wreckAlpha, craterAlpha, LIFE } from '../public/js/render/fx.js';
import { createScene } from '../public/js/render/scene.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { DEFAULTS } from '../public/js/sim/defaults.js';
import { createList, createProjector, LIST_CAPS } from '../public/js/render/canvas.js';
import { createFakeCtx } from './support/fake-canvas.js';

// CB-20, CB-9 (muertes): los efectos viven en pools de capacidad fija (el más viejo se recicla), con un RNG propio
// sembrado por partido, sin sangre y con vida acotada. Todo es cosmético: nada de esto toca el sim.

const ROJO_SANGRE = /blood|gore|sangre|corpse|cuerpo|ragdoll|gib/i;

const mundoFalso = (step = 10) => ({
  step,
  cfg: DEFAULTS,
  units: [],
  planes: [],
  bombs: [],
  bases: [{ turrets: [{ x: 100, y: 242 }] }, { turrets: [{ x: 1340, y: 242 }] }],
});

const activas = (fx) => fx.particles.filter((p) => p.a);
const escena = () => createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });

// ---------------------------------------------------------------------------------------------------------------
// 5b.1: pools

test('los topes son los del diseño: partículas 600, explosiones 40, cráteres 60, restos 24', () => {
  assert.deepEqual({ ...FX_CAPS }, { particles: 600, booms: 40, craters: 60, wrecks: 24 });
  const fx = createFx({ seed: 'efectos:topes' });
  assert.equal(fx.particles.length, 600);
  assert.equal(fx.booms.length, 40);
});

test('10 000 pedidos en ráfaga: ningún pool supera su tope', () => {
  const fx = createFx({ seed: 'efectos:rafaga' });
  for (let i = 0; i < 10000; i++) {
    const x = i % 1400;
    fx.smoke(x, 300, 2, 1, -10, 5);
    fx.spark(x, 300, 3, '#FFE680');
    fx.debris(x, 300, 4, '#4F5A70', 310);
    fx.boom(x, 400, i % 2 ? 'huge' : 'med', 0);
    fx.addCrater(x, 400, 14, i >> 4);
    fx.addWreck({ x, y: 300, kind: i % 2 ? 'tanque' : 'soldado', side: i % 2 }, i >> 4);
    const u = fx.usage();
    assert.ok(u.particles <= 600 && u.booms <= 40 && u.craters <= 60 && u.wrecks <= 24, JSON.stringify(u));
    assert.equal(fx.particles.length, 600, 'el pool no crece: se recicla');
    assert.equal(fx.booms.length, 40);
  }
  assert.equal(fx.usage().particles, 600, 'la ráfaga llenó el pool');
});

test('con el pool lleno se recicla la entrada MÁS VIEJA, no la más nueva (partículas, explosiones, cráteres y restos)', () => {
  const fx = createFx({ seed: 'efectos:viejo' });
  for (let i = 0; i < 600; i++) fx.smoke(i, 100, 1, 0, 0, 100);
  assert.deepEqual(
    activas(fx)
      .map((p) => p.x)
      .sort((a, b) => a - b)[0],
    0,
  );
  fx.smoke(600, 100, 1, 0, 0, 100);
  const xs = activas(fx).map((p) => p.x);
  assert.equal(xs.length, 600);
  assert.ok(!xs.includes(0), 'la más vieja salió');
  assert.ok(xs.includes(599) && xs.includes(600), 'la última antes y la nueva siguen');

  for (let i = 0; i < 40; i++) fx.boom(i * 10, 400, 'small', 0);
  assert.ok(fx.booms.some((b) => b.a && b.x === 0));
  fx.boom(1000, 400, 'small', 0);
  const bx = fx.booms.filter((b) => b.a).map((b) => b.x);
  assert.equal(bx.length, 40);
  assert.ok(!bx.includes(0) && bx.includes(1000) && bx.includes(390));

  for (let i = 0; i < 60; i++) fx.addCrater(i * 5, 300, 10, 0);
  fx.addCrater(999, 300, 10, 0);
  assert.equal(fx.craters.length, 60);
  assert.ok(
    !fx.craters.some((c) => c.x === 0) && fx.craters.some((c) => c.x === 999) && fx.craters.some((c) => c.x === 295),
  );

  for (let i = 0; i < 24; i++) fx.addWreck({ x: i, y: 300, kind: 'jeep', side: 0 }, 0);
  fx.addWreck({ x: 500, y: 300, kind: 'jeep', side: 0 }, 0);
  assert.equal(fx.wrecks.length, 24);
  assert.ok(
    !fx.wrecks.some((w) => w.x === 0) && fx.wrecks.some((w) => w.x === 500) && fx.wrecks.some((w) => w.x === 23),
  );
});

test('el RNG de efectos es propio y sembrado: misma semilla, mismo resultado; otra semilla, otro; nunca Math.random', () => {
  const corrida = (semilla) => {
    const alea = Math.random;
    Math.random = () => {
      throw new Error('los efectos no usan Math.random');
    };
    try {
      const fx = createFx({ seed: semilla });
      for (let i = 0; i < 30; i++) fx.boom(100 + i * 7, 300, 'large', 4);
      fx.update(0.1, mundoFalso());
      return JSON.stringify(activas(fx).map((p) => [p.x, p.y, p.vx, p.vy, p.l]));
    } finally {
      Math.random = alea;
    }
  };
  assert.equal(corrida('efectos:PE-MX:0'), corrida('efectos:PE-MX:0'));
  assert.notEqual(corrida('efectos:PE-MX:0'), corrida('efectos:PE-MX:1'));
});

test('startMatch resiembra: el mismo partido repite exactamente los mismos efectos', () => {
  const fx = createFx({ seed: 'x' });
  fx.startMatch('efectos:AR-CL:0');
  fx.boom(300, 300, 'huge', 0);
  const a = JSON.stringify(activas(fx).map((p) => [p.x, p.y, p.vx, p.vy]));
  fx.reset();
  fx.startMatch('efectos:AR-CL:0');
  fx.boom(300, 300, 'huge', 0);
  assert.equal(JSON.stringify(activas(fx).map((p) => [p.x, p.y, p.vx, p.vy])), a);
  // otro partido (otra etiqueta), otros efectos: la semilla de startMatch cuenta
  fx.reset();
  fx.startMatch('efectos:AR-CL:1');
  fx.boom(300, 300, 'huge', 0);
  assert.notEqual(JSON.stringify(activas(fx).map((p) => [p.x, p.y, p.vx, p.vy])), a);
});

// ---------------------------------------------------------------------------------------------------------------
// CB-9: caer y desvanecerse, nunca sangre

test('ningún id de efecto ni de sprite casa con sangre/gore/cadáver/ragdoll', () => {
  const ids = [];
  const recoge = (o) => {
    if (o === null || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      ids.push(k);
      if (Array.isArray(v)) {
        for (const x of v) recoge(x);
      } else recoge(v);
    }
  };
  recoge(SPRITES);
  for (const lista of Object.values(FX_IDS)) ids.push(...lista);
  assert.ok(ids.length > 40);
  assert.ok(Object.keys(FX_IDS).length >= 3);
  for (const id of ids) assert.ok(!ROJO_SANGRE.test(id), `el id "${id}" suena a sangre`);
});

test('la muerte de un soldado no suelta partículas rojas: solo polvo y un cuerpo que cae y se desvanece', () => {
  const sc = escena();
  const w = mundoFalso();
  sc.consume([{ type: 'death', id: 1, kind: 'soldado', side: 0, x: 300, y: 300 }], w);
  sc.fx.update(0.2, w);
  const colores = activas(sc.fx).map((p) => p.c ?? '');
  for (const c of colores) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) continue;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    assert.ok(!(r > 140 && g < 90 && b < 90), `partícula roja ${c} en la muerte de un soldado`);
  }
  assert.equal(sc.fx.booms.filter((b) => b.a).length, 0, 'un soldado no explota');
  assert.equal(sc.wrecks.length, 1, 'queda el cuerpo que cae');
});

// ---------------------------------------------------------------------------------------------------------------
// CB-20: vida de restos y cráteres

test('el soldado se desvanece desde 2,5 s y está fuera a los 3,1 s; el vehículo a los 7,5 s; el cráter de 15 a 20 s', () => {
  assert.deepEqual({ ...LIFE }, { soldado: 3.1, soldadoFade: 2.5, vehiculo: 7.5, crater: 20, craterFade: 15 });
  assert.equal(wreckAlpha('soldado', 0), 1);
  assert.equal(wreckAlpha('soldado', 2.4), 1, 'sigue entero justo antes de 2,5 s');
  assert.equal(wreckAlpha('soldado', 2.5), 1);
  assert.ok(wreckAlpha('soldado', 2.7) < 1 && wreckAlpha('soldado', 2.7) > 0);
  assert.equal(wreckAlpha('soldado', 3.1), 0);
  assert.equal(wreckAlpha('tanque', 3), 1, 'el vehículo no se desvanece como el soldado');
  assert.equal(craterAlpha(14.9), 1);
  assert.ok(craterAlpha(17) < 1 && craterAlpha(17) > 0);
  assert.equal(craterAlpha(20), 0);
});

test('un soldado se quita ≤ 3,5 s después de morir, un vehículo a los 7,5 s y un cráter a los 20 s', () => {
  const sc = escena();
  const w = mundoFalso(0);
  sc.consume(
    [
      { type: 'death', id: 1, kind: 'soldado', side: 0, x: 10, y: 10 },
      { type: 'death', id: 2, kind: 'jeep', side: 1, x: 20, y: 10 },
      { type: 'bombImpact', x: 5, y: 5, side: 0 },
    ],
    w,
  );
  w.step = Math.round(3.5 * 30);
  sc.consume([], w);
  assert.deepEqual(
    sc.wrecks.map((r) => r.kind),
    ['jeep'],
    'a los 3,5 s ya no queda el soldado',
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

test('a los 30 s sin combate no queda ningún cuerpo, resto, cráter, explosión ni partícula', () => {
  const sc = escena();
  const w = mundoFalso(0);
  sc.consume(
    [
      { type: 'death', id: 1, kind: 'soldado', side: 0, x: 10, y: 10 },
      { type: 'death', id: 2, kind: 'pesado', side: 1, x: 20, y: 10 },
      { type: 'death', id: 3, kind: 'tanque', side: 1, x: 60, y: 10 },
      { type: 'bombImpact', x: 5, y: 5, side: 0 },
    ],
    w,
  );
  assert.ok(sc.fx.usage().particles > 0 && sc.fx.usage().booms > 0, 'hubo efectos');
  w.step = 30 * 30;
  sc.consume([], w);
  for (let i = 0; i < 30 * 30; i++) sc.fx.update(1 / 30, w);
  assert.deepEqual(sc.fx.usage(), { particles: 0, booms: 0, craters: 0, wrecks: 0 });
});

test('un solo dueño por pool: escena y fx comparten los mismos arreglos de restos y cráteres', () => {
  const sc = escena();
  assert.equal(sc.wrecks, sc.fx.wrecks);
  assert.equal(sc.craters, sc.fx.craters);
  const w = mundoFalso();
  sc.consume([{ type: 'death', id: 1, kind: 'jeep', side: 0, x: 10, y: 10 }], w);
  assert.equal(sc.fx.wrecks.length, 1);
  sc.reset();
  assert.equal(sc.fx.wrecks.length, 0);
  assert.equal(sc.fx.usage().particles, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 5b.1 (aspecto): qué efectos salen de cada evento del sim; ported del prototipo v3

const TIPO = { spark: 0, smoke: 1, fire: 2, dust: 3, debris: 4, muzzle: 6 };
const deTipo = (fx, ty) => fx.particles.filter((p) => p.a && p.ty === ty);
const mundoConBases = (step = 10) => ({
  ...mundoFalso(step),
  bases: [
    { frontX: 110, turrets: [{ x: 100, y: 242 }] },
    { frontX: 1330, turrets: [{ x: 1340, y: 242 }] },
  ],
});

test('un disparo de soldado da un fogonazo diminuto y el del pesado un fogonazo grande con humo de boca', () => {
  const sc = escena();
  const w = mundoConBases();
  sc.consume([{ type: 'shot', id: 1, kind: 'soldado', x: 300, y: 300, tx: 330, ty: 300 }], w);
  assert.equal(deTipo(sc.fx, TIPO.muzzle).length, 1);
  assert.equal(deTipo(sc.fx, TIPO.smoke).length, 0, 'el fusil no humea');
  assert.equal(deTipo(sc.fx, TIPO.muzzle)[0].s, 1);
  sc.consume([{ type: 'shot', id: 2, kind: 'pesado', x: 400, y: 300, tx: 450, ty: 300 }], w);
  const g = deTipo(sc.fx, TIPO.muzzle).find((p) => p.s === 3);
  assert.ok(g, 'el pesado tiene el fogonazo de tamaño 3');
  assert.ok(deTipo(sc.fx, TIPO.smoke).length >= 1, 'el pesado humea por la boca');
  sc.fx.update(0.1, w);
  assert.equal(deTipo(sc.fx, TIPO.muzzle).length, 0, 'el fogonazo dura 0,07 s');
});

test('un golpe suelta chispas en la unidad, como el v3', () => {
  const sc = escena();
  const w = mundoConBases();
  sc.consume([{ type: 'hit', id: 5, x: 300, y: 300, dmg: 10, side: 0 }], w);
  const ch = deTipo(sc.fx, TIPO.spark);
  assert.ok(ch.length >= 1 && ch.length <= 3);
  for (const p of ch) assert.ok(Math.abs(p.x - 300) < 1 && p.y < 300, 'nacen sobre el suelo, en el cuerpo');
});

test('un vehículo que muere explota según su tamaño; el pesado suma cuatro explosiones secundarias', () => {
  const sc = escena();
  const w = mundoConBases();
  const tam = (fx) => fx.booms.filter((b) => b.a).map((b) => b.R);
  sc.consume([{ type: 'death', id: 1, kind: 'jeep', side: 0, x: 200, y: 300 }], w);
  assert.deepEqual(tam(sc.fx), [11]);
  sc.consume([{ type: 'death', id: 2, kind: 'tanque', side: 0, x: 300, y: 300 }], w);
  assert.deepEqual(
    tam(sc.fx).sort((a, b) => a - b),
    [11, 18],
  );
  sc.reset();
  sc.consume([{ type: 'death', id: 3, kind: 'pesado', side: 1, x: 900, y: 300 }], w);
  assert.deepEqual(tam(sc.fx), [28]);
  const chunks = sc.fx.particles.filter((p) => p.a && p.ty === TIPO.debris && p.w > 0);
  assert.ok(chunks.length >= 1, 'el casco sale despedido girando');
  for (let i = 0; i < 12; i++) sc.fx.update(0.1, w); // 1,2 s de vista
  assert.equal(sc.fx.stats.secondary, 4, 'a los .25, .5, .8 y 1.1 s');
});

test('un obús estalla al llegar (mediano; el pesado grande), deja cráter y no lo deja si apuntaba a la base', () => {
  const sc = escena();
  const w = mundoConBases(100);
  // tanque a 135 px: la bala del sim tarda max(1, ceil(135 / 135 · 30))... se toma el tiempo de vuelo de la escena
  sc.consume([{ type: 'shot', id: 1, kind: 'tanque', x: 300, y: 300, tx: 400, ty: 300 }], w);
  const dur = Math.round(sc.projectiles[0].dur * 30);
  assert.equal(sc.fx.booms.filter((b) => b.a).length, 0, 'no explota antes de llegar');
  w.step = 100 + dur - 1;
  sc.consume([], w);
  assert.equal(sc.fx.booms.filter((b) => b.a).length, 0);
  w.step = 100 + dur;
  sc.consume([], w);
  const bs = sc.fx.booms.filter((b) => b.a);
  assert.equal(bs.length, 1);
  assert.equal(bs[0].R, 11);
  assert.equal(sc.craters.length, 1);
  assert.ok(sc.craters[0].r >= 4);
  // sin repetir la explosión en los pasos siguientes
  w.step += 1;
  sc.consume([], w);
  assert.equal(sc.fx.booms.filter((b) => b.a).length, 1);

  const sc2 = escena();
  const w2 = mundoConBases(100);
  sc2.consume([{ type: 'shot', id: 1, kind: 'pesado', x: 1000, y: 300, tx: 1330, ty: 300 }], w2); // a la base derecha
  w2.step = 100 + Math.round(sc2.projectiles[0].dur * 30);
  sc2.consume([], w2);
  assert.equal(sc2.fx.booms.filter((b) => b.a)[0].R, 18, 'el pesado estalla grande');
  assert.equal(sc2.craters.length, 0, 'contra la base no se cava cráter');
});

test('un vehículo destruido arde y humea durante 6 s de juego y después deja de echar fuego', () => {
  const sc = escena();
  const w = mundoConBases(0);
  sc.consume([{ type: 'death', id: 1, kind: 'tanque', side: 0, x: 300, y: 300 }], w);
  sc.fx.update(2, w); // se va la explosión
  const antes = deTipo(sc.fx, TIPO.fire).length + deTipo(sc.fx, TIPO.smoke).length;
  for (let i = 0; i < 10; i++) {
    w.step += 3;
    sc.fx.update(0.1, w);
  }
  const durante = deTipo(sc.fx, TIPO.fire).length + deTipo(sc.fx, TIPO.smoke).length;
  assert.ok(durante > 0 && durante >= antes - 2, 'el resto sigue echando fuego y humo');
  w.step = 7 * 30; // pasados los 6 s
  sc.fx.update(3, w);
  const n0 = sc.fx.stats.spawned;
  for (let i = 0; i < 10; i++) sc.fx.update(0.1, w);
  assert.equal(sc.fx.stats.spawned, n0, 'pasados los 6 s no emite más');
});

test('los aviones echan una bocanada de escape por góndola cada 0,15 s', () => {
  const sc = escena();
  const w = mundoConBases(0);
  w.planes = [{ x: 500, y: 448, z: 64, side: 0 }];
  for (let i = 0; i < 10; i++) sc.fx.update(0.15, w); // 1,5 s
  const total = sc.fx.stats.spawned;
  assert.ok(total >= 18 && total <= 22, `unas 20 bocanadas en 1,5 s (hubo ${total})`);
});

test('con el LOD de marcas no se pintan ni se crean las partículas de 1 px (chispas y polvo)', () => {
  const sc = escena();
  sc.fx.setView({ W: 1920, H: 1080, s: 0.8, marks: true });
  const w = mundoConBases();
  sc.consume(
    [
      { type: 'hit', id: 5, x: 300, y: 300, dmg: 10, side: 0 },
      { type: 'shot', id: 1, kind: 'soldado', x: 300, y: 300, tx: 330, ty: 300 },
      { type: 'death', id: 2, kind: 'soldado', side: 0, x: 200, y: 300 },
    ],
    w,
  );
  assert.equal(deTipo(sc.fx, TIPO.spark).length, 0);
  assert.equal(deTipo(sc.fx, TIPO.dust).length, 0);
});

test('un disparo de torreta también da su fogonazo', () => {
  const sc = escena();
  const w = mundoConBases();
  sc.consume([{ type: 'turretShot', side: 0, k: 0, tx: 140, ty: 250 }], w);
  assert.equal(deTipo(sc.fx, TIPO.muzzle).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// 5b.1: dibujo (la capa 9 de D21), con un proyector y un contexto falsos

const proyector = (mul = 1) => {
  const stats = { culled: 0, drawCalls: 0, marks: false };
  const lists = { entities: createList(1500), particles: createList(LIST_CAPS.particles), labels: createList(24) };
  const P = createProjector(stats, lists);
  P.ctx = createFakeCtx({ record: true });
  P.mul = mul;
  P.offX = 0;
  P.offY = 0;
  P.vx0 = 0;
  P.vy0 = 0;
  P.vx1 = 1440;
  P.vy1 = 810;
  P.frame = { alpha: 0, time: 0, reduced: false, scene: null };
  return P;
};
const argsFinitos = (ctx) =>
  ctx.calls.every(
    ([n, ...a]) => !['fillRect', 'translate', 'rotate'].includes(n) || a.every((v) => Number.isFinite(v)),
  );

test('dibujar efectos: pinta partículas y explosiones sin pasarse de los topes ni producir NaN, en LOW y en la pasada de dispositivo', () => {
  for (const mul of [1, 4]) {
    const sc = escena();
    const w = mundoConBases();
    const P = proyector(mul);
    for (let i = 0; i < 300; i++) {
      sc.fx.boom(100 + (i % 1200), 400, i % 3 ? 'large' : 'huge', 5);
      sc.fx.chunk(300, 300, 1, '#E5484D', 8, 3, 320);
      if (i % 10 === 0) sc.fx.update(0.05, w);
      P.ctx.reset();
      P.lists.particles.clear();
      sc.fx.draw(P);
      assert.ok(P.lists.particles.length <= 600);
      assert.ok(argsFinitos(P.ctx), 'sin NaN en lo que se dibuja');
    }
    assert.ok(P.ctx.byName.fillRect > 20);
    assert.ok(P.stats.drawCalls > 0);
    assert.equal(P.ctx.state.globalAlpha, 1, 'la opacidad vuelve a 1');
  }
});

test('dibujar efectos con la cámara lejos no pinta lo que cae fuera de la vista (recorte)', () => {
  const sc = escena();
  sc.fx.boom(1300, 400, 'huge', 0);
  const P = proyector();
  P.vx0 = 0;
  P.vx1 = 300;
  sc.fx.draw(P);
  assert.equal(P.ctx.byName.fillRect ?? 0, 0);
  assert.ok(P.stats.culled > 0);
});

test('los cráteres se dibujan con su opacidad: enteros hasta los 15 s y borrándose hasta los 20 s', () => {
  const sc = escena();
  sc.fx.addCrater(300, 300, 14, 0);
  const alfa = (edad) => {
    const P = proyector();
    P.frame.alpha = 0;
    sc.step = Math.round(edad * 30);
    sc.fx.drawCraters(P, sc.step);
    return P.ctx.calls.find(([n]) => n === 'set:globalAlpha')?.[1];
  };
  assert.ok(Math.abs(alfa(10) - 0.85) < 1e-9);
  assert.ok(alfa(17) < 0.85 && alfa(17) > 0);
});
