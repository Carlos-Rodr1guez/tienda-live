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
  ordenF,
  placeOffset,
  removeMember,
  squadBox,
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
    const o = placeOffset(cfg, kind, i, dir);
    return { x: o.x, y: o.y };
  });

// ---------------------------------------------------------------------------------------------------- lugares

test('lugares: ORDEN_F va del centro hacia afuera (F=5: 2, 1, 3, 0, 4; F=2: 0, 1; F=1: 0)', () => {
  assert.deepEqual(ordenF(5), [2, 1, 3, 0, 4]);
  assert.deepEqual(ordenF(4), [1, 0, 2, 3]);
  assert.deepEqual(ordenF(2), [0, 1]);
  assert.deepEqual(ordenF(1), [0]);
});

test('lugares: el lugar sigue fila ⌊slot/F⌋ y posición ORDEN_F[slot mod F], sin depender de cuántos son (sentido +1 y -1)', () => {
  const { cfg } = mk();
  // enmienda v2.5 (CB-21): 5 × 2, del centro hacia afuera; la fila 1 está 9 px atrás
  const o = offsets(cfg, 'soldado', 10);
  assert.deepEqual(
    o.slice(0, 5).map((p) => p.y),
    [0, -7, 7, -14, 14],
  );
  assert.deepEqual(
    o.slice(5).map((p) => p.y),
    [0, -7, 7, -14, 14],
  );
  assert.equal(o[0].x, 0);
  assert.equal(o[5].x, -9);
  // lado derecho: espejo en x
  const d = offsets(cfg, 'soldado', 10, -1);
  assert.equal(d[5].x, 9);
  // el lugar no depende del tamaño del grupo: el 7 es el mismo con 8 o con 10 miembros
  assert.deepEqual({ ...placeOffset(cfg, 'soldado', 7, 1) }, { ...o[7] });
});

test('lugares: zigzag de 3 px en las posiciones impares de los soldados y nada en los demás tipos', () => {
  const { cfg } = mk();
  const o = offsets(cfg, 'soldado', 10);
  // p = 2, 1, 3, 0, 4: las impares (1 y 3) van 3 px atrás
  assert.deepEqual(
    o.slice(0, 5).map((p) => p.x),
    [0, -3, -3, 0, 0],
  );
  assert.deepEqual(
    o.slice(5).map((p) => p.x),
    [-9, -12, -12, -9, -9],
  );
  for (const k of ['jeep', 'tanque', 'pesado']) {
    const q = offsets(cfg, k, cfg.squads.size[k]);
    assert.ok(
      q.every((p) => p.x === 0 || p.x === -cfg.squads.formation[k].dx),
      k,
    );
  }
});

