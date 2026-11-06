import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../public/js/sim/defaults.js';
import { createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import {
  addUnit,
  boxOf,
  createSquad,
  formationExtent,
  haltDistance,
  placeOffset,
  removeMember,
} from '../public/js/sim/squads.js';
import { ATTACK_LANES, laneY } from '../public/js/sim/field.js';
import { arriveVelocity, limitDelta, updateFacing } from '../public/js/sim/steer.js';

// CB-22, CB-21 (cambio por el último), C5, C6: lugares, steering y grupos en movimiento.

const mk = () => createWorld();
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const offsets = (cfg, kind, n, dir = 1) =>
  Array.from({ length: n }, (_, i) => {
    const o = placeOffset(cfg, kind, i, n, dir);
    return { x: o.x, y: o.y };
  });

// ---------------------------------------------------------------------------------------------------- lugares

test('lugares: la posición del lugar i sigue fila, posición y centrado por cantidad (sentido +1 y -1)', () => {
  const { cfg } = mk();
  // 5 × 2: fila 0 con p = 0..4 centradas en 0 con paso 7; la fila 1 está 9 px atrás
  const o = offsets(cfg, 'soldado', 10);
  assert.deepEqual(
    o.slice(0, 5).map((p) => p.y),
    [-14, -7, 0, 7, 14],
  );
  assert.deepEqual(
    o.slice(5).map((p) => p.y),
    [-14, -7, 0, 7, 14],
  );
  assert.equal(o[0].x, 0);
  assert.equal(o[5].x, -9);
  // lado derecho: espejo en x
  const d = offsets(cfg, 'soldado', 10, -1);
  assert.equal(d[5].x, 9);
});

test('lugares: zigzag de 3 px en las posiciones impares de los soldados y nada en los demás tipos', () => {
  const { cfg } = mk();
  const o = offsets(cfg, 'soldado', 10);
  assert.deepEqual(
    o.slice(0, 5).map((p) => p.x),
    [0, -3, 0, -3, 0],
  );
  assert.deepEqual(
    o.slice(5).map((p) => p.x),
    [-9, -12, -9, -12, -9],
  );
  for (const k of ['jeep', 'tanque', 'pesado']) {
    const q = offsets(cfg, k, cfg.squads.size[k]);
    assert.ok(
      q.every((p) => p.x === 0 || p.x === -cfg.squads.formation[k].dx),
      k,
    );
  }
});

test('lugares: filas centradas por cantidad y la última fila se re-centra', () => {
  const { cfg } = mk();
  const o = offsets(cfg, 'soldado', 7);
  // fila 1 con 2 miembros: -3,5 y +3,5
  assert.deepEqual([o[5].y, o[6].y], [-3.5, 3.5]);
  const p = offsets(cfg, 'soldado', 6);
  assert.equal(p[5].y, 0);
  // una baja siempre corre a los que quedan hacia el mismo lado (+dy/2)
  assert.ok(Math.abs(o[5].y - p[5].y) <= cfg.squads.formation.soldado.dy / 2 + 1e-9);
  assert.deepEqual(
    offsets(cfg, 'tanque', 2).map((q) => q.y),
    [-8, 8],
  );
  assert.deepEqual(offsets(cfg, 'pesado', 1), [{ x: 0, y: 0 }]);
});

test('tabla de D15: tamaño, fondo y semialto del grupo lleno por tipo', () => {
  const { cfg } = mk();
  const esperado = {
    soldado: { size: 10, fondo: 12, hw: 16 },
    jeep: { size: 4, fondo: 26, hw: 11.5 },
    tanque: { size: 2, fondo: 0, hw: 13 },
    pesado: { size: 1, fondo: 0, hw: 7 },
  };
  for (const [k, e] of Object.entries(esperado)) {
    assert.equal(cfg.squads.size[k], e.size, k);
    const x = formationExtent(cfg, k, e.size);
    assert.equal(x.fondo, e.fondo, `${k} fondo`);
    assert.equal(x.hw, e.hw, `${k} semialto`);
    assert.ok(x.hw <= 18);
  }
});

test('lugares: cada paso es al menos la huella más 3 y haltD vale 13/7/41/49', () => {
  const { cfg } = mk();
  for (const k of ['soldado', 'jeep', 'tanque', 'pesado']) {
    const f = cfg.squads.formation[k];
    const size = cfg.squads.size[k];
    if (Math.min(f.width, size) > 1) assert.ok(f.dy >= cfg.units[k].foot[1] + 3, `${k} dy`);
    if (Math.ceil(size / f.width) > 1) assert.ok(f.dx >= cfg.units[k].foot[0] + 3, `${k} dx`);
  }
  assert.deepEqual(
    ['soldado', 'jeep', 'tanque', 'pesado'].map((k) => haltDistance(cfg, k)),
    [13, 7, 41, 49],
  );
  const b = boxOf(cfg, 'soldado', 10);
  assert.deepEqual([b.front, b.rear, b.hw], [3, 15, 16]);
});

test('lugares: la unidad que se une toma el índice n y los lugares no se pisan', () => {
  const w = mk();
  const sq = createSquad(w, { side: 0, kind: 'soldado', x: 300, y: 448 });
  for (let i = 0; i < 4; i++) addUnit(w, sq, 300, 448);
  assert.deepEqual(
    sq.members.map((u) => u.id),
    [1, 2, 3, 4],
  );
  const o = offsets(w.cfg, 'soldado', 4);
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) assert.ok(Math.abs(o[i].x - o[j].x) >= 3 || Math.abs(o[i].y - o[j].y) >= 7);
});

