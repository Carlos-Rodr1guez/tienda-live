import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { applyEvent, createWorld, resetRound, stepWorld } from '../public/js/sim/world.js';
import { addUnit, createSquad, placeOffset } from '../public/js/sim/squads.js';
import { createFromPlan, submitGift, submitOrder } from '../public/js/sim/queue.js';
import { planAlta } from '../public/js/sim/commander.js';
import { ledger } from '../public/js/sim/credit.js';

// CB-7, CB-8, CB-10, CB-14 (órdenes), CB-21 (alta, grupos abiertos y cerrados): todo entra por la cola.

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
const INMORTAL = { hq: { hp: 1e12 } }; // la base no cae: estos tests no miden el final de ronda

const mundo = (game = {}, opts = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox', ...opts });
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const orden = (kind, team, count, unitValue = 0, owner = null, source = 'gift') => ({
  kind,
  team,
  owner,
  count,
  unitValue,
  source,
});
const vivos = (w, side) => w.units.filter((u) => u.side === side).length;
const enCola = (w, side) => w.queues[side].groundUnits;

/** Corre n pasos y devuelve el paso (de reloj) en que apareció cada unidad nueva del lado. */
function conPasos(w, n, side = 0) {
  const pasos = [];
  const vistos = new Set();
  for (let i = 0; i < n; i++) {
    const paso = w.step;
    stepWorld(w);
    for (const u of w.units) {
      if (u.side === side && !vistos.has(u.id)) {
        vistos.add(u.id);
        pasos.push(paso);
      }
    }
  }
  return pasos;
}

test('tope de 200 vivos por lado en CADA paso: 500 unidades pedidas durante 5 min, el resto espera', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 500, 1, 'A'));
  let max = 0;
  for (let i = 0; i < 9000; i++) {
    stepWorld(w);
    max = Math.max(max, vivos(w, 0));
    assert.ok(vivos(w, 0) <= 200, `paso ${i}: ${vivos(w, 0)} vivos`);
    if (i === 900) {
      assert.equal(vivos(w, 0), 200);
      assert.equal(enCola(w, 0), 300, 'el resto sigue esperando');
    }
  }
  assert.equal(max, 200);
});

test('8 apariciones por segundo: un regalo de 40 sale con la última unidad en ≈ 4,9 s', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 40, 1, 'A'));
  const pasos = conPasos(w, 300);
  assert.equal(pasos.length, 40);
  const ultima = pasos.at(-1) / 30;
  assert.ok(ultima > 4.7 && ultima < 5.1, `la última salió en ${ultima} s`);
  // ritmo: nunca más de una unidad por paso y 8 por segundo de promedio
  assert.equal(new Set(pasos).size, 40);
  assert.ok(pasos.filter((p) => p < 30).length <= 9, 'la primera sale sin esperar y luego 8 por segundo');
});

test('FIFO estricto: A 3, B 2 y C 4 con 9 cupos salen A, B, C sin intercalar', () => {
  const w = mundo({ limits: { maxAlivePerSide: 40 } });
  submitOrder(w, orden('soldado', 1, 40, 1, 'X'));
  run(w, 400);
  assert.equal(vivos(w, 0), 40);
  submitOrder(w, orden('soldado', 1, 3, 1, 'A'));
  submitOrder(w, orden('soldado', 1, 2, 1, 'B'));
  submitOrder(w, orden('soldado', 1, 4, 1, 'C'));
  run(w, 60);
  assert.equal(enCola(w, 0), 9, 'con el lado en el tope nada sale');
  const muertos = w.units.filter((u) => u.side === 0 && u.owner === 'X').slice(0, 9);
  for (const u of muertos) u.alive = false;
  const vistos = new Set(w.units.map((u) => u.id));
  const salida = [];
  for (let i = 0; i < 200; i++) {
    stepWorld(w);
    for (const u of w.units) {
      if (!vistos.has(u.id)) {
        vistos.add(u.id);
        salida.push(u.owner);
      }
    }
  }
  assert.deepEqual(salida, ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'C', 'C']);
});

