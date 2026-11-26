import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { ANIMATION_STATES, UNIT_TYPES, initialCooldown, unitStats } from '../public/js/sim/units.js';
import { applyEvent, createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { damageUnit, scheduleHit } from '../public/js/sim/combat.js';
import { FALL_STEPS, bombPosition, bombZ, canLaunchPlane, launchPlane } from '../public/js/sim/plane.js';

// CB-9: roster y regla de stats (#327). hp = 60·c·bonoHP, dps = 6·c·bonoDPS, daño = dps × cadencia.

const cfg = resolveConfig();

test('hp y dps salen de la regla y daño / cadencia = dps en cada tipo', () => {
  const esperado = {
    soldado: { hp: 60, dps: 6, damage: 6 },
    jeep: { hp: 600, dps: 60, damage: 42 },
    tanque: { hp: 7500, dps: 750, damage: 937.5 },
    pesado: { hp: 60000, dps: 3000, damage: 4500 }, // v2.7: bonoHP 1,5 → 1 (−33 %)
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
  assert.equal(unitStats(cfg, 'soldado').range, 63); // v2.7 y v2.8: alcance ×1,5 dos veces (28 → 42 → 63)
  assert.equal(unitStats(cfg, 'pesado').range, 117);
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

test('el registro de tipos tiene los nueve con ids de ataque distintos y estados de animación', () => {
  assert.deepEqual(Object.keys(UNIT_TYPES), [
    'soldado',
    'francotirador',
    'jeep',
    'blindado',
    'tanque',
    'lanzacohetes',
    'pesado',
    'lobo',
    'avion',
  ]);
  const ataques = Object.values(UNIT_TYPES).map((t) => t.attack);
  assert.deepEqual(ataques, [
    'fusil',
    'rifle-largo',
    'ametralladora',
    'ametralladora-pesada',
    'canon',
    'cohetes',
    'canon-doble',
    'zarpazo',
    'bombas',
  ]);
  assert.equal(new Set(ataques).size, 9);
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

/** `count` unidades quietas en (x, y): el andamiaje de estas pruebas (no marchan, miran y disparan). */
const hold = (w, side, kind, x, y, count = 1) => ({
  members: seedUnits(w, { side, kind, count, x, y, yg: y, pinned: true }).units,
});
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};

test('cada unidad de tierra es una entidad propia: 40 de daño a un soldado de 5 juntos solo cambia su HP', () => {
  const w = createWorld();
  const { members: quietos } = hold(w, 0, 'soldado', 300, 448, 5);
  const antes = quietos.map((u) => u.hp);
  damageUnit(w, quietos[2], 40, { side: 1 });
  assert.deepEqual(
    quietos.map((u) => u.hp),
    antes.map((h, i) => (i === 2 ? 20 : h)),
  );
  assert.ok(quietos.every((u) => u.alive));
  damageUnit(w, quietos[2], 1000, { side: 1 }); // sin sobredaño: aplica solo lo que queda
  assert.equal(quietos[2].hp, 0);
  assert.equal(quietos[2].alive, false);
  assert.equal(damageUnit(w, quietos[2], 5, { side: 1 }), 0);
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

test('prioridad: unidad > torreta > base, y la base es blanco de TODA unidad (sin roles)', () => {
  const w = createWorld();
  const t = w.bases[1].turrets[1]; // (1340, 448)
  const u = hold(w, 0, 'soldado', 1330, 448).members[0];
  run(w, 1);
  assert.equal(u.tgtKind, 'turret');
  assert.equal(u.tgt, t);
  // un enemigo en alcance gana a la torreta
  const enemigo = hold(w, 1, 'soldado', 1320, 448).members[0];
  run(w, 1);
  assert.equal(u.tgt, enemigo);
  // sin torreta ni unidad, la base (a ≤ alcance de su frente en x): cualquier unidad la ataca, sin condición de rol
  const w2 = createWorld();
  w2.bases[1].turrets.forEach((x) => {
    x.hp = 0;
    x.on = false;
  });
  const v = hold(w2, 0, 'soldado', 1320, 448).members[0];
  run(w2, 1);
  assert.equal(v.tgtKind, 'base');
  assert.equal(v.tgt, w2.bases[1]);
  // y no a más de su alcance (63) de la cara del hangar: a 64 px no hay blanco
  const w3 = createWorld();
  w3.bases[1].turrets.forEach((x) => {
    x.hp = 0;
    x.on = false;
  });
  const lejos = hold(w3, 0, 'soldado', 1350 - 64, 448).members[0];
  run(w3, 1);
  assert.equal(lejos.tgt, null);
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
    seedUnits(w, { side: 0, kind: 'soldado', count: 10, x: 200, y: 300, dy: 25 });
    seedUnits(w, { side: 0, kind: 'jeep', count: 4, x: 160, y: 350, dy: 90 });
    seedUnits(w, { side: 1, kind: 'tanque', count: 2, x: 700, y: 500, dy: 60 });
    seedUnits(w, { side: 1, kind: 'soldado', count: 10, x: 1200, y: 300, dy: 25 });
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

test('lanzamiento: 1 vivo por lado, ≥ 8 s entre lanzamientos, entra en x -44 o 1484 a z 48 con vx ±120', () => {
  const w = createWorld();
  const r1 = launchPlane(w, 0);
  assert.ok(r1.ok);
  assert.equal(r1.plane.x, -44);
  assert.equal(r1.plane.vx, 120);
  assert.equal(r1.plane.z, 48);
  assert.deepEqual(launchPlane(w, 0), { ok: false, reason: 'cap' }, 'un solo avión por lado en el aire');
  // el intervalo, solo: con 2 vivos permitidos, el segundo espera 8 s (240 pasos)
  const g = createWorld({ limits: { maxPlanesPerTeam: 2 } });
  assert.ok(launchPlane(g, 0).ok);
  assert.deepEqual(launchPlane(g, 0), { ok: false, reason: 'gap' });
  run(g, 239);
  assert.equal(canLaunchPlane(g, 0).ok, false);
  run(g, 1);
  assert.ok(launchPlane(g, 0).ok);
  run(g, 100); // el primero sigue en el aire (vuela 382 pasos): dos vivos = tope
  assert.deepEqual(launchPlane(g, 0), { ok: false, reason: 'cap' });
  const d = launchPlane(w, 1).plane;
  assert.equal(d.x, 1484);
  assert.equal(d.vx, -120);
});

test('bombas: una entidad por bomba desde la suelta hasta el impacto (14 pasos); bombsLeft baja de N a 0 y el daño es de 300', () => {
  const w = createWorld();
  const objetivo = hold(w, 1, 'tanque', 628, 450, 2); // en la línea (banda 426 a 474) y sobre el impacto 14
  objetivo.members.forEach((u) => (u.hp = u.maxHp = 50000));
  const p = launchPlane(w, 0).plane;
  assert.equal(p.bombsLeft, p.bombsTotal);
  assert.equal(p.bombsTotal, 34);
  const existencia = new Map(); // id de bomba -> pasos en que existió
  let primera = -1;
  for (let i = 0; i < 900 && w.planes.length > 0; i++) {
    stepWorld(w);
    for (const b of w.bombs) existencia.set(b.id, (existencia.get(b.id) ?? 0) + 1);
    if (primera < 0 && w.bombs.length > 0) {
      primera = i;
      assert.equal(p.bombsLeft, 33, 'al soltar la primera queda una menos');
    }
  }
  assert.equal(existencia.size, 34);
  for (const n of existencia.values()) assert.equal(n, FALL_STEPS);
  assert.equal(FALL_STEPS, 14);
  assert.equal(p.bombsLeft, 0);
  run(w, 20);
  assert.equal(w.bombs.length, 0);
  // los tanques recibieron golpes de 300 (a ≤ 24 px del punto de impacto)
  const total = objetivo.members.reduce((s, u) => s + (50000 - u.hp), 0);
  assert.ok(total > 0 && total % 300 === 0, `daño total ${total}`);
});

test('una bomba daña a la torreta enemiga a ≤ 24 px y al hangar si el círculo toca su rectángulo, y nunca a su equipo', () => {
  const w = createWorld();
  const propio = hold(w, 0, 'soldado', 1332, 448).members[0];
  const enemigo = hold(w, 1, 'soldado', 1340, 460).members[0];
  propio.hp = propio.maxHp = 5000;
  enemigo.hp = enemigo.maxHp = 5000;
  propio.cd = 99;
  enemigo.cd = 99;
  w.bombs.push({ id: 99, side: 0, owner: null, x0: 1350, y0: 448, tx: 1350, ty: 448, dropStep: 0, impactStep: w.step });
  w.bases[1].bucket = 1e9; // este test no mide el cubo (CB-12 está en whale.test.js)
  const hp0 = w.bases[1].hp;
  const t0 = w.bases[1].turrets[1].hp;
  run(w, 1);
  assert.equal(enemigo.hp, 5000 - 300);
  assert.equal(propio.hp, 5000, 'una bomba nunca daña al propio equipo');
  assert.equal(w.bases[1].hp, hp0 - 300);
  assert.equal(w.bases[1].turrets[1].hp, t0 - 300);
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

// ---------------------------------------------------------------------------------------------------- energía (4c.11)
// CB-14, KIT-19 `strike`, CB-11 (energía sin atribuir).

test('barra llena con racimos de distinta fuerza: 3 golpes de 160, radio 20, sobre el más fuerte, en los pasos +0, +8 y +16', async () => {
  const { createRegistry } = await import('@tienda/kit/sim/registry.js');
  const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
  const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
  const registry = createRegistry({ teams: [PE, MX] });
  const w = createWorld({ hq: { hp: 1e12 } }, { registry, phase: 'battle' });
  const debil = hold(w, 1, 'soldado', 900, 300, 5);
  const fuerte = hold(w, 1, 'tanque', 900, 600, 2);
  for (const u of [...debil.members, ...fuerte.members]) u.cd = 1e9;
  // 15 usuarios del equipo 1 comentan: la carga 15 llena la barra (una carga por usuario cada 3 s)
  const res = [];
  for (let i = 0; i < 15; i++) {
    const evt = { type: 'chat', userId: `u${i}`, nickname: `u${i}`, text: '1' };
    res.push(applyEvent(w, { type: 'chat', evt }));
  }
  assert.equal(res.filter((r) => r.strike).length, 1, 'solo la carga 15 dispara');
  const golpes = w.hits.filter((h) => h.splash === 20);
  assert.equal(golpes.length, 3);
  assert.deepEqual(
    golpes.map((h) => h.due - w.step),
    [0, 8, 16],
  );
  for (const h of golpes) {
    assert.equal(h.dmg, 160);
    assert.equal(h.owner, null, 'sin dueño');
    assert.equal(h.side, 0);
    assert.ok(
      Math.abs(h.tx - fuerte.members[0].x) <= 12 + 1e-9 && Math.abs(h.ty - fuerte.members[0].y) <= 10 + 1e-9,
      'sobre el racimo más fuerte',
    );
  }
  const hp0 = w.bases[1].hp;
  const xp0 = registry.users().map((u) => u.xp.live);
  run(w, 20);
  assert.equal(w.bases[1].hp, hp0, 'la base no recibe daño');
  assert.deepEqual(
    registry.users().map((u) => u.xp.live),
    xp0,
    'nadie gana XP',
  );
  assert.ok(
    fuerte.members.some((u) => u.hp < u.maxHp),
    'el racimo más fuerte sí',
  );
  assert.ok(debil.members.every((u) => u.hp === u.maxHp));
});

test('sin unidades enemigas la base recibe 600 por el cubo', () => {
  const w = createWorld();
  w.bases[1].bucket = 800;
  const r = applyEvent(w, { type: 'strike', side: 0 });
  assert.equal(r.target, 'base');
  assert.equal(w.bases[1].hp, 60000 - 600);
  // con el cubo en 200 solo pasan 200
  const w2 = createWorld();
  w2.bases[1].bucket = 200;
  applyEvent(w2, { type: 'strike', side: 0 });
  assert.equal(w2.bases[1].hp, 60000 - 200);
});

test('10 cargas en 60 s (6000 pedidos) restan como máximo 3600 a la base y queda viva', () => {
  const w = createWorld({ hq: { minSeconds: 60 } });
  for (let i = 0; i < 10; i++) {
    w.bases[1].bucket = w.bases[1].cap;
    applyEvent(w, { type: 'strike', side: 0 });
    run(w, 180);
  }
  const perdido = 60000 - w.bases[1].hp;
  assert.ok(perdido <= 3600 + 1e-9, `perdió ${perdido}`);
  assert.ok(perdido > 0 && w.bases[1].hp > 0);
});

test('los impactos que caen sobre una torreta la dañan', () => {
  const w = createWorld();
  const t = w.bases[1].turrets[1];
  const g = hold(w, 0, 'soldado', t.x - 4, t.y, 3);
  g.members.forEach((u) => (u.cd = 1e9));
  hold(w, 1, 'soldado', t.x - 6, t.y).members.forEach((u) => (u.cd = 1e9)); // el blanco de la energía: una unidad del lado 1
  const hp0 = t.hp;
  applyEvent(w, { type: 'strike', side: 0 });
  run(w, 20);
  assert.ok(t.hp < hp0, 'la torreta recibió daño de la energía');
});