test('lugares: una fila incompleta queda casi centrada sin re-centrar; tanques y pesado', () => {
  const { cfg } = mk();
  const o = offsets(cfg, 'soldado', 7);
  // fila 1 con 2 miembros: los lugares 5 y 6 son p = 2 y 1, o sea y = 0 y -7 (los mismos que con 10)
  assert.deepEqual([o[5].y, o[6].y], [0, -7]);
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

test('lugares: la unidad que se une toma el lugar libre más bajo y los lugares no se pisan', () => {
  const w = mk();
  const sq = createSquad(w, { side: 0, kind: 'soldado', x: 300, y: 448 });
  for (let i = 0; i < 4; i++) addUnit(w, sq, 300, 448);
  assert.deepEqual(
    sq.members.map((u) => [u.id, u.slot]),
    [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ],
  );
  const o = offsets(w.cfg, 'soldado', 4);
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) assert.ok(Math.abs(o[i].x - o[j].x) >= 3 || Math.abs(o[i].y - o[j].y) >= 7);
  // sale el del lugar 1 (nadie detrás en su columna): el hueco queda y el que llega lo toma
  removeMember(sq, sq.members[1]);
  assert.deepEqual(
    sq.members.map((u) => u.slot),
    [0, 2, 3],
  );
  const nuevo = addUnit(w, sq, 300, 448);
  assert.equal(nuevo.slot, 1, 'el lugar libre de índice más bajo');
  assert.equal(addUnit(w, sq, 300, 448).slot, 4);
  assert.equal(addUnit(w, sq, 300, 448).slot, 5);
});

// ------------------------------------------------------------------------------- cerrar filas (enmienda v2.5, CB-21)

/** Un grupo quieto (en su puesto) con `n` miembros y sin enemigos cerca. */
function quieto(w, kind, n, x = 300, y = 448) {
  const sq = seedSquad(w, { side: 0, kind, count: n, x, y, state: 'holding' }).squad;
  sq.postPos = { x, y };
  return sq;
}
const lugares = (sq) => sq.members.map((u) => [u.id, u.slot, u.fromSlot]);

test('cerrar filas: sale el del lugar 2 y solo el de SU columna (el 7) avanza al 2; nadie más cambia de lugar', () => {
  const w = mk();
  const sq = quieto(w, 'soldado', 10);
  const ids = sq.members.map((u) => u.id);
  const antes = lugares(sq);
  removeMember(sq, sq.members[2]);
  assert.deepEqual(
    sq.members.map((u) => u.id),
    ids.filter((_, i) => i !== 2),
    'splice: los demás conservan su orden',
  );
  const despues = lugares(sq);
  const cambiaron = despues.filter((d) => {
    const a = antes.find((x) => x[0] === d[0]);
    return a[1] !== d[1] || a[2] !== d[2];
  });
  assert.deepEqual(cambiaron, [[ids[7], 2, 7]], 'el del 7 pasa al 2 y recuerda de dónde sale');
});

test('cerrar filas: sale uno de la fila de atrás y nadie avanza; el hueco queda al fondo', () => {
  const w = mk();
  const sq = quieto(w, 'soldado', 10);
  const antes = lugares(sq).filter((l) => l[0] !== sq.members[8].id);
  removeMember(sq, sq.members[8]);
  assert.deepEqual(lugares(sq), antes);
});

test('cerrar filas: dos bajas seguidas de una columna, la de atrás conserva su fromSlot original', () => {
  const w = mk();
  const sq = quieto(w, 'soldado', 10);
  const [, , a, , , , , g] = sq.members;
  removeMember(sq, a); // el 7 pasa al 2 (fromSlot 7)
  assert.deepEqual([g.slot, g.fromSlot], [2, 7]);
  removeMember(sq, g); // se va el que había avanzado: queda el lugar 2 vacío
  assert.deepEqual(
    sq.members.map((u) => u.slot),
    [0, 1, 3, 4, 5, 6, 8, 9],
  );
});

test('cerrar filas: tanques y pesado, nadie está detrás y nadie se mueve', () => {
  for (const [kind, n] of [
    ['tanque', 2],
    ['pesado', 1],
  ]) {
    const w = mk();
    const sq = quieto(w, kind, n);
    const resto = sq.members.slice(1);
    const antes = resto.map((u) => [u.slot, u.x, u.y]);
    removeMember(sq, sq.members[0]);
    run(w, 60);
    assert.deepEqual(
      resto.map((u) => [u.slot, u.fromSlot]),
      antes.map((a) => [a[0], -1]),
      kind,
    );
    assert.deepEqual(
      resto.map((u) => [u.slot, u.x, u.y]),
      antes,
      `${kind}: quieto`,
    );
  }
});

test('cerrar filas: en el jeep 2 × 2 el de atrás da un paso adelante en su columna', () => {
  const w = mk();
  const sq = quieto(w, 'jeep', 4);
  const [j0, j1, j2, j3] = sq.members;
  removeMember(sq, j0);
  assert.deepEqual(lugares(sq), [
    [j1.id, 1, -1],
    [j2.id, 0, 2],
    [j3.id, 3, -1],
  ]);
  const y0 = j2.y;
  const x0 = j2.x;
  let maxLat = 0;
  for (let i = 0; i < 90 && j2.fromSlot >= 0; i++) {
    stepWorld(w);
    maxLat = Math.max(maxLat, Math.abs(j2.y - y0));
  }
  assert.equal(j2.fromSlot, -1, 'llegó');
  assert.ok(j2.x > x0 + 20, 'avanzó casi una fila (26 px)');
  assert.ok(maxLat < 1e-9, `se salió de su columna ${maxLat}`);
});

test('cerrar filas: el que avanza va derecho por su columna a ≤ vMax, llega y se queda quieto; los demás ni se mueven', () => {
  const w = mk();
  const sq = quieto(w, 'soldado', 10);
  const vmax = w.stats.soldado.speed;
  const cerrador = sq.members[7];
  const otros = sq.members.filter((u) => u !== cerrador && u !== sq.members[2]);
  removeMember(sq, sq.members[2]);
  const y0 = cerrador.y;
  const pos0 = otros.map((u) => [u.x, u.y]);
  let prev = [cerrador.x, cerrador.y];
  let maxLat = 0;
  let maxPaso = 0;
  let llegada = -1;
  for (let i = 0; i < 120; i++) {
    stepWorld(w);
    maxLat = Math.max(maxLat, Math.abs(cerrador.y - y0));
    maxPaso = Math.max(maxPaso, Math.hypot(cerrador.x - prev[0], cerrador.y - prev[1]));
    prev = [cerrador.x, cerrador.y];
    if (llegada < 0 && cerrador.fromSlot < 0) llegada = i;
  }
  assert.ok(llegada > 0, 'llegó');
  assert.ok(maxLat < 1e-9, `lateral ${maxLat}`);
  assert.ok(maxPaso <= vmax * DT + 1e-9, `paso ${maxPaso}`);
  const o = placeOffset(w.cfg, 'soldado', 2, 1);
  assert.ok(Math.hypot(cerrador.x - (sq.anchor.x + o.x), cerrador.y - (sq.anchor.y + o.y)) < 1e-6, 'en su lugar');
  assert.equal(cerrador.vx, 0);
  assert.equal(cerrador.vy, 0);
  assert.deepEqual(
    otros.map((u) => [u.x, u.y]),
    pos0,
    'nadie de otra columna se movió',
  );
});

test('cerrar filas: justo después de cerrar, la caja del grupo sigue conteniendo el lugar de partida del que avanza', () => {
  const w = mk();
  const sq = quieto(w, 'soldado', 6); // lugares 0..5: el 5 es la fila de atrás, columna del 0
  const nominal = boxOf(w.cfg, 'soldado', 5);
  assert.equal(squadBox(w.cfg, sq).rear, boxOf(w.cfg, 'soldado', 6).rear);
  removeMember(sq, sq.members[0]);
  const cierra = sq.members.find((u) => u.fromSlot === 5);
  assert.ok(cierra, 'el del 5 avanza al 0');
  const conPartida = squadBox(w.cfg, sq);
  assert.equal(conPartida.rear, boxOf(w.cfg, 'soldado', 6).rear, 'la fila de atrás sigue dentro de la caja');
  assert.ok(conPartida.rear > nominal.rear, 'más que sin el lugar de partida');
  run(w, 1);
  stepToArrival(w, cierra);
  assert.equal(cierra.fromSlot, -1);
  assert.equal(squadBox(w.cfg, sq).rear, nominal.rear, 'ya llegó: la caja se achica');
});
function stepToArrival(w, u) {
  for (let i = 0; i < 200 && u.fromSlot >= 0; i++) stepWorld(w);
}

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
    const o = placeOffset(w.cfg, 'soldado', i, 1);
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

// ---------------------------------------------------------------------------------------------------- 4c.13
// CB-22: métricas de movimiento sobre una corrida grabada de 60 s con ~340 unidades (marcha, combate y vuelta a puestos).
// Enmienda v2.5 (CB-22): el solape se mide en CADA paso sobre TODAS las unidades terrestres amigas, en marcha,
// deslizándose de calle, cerrando filas, trabadas o en combate; solo quedan fuera los grupos que arman (puerta de la
// base). Sin exenciones por distancia al lugar. La regla "trabado: quieto en ≤ 0,5 s a ≤ 2 px" exime solo a quienes
// cierran filas hasta que llegan, y el test los deriva de SU registro de cambios de `u.slot` (no de una bandera del sim).

import { submitOrder } from '../public/js/sim/queue.js';

const FOOT = { soldado: [6, 4], jeep: [18, 8], tanque: [24, 10], pesado: [34, 14] };

function corridaGrabada() {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
  for (const team of [1, 2]) {
    for (const [kind, count] of [
      ['soldado', 120],
      ['jeep', 36],
      ['tanque', 16],
      ['pesado', 3],
    ]) {
      submitOrder(w, { kind, team, owner: null, count, unitValue: 0, source: 'gift' });
    }
  }
  return w;
}

test('métricas de movimiento: 60 s con ~340 unidades marchando, combatiendo y volviendo a puestos', () => {
  const w = corridaGrabada();
  const dir = (sq) => w.field.sides[sq.side].dir;
  const distLugar = (u) => {
    const sq = u.squad;
    const o = placeOffset(w.cfg, sq.kind, u.slot, dir(sq));
    return Math.hypot(sq.anchor.x + o.x - u.x, sq.anchor.y + o.y - u.y);
  };
  // quienes cierran filas, según el registro propio del test: cambió su `slot` y aún no llegó a ≤ 1 px del lugar nuevo
  const slotPrevio = new Map();
  const cerrando = new Set();
  let cierres = 0;
  const ultimoGiro = new Map();
  const dirPrevia = new Map();
  const previo = new Map();
  const signos = new Map();
  const bloqueado = new Map();
  const cambio = new Map();
  const cuenta = new Map();
  const peor = {
    giro: 0,
    solape: 0,
    solapeMarcha: 0,
    solapeTrabado: 0,
    lateral: -Infinity,
    dv: 0,
    desp: 0,
    tartamudeo: 0,
    zigzag: 0,
    enLinea: 0,
  };
  let maxUnidades = 0;
  for (let s = 0; s < 1800; s++) {
    stepWorld(w);
    maxUnidades = Math.max(maxUnidades, w.units.length);
    for (const u of w.units) {
      if (slotPrevio.has(u.id) && slotPrevio.get(u.id) !== u.slot) {
        cerrando.add(u.id);
        cierres++;
      }
      slotPrevio.set(u.id, u.slot);
      if (cerrando.has(u.id) && distLugar(u) <= 1) cerrando.delete(u.id);
    }
    for (const u of w.units) {
      // orientación: a lo sumo un cambio cada 0,3 s
      if (dirPrevia.has(u.id) && dirPrevia.get(u.id) !== u.dir) {
        if (ultimoGiro.has(u.id) && s - ultimoGiro.get(u.id) < 9) peor.giro++;
        ultimoGiro.set(u.id, s);
      }
      dirPrevia.set(u.id, u.dir);
      // aceleración y desplazamiento
      const p = previo.get(u.id);
      if (p) {
        const vmax = u.stats.speed;
        peor.desp = Math.max(peor.desp, Math.hypot(u.x - p.x, u.y - p.y) / (vmax * DT));
        peor.dv = Math.max(peor.dv, Math.hypot(u.vx - p.vx, u.vy - p.vy) / (vmax * w.cfg.squads.unitAccel * DT));
      }
      previo.set(u.id, { x: u.x, y: u.y, vx: u.vx, vy: u.vy });
      // lateral ≤ avance cuando el grupo marcha en formación (no desliza, ancla a régimen)
      const sq = u.squad;
      const vA = sq.stats.speed * w.cfg.squads.anchorSpeedFactor;
      if (sq.state === 'advance' && !sq.locked && sq.sideStep === 0 && Math.abs(sq.anchor.vx) > 0.9 * vA) {
        peor.lateral = Math.max(peor.lateral, Math.abs(u.vy) - Math.abs(sq.anchor.vx));
      }
      // un cambio de signo lateral en 2 s a lo sumo (con histéresis de 1 px/s)
      let sg = signos.get(u.id);
      if (!sg) signos.set(u.id, (sg = { ultimo: 0, cambios: [] }));
      const signo = u.vy > 1 ? 1 : u.vy < -1 ? -1 : 0;
      if (signo !== 0 && sg.ultimo !== 0 && signo !== sg.ultimo) sg.cambios.push(s);
      if (signo !== 0) sg.ultimo = signo;
      while (sg.cambios.length && sg.cambios[0] < s - 60) sg.cambios.shift();
      const reciente = s - (cambio.get(sq.id) ?? -999) < 90;
      if (sg.cambios.length > 1 && !reciente) peor.zigzag++;
    }
    for (const sq of w.squads) {
      if (cuenta.get(sq.id) !== sq.members.length) {
        cuenta.set(sq.id, sq.members.length);
        cambio.set(sq.id, s);
      }
      if (sq.members.length < 2) continue;
      const vA = sq.stats.speed * w.cfg.squads.anchorSpeedFactor;
      const marcha = sq.state === 'advance' && !sq.locked && sq.sideStep === 0;
      // nadie quieto mientras otro del grupo va a > 20 %
      if (marcha && Math.abs(sq.anchor.vx) > 0.2 * vA) {
        let rapido = false;
        let quieto = false;
        for (const u of sq.members) {
          const v = Math.hypot(u.vx, u.vy);
          if (v > 0.2 * vA) rapido = true;
          if (v === 0) quieto = true;
        }
        if (rapido && quieto) peor.tartamudeo++;
      }
      // grupo trabado: quieto y a ≤ 2 px de su lugar tras 0,5 s (salvo quien cierra filas hasta que llega)
      const n = sq.locked ? (bloqueado.get(sq.id) ?? 0) + 1 : 0;
      bloqueado.set(sq.id, n);
      const reasignado = s - (cambio.get(sq.id) ?? -999) < 60;
      if (n >= 20 && !reasignado && sq.state !== 'converting' && sq.sideStep === 0) {
        for (const u of sq.members) {
          if (cerrando.has(u.id)) continue;
          if (Math.hypot(u.vx, u.vy) > 1.5 || distLugar(u) > 2) peor.enLinea++;
        }
      }
    }
    // superposición amiga ≤ 10 % de la huella menor, en cada paso y en cualquier par de unidades amigas (solo quedan
    // fuera los grupos que arman); en marcha y trabados por separado
    for (const side of [0, 1]) {
      // TEMPORAL: se exime a los grupos que se deslizan de calle (`converting`), como en el commit anterior; el commit
      // siguiente (conversiones solo por calles libres, DV25-8) quita esta exención y la métrica queda según DV25-6.
      const us = w.units.filter(
        (u) => u.side === side && u.squad.state !== 'forming' && u.squad.state !== 'converting',
      );
      for (let i = 0; i < us.length; i++) {
        for (let j = i + 1; j < us.length; j++) {
          const a = us[i];
          const b = us[j];
          if (Math.abs(a.x - b.x) > 40 || Math.abs(a.y - b.y) > 20) continue;
          const [wa, ha] = FOOT[a.kind];
          const [wb, hb] = FOOT[b.kind];
          const ox = Math.min(a.x + wa / 2, b.x + wb / 2) - Math.max(a.x - wa / 2, b.x - wb / 2);
          const oy = Math.min(a.y + ha / 2, b.y + hb / 2) - Math.max(a.y - ha / 2, b.y - hb / 2);
          if (ox > 0 && oy > 0) {
            const f = (ox * oy) / Math.min(wa * ha, wb * hb);
            peor.solape = Math.max(peor.solape, f);
            const trabado = a.squad.locked || b.squad.locked;
            if (trabado) peor.solapeTrabado = Math.max(peor.solapeTrabado, f);
            else peor.solapeMarcha = Math.max(peor.solapeMarcha, f);
          }
        }
      }
    }
  }
  assert.ok(maxUnidades >= 300, `la corrida llegó a ${maxUnidades} unidades`);
  assert.equal(peor.giro, 0, 'más de un giro de orientación en 0,3 s');
  assert.ok(cierres > 0, 'la corrida tuvo bajas con cierre de filas');
  assert.ok(peor.solapeMarcha <= 0.1, `superposición amiga en marcha ${peor.solapeMarcha}`);
  assert.ok(peor.solapeTrabado <= 0.1, `superposición amiga con el grupo trabado ${peor.solapeTrabado}`);
  assert.ok(peor.lateral <= 1e-9, `lateral supera el avance en ${peor.lateral} px/s`);
  assert.ok(peor.dv <= 1 + 1e-9, `|Δv| supera aMax·DT (razón ${peor.dv})`);
  assert.ok(peor.desp <= 1 + 1e-9, `desplazamiento supera vMax·DT (razón ${peor.desp})`);
  assert.equal(peor.tartamudeo, 0, 'alguien quieto mientras otro del grupo va a > 20 %');
  assert.equal(peor.zigzag, 0, 'más de un cambio de signo lateral en 2 s');
  assert.equal(peor.enLinea, 0, 'un grupo trabado no quedó quieto en ≤ 0,5 s a ≤ 2 px');
});

test('40 unidades que llegan al punto de reunión toman lugares distintos sin superposición', () => {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
  submitOrder(w, { kind: 'soldado', team: 1, owner: null, count: 40, unitValue: 0, source: 'gift' });
  let muestras = 0;
  let peor = 0;
  for (let s = 0; s < 260; s++) {
    stepWorld(w);
    const enPuerta = w.units.filter((u) => u.squad.state === 'forming' && u.arrived);
    muestras += enPuerta.length;
    // lugares distintos: ni dos unidades en el mismo punto ni dos con huellas que se solapen más de 10 %
    for (let i = 0; i < enPuerta.length; i++) {
      for (let j = i + 1; j < enPuerta.length; j++) {
        const a = enPuerta[i];
        const b = enPuerta[j];
        const ox = Math.min(a.x + 3, b.x + 3) - Math.max(a.x - 3, b.x - 3);
        const oy = Math.min(a.y + 2, b.y + 2) - Math.max(a.y - 2, b.y - 2);
        peor = Math.max(peor, ox > 0 && oy > 0 ? (ox * oy) / (6 * 4) : 0);
      }
    }
  }
  assert.ok(muestras > 100, `solo ${muestras} muestras de unidades en su lugar de espera`);
  assert.ok(peor <= 0.1, `superposición en la puerta ${peor}`);
  assert.equal(w.units.length, 40);
});

test('cambio de calle: al llegar, el ancla se ajusta a la calle con un salto de ≤ 0,05 px (no empuja a los miembros)', () => {
  const w = mk();
  const { squad: sq } = seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 300, corridor: 1, lane: 0 });
  sq.state = 'converting';
  sq.slideY = sq.anchor.y + 30;
  sq.nextLane = 1;
  sq.afterConvert = 'holding';
  let salto = -1;
  for (let i = 0; i < 600 && sq.state === 'converting'; i++) {
    const antes = sq.anchor.y;
    stepWorld(w);
    if (sq.state !== 'converting') salto = Math.abs(sq.anchor.y - antes - sq.anchor.vy * DT);
  }
  assert.ok(salto >= 0, 'terminó de deslizarse');
  assert.ok(salto <= 0.05 + 1e-9, `salto de ${salto} px al ajustar el ancla`);
});
