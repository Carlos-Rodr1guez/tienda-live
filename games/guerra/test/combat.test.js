import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { ANIMATION_STATES, UNIT_TYPES, initialCooldown, unitStats } from '../public/js/sim/units.js';
import { applyEvent, createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import { damageUnit, scheduleHit } from '../public/js/sim/combat.js';
import {
  FALL_STEPS,
  bombPosition,
  bombZ,
  canLaunchPlane,
  launchPlane,
  planeTargetSquad,
} from '../public/js/sim/plane.js';

// CB-9: roster y regla de stats (#327). hp = 60·c·bonoHP, dps = 6·c·bonoDPS, daño = dps × cadencia.

const cfg = resolveConfig();

test('hp y dps salen de la regla y daño / cadencia = dps en cada tipo', () => {
  const esperado = {
    soldado: { hp: 60, dps: 6, damage: 6 },
    jeep: { hp: 600, dps: 60, damage: 42 },
    tanque: { hp: 7500, dps: 750, damage: 937.5 },
    pesado: { hp: 90000, dps: 3000, damage: 4500 },
  };
  for (const [kind, e] of Object.entries(esperado)) {
    const s = unitStats(cfg, kind);
    assert.equal(s.hp, e.hp, `${kind} hp`);
    assert.equal(s.dps, e.dps, `${kind} dps`);
    assert.ok(Math.abs(s.damage - e.damage) < 1e-9, `${kind} damage`);
    assert.ok(Math.abs(s.damage / s.cadence - s.dps) < 1e-9, `${kind} damage/cadencia`);
  }
  // tanque: 937,5 / 1,25 = 750; pesado: 4500 / 1,5 = 3000
  assert.equal(unitStats(cfg, 'tanque').damage / 1.25, 750);
  assert.equal(unitStats(cfg, 'pesado').damage / 1.5, 3000);
});

test('alcance, velocidad, salpicadura y velocidad del proyectil de cada tipo', () => {
  assert.equal(unitStats(cfg, 'soldado').range, 28);
  assert.equal(unitStats(cfg, 'jeep').speed, 64);
  assert.equal(unitStats(cfg, 'tanque').splash, 12.8);
  assert.equal(unitStats(cfg, 'pesado').splash, 19.2);
  assert.equal(unitStats(cfg, 'soldado').projectileSpeed, 270);
  assert.equal(unitStats(cfg, 'jeep').projectileSpeed, 270);
  assert.equal(unitStats(cfg, 'tanque').projectileSpeed, 190);
  assert.equal(unitStats(cfg, 'pesado').projectileSpeed, 150);
  assert.equal(unitStats(cfg, 'jeep').cdSteps, 21);
  assert.equal(unitStats(cfg, 'soldado').cdSteps, 30);
});

test('el registro de tipos tiene los cinco con ids de ataque distintos y estados de animación', () => {
  assert.deepEqual(Object.keys(UNIT_TYPES), ['soldado', 'jeep', 'tanque', 'pesado', 'avion']);
  const ataques = Object.values(UNIT_TYPES).map((t) => t.attack);
  assert.deepEqual(ataques, ['fusil', 'ametralladora', 'canon', 'canon-doble', 'bombas']);
  assert.equal(new Set(ataques).size, 5);
  for (const k of Object.keys(UNIT_TYPES)) {
    assert.ok(Array.isArray(ANIMATION_STATES[k]) && ANIMATION_STATES[k].length > 0, k);
  }
  assert.ok(ANIMATION_STATES.soldado.includes('death'));
  assert.ok(ANIMATION_STATES.tanque.includes('wreck'));
  // ningún id de la vista nombra restos humanos (CB-9)
  const txt = JSON.stringify({ UNIT_TYPES, ANIMATION_STATES });
  assert.ok(!/blood|gore|sangre|corpse|cuerpo|ragdoll|gib/.test(txt));
});

test('el cooldown inicial es floor(frac(id·0,618034)·cdSteps), sin azar', () => {
  for (const id of [1, 2, 3, 17, 250, 4001]) {
    const cd = 21;
    const x = id * 0.618034;
    assert.equal(initialCooldown(id, cd), Math.floor((x - Math.floor(x)) * cd));
  }
  assert.equal(initialCooldown(5, 30), initialCooldown(5, 30));
  for (let id = 1; id < 300; id++) {
    const c = initialCooldown(id, 30);
    assert.ok(c >= 0 && c < 30);
  }
});

// ------------------------------------------------------------------------------------ el mundo en combate

const hold = (w, side, kind, x, y, count = 1) => {
  const { squad } = seedSquad(w, { side, kind, count, x, y, state: 'holding' });
  squad.postPos = { x, y };
  return squad;
};
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};