test('cola llena (4000): lo que no entra suma a overflowValue, conserva el valor y avisa de forma acotada', () => {
  const w = mundo({ limits: { maxAlivePerSide: 40 } });
  submitOrder(w, orden('soldado', 1, 4000, 2, 'A'));
  assert.equal(enCola(w, 0), 4000);
  submitOrder(w, orden('soldado', 1, 10, 3, 'B'));
  assert.equal(w.credit.overflow[0], 30);
  assert.equal(w.queueStats.overflow, 1);
  submitOrder(w, orden('soldado', 1, 5, 3, 'B'));
  assert.equal(w.credit.overflow[0], 45);
  assert.equal(w.queueStats.overflow, 2);
  const avisos = w.drain().filter((e) => e.type === 'warn');
  assert.equal(avisos.length, 1, 'un solo aviso en 10 s de reloj de juego');
  run(w, 301);
  submitOrder(w, orden('soldado', 1, 100, 3, 'B'));
  assert.equal(w.drain().filter((e) => e.type === 'warn').length, 1, 'otro aviso pasados 10 s');
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6, 'el valor se conserva');
});

test('la cola sobrevive entre rondas y en pausa no drena', () => {
  const w = mundo({ limits: { maxAlivePerSide: 40 } });
  submitOrder(w, orden('soldado', 1, 60, 1, 'A'));
  run(w, 400);
  assert.equal(enCola(w, 0), 20);
  resetRound(w);
  assert.equal(w.units.length, 0);
  assert.equal(enCola(w, 0), 20, 'la cola sigue tras limpiar el campo');
  w.paused = true;
  const antes = w.step;
  run(w, 300);
  assert.equal(w.step, antes, 'en pausa el reloj no avanza');
  assert.equal(w.units.length, 0, 'ni se drena');
  assert.equal(enCola(w, 0), 20);
  submitOrder(w, orden('soldado', 1, 5, 1, 'B'));
  assert.equal(enCola(w, 0), 25, 'las órdenes sí esperan en la cola durante la pausa');
  w.paused = false;
  run(w, 400);
  assert.equal(enCola(w, 0), 0);
  assert.equal(vivos(w, 0), 25);
});

test('un regalo de 10 con el lado en el tope se encola con monedas y XP ya acreditados y sale completo', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  registry.touch({ userId: 'A', nickname: 'A' });
  const w = mundo({ limits: { maxAlivePerSide: 40 } }, { registry });
  submitOrder(w, orden('soldado', 1, 40, 0, null));
  run(w, 400);
  const pedidas = 10;
  submitGift(w, { owner: 'A', coins: 50, orders: [orden('soldado', 1, pedidas, 5, 'A')] });
  assert.equal(registry.get('A').coins.live, 50, 'monedas al llegar');
  assert.equal(registry.get('A').xp.live, 50, 'y XP al llegar');
  assert.equal(enCola(w, 0), pedidas);
  for (const u of w.units.filter((x) => x.side === 0).slice(0, 10)) u.alive = false;
  run(w, 200);
  assert.equal(enCola(w, 0), 0);
  const mios = w.units.filter((u) => u.owner === 'A').length;
  assert.equal(mios, pedidas, 'spawned + queued + merged == ordered');
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6);
});

test('punto de aparición libre: un amigo de otro grupo encima lo bloquea y sin él la cabeza sale', () => {
  const w = mundo();
  const s = w.field.sides[0];
  const otro = createSquad(w, {
    side: 0,
    kind: 'soldado',
    role: 'ataque',
    state: 'holding',
    x: 600,
    y: 600,
    pinned: true,
  });
  const amigos = s.gates.map((y) => addUnit(w, otro, s.exitX + 2, y, {}));
  for (const a of amigos) a.cd = 1e9;
  submitOrder(w, orden('soldado', 1, 1, 0));
  run(w, 5);
  assert.equal(vivos(w, 0), 3, 'bloqueado: solo están los amigos (cualquier corredor que elija el comandante)');
  for (const a of amigos) a.x = 600; // se van
  run(w, 5);
  assert.equal(vivos(w, 0), 4, 'sin los amigos la cabeza sale');
});

test('posición de aparición sin azar: con poblaciones iguales siempre el mismo lugar', () => {
  const corrida = () => {
    const w = mundo();
    submitOrder(w, orden('soldado', 1, 12, 1, 'A'));
    submitOrder(w, orden('jeep', 1, 3, 1, 'B'));
    run(w, 200);
    return w.units.map((u) => [u.id, u.x, u.y]);
  };
  assert.deepEqual(corrida(), corrida());
});

