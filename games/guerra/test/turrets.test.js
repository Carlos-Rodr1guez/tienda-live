import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, resetRound, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { createScene } from '../public/js/render/scene.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { scheduleHit } from '../public/js/sim/combat.js';
import { launchPlane } from '../public/js/sim/plane.js';

// CB-19, CB-13 (fase de torreta), D16, D17: bases y torretas con HP. El cubo de la base y el crédito llegan en 4c.

const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const quieto = (w, side, kind, x, y, count = 1) => {
  const { units } = seedUnits(w, { side, kind, count, x, y, yg: y, pinned: true });
  for (const u of units) u.hp = u.maxHp = 1e9;
  return { members: units };
};

test('tres torretas idénticas por base: mismo conteo y mismos stats con HP', () => {
  const w = createWorld();
  assert.equal(w.bases[0].turrets.length, 3);
  assert.equal(w.bases[1].turrets.length, 3);
  const stats = (b) => b.turrets.map((t) => ({ k: t.k, hp: t.hp, maxHp: t.maxHp, cd: t.cd, on: t.on }));
  assert.deepEqual(stats(w.bases[0]), stats(w.bases[1]));
  assert.ok(w.bases[0].turrets.every((t) => t.hp === 3000 && t.maxHp === 3000));
  const g = createWorld({ turret: { hp: 99999 } });
  assert.equal(g.bases[0].turrets[0].hp, 20000);
});

test('la fase inicial es 3·k pasos, función solo del id de la torreta', () => {
  const w = createWorld();
  assert.deepEqual(
    w.bases[0].turrets.map((t) => t.cd),
    [0, 3, 6],
  );
  assert.deepEqual(
    w.bases[1].turrets.map((t) => t.cd),
    [0, 3, 6],
  );
});

test('blanco de la torreta: la unidad de tierra enemiga más cercana, con arco frontal; nunca aviones', () => {
  const w = createWorld();
  const t = w.bases[0].turrets[1]; // (100, 448)
  const lejos = quieto(w, 1, 'soldado', 160, 448).members[0];
  const cerca = quieto(w, 1, 'soldado', 140, 460).members[0];
  quieto(w, 1, 'soldado', 90, 448); // detrás del arco: dx·dir = -10 < -4
  run(w, 1);
  assert.equal(t.tgt, cerca);
  assert.notEqual(t.tgt, lejos);
  // el empate de distancia lo gana el id menor
  const w2 = createWorld();
  const a = quieto(w2, 1, 'soldado', 130, 428).members[0];
  quieto(w2, 1, 'soldado', 130, 468);
  run(w2, 1);
  assert.equal(w2.bases[0].turrets[1].tgt, a);
  // un avión enemigo encima de la torreta no es blanco: solo hay aviones, no hay blanco
  const w3 = createWorld();
  const p = launchPlane(w3, 1).plane;
  p.x = 110;
  p.y = 448;
  p.vx = 0;
  run(w3, 2);
  assert.equal(w3.bases[0].turrets[1].tgt, null);
});

test('dispara 40 de daño cada 10 pasos con alcance 105', () => {
  const w = createWorld();
  const enemigo = quieto(w, 1, 'soldado', 150, 448).members[0];
  enemigo.cd = 999;
  const disparos = [];
  for (let i = 0; i < 40; i++) {
    stepWorld(w);
    for (const e of w.drain()) if (e.type === 'turretShot' && e.k === 1) disparos.push(i);
  }
  assert.ok(disparos.length >= 3);
  for (let i = 1; i < disparos.length; i++) assert.equal(disparos[i] - disparos[i - 1], 10);
  assert.ok(enemigo.hp < 1e9);
  assert.equal((1e9 - enemigo.hp) % 40, 0, 'cada golpe es de 40');
  // fuera de alcance no dispara
  const w2 = createWorld();
  quieto(w2, 1, 'soldado', 210, 448); // a 110 px de la torreta central (alcance 105)
  run(w2, 30);
  assert.ok(!w2.drain().some((e) => e.type === 'turretShot' && e.k === 1));
});