test('cada unidad de tierra es una entidad propia: 40 de daño a un soldado de un grupo de 5 solo cambia su HP', () => {
  const w = createWorld();
  const { squad } = seedSquad(w, { side: 0, kind: 'soldado', count: 5, x: 300, y: 448 });
  const antes = squad.members.map((u) => u.hp);
  damageUnit(w, squad.members[2], 40, { side: 1 });
  assert.deepEqual(
    squad.members.map((u) => u.hp),
    antes.map((h, i) => (i === 2 ? 20 : h)),
  );
  assert.ok(squad.members.every((u) => u.alive));
  damageUnit(w, squad.members[2], 1000, { side: 1 }); // sin sobredaño: aplica solo lo que queda
  assert.equal(squad.members[2].hp, 0);
  assert.equal(squad.members[2].alive, false);
  assert.equal(damageUnit(w, squad.members[2], 5, { side: 1 }), 0);
});

test('el blanco es la unidad enemiga más cercana; el empate de distancia lo gana el id menor', () => {
  const w = createWorld();
  const mio = hold(w, 0, 'soldado', 300, 448).members[0];
  const lejos = hold(w, 1, 'soldado', 320, 448).members[0]; // d = 20
  const cerca = hold(w, 1, 'soldado', 310, 448).members[0]; // d = 10
  run(w, 1);
  assert.equal(mio.tgt, cerca);
  assert.equal(mio.tgtKind, 'unit');
  assert.notEqual(mio.tgt, lejos);
  // empate: a 10 px a la izquierda y a 10 px a la derecha; gana el id menor (el primero que se creó)
  const w2 = createWorld();
  const yo = hold(w2, 0, 'soldado', 300, 448).members[0];
  const a = hold(w2, 1, 'soldado', 290, 448).members[0];
  hold(w2, 1, 'soldado', 310, 448);
  run(w2, 1);
  assert.equal(yo.tgt, a);
});

test('prioridad: unidad > torreta > base, y la base solo es blanco en ataque', () => {
  const w = createWorld();
  const t = w.bases[1].turrets[1]; // (1340, 448)
  const atk = hold(w, 0, 'soldado', 1330, 448);
  atk.role = 'ataque';
  const u = atk.members[0];
  run(w, 1);
  assert.equal(u.tgtKind, 'turret');
  assert.equal(u.tgt, t);
  // un enemigo en alcance gana a la torreta
  const enemigo = hold(w, 1, 'soldado', 1320, 448).members[0];
  run(w, 1);
  assert.equal(u.tgt, enemigo);
  // sin torreta ni unidad, la base (a ≤ alcance de su frente en x) si el grupo es de ataque
  const w2 = createWorld();
  w2.bases[1].turrets.forEach((x) => {
    x.hp = 0;
    x.on = false;
  });
  const sq = hold(w2, 0, 'soldado', 1320, 448);
  sq.role = 'ataque';
  run(w2, 1);
  assert.equal(sq.members[0].tgtKind, 'base');
  const w3 = createWorld();
  w3.bases[1].turrets.forEach((x) => {
    x.hp = 0;
    x.on = false;
  });
  const def = hold(w3, 0, 'soldado', 1320, 448);
  def.role = 'defensa';
  run(w3, 1);
  assert.equal(def.members[0].tgt, null);
});

