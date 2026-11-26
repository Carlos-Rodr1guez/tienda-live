import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, resetRound, stepWorld } from '../public/js/sim/world.js';
import { submitOrder } from '../public/js/sim/queue.js';
import { addUnit, targetHeight } from '../public/js/sim/units.js';
import { doorOffsets } from '../public/js/sim/field.js';
import { hashWorld } from '../public/js/sim/hash.js';

// CB-21, CB-10: todas las unidades de un lado salen por UNA puerta (cinco ranuras rotativas cuyo paso depende del
// tipo), en orden de llegada, con el tope de vivos. Cada una sale por la primera ranura libre (nadie vivo a menos de
// 0,9 × el espaciado del par); si ninguna lo está, la cabeza de la cola espera y no gasta la ficha (D30).

const INMORTAL = { hq: { hp: 1e12 } };
const mundo = (game = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox' });
const orden = (kind, team, count, owner = null) => ({ kind, team, owner, count, unitValue: 0, source: 'gift' });

/** Corre n pasos y devuelve las unidades nuevas con el paso en que aparecieron (lado 0). */
function salidas(w, n, side = 0) {
  const vistos = new Set();
  const out = [];
  for (let i = 0; i < n; i++) {
    const paso = w.step;
    stepWorld(w);
    for (const e of w.drain()) {
      if (e.type !== 'spawn' || e.side !== side || vistos.has(e.id)) continue;
      vistos.add(e.id);
      out.push({ paso, u: w.units.find((u) => u.id === e.id), x: e.x, y: e.y });
    }
  }
  return out;
}

const SP = { soldado: 9, jeep: 20, tanque: 28, pesado: 38 };

/**
 * Corre n pasos y comprueba, EN EL INSTANTE de cada salida, la distancia a los amigos vivos tal como estaban al
 * empezar el paso (lo que ve el despliegue). Devuelve las salidas y la peor distancia relativa al espaciado del par.
 */
function salidasMidiendo(w, n, side = 0) {
  const out = [];
  let peor = Infinity;
  const vistos = new Set();
  for (let i = 0; i < n; i++) {
    const paso = w.step;
    const antes = w.units
      .filter((u) => u.alive && u.side === side)
      .map((u) => ({ x: u.x, y: u.y, sp: u.stats.spacing }));
    stepWorld(w);
    for (const e of w.drain()) {
      if (e.type !== 'spawn' || e.side !== side || vistos.has(e.id)) continue;
      vistos.add(e.id);
      const u = w.units.find((q) => q.id === e.id);
      for (const a of antes) peor = Math.min(peor, Math.hypot(a.x - e.x, a.y - e.y) / ((a.sp + u.stats.spacing) / 2));
      out.push({ paso, u, x: e.x, y: e.y });
    }
  }
  return { out, peor };
}

test('las ranuras escalan con el tipo: d = máx(9, espaciado / 2) → soldado 9, jeep 10, tanque 14, pesado 19', () => {
  const w = mundo();
  const door = w.field.sides[0].door;
  assert.deepEqual(doorOffsets(door, SP.soldado), [0, 9, -9, 18, -18]);
  assert.deepEqual(doorOffsets(door, SP.jeep), [0, 10, -10, 20, -20]);
  assert.deepEqual(doorOffsets(door, SP.tanque), [0, 14, -14, 28, -28]);
  assert.deepEqual(doorOffsets(door, SP.pesado), [0, 19, -19, 38, -38]);
  // un espaciado chico no estrecha la puerta por debajo del mínimo de 9 px
  assert.deepEqual(doorOffsets(door, 4), [0, 9, -9, 18, -18]);
  // sigue siendo UNA puerta: el ancho máximo es ±38 px y cabe en el suelo
  for (const s of w.field.sides)
    for (const k of Object.keys(SP))
      for (const dy of doorOffsets(s.door, SP[k])) {
        assert.ok(Math.abs(dy) <= 38);
        assert.ok(s.door.y + dy >= w.field.ground[0] && s.door.y + dy <= w.field.ground[1]);
      }
});

test('las unidades salen por las ranuras de SU tipo (x de la puerta, y en door.y + el desplazamiento del tipo)', () => {
  for (const kind of Object.keys(SP)) {
    const w = mundo();
    submitOrder(w, orden(kind, 1, 12, 'A'));
    const { out } = salidasMidiendo(w, 30 * 12, 0);
    assert.equal(out.length, 12, kind);
    const offs = doorOffsets(w.field.sides[0].door, SP[kind]);
    for (const s of out) {
      assert.equal(s.x, 124);
      assert.ok(offs.includes(s.y - 448), `${kind}: y ${s.y - 448} no es una de ${offs}`);
    }
  }
});

test('ráfaga de 40 tanques: nadie aparece a menos de 0,9 × 28 px de un amigo vivo; sale cada uno por una ranura libre', () => {
  const w = mundo();
  submitOrder(w, orden('tanque', 1, 40, 'A'));
  const { out, peor } = salidasMidiendo(w, 30 * 40, 0);
  assert.equal(out.length, 40, 'todos acaban saliendo');
  assert.ok(peor >= 0.9 - 1e-9, `distancia relativa mínima al salir: ${peor.toFixed(3)} (mínimo 0,9)`);
});

test('ráfaga de 20 pesados: nadie aparece a menos de 0,9 × 38 px de un amigo vivo', () => {
  const w = mundo();
  submitOrder(w, orden('pesado', 1, 20, 'A'));
  const { out, peor } = salidasMidiendo(w, 30 * 40, 0);
  assert.equal(out.length, 20);
  assert.ok(peor >= 0.9 - 1e-9, `distancia relativa mínima al salir: ${peor.toFixed(3)} (mínimo 0,9)`);
});

test('par mixto: un soldado tras un tanque respeta 0,9 × el promedio (18,5) y el FIFO se conserva', () => {
  const w = mundo();
  submitOrder(w, orden('tanque', 1, 10, 'A'));
  submitOrder(w, orden('soldado', 1, 10, 'B'));
  submitOrder(w, orden('pesado', 1, 5, 'C'));
  const { out, peor } = salidasMidiendo(w, 30 * 40, 0);
  assert.equal(out.length, 25);
  assert.ok(peor >= 0.9 - 1e-9, `distancia relativa mínima al salir: ${peor.toFixed(3)}`);
  assert.deepEqual(
    out.map((s) => s.u.owner),
    [...Array(10).fill('A'), ...Array(10).fill('B'), ...Array(5).fill('C')],
  );
});

test('si ninguna ranura está libre la cola espera y NO gasta la ficha ni el contador de salidas', () => {
  const w = mundo({ movement: { door: { maxWait: 100 } } });
  // tanque pinned en cada ranura de la puerta: ninguna queda libre
  const door = w.field.sides[0].door;
  for (const dy of doorOffsets(door, SP.tanque)) {
    const u = addUnit(w, 0, 'tanque', door.x, door.y + dy, { pinned: true });
    u.hp = u.maxHp = 1e12;
  }
  stepWorld(w); // la grilla se reconstruye en cada paso: que ya contenga a los tanques
  submitOrder(w, orden('tanque', 1, 1, 'A'));
  const n0 = w.doorN[0];
  for (let i = 0; i < 60; i++) stepWorld(w);
  assert.equal(w.queues[0].groundUnits, 1, 'sigue en la cola');
  assert.equal(w.doorN[0], n0, 'el contador de salidas no avanza');
  assert.equal(w.queues[0].tokens, 30, 'la ficha de 8/s queda llena (no se consume)');
  // se libera una ranura: sale ese mismo paso, por la ranura libre
  // (la ranura +28 sola no alcanza: el tanque de +14 está a 14 < 25,2; se liberan las dos. La altura de destino del
  // que sale, n = 1 → camino de abajo (yg ≈ 615), va hacia abajo: le corresponde la ranura de abajo)
  w.doorN[0] = 1;
  for (const dy of [14, 28]) {
    const q = w.units.find((u) => u.y === door.y + dy);
    q.alive = false;
    w.units.splice(w.units.indexOf(q), 1);
  }
  const { out } = salidasMidiendo(w, 3, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].y, door.y + 28);
});

