import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, seedSquad } from '../public/js/sim/world.js';
import { addUnit, createSquad, placeOffset } from '../public/js/sim/squads.js';
import { corridorOrder, currentQuota, planAlta, scaleL } from '../public/js/sim/commander.js';
import {
  corridorPick,
  countGroups,
  countMembers,
  createMeasureWorld,
  choiceDiffers,
  deviates,
  generateLog,
  longestStreak,
  pressureWeighted,
  runRound,
  sampleSide,
  sectorPick,
  seeded,
  shareCounts,
  sharePoints,
  summarizeRound,
  verdict,
  weightGroups,
  weightMembers,
} from '../tools/h26.mjs';

// H26 (diseño §14 y §21.1): funciones puras de la medición, con fixtures chicos de resultados conocidos.

const mundo = () => createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
const quieto = (w, side, kind, count, corridor, extra = {}) =>
  seedSquad(w, { side, kind, count, corridor, lane: 0, x: 600, state: 'holding', pinned: true, ...extra }).squad;

/** Un grupo de DEFENSA en el puesto `post` de un sector (como en commander.test.js). */
function defensa(w, side, kind, sector, post, n) {
  const s = w.field.sides[side];
  const lane = kind === 'jeep' ? 'B' : 'A';
  const p = s.sectors[sector].posts[lane][post];
  const sq = createSquad(w, {
    side,
    kind,
    role: 'defensa',
    state: 'holding',
    corridor: sector,
    sector,
    post,
    postLane: lane,
    postPos: { x: p.x, y: p.y },
    x: p.x,
    y: p.y,
    pinned: true,
  });
  for (let i = 0; i < n; i++) {
    const o = placeOffset(w.cfg, kind, i, s.dir);
    addUnit(w, sq, p.x + o.x, p.y + o.y, {});
  }
  return sq;
}

test('pesos: por grupos no cambia al diezmarse; por miembros vivos baja en proporción (tanque 1 de 2 pesa 1)', () => {
  const w = mundo();
  const lleno = quieto(w, 1, 'soldado', 10, 1);
  const uno = quieto(w, 1, 'soldado', 1, 1);
  const tanque = quieto(w, 1, 'tanque', 1, 1);
  assert.equal(weightGroups(w, lleno), 1);
  assert.equal(weightGroups(w, uno), 1);
  assert.equal(weightMembers(w, lleno), 1);
  assert.equal(weightMembers(w, uno), 0.1);
  assert.equal(weightGroups(w, tanque), 2);
  assert.equal(weightMembers(w, tanque), 1);
  assert.equal(countGroups(w, uno), 1);
  assert.equal(countMembers(w, uno), 0.1);
});

test('corredor: dos soldados sueltos en el de arriba cuestan 2 por grupos y 0,2 por miembros: la elección difiere', () => {
  const w = mundo();
  quieto(w, 1, 'soldado', 1, 0);
  quieto(w, 1, 'soldado', 1, 0, { x: 640 });
  quieto(w, 1, 'soldado', 10, 1);
  quieto(w, 1, 'soldado', 10, 2);
  // por grupos: costos [2, 1, 1] -> el medio gana el empate; por miembros: [0,2, 1, 1] -> el de arriba (el sector, con
  // los mismos enemigos en la mitad propia, también difiere)
  assert.equal(corridorPick(w, 0, weightGroups), 1);
  assert.equal(corridorPick(w, 0, weightMembers), 0);
  const s = sampleSide(w, 0);
  assert.equal(s.corridorG, 1);
  assert.equal(s.corridorM, 0);
  assert.deepEqual(choiceDiffers(s), { corridor: true, sector: true, any: true });
});