test('el disparo es un golpe programado en step + max(1, ceil(dist/velocidad·30))', () => {
  const w = createWorld();
  const yo = hold(w, 0, 'soldado', 300, 448).members[0];
  const enemigo = hold(w, 1, 'soldado', 327, 448).members[0];
  yo.cd = 0;
  yo.dir = 1;
  enemigo.cd = 99; // que no dispare en este paso
  const paso = w.step;
  run(w, 1);
  const h = w.hits.find((x) => x.side === 0);
  assert.ok(h, 'no hubo disparo');
  assert.equal(h.due, paso + Math.max(1, Math.ceil((27 / 270) * 30)));
  assert.equal(h.due, paso + 3);
  // tanque: obús a 190 px/s
  const w2 = createWorld();
  const tk = hold(w2, 0, 'tanque', 300, 448).members[0];
  const obj = hold(w2, 1, 'soldado', 340, 448).members[0];
  obj.cd = 99;
  tk.cd = 0;
  tk.dir = 1;
  const p2 = w2.step;
  run(w2, 1);
  const h2 = w2.hits.find((x) => x.side === 0);
  assert.equal(h2.kind, 'shell');
  assert.equal(h2.due, p2 + Math.ceil((40 / 190) * 30));
  assert.equal(h2.dmg, 937.5);
});

test('la bala se pierde si el blanco murió antes de llegar', () => {
  const w = createWorld();
  hold(w, 0, 'soldado', 300, 448);
  const blanco = hold(w, 1, 'soldado', 320, 448).members[0];
  blanco.hp = blanco.maxHp = 100;
  scheduleHit(w, {
    due: w.step + 2,
    kind: 'bullet',
    side: 0,
    owner: null,
    dmg: 6,
    splash: 0,
    tx: 320,
    ty: 448,
    tgt: blanco,
    tgtKind: 'unit',
  });
  blanco.hp = 0;
  blanco.alive = false;
  w.drain();
  run(w, 3);
  assert.equal(blanco.hp, 0);
  assert.ok(!w.drain().some((e) => e.type === 'hit' && e.id === blanco.id), 'una bala perdida no debe dañar');
});

test('el obús daña a todo enemigo a ≤ salpicadura y a nadie de su equipo', () => {
  const w = createWorld();
  const e = [5, 12, 12.7, 13.5, 40].map((dx) => hold(w, 1, 'soldado', 600 + dx, 448).members[0]);
  const amigo = hold(w, 0, 'soldado', 603, 448).members[0];
  e.forEach((u) => (u.hp = u.maxHp = 5000));
  amigo.hp = amigo.maxHp = 5000;
  scheduleHit(w, {
    due: w.step,
    kind: 'shell',
    side: 0,
    owner: null,
    dmg: 937.5,
    splash: 12.8,
    tx: 600,
    ty: 448,
    tgt: e[0],
    tgtKind: 'unit',
  });
  run(w, 1);
  assert.deepEqual(
    e.map((u) => u.hp === 5000 - 937.5),
    [true, true, true, false, false],
  );
  assert.equal(amigo.hp, 5000);
});

test('nadie dispara sin mirar a su blanco: gira 9 pasos y recién entonces dispara', () => {
  const w = createWorld();
  const yo = hold(w, 0, 'soldado', 300, 448).members[0];
  const otro = hold(w, 1, 'soldado', 280, 448).members[0]; // a la izquierda: yo miro a la derecha
  yo.cd = 0;
  otro.cd = 99;
  otro.dir = -1;
  let disparo = -1;
  for (let i = 0; i < 14; i++) {
    stepWorld(w);
    if (w.hits.some((h) => h.side === 0)) {
      disparo = i;
      break;
    }
  }
  assert.equal(yo.dir, -1);
  assert.ok(disparo >= 8, `disparó en el paso ${disparo}, antes de girar`);
});

