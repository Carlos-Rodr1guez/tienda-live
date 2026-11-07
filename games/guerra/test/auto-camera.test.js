import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTarget, createHeat, createMoments, HEAT_SLOTS, restScale, simViewOf } from '../public/js/camera/auto.js';
import { autoRuns, createCameraRig } from '../public/js/camera/rig.js';
import { createCameraController, fitScale } from '../public/js/camera/controller.js';
import { resolveView } from '../public/js/camera/config.js';
import { CAMERA_TEXT } from '../public/js/camera/text.js';
import { scaleMode } from '../public/js/render/scale.js';

// NM-4 y NM-6 (lote 5c, tareas 5c.3 a 5c.5): la cámara automática encuadra GRUPOS, no unidades. `autoTarget` es una
// función del estado del sim (sin RNG ni reloj de pared); aquí se prueba con vistas de sim armadas a mano.

const EPS = 1e-9;
const FRAME = 1 / 60;
const AUTO = resolveView().auto;

/** Vista del sim mínima: lo que `autoTarget` lee. */
const sv = (o = {}) => ({
  step: o.step ?? 0,
  squads: o.squads ?? [],
  planes: o.planes ?? [],
  dir: [1, -1],
  range: { soldado: 28, jeep: 36, tanque: 44, pesado: 52 },
  events: o.events ?? [],
});
/** Un grupo trabado del lado `side` con miembros de los tipos dados. */
const grupo = (side, x, y, kinds, locked = true) => ({
  side,
  locked,
  kind: kinds[0],
  anchor: { x, y },
  members: kinds.map((kind) => ({ kind })),
});
const soldados = (n) => Array.from({ length: n }, () => 'soldado');
const evento = (x, y, w, step = 0) => ({ x, y, w, step });

test('mismo estado, mismo objetivo: sin RNG ni reloj de pared, y no toca lo que lee', () => {
  const vista = sv({
    squads: [grupo(0, 300, 400, soldados(8)), grupo(1, 380, 420, soldados(6))],
    events: [evento(340, 410, 6, 0)],
    planes: [{ x: 200, y: 300, z: 48, vx: 120 }],
  });
  const copia = JSON.stringify(vista);
  const azar = Math.random;
  const reloj = Date.now;
  Math.random = () => {
    throw new Error('sin azar');
  };
  Date.now = () => {
    throw new Error('sin reloj de pared');
  };
  let a;
  let b;
  try {
    a = autoTarget(vista, null, AUTO);
    b = autoTarget(JSON.parse(copia), null, AUTO);
  } finally {
    Math.random = azar;
    Date.now = reloj;
  }
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(vista), copia, 'solo lee');
  assert.equal(a.all, undefined);
});

test('foco por grupo trabado: el ancla se corre dir·alcance/2 hacia el enemigo y pesa por el tamaño de sus miembros', () => {
  const izq = autoTarget(sv({ squads: [grupo(0, 300, 400, soldados(10))] }), null, AUTO);
  assert.deepEqual(izq.focus, { x: 314, y: 400 }, 'lado izquierdo: +28/2');
  const der = autoTarget(sv({ squads: [grupo(1, 900, 400, soldados(10))] }), null, AUTO);
  assert.deepEqual(der.focus, { x: 886, y: 400 }, 'lado derecho: −28/2');
  const tanques = autoTarget(sv({ squads: [grupo(0, 300, 400, ['tanque', 'tanque'])] }), null, AUTO);
  assert.deepEqual(tanques.focus, { x: 322, y: 400 }, 'el alcance del tanque es 44');
  // 3 pesados (peso 12) en un lado le ganan a 10 soldados (peso 10) en el otro; 10 soldados le ganan a 2 tanques (6)
  const lejosA = grupo(0, 300, 300, soldados(10));
  const lejosB = grupo(1, 1100, 500, ['pesado', 'pesado', 'pesado']);
  assert.equal(autoTarget(sv({ squads: [lejosA, lejosB] }), null, AUTO).focus.x, 1100 - 26);
  const lejosC = grupo(1, 1100, 500, ['tanque', 'tanque']);
  assert.equal(autoTarget(sv({ squads: [lejosA, lejosC] }), null, AUTO).focus.x, 314);
  // un grupo que no está trabado (en marcha o formando) no aporta calor
  assert.deepEqual(autoTarget(sv({ squads: [grupo(0, 300, 400, soldados(10), false)] }), null, AUTO), { all: true });
});

test('foco por eventos: w·exp(−edad/2,5 s) hasta los 5 s, con la edad en pasos del sim', () => {
  // A pesa 6 y envejece 2,5 s (75 pasos) → 2,207; B pesa 2 y es nuevo → gana B. Con 3,5 s (105 pasos) A vale 1,479 < 2
  const A = (step) => evento(300, 300, 6, step);
  const B = (step) => evento(1100, 500, 2, step);
  const a = autoTarget(sv({ step: 175, events: [A(100), B(175)] }), null, AUTO);
  assert.equal(a.focus.x, 300, 'A con 2,5 s todavía vale 2,207 > 2');
  const aunMas = autoTarget(sv({ step: 205, events: [A(100), B(205)] }), null, AUTO);
  assert.equal(aunMas.all, undefined);
  assert.equal(aunMas.focus.x, 1100, 'a los 3,5 s A vale 1,479 < 2 y B gana');
  // a los 5,01 s ya no cuenta nada: con un solo evento viejo, mapa entero
  assert.deepEqual(autoTarget(sv({ step: 100 + 151, events: [A(100)] }), null, AUTO), { all: true });
  // un evento nuevo de peso 6 solo ya es foco (total ≥ 3)
  assert.equal(autoTarget(sv({ step: 100, events: [A(100)] }), null, AUTO).focus.x, 300);
});

test('foco por aviones: un punto adelante en la ruta (x + vx·1,2, y − z/2) con peso 3, y el objetivo queda adelante', () => {
  const ida = autoTarget(sv({ planes: [{ x: 300, y: 400, z: 48, vx: 120 }] }), null, AUTO);
  assert.deepEqual(ida.focus, { x: 444, y: 376 });
  assert.ok(ida.cx > 300, 'el objetivo queda adelante del avión');
  const vuelta = autoTarget(sv({ planes: [{ x: 1000, y: 400, z: 48, vx: -120 }] }), null, AUTO);
  assert.deepEqual(vuelta.focus, { x: 856, y: 376 });
  assert.ok(vuelta.cx < 1000);
});

test('calor en ±135×±83: dos focos cercanos suman y le ganan a uno solo más fuerte; lejos ya no suman', () => {
  const solo = evento(1100, 500, 7);
  const cerca = [evento(300, 300, 5), evento(300 + 130, 300 + 80, 5)];
  assert.ok(autoTarget(sv({ events: [...cerca, solo] }), null, AUTO).focus.x < 500, 'el par suma 10 > 7');
  const lejos = [evento(300, 300, 5), evento(300 + 140, 300, 5)];
  assert.equal(autoTarget(sv({ events: [...lejos, solo] }), null, AUTO).focus.x, 1100, '140 px: no suman');
  const altos = [evento(300, 300, 5), evento(300, 300 + 84, 5)];
  assert.equal(autoTarget(sv({ events: [...altos, solo] }), null, AUTO).focus.x, 1100, '84 px de alto: no suman');
});