test('la ranura sigue a la altura de destino: yg arriba sale por arriba, yg abajo por abajo (sin cruces en leg)', () => {
  const door = mundo().field.sides[0].door;
  const vistos = { arriba: 0, abajo: 0 };
  for (let n = 0; n < 30; n++) {
    const v = mundo();
    v.doorN[0] = n;
    submitOrder(v, orden('tanque', 1, 1, 'A'));
    const { out } = salidasMidiendo(v, 3, 0);
    const yg = targetHeight(v, n);
    const dy = out[0].y - door.y;
    if (yg < door.y - 15) {
      assert.ok(dy <= 0, `n = ${n}: yg ${yg.toFixed(0)} (arriba) sale por ${dy}`);
      vistos.arriba++;
    } else if (yg > door.y + 15) {
      assert.ok(dy >= 0, `n = ${n}: yg ${yg.toFixed(0)} (abajo) sale por ${dy}`);
      vistos.abajo++;
    }
  }
  assert.ok(vistos.arriba >= 5 && vistos.abajo >= 5, JSON.stringify(vistos));
});

test('con la ranura preferida ocupada toma la libre más cercana a su meta, sin cruzarse con el que sigue en la puerta', () => {
  const v = mundo();
  const door = v.field.sides[0].door;
  addUnit(v, 0, 'tanque', door.x, door.y, { pinned: true }); // ocupa 0 y ±14 (a 14 < 25,2)
  stepWorld(v); // la grilla se reconstruye en cada paso: que ya contenga al tanque
  v.doorN[0] = 1; // n = 1 → camino de abajo (yg ≈ 615, meta ≈ +15)
  assert.ok(targetHeight(v, 1) > door.y);
  submitOrder(v, orden('tanque', 1, 1, 'A'));
  const { out } = salidasMidiendo(v, 3, 0);
  // +14 está a 14 < 25,2 del tanque quieto; −28 queda a distancia libre pero del lado contrario a su yg (se cruzaría)
  assert.equal(out[0].y - door.y, 28);
});