test('mismo estado, mismo resultado, sin RNG: dos corridas iguales y Math.random reemplazado por una función que lanza', () => {
  const armar = () => {
    const w = createWorld();
    seedSquad(w, { side: 0, kind: 'soldado', count: 10, x: 200 });
    seedSquad(w, { side: 0, kind: 'jeep', count: 4, x: 160, lane: 1 });
    seedSquad(w, { side: 1, kind: 'tanque', count: 2, x: 700, lane: 2, corridor: 1 });
    seedSquad(w, { side: 1, kind: 'soldado', count: 10, x: 1200 });
    return w;
  };
  const a = armar();
  const b = armar();
  const alea = Math.random;
  Math.random = () => {
    throw new Error('el sim no usa Math.random');
  };
  try {
    run(a, 900);
    run(b, 900);
  } finally {
    Math.random = alea;
  }
  const foto = (w) => w.units.map((u) => [u.id, u.hp, u.x, u.y, u.vx, u.vy, u.cd]);
  assert.deepEqual(foto(a), foto(b));
  assert.deepEqual(
    a.bases.map((x) => x.hp),
    b.bases.map((x) => x.hp),
  );
  assert.ok(a.units.length > 0);
});

// ------------------------------------------------------------------------------------------------- avión

test('lanzamiento: ≤ 2 vivos por lado, ≥ 1,5 s entre lanzamientos, entra en x -44 o 1484 a z 48 con vx ±120', () => {
  const w = createWorld();
  const r1 = launchPlane(w, 0);
  assert.ok(r1.ok);
  assert.equal(r1.plane.x, -44);
  assert.equal(r1.plane.vx, 120);
  assert.equal(r1.plane.z, 48);
  assert.deepEqual(launchPlane(w, 0), { ok: false, reason: 'gap' });
  run(w, 44);
  assert.equal(canLaunchPlane(w, 0).ok, false);
  run(w, 1);
  assert.ok(launchPlane(w, 0).ok);
  run(w, 45);
  assert.deepEqual(launchPlane(w, 0), { ok: false, reason: 'cap' });
  const d = launchPlane(w, 1).plane;
  assert.equal(d.x, 1484);
  assert.equal(d.vx, -120);
});

test('blanco del avión: grupo enemigo salido de mayor fuerza en la mitad lejana; si no hay, el de mayor fuerza; empate por id', () => {
  const w = createWorld();
  const cerca = hold(w, 1, 'pesado', 1000, 448); // en la mitad lejana de un avión izquierdo
  const lejos = hold(w, 1, 'soldado', 800, 300, 10);
  hold(w, 0, 'pesado', 900, 448); // propio: nunca cuenta
  const p = launchPlane(w, 0).plane;
  assert.equal(planeTargetSquad(w, p), cerca);
  cerca.members[0].hp = 1; // casi sin fuerza: gana el grupo de soldados
  assert.equal(planeTargetSquad(w, p), lejos);
  // sin nadie en la mitad lejana: el de mayor fuerza
  const w2 = createWorld();
  const a = hold(w2, 1, 'jeep', 500, 300, 4);
  hold(w2, 1, 'soldado', 600, 448, 10);
  assert.equal(planeTargetSquad(w2, launchPlane(w2, 0).plane), a);
  // sin grupos: nada (apunta a la base)
  const w5 = createWorld();
  assert.equal(planeTargetSquad(w5, launchPlane(w5, 0).plane), null);
  // un grupo en formación no cuenta como salido
  const w3 = createWorld();
  hold(w3, 1, 'pesado', 1000, 448).state = 'forming';
  assert.equal(planeTargetSquad(w3, launchPlane(w3, 0).plane), null);
  // empate de fuerza: el id menor
  const w4 = createWorld();
  const p1 = hold(w4, 1, 'soldado', 1000, 300, 5);
  hold(w4, 1, 'soldado', 1000, 600, 5);
  assert.equal(planeTargetSquad(w4, launchPlane(w4, 0).plane), p1);
});