test('la elección por miembros de la herramienta es la del comandante (corridorOrder y planAlta)', () => {
  // enmienda v2.5 (CB-21): la regla del sim es la de miembros vivos; la de grupos es solo la comparación
  const w = mundo();
  quieto(w, 1, 'tanque', 2, 0);
  quieto(w, 1, 'soldado', 3, 2);
  quieto(w, 0, 'soldado', 10, 1, { role: 'ataque', pinned: true });
  assert.equal(corridorPick(w, 0, weightMembers), corridorOrder(w, 0)[0]);
  // sector: con la cuota máxima el próximo soldado va a DEFENSA y planAlta elige el sector de menor costo
  const w2 = createWorld({ hq: { hp: 1e12 }, commander: { bias: 100 } }, { phase: 'sandbox' });
  for (let i = 0; i < 6; i++)
    seedSquad(w2, { side: 0, kind: 'tanque', count: 1, corridor: i % 3, lane: 2, x: 600 + i * 40 });
  defensa(w2, 0, 'soldado', 1, 0, 4);
  const plan = planAlta(w2, 0, 'soldado');
  assert.equal(plan.role, 'defensa');
  assert.equal(sectorPick(w2, 0, weightMembers), plan.sector);
});

test('sector: dos DEFENSA de 1 soldado en el medio cuestan 2 por grupos y 0,2 por miembros', () => {
  const w = mundo();
  defensa(w, 0, 'soldado', 1, 0, 1);
  defensa(w, 0, 'jeep', 1, 0, 1); // otra calle de puestos: no ocupa la de los soldados
  defensa(w, 0, 'soldado', 0, 0, 10);
  defensa(w, 0, 'soldado', 2, 0, 10);
  // por grupos: arriba 1, medio 2, abajo 1 -> arriba (empate arriba/abajo); por miembros: medio 0,1 + jeep 0,25 -> medio
  assert.equal(sectorPick(w, 0, weightGroups), 0);
  assert.equal(sectorPick(w, 0, weightMembers), 1);
  assert.equal(choiceDiffers(sampleSide(w, 0)).sector, true);
});