test('con la puerta vacía sale por la ranura más cercana a la meta de su yg', () => {
  const door = mundo().field.sides[0].door;
  const v = mundo();
  v.doorN[0] = 7;
  const yg = targetHeight(v, 7);
  submitOrder(v, orden('tanque', 1, 1, 'A'));
  const { out } = salidasMidiendo(v, 3, 0);
  const offs = doorOffsets(door, SP.tanque);
  const meta = ((yg - door.y) / Math.max(738 - door.y, door.y - 138)) * 28;
  const mejor = Math.min(...offs.map((o) => Math.abs(o - meta)));
  assert.equal(Math.abs(out[0].y - door.y - meta), mejor);
});

test('el descriptor declara UNA puerta por lado con cinco ranuras (múltiplos 0, ±1, ±2 del paso del tipo) a y 448', () => {
  const w = mundo();
  for (const s of w.field.sides) {
    assert.deepEqual(s.door, {
      x: s.exitX,
      y: 448,
      slots: [0, 1, -1, 2, -2],
      slotMin: 9,
      slotStep: 0.5,
      freeFactor: 0.9,
    });
    assert.equal(s.gates, undefined, 'no hay tres puertas');
    assert.equal(s.sectors, undefined);
    assert.equal(s.defenseZone, undefined);
  }
  assert.equal(w.field.sides[0].door.x, 124);
  assert.equal(w.field.sides[1].door.x, w.field.w - 124);
});

test('200 salidas por lado: todas por la puerta, a 8 por segundo, y las 5 ranuras se turnan por el contador', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 200, 'A'));
  submitOrder(w, orden('soldado', 2, 200, 'B'));
  const l = salidas(w, 30 * 27, 0);
  assert.equal(l.length, 200);
  const offs = doorOffsets(w.field.sides[0].door, SP.soldado);
  for (const s of l) {
    assert.equal(s.x, 124, 'sale de la puerta');
    assert.ok(offs.includes(s.y - 448), `ranura ${s.y - 448} fuera de ${offs}`);
  }
  // las cinco ranuras se usan
  const cuenta = new Map();
  for (const s of l) cuenta.set(s.y, (cuenta.get(s.y) ?? 0) + 1);
  assert.equal(cuenta.size, 5);
  // ritmo: en cualquier ventana de 1 s salen a lo sumo 9 (8 por segundo + la ficha inicial)
  for (let i = 0; i + 8 < l.length; i++) {
    const t = (l[i + 8].paso - l[i].paso) / 30;
    assert.ok(t >= 0.9, `9 salidas en ${t} s`);
  }
});

test('el lado derecho sale de SU puerta, en el espejo, con las mismas ranuras', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 2, 20, 'B'));
  const l = salidas(w, 30 * 4, 1);
  assert.equal(l.length, 20);
  const offs = doorOffsets(w.field.sides[1].door, SP.soldado);
  for (const s of l) {
    assert.equal(s.x, w.field.w - 124);
    assert.ok(offs.includes(s.y - 448));
  }
});