test('con HP 0 una torreta deja de disparar y de ser blanco; las demás siguen', () => {
  const w = createWorld();
  const u = quieto(w, 0, 'soldado', 1310, 448).members[0];
  u.dir = 1;
  const t = w.bases[1].turrets[1];
  run(w, 1);
  assert.equal(u.tgt, t, 'con la torreta central viva es su blanco');
  t.hp = 0;
  t.on = false;
  run(w, 1);
  assert.notEqual(u.tgt, t);
  assert.equal(u.tgtKind, 'base', 'caída la central, queda la base');
  w.drain();
  // v2.7: la de arriba nunca es blanco de una unidad, pero sigue disparando a quien le entra en rango
  const otro = quieto(w, 0, 'soldado', 1320, 250).members[0];
  run(w, 1);
  assert.equal(otro.tgt, null);
  assert.equal(w.bases[1].turrets[0].tgt, otro);
});

test('solo daña a las torretas lo enemigo: bombas de 900 a ≤ 24 px, energía de 160 a ≤ 20 px y salpicadura', () => {
  const w = createWorld();
  const t = w.bases[1].turrets[0]; // (1340, 242)
  const propia = w.bases[0].turrets[0];
  const t0 = t.hp;
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: 1340 - 20,
    ty: 242,
    tgt: null,
    tgtKind: '',
  });
  scheduleHit(w, {
    due: w.step,
    kind: 'energy',
    side: 0,
    owner: null,
    dmg: 160,
    splash: 20,
    tx: 1340 - 19,
    ty: 242,
    tgt: null,
    tgtKind: '',
  });
  scheduleHit(w, {
    due: w.step,
    kind: 'energy',
    side: 0,
    owner: null,
    dmg: 160,
    splash: 20,
    tx: 1340 - 21,
    ty: 242,
    tgt: null,
    tgtKind: '',
  }); // fuera
  scheduleHit(w, {
    due: w.step,
    kind: 'shell',
    side: 0,
    owner: null,
    dmg: 937.5,
    splash: 12.8,
    tx: 1340,
    ty: 242 + 12,
    tgt: null,
    tgtKind: '',
  });
  run(w, 1);
  assert.equal(t.hp, t0 - 900 - 160 - 937.5);
  // lo propio no las daña: un golpe del lado 1 sobre su propia torreta no hace nada
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 1,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: 1340,
    ty: 242,
    tgt: null,
    tgtKind: '',
  });
  run(w, 1);
  assert.equal(t.hp, t0 - 900 - 160 - 937.5);
  assert.equal(propia.hp, 3000);
});

test('el daño efectivo es min(dmg, hp) y se suma por equipo; una torreta destruida emite su evento', () => {
  const w = createWorld();
  const t = w.bases[1].turrets[2];
  t.hp = 300;
  w.bases[1].bucket = 1e9; // el cubo se prueba en whale.test.js
  w.drain();
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: t.x,
    ty: t.y,
    tgt: null,
    tgtKind: '',
  });
  run(w, 1);
  // v2.8: la bomba cae en y 655, a 83 px de la franja del hangar (y 348–548): ya no daña la base, solo la torreta
  assert.equal(w.teams[0].structDamage, 300);
  assert.equal(w.teams[1].structDamage, 0);
  assert.equal(t.hp, 0);
  assert.equal(t.on, false);
  assert.ok(w.drain().some((e) => e.type === 'turretDown' && e.side === 1 && e.k === 2));
  // una torreta ya destruida no suma más
  w.bases[1].bucket = 1e9;
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: t.x,
    ty: t.y,
    tgt: null,
    tgtKind: '',
  });
  run(w, 1);
  assert.equal(
    w.teams[0].structDamage,
    300,
    'la torreta destruida no suma más y la base no está al alcance de la bomba',
  );
});

test('daño a la base: efectivo, sin XP; al caer la base las torretas se apagan y la ronda termina en ese paso', () => {
  const w = createWorld();
  const b = w.bases[1];
  b.hp = 500;
  b.bucket = 1e9;
  run(w, 3);
  assert.equal(w.over, null);
  const paso = w.step;
  scheduleHit(w, {
    due: paso,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: b.frontX - 24,
    ty: 540, // dentro de la franja del hangar (y 348–548) y a 24 px de su cara
    tgt: null,
    tgtKind: '',
  });
  stepWorld(w);
  assert.equal(b.hp, 0);
  assert.ok(b.turrets.every((t) => !t.on));
  assert.deepEqual(w.over, { step: paso, winner: 0, both: false });
  assert.equal(w.teams[0].structDamage, 500, 'suma lo aplicado, no lo pedido');
  // las reglas quedan congeladas
  const antes = w.step;
  run(w, 5);
  assert.equal(w.step, antes);
});