// ------------------------------------------------------------------------------- cambio por el último (C5)

test('cambio por el último: 7 soldados, baja en el 2: el del 6 pasa al 2 y nadie más cambia salvo la última fila', () => {
  const w = mk();
  const { sq } = (() => {
    const r = seedSquad(w, { side: 0, kind: 'soldado', count: 7, x: 300, y: 448 });
    return { sq: r.squad };
  })();
  const ids = sq.members.map((u) => u.id);
  const antes = offsets(w.cfg, 'soldado', 7);
  removeMember(sq, sq.members[2]);
  assert.deepEqual(
    sq.members.map((u) => u.id),
    [ids[0], ids[1], ids[6], ids[3], ids[4], ids[5]],
  );
  const despues = offsets(w.cfg, 'soldado', 6);
  const movidos = [];
  for (let i = 0; i < 6; i++) {
    const idAntes = ids.indexOf(sq.members[i].id);
    if (antes[idAntes].x !== despues[i].x || antes[idAntes].y !== despues[i].y) movidos.push(sq.members[i].id);
  }
  // el que pasó al 2 (id del antiguo índice 6) y el del índice 5, que se re-centra en su fila (ahora de uno)
  assert.deepEqual(movidos.sort(), [ids[5], ids[6]].sort());
});

test('una baja no teletransporta a nadie: el desplazamiento por paso nunca pasa de vMax·DT', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 400, y: 448 });
  // enemigo lejos de todo: solo queremos ver el cierre del hueco
  run(w, 5);
  sq.members[2].hp = 0;
  sq.members[2].alive = false;
  sq.members[6].hp = 0;
  sq.members[6].alive = false;
  const vmax = w.stats.soldado.speed;
  const prev = new Map(sq.members.map((u) => [u.id, [u.x, u.y]]));
  let maxStep = 0;
  for (let i = 0; i < 90; i++) {
    stepWorld(w);
    for (const u of sq.members) {
      const p = prev.get(u.id);
      maxStep = Math.max(maxStep, Math.hypot(u.x - p[0], u.y - p[1]));
      prev.set(u.id, [u.x, u.y]);
    }
  }
  assert.ok(sq.members.length === 8);
  assert.ok(maxStep <= vmax * DT + 1e-9, `paso máximo ${maxStep}`);
});

// ---------------------------------------------------------------------------------------------------- steering

test('aproximación: la unidad llega a su lugar sin pasarse, con |Δv| ≤ aMax·DT y desplazamiento ≤ vMax·DT', () => {
  const w = mk();
  const sq = createSquad(w, { side: 0, kind: 'soldado', x: 500, y: 448 });
  sq.state = 'holding'; // ancla quieta en su lugar
  sq.postPos = { x: 500, y: 448 };
  const u = addUnit(w, sq, 470, 460); // 30 px atrás y 12 px al costado de su lugar (0, 0)
  const vmax = u.stats.speed;
  let pvx = 0;
  let pvy = 0;
  let px = u.x;
  let py = u.y;
  let cruzo = false;
  for (let i = 0; i < 240; i++) {
    stepWorld(w);
    const dv = Math.hypot(u.vx - pvx, u.vy - pvy);
    assert.ok(dv <= 3 * vmax * DT + 1e-9, `Δv ${dv}`);
    assert.ok(Math.hypot(u.x - px, u.y - py) <= vmax * DT + 1e-9);
    if (u.x > 500.3) cruzo = true;
    pvx = u.vx;
    pvy = u.vy;
    px = u.x;
    py = u.y;
  }
  assert.ok(!cruzo, 'se pasó del lugar');
  assert.ok(Math.hypot(u.x - 500, u.y - 448) <= 0.3);
  assert.equal(u.vx, 0);
  assert.equal(u.vy, 0);
});