test('el tope de vivos por lado se respeta y el resto espera en la cola', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 300, 'A'));
  for (let i = 0; i < 30 * 40; i++) {
    stepWorld(w);
    assert.ok(w.units.filter((u) => u.side === 0).length <= 200);
  }
  assert.equal(w.units.filter((u) => u.side === 0).length, 200);
  // las torretas enemigas matan a algunos y esos cupos se reponen: lo encolado es lo pedido menos lo salido
  assert.equal(w.queues[0].groundUnits, 300 - w.nextId);
  assert.ok(w.queues[0].groundUnits > 0, 'el resto sigue esperando');
});

test('FIFO: salen en el orden de las órdenes, con sus dueños', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 3, 'A'));
  submitOrder(w, orden('jeep', 1, 2, 'B'));
  submitOrder(w, orden('tanque', 1, 1, 'C'));
  const l = salidas(w, 200, 0);
  assert.deepEqual(
    l.map((s) => `${s.u.kind}:${s.u.owner}`),
    ['soldado:A', 'soldado:A', 'soldado:A', 'jeep:B', 'jeep:B', 'tanque:C'],
  );
});

/** Ritmo real de una ráfaga: salidas por segundo entre la primera y la última (puerta vacía al empezar). */
function ritmo(kind, n) {
  const w = mundo();
  submitOrder(w, orden(kind, 1, n, 'A'));
  const l = salidas(w, 30 * 60, 0);
  assert.equal(l.length, n, `${kind}: salieron todos`);
  return {
    porSegundo: (n - 1) / ((l[n - 1].paso - l[0].paso) / 30),
    hueco: Math.max(...l.slice(1).map((s, i) => s.paso - l[i].paso)),
  };
}

test('ritmo de salida por tipo: los soldados siguen a 8/s; los pesados salen más lento (esperan ranura libre)', () => {
  // Medido (puerta vacía, ráfaga): soldado 8,00/s · jeep 5,73/s · tanque 3,10/s · pesado 1,74/s. Menos de 8/s para los
  // tipos grandes es lo esperado: se espera a que el anterior se aleje 0,9 × su espaciado en vez de aparecer encimado.
  const s = ritmo('soldado', 200);
  assert.ok(s.porSegundo >= 7.95 && s.porSegundo <= 8.05, `soldados ${s.porSegundo.toFixed(2)}/s`);
  assert.ok(s.hueco <= 4, `hueco máximo de soldados: ${s.hueco} pasos`);
  const j = ritmo('jeep', 60);
  const t = ritmo('tanque', 40);
  const p = ritmo('pesado', 20);
  assert.ok(j.porSegundo >= 5 && j.porSegundo <= 8, `jeeps ${j.porSegundo.toFixed(2)}/s`);
  assert.ok(t.porSegundo >= 2.5 && t.porSegundo <= 8, `tanques ${t.porSegundo.toFixed(2)}/s`);
  assert.ok(p.porSegundo >= 1.4 && p.porSegundo <= 8, `pesados ${p.porSegundo.toFixed(2)}/s`);
  assert.ok(j.porSegundo > t.porSegundo && t.porSegundo > p.porSegundo, 'cuanto más grande, más lento');
});

test('nadie espera a nadie más que a una ranura libre: el hueco entre salidas sigue acotado (< 1,5 s)', () => {
  for (const [kind, n] of [
    ['tanque', 40],
    ['pesado', 20],
  ]) {
    const w = mundo();
    submitOrder(w, orden(kind, 1, n, 'A'));
    const l = salidas(w, 30 * 60, 0);
    assert.equal(l.length, n);
    for (let i = 1; i < l.length; i++)
      assert.ok(l[i].paso - l[i - 1].paso < 45, `${kind}: hueco de ${l[i].paso - l[i - 1].paso} pasos`);
  }
});

test('cada unidad recibe su altura de destino yg del contador de salidas y empieza en la fase leg', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 20, 'A'));
  const l = salidas(w, 30 * 4, 0);
  for (const [n, s] of l.entries()) {
    assert.equal(s.u.phase, 'leg');
    assert.equal(s.u.yg, targetHeight(w, n));
  }
});

test('el contador de salidas es por lado y por ronda: resetRound lo reinicia', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 3, 'A'));
  submitOrder(w, orden('soldado', 2, 1, 'B'));
  salidas(w, 120, 0);
  assert.deepEqual(w.doorN, [3, 1]);
  resetRound(w);
  assert.deepEqual(w.doorN, [0, 0]);
});