test('en matchup un regalo suma monedas y XP de LIVE, muestra el agradecimiento y no crea ni encola unidades', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  registry.touch({ userId: 'A', nickname: 'A' });
  const w = mundo({}, { registry, phase: 'matchup' });
  submitGift(w, { owner: 'A', coins: 100, orders: [orden('soldado', 1, 100, 1, 'A')] });
  assert.equal(registry.get('A').coins.live, 100);
  assert.equal(registry.get('A').xp.live, 100);
  assert.ok(w.drain().some((e) => e.type === 'thanks' && e.coins === 100));
  assert.equal(w.units.length, 0);
  assert.equal(enCola(w, 0) + enCola(w, 1), 0);
  assert.equal(w.credit.paid, 0);
  w.phase = 'battle'; // startMatch
  assert.equal(enCola(w, 0) + enCola(w, 1), 0, 'la cola está vacía al empezar el partido');
});

// ---------------------------------------------------------------------------------------------------- 4c.4

test('60 s sin eventos: ambos lados reciben las mismas unidades por tipo (refuerzos desde t = 3 s y cada 12 s)', () => {
  const w = mundo({}, { phase: 'battle' });
  const cuenta = [{}, {}];
  const pasos = [];
  for (let i = 0; i < 1800; i++) {
    stepWorld(w);
    for (const e of w.drain()) {
      if (e.type === 'spawn') {
        cuenta[e.side][e.kind] = (cuenta[e.side][e.kind] ?? 0) + 1;
        if (e.side === 0) pasos.push(w.step - 1);
      }
    }
  }
  assert.deepEqual(cuenta[0], cuenta[1]);
  assert.equal(cuenta[0].soldado, 20, '5 refuerzos de 4 en 60 s (t = 3, 15, 27, 39, 51)');
  assert.ok(pasos[0] >= 90 && pasos[0] < 95, 'el primero sale recién a los 3 s');
  assert.ok(
    w.units.every((u) => u.owner === null && u.unitValue === 0),
    'dueño null y valor 0',
  );
});

test('los refuerzos base forman grupos y salen 6 s después de la primera llegada', () => {
  const w = mundo({}, { phase: 'battle' });
  run(w, 90 + 600);
  const g = w.squads.filter((s) => s.side === 0)[0];
  assert.equal(g.members.length, 4);
  assert.ok(g.firstArrivalStep > 90);
  assert.equal(g.departStep - g.firstArrivalStep, 180, 'sale 6 s después de la primera llegada');
  assert.notEqual(g.state, 'forming');
});

test('unión: re-enviar "1" cinco veces deja exactamente un soldado; la ronda siguiente puede ganar otro', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  const w = mundo({}, { registry });
  const chat = (text, id = 'U') =>
    applyEvent(w, { type: 'chat', evt: { type: 'chat', userId: id, nickname: id, text } });
  for (let i = 0; i < 5; i++) chat('1');
  assert.equal(enCola(w, 0), 1, 'un solo soldado en cola');
  run(w, 10);
  assert.equal(w.units.filter((u) => u.owner === 'U').length, 1);
  assert.equal(w.units.find((u) => u.owner === 'U').unitValue, 0);
  w.round = 2;
  chat('1');
  assert.equal(enCola(w, 0), 1, 'a la ronda siguiente gana otro');
});

test('un cambio de equipo bloqueado por el cooldown no da soldado', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  const w = mundo({}, { registry });
  const chat = (text) => applyEvent(w, { type: 'chat', evt: { type: 'chat', userId: 'U', nickname: 'U', text } });
  chat('1');
  w.round = 2;
  run(w, 30); // 1 s: dentro del cooldown de 15 s
  chat('2');
  assert.equal(registry.get('U').team, 1, 'el cambio quedó bloqueado');
  assert.equal(enCola(w, 1), 0, 'y no dio soldado al otro lado');
});

test('likes (4 soldados), follow (1 jeep) y share (3 soldados) entran por la cola con valor 0', () => {
  const w = mundo({ social: { likes: { perReinforcement: 300 } } });
  applyEvent(w, { type: 'likes', team: 1, count: 290 });
  assert.equal(enCola(w, 0), 0);
  applyEvent(w, { type: 'likes', team: 1, count: 20 });
  assert.equal(enCola(w, 0), 4);
  applyEvent(w, { type: 'follow', team: 2, owner: 'F' });
  applyEvent(w, { type: 'share', team: 2, owner: 'S' });
  assert.equal(enCola(w, 1), 4);
  const o = w.queues[1].ground;
  assert.equal(o[0].kind, 'jeep');
  assert.equal(o[1].kind, 'soldado');
  assert.ok(w.queues[0].ground.every((x) => x.unitValue === 0 && x.owner === null));
  assert.ok(o.every((x) => x.unitValue === 0));
});