test('las dos bases caen en el mismo paso: la ronda termina sin ganador (4d lo decide con el desempate)', () => {
  const w = createWorld();
  w.bases[0].hp = 10;
  w.bases[1].hp = 10;
  w.bases[0].bucket = w.bases[1].bucket = 1e9;
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: w.bases[1].frontX,
    ty: 448,
    tgt: null,
    tgtKind: '',
  });
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 1,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: w.bases[0].frontX,
    ty: 448,
    tgt: null,
    tgtKind: '',
  });
  stepWorld(w);
  assert.deepEqual(w.over, { step: 0, winner: null, both: true });
});

// ---------------------------------------------------------------------------------------------------------------
// 5b.4 (vista): la ruina de una torreta. La vista solo LEE el estado y la bandeja del mundo.

test('vista: una torreta que cae explota con radio 18, deja el disco de ruina con humo 3 s y vuelve entera en la ronda siguiente', () => {
  const w = createWorld();
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  const t = w.bases[1].turrets[2];
  t.hp = 300;
  w.bases[1].bucket = 1e9;
  w.drain();
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: t.x,
    ty: t.y,
    tgt: null,
    tgtKind: '',
  });
  run(w, 1);
  assert.equal(t.on, false);
  sc.consume(w.drain(), w);
  const grandes = sc.fx.booms.filter((b) => b.a && b.R === 18);
  assert.equal(grandes.length, 1, 'una explosión de radio 18');
  assert.ok(Math.abs(grandes[0].x - Math.round(t.x)) <= 1 && Math.abs(grandes[0].gy - Math.round(t.y)) <= 1);
  assert.equal(sc.turretShown(1, 2, t.on && t.hp > 0), false, 'ruina: sin cañón, solo el disco');
  assert.equal(sc.turretShown(1, 0, true), true, 'las otras siguen enteras');
  // humo durante 3 s y después nada
  const bocanadas = () => sc.fx.stats.ruinPuffs;
  for (let i = 0; i < 90; i++) sc.fx.update(1 / 30, w); // 3 s de vista
  const en3s = bocanadas();
  assert.ok(en3s >= 14 && en3s <= 18, `unas 16 bocanadas en 3 s (hubo ${en3s})`);
  for (let i = 0; i < 60; i++) sc.fx.update(1 / 30, w);
  assert.equal(bocanadas(), en3s, 'pasados los 3 s ya no echa humo');
  // vuelve entera en la ronda siguiente
  resetRound(w);
  sc.reset();
  assert.equal(w.bases[1].turrets[2].on, true);
  assert.equal(sc.turretShown(1, 2, w.bases[1].turrets[2].on && w.bases[1].turrets[2].hp > 0), true);
  assert.equal(sc.fx.usage().booms, 0);
});

test('vista: la ronda ya terminó en el paso en que la base llegó a 0; la secuencia se ve DESPUÉS, con el mundo congelado', () => {
  const w = createWorld();
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  const b = w.bases[1];
  b.hp = 500;
  b.bucket = 1e9;
  run(w, 3);
  w.drain();
  const paso = w.step;
  scheduleHit(w, {
    due: paso,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 900,
    splash: 24,
    tx: b.frontX - 24,
    ty: 540, // dentro de la franja del hangar (y 348–548) y a 24 px de su cara
    tgt: null,
    tgtKind: '',
  });
  stepWorld(w);
  assert.deepEqual(w.over, { step: paso, winner: 0, both: false }, 'la ronda terminó en ese paso');
  sc.consume(w.drain(), w);
  assert.equal(sc.fx.sequence(1) !== null, true, 'arranca la secuencia de la base caída');
  assert.equal(sc.fx.sequence(0), null, 'la otra base no');
  const congelado = w.step;
  for (let i = 0; i < 120; i++) {
    stepWorld(w); // no avanza: la ronda ya terminó
    sc.consume(w.drain(), w);
    sc.fx.update(1 / 30, w);
  }
  assert.equal(w.step, congelado, 'el sim no avanzó');
  assert.ok(sc.fx.sequence(1).booms >= 8, 'la secuencia siguió con el reloj de vista');
});