test('sin protección al aparecer por defecto (spawnShield 0) y con un valor se activa', () => {
  const w = mundo();
  assert.equal(w.cfg.movement.spawnShield, 0);
  submitOrder(w, orden('soldado', 1, 1, 'A'));
  const [s] = salidas(w, 3, 0);
  assert.equal(s.u.shieldUntil, 0);
  const p = mundo({ movement: { spawnShield: 1.5 } });
  submitOrder(p, orden('soldado', 1, 1, 'A'));
  const [t] = salidas(p, 3, 0);
  assert.ok(t.u.shieldUntil > p.step);
});

// ---------------------------------------------------------------------------------------------------------------
// Puerta despejada y espera acotada (R7: el cierre de cada ronda es una base sitiada)

/** Semiancho del umbral de un soldado: 0,9 × (9 + 38) / 2 en x; en y: 2 × 19 + 1,2 × (9 + 38) / 2 (ver field.js). */
const UMBRAL_SOLDADO = { x: 21.15, y: 66.2 };

const dentro = (u, door, z) => Math.abs(u.x - door.x) < z.x - 0.01 && Math.abs(u.y - door.y) < z.y - 0.01;

function enemigoQuieto(w, side, kind, x, y) {
  const e = addUnit(w, side, kind, x, y, { pinned: true });
  e.hp = e.maxHp = 1e12;
  return e;
}

test('puerta despejada: quien nace con un enemigo al alcance sigue avanzando hasta salir del umbral y recién ahí frena y dispara', () => {
  const w = mundo({ movement: { spawnShield: 1000 } });
  const door = w.field.sides[0].door;
  enemigoQuieto(w, 1, 'soldado', door.x + 20, door.y); // a 20 px de la puerta, al alcance del soldado (28)
  stepWorld(w);
  submitOrder(w, orden('soldado', 1, 1, 'A'));
  let u = null;
  let detenidoDentro = 0;
  let disparos = 0;
  let tgtAlNacer = false;
  for (let i = 0; i < 120; i++) {
    stepWorld(w);
    u ??= w.units.find((q) => q.owner === 'A') ?? null;
    for (const e of w.drain()) if (e.type === 'shot' && u && e.id === u.id) disparos++;
    if (!u) continue;
    if (u.tgt !== null) tgtAlNacer = true;
    const v = Math.hypot(u.vx, u.vy);
    // los primeros pasos arrancan de v = 0; después nadie se queda quieto dentro del umbral
    if (w.step > 4 && dentro(u, door, UMBRAL_SOLDADO) && v < 1) detenidoDentro++;
  }
  assert.ok(u && tgtAlNacer, 'la unidad tuvo blanco al alcance desde que nació');
  assert.equal(detenidoDentro, 0, 'nadie queda detenido dentro del umbral');
  assert.ok(!dentro(u, door, UMBRAL_SOLDADO), 'terminó fuera del umbral');
  assert.ok(Math.hypot(u.vx, u.vy) < 1 && u.tgt !== null, 'y ahí frenó para disparar');
  assert.ok(disparos > 0, 'dispara');
});

/** Asedio forzado: atacantes quietos frente a la puerta de B, al alcance, y una ráfaga para B. */
function asedio(game = {}) {
  const w = mundo({ movement: { spawnShield: 1000 }, ...game });
  const door = w.field.sides[1].door;
  for (const [kind, dx, dy] of [
    ['tanque', -20, -30],
    ['tanque', -20, 30],
    ['soldado', -15, 0],
    ['soldado', -20, 60],
    ['soldado', -20, -60],
  ])
    enemigoQuieto(w, 0, kind, door.x + dx, door.y + dy);
  stepWorld(w);
  submitOrder(w, orden('soldado', 2, 40, 'S'));
  submitOrder(w, orden('tanque', 2, 4, 'T'));
  submitOrder(w, orden('pesado', 2, 2, 'P'));
  const l = [];
  const vistos = new Set();
  const inicio = w.step;
  for (let i = 0; i < 30 * 60; i++) {
    stepWorld(w);
    for (const e of w.drain())
      if (e.type === 'spawn' && e.side === 1 && !vistos.has(e.id)) {
        vistos.add(e.id);
        l.push({ paso: w.step - inicio, kind: e.kind, owner: w.units.find((q) => q.id === e.id)?.owner });
      }
  }
  return { w, l };
}