test('cola de aire (≤ 20): ≤ 2 aviones vivos, ≥ 1,5 s entre lanzamientos y no cuenta para el tope de tierra', () => {
  const w = mundo({ limits: { maxAlivePerSide: 40 } });
  submitOrder(w, orden('soldado', 1, 60, 1, 'A'));
  run(w, 400);
  assert.equal(vivos(w, 0), 40, 'la tierra está en su tope');
  submitOrder(w, orden('avion', 1, 25, 500, 'P'));
  assert.equal(w.queues[0].airUnits, 20, 'la cola de aire admite 20');
  assert.equal(w.credit.overflow[0], 5 * 500);
  const lanzamientos = [];
  let maxVivos = 0;
  for (let i = 0; i < 1500; i++) {
    const n = w.planes.length;
    stepWorld(w);
    maxVivos = Math.max(maxVivos, w.planes.filter((p) => p.side === 0).length);
    if (w.planes.length > n || w.planes.some((p) => p.launchStep === w.step - 1)) {
      for (const p of w.planes) if (p.launchStep === w.step - 1) lanzamientos.push(p.launchStep);
    }
  }
  assert.ok(lanzamientos.length >= 4, 'los aviones salieron aunque la tierra estaba al tope');
  assert.ok(maxVivos <= 2);
  for (let i = 1; i < lanzamientos.length; i++) assert.ok(lanzamientos[i] - lanzamientos[i - 1] >= 45);
});

// ---------------------------------------------------------------------------------------------------- 4c.8

/** Pone un grupo formando con `n` unidades ya en su lugar de espera. */
function formando(w, side, kind, n, plan) {
  const sq = createFromPlan(w, side, kind, plan);
  const dir = w.field.sides[side].dir;
  for (let i = 0; i < n; i++) {
    const off = placeOffset(w.cfg, kind, i, n, dir);
    addUnit(w, sq, plan.x + off.x, plan.y + off.y, {});
  }
  return sq;
}

test('tamaños 10/4/2/1 sin mezclar tipos: 25 soldados, 5 jeeps, 3 tanques y 1 pesado', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 25, 0));
  submitOrder(w, orden('jeep', 1, 5, 0));
  submitOrder(w, orden('tanque', 1, 3, 0));
  submitOrder(w, orden('pesado', 1, 1, 0));
  run(w, 500);
  const tam = (kind) =>
    w.squads
      .filter((s) => s.kind === kind)
      .map((s) => s.members.length)
      .sort((a, b) => b - a);
  assert.deepEqual(tam('soldado'), [10, 10, 5]);
  assert.deepEqual(tam('jeep'), [4, 1]);
  assert.deepEqual(tam('tanque'), [2, 1]);
  assert.deepEqual(tam('pesado'), [1]);
  for (const s of w.squads) assert.ok(s.members.every((u) => u.kind === s.kind));
});

test('a lo sumo un grupo abierto por tipo y lado, y se cierra lleno o con < 2 s para salir por tiempo', () => {
  const w = mundo({ limits: { spawnsPerSecond: 3 } });
  submitOrder(w, orden('soldado', 1, 30, 0));
  submitOrder(w, orden('jeep', 1, 8, 0));
  for (let i = 0; i < 900; i++) {
    stepWorld(w);
    for (const side of [0, 1]) {
      for (const kind of ['soldado', 'jeep', 'tanque', 'pesado']) {
        const abiertos = w.squads.filter((s) => s.side === side && s.kind === kind && s.open);
        assert.ok(abiertos.length <= 1, `paso ${i}: ${abiertos.length} abiertos de ${kind}`);
      }
    }
    for (const s of w.squads) {
      if (s.state === 'forming' && s.firstArrivalStep >= 0 && w.step - s.firstArrivalStep >= 120) {
        assert.equal(s.open, false, 'con menos de 2 s para salir, cerrado');
      }
      if (s.members.length >= w.cfg.squads.size[s.kind]) assert.equal(s.open, false);
    }
  }
});