test('la caja de calor (heatBox, ±135×±83) es configurable y el nombre no choca con el escáner de pureza', () => {
  assert.deepEqual(AUTO.heatBox, [135, 83]);
  assert.equal('window' in AUTO, false);
  const par = [evento(300, 300, 5), evento(300 + 130, 300 + 80, 5)];
  const solo = evento(1100, 500, 7);
  const angosta = resolveView({ auto: { heatBox: [50, 50] } }).auto;
  assert.equal(
    autoTarget(sv({ events: [...par, solo] }), null, angosta).focus.x,
    1100,
    'con una caja angosta no suman',
  );
  assert.deepEqual(resolveView({ auto: { heatBox: 'x' } }).auto.heatBox, [135, 83]);
});

test('conserva el foco si todavía tiene ≥ 80 % del mejor; si no, cambia', () => {
  const A = evento(300, 300, 10);
  const B = (w) => evento(1100, 500, w);
  const prevB = { x: 1100, y: 500 };
  assert.deepEqual(autoTarget(sv({ events: [A, B(8.5)] }), prevB, AUTO).focus, prevB, '8,5 ≥ 0,8·10: lo conserva');
  assert.equal(autoTarget(sv({ events: [A, B(7.5)] }), prevB, AUTO).focus.x, 300, '7,5 < 8: pasa al mejor');
  assert.equal(autoTarget(sv({ events: [A, B(8.5)] }), null, AUTO).focus.x, 300, 'sin foco previo gana el mejor');
});

test('vuelve al mapa entero si el mejor tiene < 30 % del total (peleas en 4 sitios) o el total es chico', () => {
  const cuatro = [evento(200, 150, 5), evento(1200, 150, 5), evento(200, 650, 5), evento(1200, 650, 5)];
  assert.deepEqual(autoTarget(sv({ events: cuatro }), null, AUTO), { all: true }, '25 % cada uno');
  const tres = cuatro.slice(0, 3);
  assert.equal(autoTarget(sv({ events: tres }), null, AUTO).all, undefined, '33 %: hay foco');
  // el total chico: un soldado peleando solo (1) o un jeep solo (2) no mueve la cámara
  assert.deepEqual(autoTarget(sv({ squads: [grupo(0, 300, 400, ['soldado'])] }), null, AUTO), { all: true });
  assert.deepEqual(autoTarget(sv({ squads: [grupo(0, 300, 400, ['jeep'])] }), null, AUTO), { all: true });
  assert.equal(autoTarget(sv({ squads: [grupo(0, 300, 400, ['tanque'])] }), null, AUTO).all, undefined);
  assert.deepEqual(autoTarget(sv(), null, AUTO), { all: true }, 'sin nada, el mapa entero');
});

test('semitamaño ≥ 220×124: el techo real de k lo pone minHalf (1,96), no maxK', () => {
  const chico = autoTarget(sv({ squads: [grupo(0, 300, 400, soldados(6))] }), null, AUTO);
  assert.ok(Math.abs(chico.k - 486 / 248) < EPS, `k ${chico.k}`);
  // subir solo maxK no cambia nada
  const maxK3 = resolveView({ auto: { maxK: 3 } }).auto;
  assert.equal(autoTarget(sv({ squads: [grupo(0, 300, 400, soldados(6))] }), null, maxK3).k, chico.k);
  // bajar minHalf es lo que acerca (con maxK que lo deje)
  const cerca = resolveView({ auto: { maxK: 3, minHalf: [192, 108] } }).auto;
  const r = autoTarget(sv({ squads: [grupo(0, 300, 400, soldados(6))] }), null, cerca);
  assert.ok(Math.abs(r.k - 486 / 216) < EPS, `k ${r.k}`);
  // y con la perilla por defecto de maxK (2) y minHalf bajo, manda maxK
  const sinTecho = resolveView({ auto: { minHalf: [192, 108] } }).auto;
  assert.equal(autoTarget(sv({ squads: [grupo(0, 300, 400, soldados(6))] }), null, sinTecho).k, 2);
  // un cúmulo ancho encuadra más lejos: nunca k < 1
  const ancho = autoTarget(
    sv({
      squads: [grupo(0, 200, 400, soldados(8)), grupo(0, 380, 400, soldados(8)), grupo(1, 560, 400, soldados(8))],
    }),
    null,
    AUTO,
  );
  assert.ok(ancho.k >= 1 && ancho.k <= 1.96 + EPS);
});

test('el encuadre abarca los focos a ±240×±150 con 2σ + 45 de ancho y 2σ + 36 de alto', () => {
  // a lo ancho: centro de peso 5 y dos de peso 5 a ±240 → σx = sqrt(2·240²·5/15) = 195,96 → hx = 436,9 → k = 1440/(2hx)
  const ancho = autoTarget(sv({ events: [evento(700, 300, 5), evento(460, 300, 5), evento(940, 300, 5)] }), null, AUTO);
  const sx = Math.sqrt((2 * 240 * 240 * 5) / 15);
  assert.ok(Math.abs(ancho.k - 1440 / (2 * (2 * sx + 45))) < 1e-9, `k ${ancho.k}`);
  assert.ok(Math.abs(ancho.cx - 700) < 1e-9);
  // a lo alto: tres focos a 100 px de distancia → σy = sqrt(2·100²/3) = 81,65 → hy = 199,3 → k = 0,6·810/(2hy)
  const alto = autoTarget(sv({ events: [evento(700, 405, 5), evento(700, 305, 5), evento(700, 505, 5)] }), null, AUTO);
  const sy = Math.sqrt((2 * 100 * 100) / 3);
  assert.ok(Math.abs(alto.k - 486 / (2 * (2 * sy + 36))) < 1e-9, `k ${alto.k}`);
  // un foco fuera de ±240 no entra en el encuadre
  const lejos = autoTarget(sv({ events: [evento(700, 300, 5), evento(700 + 241, 300, 5)] }), null, AUTO);
  assert.ok(Math.abs(lejos.cx - 700) < 1e-9);
});