test('ancla: velocidad ≤ 0,9·vmax, acelera ≤ 1·vmax/s y frena ≤ 2·vmax/s', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'jeep', count: 4, x: 200, y: 448 });
  const vmaxA = 0.9 * w.stats.jeep.speed;
  let pvx = 0;
  let maxV = 0;
  let maxAcc = 0;
  let maxDec = 0;
  for (let i = 0; i < 400; i++) {
    stepWorld(w);
    const a = sq.anchor;
    maxV = Math.max(maxV, Math.hypot(a.vx, a.vy));
    const dv = (a.vx - pvx) / DT;
    if (dv > 0) maxAcc = Math.max(maxAcc, dv);
    else maxDec = Math.max(maxDec, -dv);
    pvx = a.vx;
  }
  assert.ok(maxV <= vmaxA + 1e-9, `v ${maxV}`);
  assert.ok(maxV > 0.8 * vmaxA, 'debería llegar a la velocidad de crucero');
  assert.ok(maxAcc <= 1 * vmaxA + 1e-6, `acel ${maxAcc}`);
  assert.ok(maxDec <= 2 * vmaxA + 1e-6, `freno ${maxDec}`);
});

test('steer: la aproximación recorta a vmax y limitDelta no supera el cambio máximo', () => {
  const a = arriveVelocity(100, 0, 30, 2);
  assert.deepEqual([a.x, a.y], [30, 0]);
  const b = arriveVelocity(5, 0, 30, 2);
  assert.deepEqual([b.x, b.y], [10, 0]);
  const c = limitDelta(0, 0, 30, 40, 10);
  assert.ok(Math.abs(Math.hypot(c.x, c.y) - 10) < 1e-12);
});

test('orientación: gira solo si la deseada difiere 9 pasos seguidos (≤ 1 cambio cada 0,3 s)', () => {
  const u = { dir: 1, faceSteps: 0, vx: 0 };
  let cambios = 0;
  for (let i = 0; i < 8; i++) {
    updateFacing(u, -50, 38, 9);
    if (u.dir === -1) cambios++;
  }
  assert.equal(u.dir, 1, 'a los 8 pasos todavía no giró');
  updateFacing(u, -50, 38, 9);
  assert.equal(u.dir, -1);
  // una deseada que oscila no hace girar
  const v = { dir: 1, faceSteps: 0, vx: 0 };
  for (let i = 0; i < 100; i++) updateFacing(v, i % 2 ? -50 : 50, 38, 9);
  assert.equal(v.dir, 1);
  // con |dx| < 2 conserva; sin blanco usa la velocidad si |vx| ≥ 0,2·vmax
  const z = { dir: 1, faceSteps: 0, vx: -10 };
  for (let i = 0; i < 9; i++) updateFacing(z, null, 38, 9);
  assert.equal(z.dir, -1);
  const k = { dir: 1, faceSteps: 0, vx: 0 };
  for (let i = 0; i < 20; i++) updateFacing(k, 1, 38, 9);
  assert.equal(k.dir, 1);
  assert.equal(cambios, 0);
});

test('un grupo que marcha avanza por su calle y el desvío lateral nunca pasa del avance', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 200 });
  sq.members.forEach((u) => (u.y += 10)); // descolocados 10 px al costado
  let ok = true;
  for (let i = 0; i < 120; i++) {
    stepWorld(w);
    const av = Math.abs(sq.anchor.vx);
    for (const u of sq.members) if (av > 0 && Math.abs(u.vy) > av + 1e-9) ok = false;
  }
  assert.ok(ok, 'lateral > avance');
  assert.ok(sq.anchor.x > 300);
  assert.ok(Math.abs(sq.anchor.y - laneY(w.field, sq.corridor, sq.lane)) < 1);
});