test('empates: sin enemigos gana el medio; con el medio cargado, arriba antes que abajo', () => {
  const w = mundo();
  defensa(w, 0, 'soldado', 1, 3, 1); // un puesto ocupado lejos del 0: no cambia lo alcanzable de los otros sectores
  assert.equal(corridorPick(w, 0, weightGroups), 1);
  quieto(w, 1, 'soldado', 10, 1);
  assert.equal(corridorPick(w, 0, weightGroups), 0);
  assert.equal(corridorPick(w, 0, weightMembers), 0);
  assert.equal(sectorPick(createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' }), 0, weightGroups), 1);
});

test('sin puesto alcanzable en ningún sector, el sector elegido es -1', () => {
  const w = mundo();
  for (let c = 0; c < 3; c++) defensa(w, 0, 'soldado', c, 3, 10); // el puesto de atrás ocupado: nada alcanzable
  assert.equal(sectorPick(w, 0, weightGroups), -1);
  assert.equal(sectorPick(w, 0, weightMembers), -1);
});

test('S y D: por grupos 4 y 1 (25 puntos); por miembros 2,3 y 1 (43,5 puntos), y H y Z pesan lo que queda vivo', () => {
  const w = mundo();
  defensa(w, 0, 'soldado', 1, 0, 10);
  quieto(w, 0, 'soldado', 1, 0, { role: 'ataque' });
  quieto(w, 0, 'soldado', 1, 1, { role: 'ataque' });
  quieto(w, 0, 'soldado', 1, 2, { role: 'ataque' });
  const g = shareCounts(w, 0, countGroups);
  const m = shareCounts(w, 0, countMembers);
  assert.deepEqual(g, { S: 4, D: 1 });
  assert.ok(Math.abs(m.S - 1.3) < 1e-9 && m.D === 1);
  assert.equal(sharePoints(g.S, g.D), 25);
  assert.ok(Math.abs(sharePoints(m.S, m.D) - 100 / 1.3) < 1e-9);
  assert.equal(sharePoints(0, 0), null);
  // un enemigo de 5 de 10 en la mitad propia: H = 1 por grupos y 0,5 por miembros
  quieto(w, 1, 'soldado', 5, 1, { x: 300 });
  const hm = pressureWeighted(w, 0, weightMembers);
  assert.equal(hm.H, 0.5);
});

test('la cuota por grupos sale de H y Z por grupos; la de miembros es la del sim y usa lo vivo', () => {
  const w = mundo();
  quieto(w, 1, 'soldado', 1, 1, { x: 300 }); // en la mitad propia y en la zona de defensa del lado 0
  const s = sampleSide(w, 0);
  assert.equal(s.quota, 26.25); // por grupos: H = 1, Z = 1
  assert.equal(s.quotaM, currentQuota(w, 0) / (4 * scaleL(w.cfg))); // enmienda v2.5: es la cuota real del comandante
  assert.ok(Math.abs(s.quotaM - (60 + 15 * 0.1 + 30 * 0.1) / 4) < 1e-9, `cuota por miembros ${s.quotaM}`); // 1 de 10 vivo: H = Z = 0,1
});

test('racha: segundos de reloj seguidos con la bandera encendida; null y false la cortan', () => {
  const t = 15 / 30;
  assert.equal(longestStreak([], t), 0);
  assert.equal(longestStreak([false, false], t), 0);
  assert.equal(longestStreak([true, true, true, false, true], t), 1.5);
  assert.equal(longestStreak([true, true, null, true, true, true, true], t), 2);
  assert.equal(longestStreak(Array(61).fill(true), t), 30.5);
});

test('desvío: más de 15 puntos de la cuota; justo 15 no; sin grupos es null', () => {
  assert.equal(deviates(41.26, 26.25), true);
  assert.equal(deviates(41.25, 26.25), false);
  assert.equal(deviates(12, 26.25), false);
  assert.equal(deviates(null, 26.25), null);
});

test('veredicto: > 20 % de ticks o > 30 s supera; en el umbral exacto no', () => {
  const ronda = (diffAny, streakMembers, samples = 100) => ({ samples, diffAny, streakMembers });
  assert.equal(verdict([ronda(0.2, 30), ronda(0.2, 0)]).needsH263, false);
  assert.equal(verdict([ronda(0.21, 0)]).overDiff, true);
  assert.equal(verdict([ronda(0, 30.5)]).overStreak, true);
  assert.equal(verdict([ronda(0.5, 0, 100), ronda(0, 0, 300)]).diff, 0.125); // pondera por ticks
});

test('generador sembrado: misma semilla, mismo log; otra semilla, otro log; ordenado por paso', () => {
  const a = seeded(7);
  const b = seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(seeded(8)(), seeded(7)());
  const l1 = generateLog(11, 30);
  assert.deepEqual(l1, generateLog(11, 30));
  assert.notDeepEqual(l1, generateLog(12, 30));
  for (let i = 1; i < l1.length; i++) assert.ok(l1[i].step >= l1[i - 1].step);
  assert.ok(l1.some((e) => e.payload.type === 'order'));
  assert.ok(l1.every((e) => e.step < 30 * 30));
});

test('una ronda corta en el sim real: una muestra por tick del comandante, mismas cifras corriéndola dos veces', () => {
  const log = generateLog(3, 20);
  const t1 = runRound(log, 20);
  const t2 = runRound(log, 20, createMeasureWorld());
  assert.equal(t1.length, 40); // 20 s a 2 Hz
  assert.deepEqual(
    t1.map((t) => t.step),
    Array.from({ length: 40 }, (_, i) => i * 15),
    'una muestra en cada paso múltiplo de 15, antes de que el comandante decida',
  );
  assert.deepEqual(summarizeRound(t1), summarizeRound(t2));
  const m = summarizeRound(t1);
  assert.ok(m.samples > 0 && m.diffAny >= 0 && m.diffAny <= 1);
  assert.ok(Number.isFinite(m.meanDevMembers) && Number.isFinite(m.meanDevGroups));
});