test('un soldado solo o un cúmulo de 3 grupos dan k ≤ maxK, y en el cúmulo toda el área queda dentro de la vista', () => {
  const uno = autoTarget(sv({ squads: [grupo(0, 300, 400, ['pesado'])] }), null, AUTO);
  assert.ok(uno.k <= AUTO.maxK + EPS);
  const solo = autoTarget(sv({ squads: [grupo(0, 300, 400, ['soldado'])] }), null, AUTO);
  assert.ok(solo.all === true || solo.k <= AUTO.maxK + EPS);
  const tres = [grupo(0, 300, 380, soldados(8)), grupo(0, 340, 440, soldados(8)), grupo(1, 400, 410, soldados(8))];
  const r = autoTarget(sv({ squads: tres }), null, AUTO);
  assert.ok(r.k <= AUTO.maxK + EPS);
  // cada foco del cúmulo cabe en la mitad de la vista de esa k (con el aire de las bandas del HUD)
  const dir = [1, -1];
  for (const g of tres) {
    const x = g.anchor.x + (dir[g.side] * 28) / 2;
    assert.ok(Math.abs(x - r.cx) <= 720 / r.k, `x ${x} dentro`);
    assert.ok(Math.abs(g.anchor.y - r.cy) <= 405 / r.k, `y ${g.anchor.y} dentro`);
  }
  // sube el centro 0,015·810/k por las bandas del HUD
  const sinHud = autoTarget(sv({ squads: tres }), null, resolveView({ auto: { hudLift: 0 } }).auto);
  assert.ok(Math.abs(r.cy - sinHud.cy - (0.015 * 810) / r.k) < 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------
// El controlador con la automática (5c.3): tras idleSeconds sin entrada va al combate más caliente

/** Controlador + vista del sim; avanza `secs` con la vista del sim dada. */
function mk(W = 1920, H = 1080, o = {}) {
  return createCameraController({
    canvas: { w: W, h: H },
    view: resolveView(o.view),
    reducedMotion: o.reduced ?? false,
  });
}
function run(c, secs, vista) {
  for (let i = 0; i < Math.round(secs * 60); i++) c.update(FRAME, vista);
}
const peleaA = () => sv({ squads: [grupo(0, 300, 400, soldados(10)), grupo(1, 350, 420, soldados(10))] });
const peleaB = () => sv({ squads: [grupo(0, 1000, 500, soldados(10)), grupo(1, 1050, 520, soldados(10))] });

test('tras view.idleSeconds (7 s) sin entrada del narrador, el objetivo pasa al combate más caliente', () => {
  const c = mk();
  run(c, 6.9, peleaA());
  assert.equal(c.state.k, 1, 'antes de los 7 s no se mueve solo');
  assert.notEqual(c.state.mode, 'auto');
  run(c, 0.3, peleaA());
  assert.equal(c.state.mode, 'auto');
  assert.ok(c.state.k > 1, 'va a un plano de grupo');
  run(c, 6, peleaA());
  const v = c.viewRect();
  // el combate (x ≈ 300-350) queda dentro de la vista
  assert.ok(v.x0 < 300 && v.x0 + 1920 / v.s > 350);
  // sin la vista del sim (fuera de batalla) la automática no corre
  const d = mk();
  run(d, 20, null);
  assert.equal(d.state.k, 1);
  assert.notEqual(d.state.mode, 'auto');
  // idleSeconds se configura
  const e = mk(1920, 1080, { view: { idleSeconds: 3 } });
  run(e, 2.9, peleaA());
  assert.notEqual(e.state.mode, 'auto');
  run(e, 0.3, peleaA());
  assert.equal(e.state.mode, 'auto');
});

test('si la acción está repartida, la automática vuelve al mapa entero (k = 1)', () => {
  const c = mk();
  run(c, 7.5, peleaA());
  assert.ok(c.state.k > 1);
  const cuatro = sv({
    events: [evento(200, 150, 5), evento(1200, 150, 5), evento(200, 650, 5), evento(1200, 650, 5)],
  });
  run(c, 3, cuatro);
  assert.equal(c.state.k, 1);
  assert.equal(c.state.mode, 'auto');
});

test('reevalúa cada 1,5 s, no cada cuadro', () => {
  const c = mk();
  run(c, 7.05, peleaA());
  const x = c.state.tx;
  assert.ok(x < 500, 'apunta al combate A');
  run(c, 0.9, peleaB()); // 0,9 s después de elegir: todavía no reevalúa
  assert.equal(c.state.tx, x);
  run(c, 1.2, peleaB()); // ya pasaron los 1,5 s
  assert.ok(c.state.tx > 700, 'apunta al combate B');
});

test('el narrador gana en el mismo tick: la automática se detiene, el contador vuelve a 0 y la marca no la mueve la automática', () => {
  const c = mk();
  run(c, 9, peleaA());
  assert.equal(c.state.mode, 'auto');
  assert.equal(c.lastStreamerInput, 0, 'los movimientos automáticos no son entrada del narrador');
  assert.ok(c.state.idle > 8);
  const kAntes = c.state.kShown;
  c.input('wheel', { dy: -10, deltaMode: 0, ctrl: false, x: 960, y: 540 });
  assert.equal(c.state.mode, 'manual');
  assert.equal(c.state.idle, 0);
  assert.equal(c.lastStreamerInput, c.clock);
  // el movimiento automático se canceló: la vista no sigue yendo al objetivo
  const cx = c.state.cx;
  run(c, 2, peleaA());
  assert.equal(c.state.mode, 'manual');
  assert.ok(Math.abs(c.state.cx - cx) < 1e-9, 'quieta');
  assert.ok(Math.abs(c.state.kShown - kAntes) < 1e-9 || c.state.kShown === c.state.k);
  // y 7 s después de la última entrada, vuelve a tomar el control
  run(c, 5.1, peleaA());
  assert.equal(c.state.mode, 'auto');
});

test('seguir a alguien frena a la automática; dejar de seguir la devuelve', () => {
  const c = mk();
  c.follow(() => ({ x: 600, y: 400 }));
  run(c, 12, peleaA());
  assert.equal(c.state.mode, 'follow');
  c.stopFollow(); // la acción del narrador (Shift+S): es una entrada de cámara y reinicia el contador
  assert.equal(c.state.idle, 0);
  assert.equal(c.lastStreamerInput, c.clock);
  run(c, 6.5, peleaA());
  assert.equal(c.state.mode, 'manual', 'la automática espera sus 7 s desde que el narrador soltó el seguimiento');
  run(c, 1, peleaA());
  assert.equal(c.state.mode, 'auto');
});

test('la automática va eased (ease-out) con su τ lento: se acerca al objetivo sin pasarse y sin saltos de cuadro', () => {
  const c = mk();
  run(c, 6.9, peleaA()); // todavía manda el narrador: se mide desde el primer cuadro en que la automática arranca
  let prev = c.state.kShown;
  let maxPaso = 0;
  for (let i = 0; i < 60 * 9; i++) {
    c.update(FRAME, peleaA());
    assert.ok(c.state.kShown <= c.state.k + EPS && c.state.kShown >= prev - EPS);
    maxPaso = Math.max(maxPaso, c.state.kShown - prev);
    prev = c.state.kShown;
  }
  assert.ok(maxPaso < 0.01, `sin saltos (paso máximo ${maxPaso}): τ de 1,2 s, no el de 0,1 s de los niveles`);
  assert.equal(prev, 1.5);
});

// ---------------------------------------------------------------------------------------------------------------
// 5c.4: reposo de la automática (restScale), estado visible, movimiento reducido y la tecla A

const esEntero = (n) => Math.abs(n - Math.round(n)) < 1e-6;

test('restScale: bajo 1,9 reposa fraccional, en [1,9, 2) se recorta a 1,89, desde 2 baja al entero, y nunca baja de fd', () => {
  const fd = fitScale(1920, 1080); // 1,333
  assert.equal(restScale(1.8, fd), 1.8);
  assert.equal(restScale(1.86, fd), 1.86);
  assert.equal(restScale(1.89, fd), 1.89);
  assert.equal(restScale(1.9, fd), 1.89);
  assert.equal(restScale(1.95, fd), 1.89, 'nunca queda en [1,9, 2)');
  assert.equal(restScale(1.999, fd), 1.89);
  assert.equal(restScale(2, fd), 2);
  assert.equal(restScale(2.0000000000000004, fd), 2);
  assert.equal(restScale(2.4, fd), 2);
  assert.equal(restScale(3.0, fd), 3);
  assert.equal(restScale(2.9999999999999996, fd), 3, 'el error de coma flotante no baja un nivel');
  assert.equal(restScale(7.9, fd), 7);
  // nunca baja de la escala de ajuste
  assert.equal(restScale(1.2, fd), fd);
  assert.equal(restScale(2.9, fitScale(3840, 2160)), fitScale(3840, 2160), 'en 4K, s = 2,9 queda en fd = 2,667');
  assert.equal(restScale(0.87, fitScale(640, 360)), 0.87);
});

/** El reposo de la automática en una ventana: s, modo de escala y k. */
function reposo(W, H, view) {
  const c = mk(W, H, { view });
  run(c, 40, peleaA());
  const v = c.viewRect();
  return { s: v.s, k: v.s / fitScale(W, H), mode: scaleMode(v.s).mode, c };
}

test('reposo de la automática con el techo (k ≤ 1,96): 1080p s = 2, 1440×810 en 1,89, 1366×768 ≈ 1,86, 1280×720 ≈ 1,74, 640×360 ≈ 0,87, 4K en 5', () => {
  const a = reposo(1920, 1080);
  assert.equal(a.s, 2);
  assert.ok(Math.abs(a.k - 1.5) < 1e-9);
  assert.equal(a.mode, 'nearest');
  const b = reposo(1440, 810);
  assert.equal(b.s, 1.89);
  assert.equal(b.mode, 'sharp');
  const c = reposo(1366, 768);
  assert.ok(Math.abs(c.s - 1.858) < 0.002, `1366×768: ${c.s}`);
  assert.equal(c.mode, 'sharp');
  const d = reposo(1280, 720);
  assert.ok(Math.abs(d.s - 1.742) < 0.002, `1280×720: ${d.s}`);
  assert.equal(d.mode, 'sharp');
  const e = reposo(640, 360);
  assert.ok(Math.abs(e.s - 0.871) < 0.002, `640×360: ${e.s}`);
  assert.equal(e.mode, 'smooth', 'bajo 1 es suave con marcas, no nítido');
  const f = reposo(3840, 2160);
  assert.equal(f.s, 5);
  assert.equal(f.mode, 'nearest');
  // con maxK 2,25 sigue en s = 2 en 1080p (el techo lo pone minHalf)
  assert.equal(reposo(1920, 1080, { auto: { maxK: 2.25 } }).s, 2);
  // para k 2,25 hace falta además bajar minHalf (Decisión 10 (a), tras el primer LIVE)
  const cerca = reposo(1920, 1080, { auto: { maxK: 2.25, minHalf: [192, 108] } });
  assert.equal(cerca.s, 3);
  assert.ok(Math.abs(cerca.k - 2.25) < 1e-9);
  // nunca baja de fd
  for (const [W, H] of [
    [1920, 1080],
    [1280, 720],
    [640, 360],
    [3840, 2160],
  ]) {
    assert.ok(reposo(W, H).s >= fitScale(W, H) - 1e-9);
  }
  assert.ok(esEntero(a.s));
});

test('estado visible: "CÁMARA AUTO" mientras maneja y "CÁMARA MANUAL" si no; apagada no se mueve sola en 60 s', () => {
  assert.equal(CAMERA_TEXT.auto, 'CÁMARA AUTO');
  assert.equal(CAMERA_TEXT.manual, 'CÁMARA MANUAL');
  const c = mk();
  assert.equal(c.status(), CAMERA_TEXT.manual, 'recién empezada ya está en manual');
  run(c, 7.5, peleaA());
  assert.equal(c.status(), CAMERA_TEXT.auto);
  c.input('press', {});
  assert.equal(c.status(), CAMERA_TEXT.manual, 'el narrador la pasa a manual en el mismo tick');
  // la tecla A la apaga: no se mueve sola en 60 s
  const d = mk();
  assert.equal(d.state.autoEnabled, true);
  assert.equal(d.toggleAuto().on, false);
  const antes = d.viewRect();
  run(d, 60, peleaA());
  assert.deepEqual(d.viewRect(), antes);
  assert.equal(d.status(), CAMERA_TEXT.manual);
  // y al prenderla vuelve a manejar (alternarla no es mover la cámara: no reinicia el contador)
  assert.equal(d.toggleAuto().on, true);
  run(d, 0.1, peleaA());
  assert.equal(d.status(), CAMERA_TEXT.auto);
  assert.ok(d.state.k > 1);
  // apagarla en pleno movimiento la deja donde está (en posición) y termina la transición en un nivel
  const cx = d.state.cx;
  assert.equal(d.toggleAuto().on, false);
  assert.equal(d.status(), CAMERA_TEXT.manual, 'en el mismo tick, sin esperar al cuadro siguiente');
  run(d, 4, peleaA());
  assert.ok(Math.abs(d.state.cx - cx) < 60, 'la posición no salta');
  assert.equal(d.state.kShown, d.state.k);
  assert.ok(d.state.level >= 0, 'el reposo manual es un nivel');
  const parada = d.viewRect();
  run(d, 5, peleaA());
  assert.deepEqual(d.viewRect(), parada);
});

/** Automática en plena transición: arrancó hace 1,5 s y su τ es de 1,2 s. */
function aMitad(W = 1920, H = 1080) {
  const c = mk(W, H);
  run(c, 8.5, peleaA());
  assert.equal(c.state.mode, 'auto');
  assert.notEqual(c.state.kShown, c.state.k, 'a mitad de transición');
  return c;
}
const enNivel = (c) => {
  const v = c.viewRect();
  assert.ok(c.state.level >= 0, `level ${c.state.level}`);
  assert.equal(c.state.kShown, c.state.k);
  assert.ok(esEntero(v.s) || Math.abs(v.s - c.fd) < 1e-9, `s ${v.s}`);
  assert.ok(c.levels().some((l) => Math.abs(l - v.s) < 1e-9));
};

test('detener la automática a mitad de transición termina en un nivel: A y botón, R, pulsación y seguir', () => {
  const acciones = {
    'A o botón': (c) => c.toggleAuto(),
    R: (c) => c.syncReduced(true),
    pulsación: (c) => c.input('press', {}),
    rueda: (c) => c.input('wheel', { dy: -10, deltaMode: 0, ctrl: false, x: 960, y: 540 }),
    seguir: (c) => c.follow(() => ({ x: 600, y: 400 })),
  };
  for (const [nombre, accion] of Object.entries(acciones)) {
    const c = aMitad();
    accion(c);
    run(c, 4, null);
    enNivel(c);
    assert.notEqual(c.state.mode, 'auto', nombre);
  }
});

test('con la automática ya en reposo fraccional, apagarla o pulsar lo deja como está; seguir desde ahí termina en un nivel', () => {
  const reposoFraccional = () => {
    const c = mk(1280, 720); // s ≈ 1,74 (nítido)
    run(c, 40, peleaA());
    assert.equal(c.state.level, -1);
    return c;
  };
  for (const accion of [(c) => c.toggleAuto(), (c) => c.input('press', {}), (c) => c.syncReduced(true)]) {
    const c = reposoFraccional();
    const s = c.viewRect().s;
    accion(c);
    run(c, 3, null);
    assert.equal(c.state.level, -1, 'es un reposo válido de la automática: no se mueve');
    assert.equal(c.viewRect().s, s);
  }
  const c = reposoFraccional();
  c.follow(() => ({ x: 600, y: 400 }));
  run(c, 4, null);
  enNivel(c);
});

test('detener la automática con movimiento reducido no anima: el ajuste al nivel es instantáneo', () => {
  const c = aMitad();
  c.syncReduced(true);
  assert.equal(c.state.kShown, c.state.k, 'sin transición pendiente');
  assert.ok(c.state.level >= 0);
});

test('los avisos de la tecla A salen de una constante de textos', () => {
  const c = mk();
  assert.equal(c.toggleAuto().notice, CAMERA_TEXT.autoOff);
  assert.equal(c.toggleAuto().notice, CAMERA_TEXT.autoOn);
  assert.equal(CAMERA_TEXT.autoOff, 'Cámara automática: desactivada');
  assert.equal(CAMERA_TEXT.autoOn, 'Cámara automática: activada');
  for (const t of Object.values(CAMERA_TEXT)) assert.doesNotMatch(t, /guerra|trench|warfare|1917|\bdirecto\b/i);
  assert.equal(Object.isFrozen(CAMERA_TEXT), true);
});

test('movimiento reducido: la automática arranca apagada, y A la prende', () => {
  const c = mk(1920, 1080, { reduced: true });
  assert.equal(c.state.autoEnabled, false);
  const antes = c.viewRect();
  run(c, 60, peleaA());
  assert.deepEqual(c.viewRect(), antes);
  assert.equal(c.status(), CAMERA_TEXT.manual);
  assert.equal(c.toggleAuto().on, true);
  run(c, 0.1, peleaA());
  assert.equal(c.status(), CAMERA_TEXT.auto);
  // la config también la apaga por defecto
  const d = mk(1920, 1080, { view: { auto: { enabled: false } } });
  assert.equal(d.state.autoEnabled, false);
});

test('R en pleno LIVE apaga también la automática ("Cámara automática: desactivada"), A la prende y apagar R deja A como estaba', () => {
  const c = mk();
  run(c, 8, peleaA());
  assert.equal(c.status(), CAMERA_TEXT.auto);
  assert.equal(c.syncReduced(false), null, 'sin cambio, sin aviso');
  assert.equal(c.syncReduced(true), CAMERA_TEXT.autoOff, 'R encendió el movimiento reducido');
  // el estado se sigue cada cuadro: con el movimiento reducido todavía activo, A la prende y NO se vuelve a apagar sola
  assert.equal(c.toggleAuto().on, true);
  assert.equal(c.syncReduced(true), null);
  assert.equal(c.state.autoEnabled, true);
  assert.equal(c.toggleAuto().on, false);
  assert.equal(c.state.autoEnabled, false);
  assert.equal(c.status(), CAMERA_TEXT.manual);
  const parada = c.viewRect();
  run(c, 10, peleaA());
  assert.deepEqual(c.viewRect(), parada, 'la automática quedó apagada y la vista, quieta');
  assert.equal(c.syncReduced(true), null, 'no repite el aviso');
  // A la vuelve a prender aun con movimiento reducido
  assert.equal(c.toggleAuto().on, true);
  run(c, 0.1, peleaA());
  assert.equal(c.status(), CAMERA_TEXT.auto);
  // apagar el movimiento reducido deja A como estaba (prendida)
  assert.equal(c.syncReduced(false), null);
  assert.equal(c.state.autoEnabled, true);
  // y si estaba apagada, sigue apagada
  c.toggleAuto();
  assert.equal(c.state.autoEnabled, false);
  assert.equal(c.syncReduced(true), null, 'ya estaba apagada: nada que avisar');
  assert.equal(c.syncReduced(false), null);
  assert.equal(c.state.autoEnabled, false);
});

test('tras un reposo fraccional de la automática, el zoom o el paneo manual terminan en un nivel (NM-6)', () => {
  const nivel = (accion) => {
    const c = mk(1440, 810); // fd = 1: la automática reposa en 1,89
    run(c, 40, peleaA());
    assert.equal(c.viewRect().s, 1.89);
    assert.equal(c.state.level, -1, 'reposa entre niveles');
    accion(c);
    run(c, 6, null);
    const v = c.viewRect();
    assert.ok(esEntero(v.s) || Math.abs(v.s - c.fd) < 1e-9, `s ${v.s}`);
    assert.ok(c.levels().some((l) => Math.abs(l - v.s) < 1e-9));
    return v;
  };
  assert.equal(nivel((c) => c.panBy(40, 10)).s, 2, 'el paneo pasa al nivel más cercano');
  assert.equal(nivel((c) => c.input('drag', { dx: -40, dy: 5 })).s, 2);
  assert.equal(nivel((c) => c.input('minimap', { wx: 500, wy: 300 })).s, 2);
  assert.equal(nivel((c) => c.input('factor', { f: 1.25 })).s, 2, 'los factores van al primer nivel en ese sentido');
  assert.equal(nivel((c) => c.input('factor', { f: 0.8 })).s, 1, 'y hacia abajo, al de abajo');
  assert.equal(nivel((c) => c.input('wheel', { dy: -100, deltaMode: 0, ctrl: false, x: 720, y: 405 })).s, 2);
  assert.equal(
    nivel((c) => {
      // una muesca hacia abajo no alcanza el punto medio con 1,89 (1,578 > 1,375); dos sí
      c.input('wheel', { dy: 100, deltaMode: 0, ctrl: false, x: 720, y: 405 });
      c.input('wheel', { dy: 100, deltaMode: 0, ctrl: false, x: 720, y: 405 });
    }).s,
    1,
  );
  assert.equal(nivel((c) => c.zoomToLevel(3)).s, 4);
  assert.equal(
    nivel((c) => {
      c.input('keys', { x: 1, y: 0 });
      c.update(FRAME);
      c.input('keys', { x: 0, y: 0 });
    }).s,
    2,
  );
});

// ---------------------------------------------------------------------------------------------------------------
// 5c.5: momento de regalo grande (NM-5): el banner siempre, y el calor decae; no hay toma de control de la cámara

const MOMENTO = (o = {}) => ({ kind: 'gift', x: 1100, y: 500, coins: 600, owner: 'ana', ...o });

/** Combate chico en A (peso 4) y, en B, un momento de peso 6: B gana si el momento cuenta. */
const combateChico = (events) =>
  sv({ squads: [grupo(0, 300, 400, soldados(2)), grupo(1, 350, 420, soldados(2))], events });

test('el banner sale siempre; la cámara no se mueve si el narrador la movió hace 3 s o si la automática está apagada', () => {
  // el narrador movió la cámara hace 3 s: la automática todavía no manda (7 s)
  const heat = createHeat();
  const moments = createMoments({ heat, enabled: true, limit: 3, coins: 500 });
  const c = mk();
  c.input('wheel', { dy: -10, deltaMode: 0, ctrl: false, x: 960, y: 540 });
  run(c, 3, combateChico(heat.slots));
  const antes = c.viewRect();
  const r = moments.push(MOMENTO(), { step: 0, reduced: false });
  assert.equal(r.banner, true);
  run(c, 1, combateChico(heat.slots));
  assert.deepEqual(c.viewRect(), antes, 'la cámara no se movió');
  assert.equal(moments.drainBanners().length, 1, 'el banner igual sale');
  assert.equal(moments.drainBanners().length, 0, 'y se vacía');

  // automática apagada (con 7 s o más de inactividad): tampoco se mueve
  const heat2 = createHeat();
  const m2 = createMoments({ heat: heat2, enabled: true, limit: 3, coins: 500 });
  const d = mk();
  d.toggleAuto();
  run(d, 10, combateChico(heat2.slots));
  const parada = d.viewRect();
  m2.push(MOMENTO({ kind: 'plane', coins: 0 }), { step: 0, reduced: false });
  run(d, 3, combateChico(heat2.slots));
  assert.deepEqual(d.viewRect(), parada);
  assert.equal(m2.drainBanners()[0].kind, 'plane', 'el banner del avión sale igual');
});

test('con la automática encendida y 7 s inactiva, el foco de peso 6 que decae puede mover el objetivo', () => {
  const sin = mk();
  const heatSin = createHeat();
  run(sin, 7.1, combateChico(heatSin.slots));
  assert.ok(sin.state.tx < 700, 'sin momento, va al combate de A');

  const heat = createHeat();
  const moments = createMoments({ heat, enabled: true, limit: 3, coins: 500 });
  moments.push(MOMENTO(), { step: 0, reduced: false });
  const c = mk();
  run(c, 7.1, combateChico(heat.slots));
  assert.ok(c.state.tx > 700, 'con el momento, el objetivo pasa a B');
  assert.equal(c.status(), CAMERA_TEXT.auto);
  // el foco decae: 5 s después ya no cuenta (la vista del sim avanzó 150 pasos) y vuelve al combate de A
  const viejo = (events) => ({ ...combateChico(events), step: 200 });
  run(c, 3, viejo(heat.slots));
  assert.ok(c.state.tx < 700, 'el momento venció');
});

test('graphics.bigGiftMoment = false lo anula (el banner igual sale) y respeta el umbral de monedas', () => {
  const heat = createHeat();
  const off = createMoments({ heat, enabled: false, limit: 3, coins: 500 });
  const r = off.push(MOMENTO(), { step: 0, reduced: false });
  assert.deepEqual([r.banner, r.camera], [true, false]);
  assert.ok(
    heat.slots.every((s) => s.w === 0),
    'ningún calor',
  );
  assert.equal(off.drainBanners().length, 1);

  const on = createMoments({ heat: createHeat(), enabled: true, limit: 3, coins: 500 });
  assert.equal(on.gift({ coins: 499, x: 1, y: 1 }, { step: 0, reduced: false }), null, 'bajo el umbral no hay momento');
  assert.equal(on.drainBanners().length, 0);
  assert.equal(on.gift({ coins: 500, x: 1, y: 1 }, { step: 0, reduced: false }).banner, true);
  assert.equal(on.drainBanners()[0].coins, 500);
});

test('cola de 3 con 5 momentos en un segundo: quedan los 3 más nuevos; los vencidos no cuentan contra el límite', () => {
  const heat = createHeat();
  const moments = createMoments({ heat, enabled: true, limit: 3, coins: 500 });
  for (let i = 0; i < 5; i++) moments.push(MOMENTO({ x: 100 + i * 300 }), { step: i * 6, reduced: false });
  const vivos = heat.slots.filter((s) => s.w > 0).map((s) => s.x);
  assert.deepEqual(
    vivos.sort((a, b) => a - b),
    [700, 1000, 1300],
    'los 3 más nuevos',
  );
  assert.equal(moments.drainBanners().length, 5, 'los 5 banners salen');
  // a los 7 s los tres vencieron: uno nuevo entra sin sacar a nadie
  moments.push(MOMENTO({ x: 50 }), { step: 24 + 7 * 30, reduced: false });
  assert.equal(moments.active(24 + 7 * 30), 1);
  // el límite se configura
  const h2 = createHeat();
  const uno = createMoments({ heat: h2, enabled: true, limit: 1, coins: 500 });
  uno.push(MOMENTO({ x: 1 }), { step: 0, reduced: false });
  uno.push(MOMENTO({ x: 2 }), { step: 0, reduced: false });
  assert.deepEqual(
    h2.slots.filter((s) => s.w > 0).map((s) => s.x),
    [2],
  );
});

test('con movimiento reducido: banner sin movimiento y ninguna cámara, aunque la automática se prenda con A', () => {
  const heat = createHeat();
  const moments = createMoments({ heat, enabled: true, limit: 3, coins: 500 });
  const r = moments.push(MOMENTO(), { step: 0, reduced: true });
  assert.deepEqual([r.banner, r.camera], [true, false]);
  const [b] = moments.drainBanners();
  assert.equal(b.slide, false, 'el banner no se desliza');
  assert.ok(heat.slots.every((s) => s.w === 0));
  const c = mk(1920, 1080, { reduced: true });
  c.toggleAuto();
  run(c, 8, combateChico(heat.slots));
  assert.ok(c.state.tx < 700, 'el momento no mueve la cámara');
  assert.equal(moments.push(MOMENTO(), { step: 0, reduced: false }).camera, true);
  assert.equal(moments.drainBanners()[0].slide, true);
});

// ---------------------------------------------------------------------------------------------------------------
// Calor por eventos, vista del sim y el conjunto cámara (rig)

const mundo = (o = {}) => ({
  step: o.step ?? 0,
  squads: o.squads ?? [],
  planes: o.planes ?? [],
  field: { sides: [{ dir: 1 }, { dir: -1 }] },
  cfg: { units: { soldado: { range: 28 }, jeep: { range: 36 }, tanque: { range: 44 }, pesado: { range: 52 } } },
  bases: [
    {
      hp: o.hp?.[0] ?? 100,
      turrets: [
        { x: 100, y: 242 },
        { x: 100, y: 448 },
        { x: 100, y: 655 },
      ],
    },
    {
      hp: o.hp?.[1] ?? 100,
      turrets: [
        { x: 1340, y: 242 },
        { x: 1340, y: 448 },
        { x: 1340, y: 655 },
      ],
    },
  ],
});
const vivos = (heat) => heat.slots.filter((s) => s.w > 0).map((s) => [s.x, s.y, s.w, s.step]);

test('el calor de eventos: obús 2 (pesado 4), bomba 2, baja de vehículo 2/4/8, base 2 con tope, torreta 6, base caída 14', () => {
  const heat = createHeat();
  const w = mundo({ step: 10 });
  heat.consume(
    [
      { type: 'shot', kind: 'tanque', tx: 500, ty: 300 },
      { type: 'shot', kind: 'pesado', tx: 600, ty: 310 },
      { type: 'shot', kind: 'soldado', tx: 1, ty: 1 },
      { type: 'shot', kind: 'jeep', tx: 2, ty: 2 },
      { type: 'bombImpact', x: 700, y: 320 },
      { type: 'death', kind: 'jeep', x: 710, y: 330 },
      { type: 'death', kind: 'tanque', x: 720, y: 340 },
      { type: 'death', kind: 'pesado', x: 730, y: 350 },
      { type: 'death', kind: 'soldado', x: 740, y: 360 },
      { type: 'turretDown', side: 1, k: 2 },
      { type: 'hit', id: 1, x: 5, y: 5, dmg: 3, side: 0 },
    ],
    w,
  );
  assert.deepEqual(vivos(heat), [
    [500, 300, 2, 10],
    [600, 310, 4, 10],
    [700, 320, 2, 10],
    [710, 330, 2, 10],
    [720, 340, 4, 10],
    [730, 350, 8, 10],
    [1340, 655, 6, 10],
  ]);
  // un golpe a la base calienta como mucho una vez cada 0,8 s (24 pasos) por base, en (60 | 1380, 448)
  const h2 = createHeat();
  for (const step of [0, 10, 23, 24, 30]) h2.consume([{ type: 'baseHit', side: 0, dmg: 5 }], mundo({ step }));
  h2.consume([{ type: 'baseHit', side: 1, dmg: 5 }], mundo({ step: 5 }));
  assert.deepEqual(vivos(h2), [
    [60, 448, 2, 0],
    [60, 448, 2, 24],
    [1380, 448, 2, 5],
  ]);
  // la base que cae pesa 14 en el fin de ronda; la que sigue en pie, nada
  const h3 = createHeat();
  h3.consume([{ type: 'roundEnd', round: 1 }], mundo({ step: 99, hp: [0, 50] }));
  assert.deepEqual(vivos(h3), [[60, 448, 14, 99]]);
  h3.reset();
  assert.deepEqual(vivos(h3), []);
});

test('el anillo de calor tiene tamaño fijo: 1000 eventos no reservan nada y se conservan los más nuevos', () => {
  const heat = createHeat();
  assert.equal(heat.slots.length, HEAT_SLOTS);
  for (let i = 0; i < 1000; i++) heat.add(i, 0, 1, i);
  assert.equal(heat.slots.length, HEAT_SLOTS);
  const xs = vivos(heat).map((e) => e[0]);
  assert.equal(xs.length, HEAT_SLOTS);
  assert.equal(Math.min(...xs), 1000 - HEAT_SLOTS, 'quedan los más nuevos');
});

test('la vista del sim solo referencia el mundo (no copia) y trae la dirección y el alcance de cada tipo', () => {
  const heat = createHeat();
  const w = mundo({ step: 42, squads: [grupo(0, 300, 400, soldados(3))], planes: [{ x: 1, y: 2, z: 3, vx: 4 }] });
  const v = simViewOf(w, heat);
  assert.equal(v.squads, w.squads);
  assert.equal(v.planes, w.planes);
  assert.equal(v.events, heat.slots);
  assert.equal(v.step, 42);
  assert.deepEqual(v.dir, [1, -1]);
  assert.deepEqual(v.range, { soldado: 28, jeep: 36, tanque: 44, pesado: 52 });
  assert.equal(simViewOf(w, heat, v), v, 'reutiliza el objeto');
});

test('la automática corre en batalla, fin de ronda, espera y fin de partido; no en selector, sala ni intro (C1)', () => {
  for (const s of ['battle', 'roundEnd', 'waitingNextRound', 'matchEnd']) assert.equal(autoRuns(s), true, s);
  for (const s of ['matchup', 'lobby', 'intro', 'otro', undefined]) assert.equal(autoRuns(s), false, String(s));
});

test('cuando cae una base la automática sigue (no pasa a manual) y encuadra la base caída', () => {
  const rig = createCameraRig({
    canvas: { w: 1920, h: 1080 },
    view: undefined,
    graphics: undefined,
    motion: { reduced: false },
  });
  const squads = [grupo(0, 700, 400, soldados(2)), grupo(1, 740, 420, soldados(2))];
  const enBatalla = mundo({ squads });
  for (let i = 0; i < 60 * 9; i++) rig.update(1 / 60, enBatalla, autoRuns('battle'));
  assert.equal(rig.controller.state.mode, 'auto');
  assert.ok(rig.controller.state.tx > 600, 'encuadra el combate');
  // la base izquierda cae: el evento de fin de ronda llega con el mundo ya congelado
  const alFinal = mundo({ squads, hp: [0, 100] });
  rig.consume([{ type: 'roundEnd', round: 1 }], alFinal);
  let manual = 0;
  for (let i = 0; i < 60 * 6; i++) {
    rig.update(1 / 60, alFinal, autoRuns('roundEnd'));
    if (rig.controller.state.mode !== 'auto') manual++;
  }
  assert.equal(manual, 0, 'nada pasa a manual en la transición');
  assert.equal(rig.controller.status(), CAMERA_TEXT.auto);
  assert.ok(rig.controller.state.tx <= 481, `el objetivo va a la base caída (tx ${rig.controller.state.tx})`);
  // y sigue durante la espera del narrador
  for (let i = 0; i < 60 * 3; i++) rig.update(1 / 60, alFinal, autoRuns('waitingNextRound'));
  assert.equal(rig.controller.state.mode, 'auto');
});

test('autoTarget con una caja de calor mayor que el encuadre no da NaN y resolveView sube el encuadre (C4)', () => {
  const grande = { ...AUTO, heatBox: [300, 200] }; // el encuadre sigue en [240, 150]
  const r = autoTarget(sv({ events: [evento(960, 400, 5)] }), { x: 700, y: 400 }, grande);
  assert.equal(r.all, undefined);
  for (const n of [r.cx, r.cy, r.k, r.focus.x, r.focus.y]) assert.ok(Number.isFinite(n), JSON.stringify(r));
  assert.deepEqual(r.focus, { x: 700, y: 400 }, 'conserva el foco previo');
  assert.equal(r.cx, 700);
  const v = resolveView({ auto: { heatBox: [300, 200] } }).auto;
  assert.deepEqual(v.frame, [300, 200]);
  assert.deepEqual(resolveView({ auto: { heatBox: [100, 100], frame: [50, 400] } }).auto.frame, [100, 400]);
  assert.deepEqual(resolveView().auto.frame, [240, 150]);
});

test('el conjunto cámara: el aterrizaje de un avión es un momento adelante en su ruta, y R apaga la automática con aviso', () => {
  const motion = { reduced: false };
  const rig = createCameraRig({ canvas: { w: 1920, h: 1080 }, view: undefined, graphics: undefined, motion });
  const w = mundo({ step: 5, planes: [{ id: 7, owner: 'ana', x: -44, y: 405, z: 48, vx: 120 }] });
  rig.consume([{ type: 'planeLaunch', id: 7, side: 0 }], w);
  assert.deepEqual(vivos(rig.heat), [[100, 381, 6, 5]], 'x + vx·1,2 y y − z/2');
  const [b] = rig.moments.drainBanners();
  assert.equal(b.kind, 'plane');
  assert.equal(b.owner, 'ana');
  assert.equal(b.slide, true);
  // un avión que ya se fue no rompe
  rig.consume([{ type: 'planeLaunch', id: 99, side: 1 }], w);
  // con movimiento reducido: el banner sale sin deslizar y ni un punto de calor
  const quieto = createCameraRig({
    canvas: { w: 1920, h: 1080 },
    view: undefined,
    graphics: undefined,
    motion: { reduced: true },
  });
  quieto.consume([{ type: 'planeLaunch', id: 7, side: 0 }], w);
  assert.deepEqual(vivos(quieto.heat), []);
  assert.equal(quieto.moments.drainBanners()[0].slide, false);
  assert.deepEqual(quieto.bigGift({ coins: 800, x: 900, y: 500 }, 5), { banner: true, camera: false });
  assert.equal(quieto.moments.drainBanners()[0].slide, false);
  // la automática solo corre en batalla: con `active` en falso, ni en 20 s
  const tranquilo = createCameraRig({
    canvas: { w: 1920, h: 1080 },
    view: undefined,
    graphics: undefined,
    motion: { reduced: false },
  });
  const peleando = mundo({ squads: [grupo(0, 300, 400, soldados(10)), grupo(1, 350, 420, soldados(10))] });
  for (let i = 0; i < 20 * 60; i++) tranquilo.update(1 / 60, peleando, false);
  assert.equal(tranquilo.controller.state.mode, 'manual');
  assert.equal(tranquilo.controller.state.k, 1);
  for (let i = 0; i < 20 * 60; i++) tranquilo.update(1 / 60, peleando, true);
  assert.equal(tranquilo.controller.state.mode, 'auto');
  // regalo grande por el gancho del adaptador del público
  assert.equal(rig.bigGift({ coins: 800, x: 900, y: 500, owner: 'luis' }, 5).banner, true);
  assert.equal(rig.bigGift({ coins: 10, x: 900, y: 500 }, 5), null);
  // el movimiento reducido encendido a mitad del LIVE apaga la automática y deja un aviso para mostrar
  rig.update(1 / 60, w, true);
  assert.deepEqual(rig.drainNotices(), []);
  motion.reduced = true;
  rig.update(1 / 60, w, true);
  assert.deepEqual(rig.drainNotices(), [CAMERA_TEXT.autoOff]);
  assert.deepEqual(rig.drainNotices(), []);
  assert.equal(rig.controller.state.autoEnabled, false);
  // cada ronda empieza con el mapa entero y sin calor viejo
  rig.controller.zoomToLevel(3);
  rig.newRound();
  assert.equal(rig.controller.state.k, 1);
  assert.deepEqual(vivos(rig.heat), []);
  assert.equal(rig.moments.active(5), 0);
});

test('el reposo fraccional de la automática en los bordes del mundo no se sale de él ni un píxel', () => {
  for (const [x, y] of [
    [60, 60],
    [1380, 60],
    [60, 750],
    [1380, 750],
  ]) {
    const c = mk(1440, 810); // fd = 1: reposa en s = 1,89 y la vista (762×429 px de mundo) tiene lugar para moverse
    const lado = x < 720 ? 0 : 1;
    const cerca = x + (lado ? -20 : 20);
    run(
      c,
      40,
      sv({ squads: [grupo(lado, x, y, soldados(10)), grupo(lado, cerca, y + (y < 400 ? 10 : -10), soldados(10))] }),
    );
    const v = c.viewRect();
    assert.equal(v.s, 1.89);
    assert.ok(v.x0 >= -1e-9 && v.y0 >= -1e-9, `(${x}, ${y}): ${v.x0}, ${v.y0}`);
    assert.ok(v.x0 + 1440 / v.s <= 1440 + 1e-9, `(${x}, ${y}): borde derecho ${v.x0 + 1440 / v.s}`);
    assert.ok(v.y0 + 810 / v.s <= 810 + 1e-9, `(${x}, ${y}): borde de abajo ${v.y0 + 810 / v.s}`);
  }
});

test('Espacio: la pelea más caliente, una vez: va al combate en un nivel entero y no se queda manejando', () => {
  const c = mk();
  c.toggleAuto(); // apagada: solo se mueve por el preajuste
  run(c, 9, null);
  assert.ok(c.state.idle > 8);
  c.hottest(peleaA());
  assert.equal(c.state.idle, 0, 'es una entrada del narrador');
  assert.equal(c.state.mode, 'preset');
  run(c, 4, null);
  const v = c.viewRect();
  assert.equal(c.state.mode, 'manual', 'llegó y queda en manos del narrador');
  assert.ok(esEntero(v.s) && v.s === 2, `s ${v.s}: el nivel más alto con s ≤ ${1.96 * fitScale(1920, 1080)}`);
  assert.ok(v.x0 < 300 && v.x0 + 1920 / v.s > 350, 'el combate queda a la vista');
  // con la acción repartida, mapa entero
  c.hottest(sv({ events: [evento(200, 150, 5), evento(1200, 150, 5), evento(200, 650, 5), evento(1200, 650, 5)] }));
  run(c, 4, null);
  assert.equal(c.state.k, 1);
  // el preajuste no prende la automática ni la apaga
  assert.equal(c.state.autoEnabled, false);
});

// FIN 5c.5