test('ancla: por la calle del corredor del lado derecho avanza en sentido contrario', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, {
    side: 1,
    kind: 'tanque',
    count: 2,
    lane: ATTACK_LANES.bajo,
    corridor: 0,
    x: 1200,
  });
  run(w, 60);
  assert.ok(sq.anchor.vx < 0);
  assert.equal(laneY(w.field, 0, ATTACK_LANES.bajo), 282);
  assert.ok(Math.abs(sq.anchor.y - 282) < 1);
});

// ------------------------------------------------------------------------------ grupos en movimiento (4b.7)

/** Un enemigo quieto e indestructible: sirve para trabar a un grupo sin que el escenario dependa del combate. */
function muro(w, side, x, y, kind = 'soldado') {
  const { squad } = seedSquad(w, { side, kind, count: 1, x, y, state: 'holding' });
  squad.postPos = { x, y };
  squad.members[0].hp = squad.members[0].maxHp = 1e12;
  return squad.members[0];
}
const speed = (u) => Math.hypot(u.vx, u.vy);

test('línea de fuego: un enemigo entra en el alcance de un miembro y los 10 frenan en formación; al irse, reanudan', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 200 });
  const enemigo = muro(w, 1, 520, 468);
  const signos = new Map(sq.members.map((u) => [u.id, []]));
  let trabado = -1;
  for (let i = 0; i < 400 && trabado < 0; i++) {
    stepWorld(w);
    if (sq.locked) trabado = i;
    for (const u of sq.members) if (Math.abs(u.vy) > 0.5) signos.get(u.id).push([i, Math.sign(u.vy)]);
  }
  assert.ok(trabado > 0, 'nunca se trabó');
  // en ≤ 0,5 s todos quietos y a ≤ 2 px de su lugar
  for (let i = 0; i < 15; i++) stepWorld(w);
  for (let i = 0; i < sq.members.length; i++) {
    const u = sq.members[i];
    const o = placeOffset(w.cfg, 'soldado', i, sq.members.length, 1);
    assert.ok(speed(u) < 0.5, `miembro ${i} sigue yendo a ${speed(u)}`);
    assert.ok(Math.hypot(u.x - (sq.anchor.x + o.x), u.y - (sq.anchor.y + o.y)) <= 2, `miembro ${i} lejos de su lugar`);
  }
  // el lateral cambia de signo a lo sumo una vez en cualquier ventana de 2 s
  for (const lista of signos.values()) {
    let cambios = 0;
    for (let i = 1; i < lista.length; i++)
      if (lista[i][1] !== lista[i - 1][1] && lista[i][0] - lista[i - 1][0] <= 60) cambios++;
    assert.ok(cambios <= 1, `${cambios} cambios de signo lateral`);
  }
  // el enemigo se va: tras 0,5 s sin blancos el grupo se destraba y reanuda
  const x0 = sq.anchor.x;
  enemigo.alive = false;
  enemigo.hp = 0;
  run(w, 90);
  assert.ok(!sq.locked);
  assert.ok(sq.anchor.x > x0 + 5, 'el grupo no reanudó');
});

test('frenado anticipado: el ancla para en la posición de tiro y todas las filas quedan en alcance', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'tanque', count: 2, lane: ATTACK_LANES.bajo, x: 200 });
  const objetivo = muro(w, 1, 700, laneY(w.field, 1, ATTACK_LANES.bajo), 'soldado');
  let pasadoDe = 0;
  for (let i = 0; i < 900; i++) {
    stepWorld(w);
    pasadoDe = Math.max(pasadoDe, sq.anchor.x - (objetivo.x - 41));
  }
  assert.ok(pasadoDe <= 0.5, `el ancla se pasó ${pasadoDe} px de la posición de tiro`);
  assert.ok(Math.abs(sq.anchor.x - (objetivo.x - 41)) < 1.5, `ancla en ${sq.anchor.x}`);
});

const huella = { soldado: [6, 4], jeep: [18, 8], tanque: [24, 10], pesado: [34, 14] };
function solape(a, b) {
  const [wa, ha] = huella[a.kind];
  const [wb, hb] = huella[b.kind];
  const ox = Math.min(a.x + wa / 2, b.x + wb / 2) - Math.max(a.x - wa / 2, b.x - wb / 2);
  const oy = Math.min(a.y + ha / 2, b.y + hb / 2) - Math.max(a.y - ha / 2, b.y - hb / 2);
  if (ox <= 0 || oy <= 0) return 0;
  return (ox * oy) / Math.min(wa * ha, wb * hb);
}