test('llegadas lentas: el grupo lleno sale al llegar el décimo y el soldado 11 abre un grupo nuevo', () => {
  const w = mundo({ limits: { spawnsPerSecond: 5 } });
  submitOrder(w, orden('soldado', 1, 11, 0));
  const salida = [];
  for (let i = 0; i < 300; i++) {
    stepWorld(w);
    for (const e of w.drain()) if (e.type === 'squadDepart') salida.push([e.id, e.n, w.step - 1]);
  }
  const uno = w.squads.find((s) => s.id === 1);
  assert.equal(uno.members.length, 10);
  assert.ok(uno.members.every((u) => u.arrived));
  assert.equal(salida[0][1], 10);
  assert.ok(salida[0][2] < uno.firstArrivalStep + 180, 'salió por estar lleno, no por tiempo');
  const dos = w.squads.find((s) => s.id === 2);
  assert.equal(dos.members.length, 1, 'el soldado 11 abre otro grupo');
});

test('alta en 0 con llegadas en 2, 3 y 4 s: el grupo de 3 sale en 8 s, no antes', () => {
  const w = mundo();
  const plan = planAlta(w, 0, 'soldado');
  const sq = createFromPlan(w, 0, 'soldado', plan);
  const dir = 1;
  const llega = (paso) => {
    while (w.step < paso) stepWorld(w);
    const n = sq.members.length + 1;
    const off = placeOffset(w.cfg, 'soldado', n - 1, n, dir);
    addUnit(w, sq, plan.x + off.x, plan.y + off.y, {});
  };
  llega(60); // 2 s
  llega(90);
  llega(120);
  while (w.step < 239) stepWorld(w);
  assert.equal(sq.state, 'forming', 'aún no, a 7,97 s');
  stepWorld(w);
  stepWorld(w);
  assert.notEqual(sq.state, 'forming');
  assert.equal(sq.departStep, 240, 'sale en 8 s (6 s desde la primera llegada)');
  assert.equal(sq.members.length, 3);
});

test('grupo de 3 con la primera llegada en 0 y un soldado que sale de la cola en 4,5 s: queda cerrado y el nuevo abre otro', () => {
  const w = mundo();
  const plan = planAlta(w, 0, 'soldado');
  const sq = formando(w, 0, 'soldado', 3, plan);
  run(w, 1); // primera llegada en el paso 0
  assert.equal(sq.firstArrivalStep, 0);
  while (w.step < 135) stepWorld(w); // 4,5 s
  assert.equal(sq.open, false, 'le quedan 1,5 s: cerrado');
  submitOrder(w, orden('soldado', 1, 1, 0));
  stepWorld(w);
  assert.equal(sq.members.length, 3, 'conserva sus 3');
  const nuevo = w.squads.find((s) => s.id !== sq.id && s.side === 0);
  assert.ok(nuevo, 'el nuevo abre otro grupo');
  assert.ok(nuevo.assembly.y !== sq.anchor.y || nuevo.assembly.x !== sq.anchor.x, 'en un lugar libre');
  while (w.step < 181) stepWorld(w);
  assert.equal(sq.departStep, 180, 'sale en 6 s');
});

test('el pesado sale en su llegada', () => {
  const w = mundo();
  submitOrder(w, orden('pesado', 1, 1, 0));
  run(w, 400);
  const g = w.squads[0];
  assert.equal(g.members.length, 1);
  assert.equal(g.departStep, g.firstArrivalStep, 'sale en el mismo paso en que llega');
});

test('rol, corredor y calle quedan fijos en el alta, antes de cualquier llegada', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 10, 0));
  run(w, 2);
  const g = w.squads[0];
  assert.equal(g.state, 'forming');
  assert.equal(g.firstArrivalStep, -1, 'todavía sin llegadas');
  const foto = [g.role, g.corridor, g.lane, g.sector, g.post];
  assert.ok(g.assembly && g.assembly.x === w.field.sides[0].gateX.soldado);
  run(w, 400);
  assert.deepEqual([g.role, g.corridor, g.lane, g.sector, g.post], foto);
});