test('asedio forzado: salen los 46, la cola no espera más de maxWait y los soldados salen a buen ritmo', () => {
  const { w, l } = asedio();
  assert.equal(l.length, 46, 'salió toda la ráfaga');
  assert.deepEqual(
    l.map((s) => s.owner),
    [...Array(40).fill('S'), ...Array(4).fill('T'), ...Array(2).fill('P')],
    'FIFO',
  );
  assert.ok(w.queueStats.waitMax <= w.cfg.movement.door.maxWait * 30, `espera máxima ${w.queueStats.waitMax} pasos`);
  const soldados = l.filter((s) => s.kind === 'soldado');
  const ritmo = 39 / ((soldados[39].paso - soldados[0].paso) / 30);
  assert.ok(ritmo >= 6, `ritmo de soldados ${ritmo.toFixed(2)}/s`);
  // nadie quedó detenido dentro del umbral de su puerta
  const door = w.field.sides[1].door;
  for (const u of w.units.filter((q) => q.side === 1)) {
    const par = (u.stats.spacing + w.maxSpacing) / 2;
    const adentro = Math.abs(u.x - door.x) < 0.9 * par - 0.01 && Math.abs(u.y - door.y) < 2 * 19 + 1.2 * par - 0.01;
    assert.ok(!(adentro && Math.hypot(u.vx, u.vy) < 1), `unidad ${u.id} (${u.kind}) detenida dentro del umbral`);
  }
});

test('seguro: con las cinco ranuras tapadas la cabeza sale a los maxWait × 30 pasos, por la de más holgura, y el FIFO se conserva', () => {
  const w = mundo();
  const door = w.field.sides[0].door;
  assert.equal(w.cfg.movement.door.maxWait, 1);
  // amigos congelados (soldados) cerca de cada ranura [0, 9, −9, 18, −18]; la ranura −18 es la que más holgura tiene
  for (const dy of [0, 6, -8, 14, -12]) {
    const f = addUnit(w, 0, 'soldado', door.x, door.y + dy, { pinned: true });
    f.hp = f.maxHp = 1e12;
  }
  stepWorld(w);
  submitOrder(w, orden('soldado', 1, 1, 'A'));
  submitOrder(w, orden('soldado', 1, 1, 'B'));
  const antes = w.step;
  const pasos = [];
  const ys = [];
  for (let i = 0; i < 100; i++) {
    stepWorld(w);
    for (const e of w.drain()) {
      if (e.type === 'spawn') {
        pasos.push(w.step - antes);
        ys.push(e.y - door.y);
      }
    }
  }
  assert.equal(pasos[0], 30, 'sale exactamente al llegar a maxWait × SIM_HZ');
  assert.equal(ys[0], -18, 'por la ranura de más holgura');
  // la ficha de 8/s tarda 4 pasos en recargarse y solo cuenta la espera con ficha: 30 de espera + hasta 4 de recarga
  assert.ok(
    pasos[1] - pasos[0] >= 30 && pasos[1] - pasos[0] <= 34,
    `la siguiente espera maxWait completo (${pasos[1] - pasos[0]})`,
  );
  assert.equal(w.queueStats.forced, 2);
  assert.equal(w.queues[0].groundUnits, 0);
  assert.deepEqual(
    w.units.filter((u) => !u.pinned).map((u) => u.owner),
    ['A', 'B'],
  );
});

test('el contador de espera es estado: entra al hash y se reinicia al salir una unidad', () => {
  const w = mundo();
  const door = w.field.sides[0].door;
  for (const dy of [0, 9, -9, 18, -18]) {
    const g = addUnit(w, 0, 'soldado', door.x, door.y + dy, { pinned: true });
    g.hp = g.maxHp = 1e12;
  }
  stepWorld(w);
  submitOrder(w, orden('soldado', 1, 1, 'A'));
  for (let i = 0; i < 10; i++) stepWorld(w);
  assert.equal(w.queues[0].wait, 10);
  const h10 = hashWorld(w);
  stepWorld(w);
  assert.notEqual(hashWorld(w), h10);
  w.queues[0].wait = 11; // el mismo estado salvo el contador: el hash debe distinguirlo
  const h11 = hashWorld(w);
  w.queues[0].wait = 12;
  assert.notEqual(hashWorld(w), h11, 'q.wait entra al hash');
  for (let i = 0; i < 25; i++) stepWorld(w);
  assert.equal(w.queues[0].wait, 0, 'se reinició al salir');
});
