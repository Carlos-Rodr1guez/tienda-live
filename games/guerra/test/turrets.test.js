import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import { scheduleHit } from '../public/js/sim/combat.js';
import { launchPlane } from '../public/js/sim/plane.js';

// CB-19, CB-13 (fase de torreta), D16, D17: bases y torretas con HP. El cubo de la base y el crédito llegan en 4c.

const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const quieto = (w, side, kind, x, y, count = 1) => {
  const { squad } = seedSquad(w, { side, kind, count, x, y, state: 'holding' });
  squad.postPos = { x, y };
  for (const u of squad.members) u.hp = u.maxHp = 1e9;
  return squad;
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

test('dispara 40 de daño cada 10 pasos con alcance 70', () => {
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
  quieto(w2, 1, 'soldado', 175, 448);
  run(w2, 30);
  assert.ok(!w2.drain().some((e) => e.type === 'turretShot' && e.k === 1));
});

test('con HP 0 una torreta deja de disparar y de ser blanco; las demás siguen', () => {
  const w = createWorld();
  const u = quieto(w, 0, 'soldado', 1300, 448).members[0];
  u.dir = 1;
  const t = w.bases[1].turrets[1];
  t.hp = 0;
  t.on = false;
  run(w, 1);
  assert.notEqual(u.tgt, t);
  assert.equal(u.tgt, null);
  w.drain();
  const otro = quieto(w, 0, 'soldado', 1320, 250).members[0];
  run(w, 1);
  assert.equal(otro.tgt, w.bases[1].turrets[0]);
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
  // la bomba cae a 8 px del frente de la base: también la daña (900)
  assert.equal(w.teams[0].structDamage, 300 + 900);
  assert.equal(w.teams[1].structDamage, 0);
  assert.equal(t.hp, 0);
  assert.equal(t.on, false);
  assert.ok(w.drain().some((e) => e.type === 'turretDown' && e.side === 1 && e.k === 2));
  // una torreta ya destruida no suma más
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
  assert.equal(w.teams[0].structDamage, 300 + 900 + 900, 'la torreta destruida no suma más; la base sí');
});

test('daño a la base: efectivo, sin XP; al caer la base las torretas se apagan y la ronda termina en ese paso', () => {
  const w = createWorld();
  const b = w.bases[1];
  b.hp = 500;
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
    ty: 600,
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