test('dos grupos amigos en el mismo corredor nunca se superponen más del 10 % de la huella menor', () => {
  const w = mk();
  const adelante = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 260 }).squad;
  const atras = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 140 }).squad;
  muro(w, 1, 560, 448);
  let peor = 0;
  for (let i = 0; i < 600; i++) {
    stepWorld(w);
    for (const a of adelante.members) for (const b of atras.members) peor = Math.max(peor, solape(a, b));
  }
  assert.ok(peor <= 0.1, `superposición ${peor}`);
  // el de atrás llegó cerca del de adelante (no se quedó lejos) pero sin tocarlo
  assert.ok(atras.anchor.x > 200);
});

test('cambio de calle: el seguidor frenado detrás de un grupo trabado se desliza a ≤ 0,5·vmax y sigue', () => {
  const w = mk();
  const lider = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 300 }).squad;
  const seg = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 170 }).squad;
  muro(w, 1, 560, 448);
  const lim = 0.5 * w.stats.soldado.speed;
  let maxLat = 0;
  let cambio = false;
  for (let i = 0; i < 700; i++) {
    stepWorld(w);
    if (seg.state === 'converting') {
      cambio = true;
      maxLat = Math.max(maxLat, Math.abs(seg.anchor.vy));
    }
  }
  assert.ok(lider.locked || lider.members.length > 0);
  assert.ok(cambio, 'nunca cambió de calle');
  assert.ok(maxLat <= lim + 1e-9, `lateral ${maxLat} > ${lim}`);
  assert.notEqual(seg.lane, ATTACK_LANES.centro);
  assert.ok(Math.abs(seg.anchor.y - laneY(w.field, seg.corridor, seg.lane)) < 1);
});

test('si no hay calle libre el seguidor espera detrás: no se superpone ni cambia de calle', () => {
  const w = mk();
  // tres líderes en las tres calles del corredor medio
  for (const lane of [0, 1, 2]) seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 330, lane, corridor: 1 });
  const seg = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 170 }).squad;
  muro(w, 1, 560, 448);
  muro(w, 1, 560, 408);
  muro(w, 1, 560, 488);
  run(w, 300);
  assert.notEqual(seg.state, 'converting');
  assert.equal(seg.lane, ATTACK_LANES.centro);
  for (const o of w.squads)
    if (o !== seg && o.side === 0) assert.ok(seg.bhi <= o.blo + 1e-9 || Math.abs(o.anchor.y - seg.anchor.y) > 30);
});

test('bloqueo mutuo: dos grupos que se frenan 1 s se separan y el de id mayor se corre de costado', () => {
  const w = mk();
  // grupos de defensa que van al mismo puesto: el cambio de calle es solo de ataque, así que solo queda el bloqueo mutuo
  const a = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 400, role: 'defensa', state: 'toPost' }).squad;
  const b = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 408, role: 'defensa', state: 'toPost' }).squad; // encima
  a.postPos = { x: 460, y: 448 };
  b.postPos = { x: 460, y: 528 };
  let corrio = false;
  for (let i = 0; i < 300; i++) {
    stepWorld(w);
    if (b.sideStep !== 0) corrio = true;
    assert.equal(a.sideStep, 0, 'el de id menor no se corre');
  }
  assert.ok(corrio, 'el de id mayor nunca se corrió');
  assert.ok(
    Math.abs(a.anchor.y - b.anchor.y) >= a.hw + b.hw + 3 || a.bhi <= b.blo || b.bhi <= a.blo,
    'siguen superpuestos',
  );
  assert.ok(a.anchor.x > 440, 'el de id menor no avanzó');
});

test('nadie se teletransporta al cerrar un hueco en combate: paso ≤ vMax·DT en toda la corrida', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 200 });
  seedSquad(w, { side: 1, kind: 'soldado', count: 10, x: 560, state: 'holding' }).squad.postPos = { x: 560, y: 448 };
  const prev = new Map();
  let maxStep = 0;
  for (let i = 0; i < 600; i++) {
    stepWorld(w);
    for (const u of w.units) {
      const p = prev.get(u.id);
      if (p) maxStep = Math.max(maxStep, Math.hypot(u.x - p[0], u.y - p[1]) / (u.stats.speed * DT));
      prev.set(u.id, [u.x, u.y]);
    }
  }
  assert.ok(maxStep <= 1 + 1e-9, `razón máxima ${maxStep}`);
  assert.ok(sq.members.length < 10 || w.squads.length > 0);
});