test('la cabeza espera SOLO con todos los lugares ocupados: el pesado ve 9 cajas, los soldados 9 + 3 de DEFENSA', () => {
  const w = mundo({ commander: { bias: 100 } });
  // 9 cajas de ATAQUE ocupadas con pesados que todavía no llegan (grupos de 1: cerrados)
  for (let i = 0; i < 9; i++) {
    const plan = planAlta(w, 0, 'pesado');
    assert.ok(plan, `caja ${i}`);
    const sq = createFromPlan(w, 0, 'pesado', plan);
    addUnit(w, sq, w.field.sides[0].exitX, plan.y, {});
  }
  assert.equal(planAlta(w, 0, 'pesado'), null, 'los pesados no tienen dónde: la cabeza espera');
  const plan = planAlta(w, 0, 'soldado');
  assert.ok(plan, 'los soldados todavía tienen los lugares de DEFENSA libres');
  submitOrder(w, orden('pesado', 1, 1, 0));
  run(w, 30);
  assert.equal(w.units.filter((u) => u.kind === 'pesado').length, 9, 'el décimo pesado no salió');
  // un lugar libre y sale en el primer paso
  const libre = w.squads[0];
  libre.members[0].alive = false;
  stepWorld(w); // el paso reap quita al miembro y el grupo vacío libera la caja
  stepWorld(w);
  assert.equal(w.units.filter((u) => u.kind === 'pesado' && u.alive).length, 9, 'ocupó el lugar libre');
  assert.equal(enCola(w, 0), 0);
});

test('saturación: la cabeza espera y el soldado que viene detrás NO se adelanta aunque tenga lugar de DEFENSA', () => {
  const w = mundo({ commander: { bias: 100 } });
  for (let i = 0; i < 9; i++) {
    const plan = planAlta(w, 0, 'pesado');
    const sq = createFromPlan(w, 0, 'pesado', plan);
    addUnit(w, sq, w.field.sides[0].exitX, plan.y, {});
  }
  assert.ok(planAlta(w, 0, 'soldado'), 'el soldado sí tendría lugar');
  submitOrder(w, orden('pesado', 1, 1, 0));
  submitOrder(w, orden('soldado', 1, 1, 0));
  run(w, 60);
  assert.equal(w.units.filter((u) => u.kind === 'soldado').length, 0, 'el soldado esperó su turno detrás del pesado');
  assert.equal(enCola(w, 0), 2, 'las dos unidades siguen en la cola');
  assert.equal(w.queues[0].ground[0].kind, 'pesado', 'el orden de llegada se conserva');
});

test('los grupos que forman cuentan en S y D, no se convierten ni entran al HUD de salidos', () => {
  const w = mundo({ commander: { bias: 100 } });
  const plan = planAlta(w, 0, 'soldado');
  const g = formando(w, 0, 'soldado', 10, plan);
  g.firstArrivalStep = -1;
  for (const u of g.members) u.arrived = false;
  run(w, 14);
  stepWorld(w); // paso 15: tick del comandante
  assert.equal(w.cmd[0].hud.forming, 1);
  assert.equal(w.cmd[0].hud.ataque + w.cmd[0].hud.defensa, 0);
});

test('los ids de grupo crecen por orden de creación', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 30, 0));
  submitOrder(w, orden('soldado', 2, 30, 0));
  run(w, 400);
  const ids = w.squads.map((s) => s.id);
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => a - b),
  );
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------------------------------- 4c.12

test('conservación exacta con aviones en un log de 500 eventos', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  const w = mundo({ hq: { hp: 1e12 }, limits: { maxAlivePerSide: 60 } }, { registry, phase: 'battle' });
  const usuarios = ['A', 'B', 'C', 'D', 'E'];
  for (const u of usuarios) registry.touch({ userId: u, nickname: u });
  const kinds = ['soldado', 'jeep', 'tanque', 'pesado', 'avion'];
  const valor = { soldado: 1, jeep: 10, tanque: 100, pesado: 1000, avion: 500 };
  let sem = 12345;
  const rnd = () => {
    sem = (Math.imul(sem, 1103515245) + 12345) & 0x7fffffff;
    return sem / 0x7fffffff;
  };
  for (let paso = 0; paso < 2400; paso++) {
    if (paso % 5 === 0 && paso < 2500) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const team = 1 + Math.floor(rnd() * 2);
      const count = 1 + Math.floor(rnd() * (kind === 'avion' ? 3 : 8));
      const owner = usuarios[Math.floor(rnd() * usuarios.length)];
      applyEvent(w, {
        type: 'gift',
        owner,
        coins: count * valor[kind],
        orders: [orden(kind, team, count, valor[kind], owner)],
      });
    }
    stepWorld(w);
    if (w.over) break;
  }
  const l = ledger(w);
  assert.ok(l.paid > 0 && l.destroyedUser > 0, 'hubo combate con crédito');
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6, `${l.sum} vs ${l.paid}`);
});