test('bombas: 5 llevadas, una entidad por paso desde la suelta hasta el impacto (14 pasos), 900 a ≤ 24 px', () => {
  const w = createWorld();
  const objetivo = hold(w, 1, 'tanque', 900, 448, 2);
  objetivo.members.forEach((u) => (u.hp = u.maxHp = 50000));
  const p = launchPlane(w, 0).plane;
  assert.equal(p.bombsLeft, 5);
  const existencia = new Map(); // id de bomba -> pasos en que existió
  let primera = -1;
  for (let i = 0; i < 900 && w.planes.length > 0; i++) {
    stepWorld(w);
    for (const b of w.bombs) existencia.set(b.id, (existencia.get(b.id) ?? 0) + 1);
    if (primera < 0 && w.bombs.length > 0) {
      primera = i;
      assert.equal(p.bombsLeft, 4, 'al soltar la primera quedan 4');
    }
  }
  assert.equal(existencia.size, 5);
  for (const n of existencia.values()) assert.equal(n, FALL_STEPS);
  assert.equal(FALL_STEPS, 14);
  run(w, 20);
  assert.equal(w.bombs.length, 0);
  // los tanques recibieron golpes de 900 (a ≤ 24 px del punto de impacto)
  const total = objetivo.members.reduce((s, u) => s + (50000 - u.hp), 0);
  assert.ok(total > 0 && total % 900 === 0, `daño total ${total}`);
});

test('una bomba daña a la torreta enemiga a ≤ 24 px y a la base si |x - frente| ≤ 24, y nunca a su equipo', () => {
  const w = createWorld();
  const propio = hold(w, 0, 'soldado', 1332, 448).members[0];
  const enemigo = hold(w, 1, 'soldado', 1340, 460).members[0];
  propio.hp = propio.maxHp = 5000;
  enemigo.hp = enemigo.maxHp = 5000;
  propio.cd = 99;
  enemigo.cd = 99;
  w.bombs.push({ id: 99, side: 0, owner: null, x0: 1332, y0: 448, tx: 1332, ty: 448, dropStep: 0, impactStep: w.step });
  const hp0 = w.bases[1].hp;
  const t0 = w.bases[1].turrets[1].hp;
  run(w, 1);
  assert.equal(enemigo.hp, 5000 - 900);
  assert.equal(propio.hp, 5000, 'una bomba nunca daña al propio equipo');
  assert.equal(w.bases[1].hp, hp0 - 900);
  assert.equal(w.bases[1].turrets[1].hp, t0 - 900);
  assert.equal(w.bases[0].turrets[1].hp, w.cfg.turret.hp);
});

test('el avión sale del mapa, se quita y solo está fuera del rectángulo dentro de 44 px de su ruta', () => {
  const w = createWorld();
  const p = launchPlane(w, 0).plane;
  let n = 0;
  while (w.planes.length > 0 && n++ < 2000) {
    assert.ok(p.x >= -44 - 1e-9 && p.x <= w.field.w + 44 + 1e-9);
    assert.ok(p.y >= 0 && p.y <= w.field.h);
    stepWorld(w);
  }
  assert.equal(w.planes.length, 0);
  assert.ok(n > 300, 'cruzó el mapa');
  // el comando del log
  const w2 = createWorld();
  assert.ok(applyEvent(w2, { type: 'launchPlane', side: 1 }).ok);
  assert.equal(applyEvent(w2, { type: 'nada' }).ok, false);
});

test('posición y altura de una bomba son funciones puras del estado y llegan al suelo en el paso del impacto', () => {
  const w = createWorld();
  const b = {
    id: 1,
    side: 0,
    owner: null,
    x0: 600,
    y0: 440,
    tx: 656,
    ty: 448,
    dropStep: 100,
    impactStep: 100 + FALL_STEPS,
  };
  assert.deepEqual(bombPosition(b, 100), { x: 600, y: 440 });
  assert.deepEqual(bombPosition(b, 100 + FALL_STEPS), { x: 656, y: 448 });
  assert.deepEqual(bombPosition(b, 107), bombPosition(b, 107));
  assert.equal(bombZ(w.cfg, b, 100), 44);
  assert.ok(bombZ(w.cfg, b, 107) < 44 && bombZ(w.cfg, b, 107) > 0);
  assert.ok(bombZ(w.cfg, b, 100 + FALL_STEPS) <= 3, 'cae 0,481 s: a los 14 pasos (0,467 s) está a ras del suelo');
  assert.ok(bombZ(w.cfg, b, 100 + FALL_STEPS - 1) > 0);
});
