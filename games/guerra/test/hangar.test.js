import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { createField } from '../public/js/sim/field.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { scheduleHit } from '../public/js/sim/combat.js';
import { launchPlane } from '../public/js/sim/plane.js';

// v2.8 (lotes 2 y 4): sin muralla. El objetivo final de cada bando es su HANGAR, el cuartel agrandado: un rectángulo de
// x 14–90 y y 348–548 (la zona de asalto) en el lado izquierdo y su espejo en el derecho. Su cara frontal (x 90 / 1350) es
// el frente y el tope duro. El daño de área solo lo daña si el golpe cae dentro del rectángulo ampliado por el radio.

const cfg = resolveConfig();
const f = createField(cfg);
const [L, R] = f.sides;
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const INMORTAL = { hq: { hp: 1e12 } };

test('descriptor: hangar {x0, x1, y0, y1, faceX} simétrico; el frente es su cara y la puerta queda delante', () => {
  assert.deepEqual(L.hangar, { x0: 14, x1: 90, y0: 348, y1: 548, faceX: 90 });
  assert.deepEqual(R.hangar, { x0: 1350, x1: 1426, y0: 348, y1: 548, faceX: 1350 });
  assert.deepEqual([L.frontX, R.frontX], [90, 1350]);
  for (const s of f.sides) {
    assert.equal(s.frontX, s.hangar.faceX);
    assert.equal(s.hangar.y1 - s.hangar.y0, 2 * cfg.movement.assault.halfY, 'alto = la zona de asalto');
    assert.equal((s.hangar.y0 + s.hangar.y1) / 2, s.door.y, 'centrado en la puerta');
  }
  assert.equal(R.hangar.x0, f.w - L.hangar.x1);
  assert.equal(R.hangar.x1, f.w - L.hangar.x0);
  assert.ok(L.door.x > L.hangar.faceX && R.door.x < R.hangar.faceX, 'la puerta es una explanada delante del hangar');
  assert.ok(Object.isFrozen(L.hangar));
  const g = createField(resolveConfig({ movement: { assault: { halfY: 60 } } }));
  assert.deepEqual([g.sides[0].hangar.y0, g.sides[0].hangar.y1], [388, 508], 'el alto sale de la config');
});

test('la base lleva su hangar y las torretas no se mueven (100/1340, y 242/448/655)', () => {
  const w = createWorld();
  assert.ok(w.bases[0].hangar);
  assert.equal(w.bases[0].hangar, w.field.sides[0].hangar);
  assert.deepEqual(
    w.bases[1].turrets.map((t) => [t.x, t.y]),
    [
      [1340, 242],
      [1340, 448],
      [1340, 655],
    ],
  );
});

/** Un golpe de área de `splash` px en (tx, ty) del lado 0 contra la base derecha; devuelve el daño que recibió. */
function golpe(tx, ty, splash = 24, extra = {}) {
  const w = createWorld(INMORTAL);
  const b = w.bases[1];
  b.bucket = 1e9;
  for (const t of b.turrets) {
    t.hp = 0;
    t.on = false;
  }
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 0,
    owner: null,
    dmg: 300,
    splash,
    tx,
    ty,
    tgt: null,
    tgtKind: '',
    ...extra,
  });
  stepWorld(w);
  return b.maxHp - b.hp;
}

test('daño de área: la base solo recibe si el círculo toca el rectángulo del hangar (x 1350–1426, y 348–548)', () => {
  assert.equal(golpe(1380, 448), 300, 'dentro del rectángulo');
  assert.equal(golpe(1350, 448), 300, 'sobre la cara');
  assert.equal(golpe(1350 - 24, 448), 300, 'a 24 px de la cara: lo toca el radio');
  assert.equal(golpe(1350 - 25, 448), 0, 'a 25 px: fuera');
  assert.equal(golpe(1380, 548 + 24), 300, 'justo bajo el borde de abajo, a 24 px');
  assert.equal(golpe(1380, 548 + 25), 0);
  assert.equal(golpe(1380, 348 - 24), 300);
  assert.equal(golpe(1380, 348 - 25), 0, 'por encima del hangar no hay daño a la base');
  assert.equal(golpe(1350 - 20, 548 + 20, 24), 0, 'la esquina cuenta por distancia, no por caja: 28 px > 24');
  assert.equal(golpe(1350 - 15, 548 + 15, 24), 300, 'a 21 px de la esquina: dentro del radio');
  assert.equal(golpe(1500, 448), 0, 'más allá del hangar, por detrás');
  assert.equal(golpe(600, 448), 0, 'en el centro del mapa');
  assert.equal(golpe(1380, 448, 24, { noBase: true }), 0, 'el golpe de energía al racimo no daña la base');
});

test('daño de área al hangar izquierdo: el espejo', () => {
  const w = createWorld(INMORTAL);
  w.bases[0].bucket = 1e9;
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 1,
    owner: null,
    dmg: 300,
    splash: 24,
    tx: 90 + 24,
    ty: 448,
    tgt: null,
    tgtKind: '',
  });
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 1,
    owner: null,
    dmg: 300,
    splash: 24,
    tx: 90 + 25,
    ty: 448,
    tgt: null,
    tgtKind: '',
  });
  scheduleHit(w, {
    due: w.step,
    kind: 'bomb',
    side: 1,
    owner: null,
    dmg: 300,
    splash: 24,
    tx: 50,
    ty: 600,
    tgt: null,
    tgtKind: '',
  });
  stepWorld(w);
  assert.equal(w.bases[0].maxHp - w.bases[0].hp, 300, 'solo el de x 114 toca el hangar');
});

test('un avión solo daña el hangar si su línea pasa por su franja (y 324–572); fuera, la base queda intacta', () => {
  const daño = (y) => {
    const w = createWorld(INMORTAL);
    // fuerza enemiga solo en la banda de la línea para que la línea quede ahí
    const e = seedUnits(w, { side: 1, kind: 'soldado', x: 800, y, yg: y, pinned: true }).units[0];
    e.cd = 1e9;
    e.hp = e.maxHp = 1e9;
    w.bases[1].bucket = 1e9;
    for (const t of w.bases[1].turrets) {
      t.hp = 0;
      t.on = false;
    }
    const p = launchPlane(w, 0).plane;
    let n = 0;
    while (w.planes.includes(p) && n++ < 3000) stepWorld(w);
    run(w, 20);
    return [p.y, w.bases[1].maxHp - w.bases[1].hp];
  };
  const [y1, d1] = daño(450);
  assert.equal(y1, 450);
  assert.ok(d1 >= 300, 'por la franja del hangar daña');
  const [y2, d2] = daño(210);
  assert.equal(y2, 210);
  assert.equal(d2, 0, 'por arriba no toca el hangar');
  const [y3, d3] = daño(690);
  assert.equal(y3, 690);
  assert.equal(d3, 0);
});

test('las unidades atacan el hangar: desde ≤ alcance de su cara y con y dentro de 348–548; fuera de la franja, no', () => {
  const objetivo = (y, dx) => {
    const w = createWorld(INMORTAL);
    for (const t of w.bases[1].turrets) {
      t.hp = 0;
      t.on = false;
    }
    const u = seedUnits(w, { side: 0, kind: 'soldado', x: 1350 - dx, y, yg: y, pinned: true }).units[0];
    run(w, 1);
    return u.tgtKind;
  };
  const alcance = cfg.units.soldado.range;
  assert.equal(objetivo(448, alcance), 'base');
  assert.equal(objetivo(448, alcance + 1), '');
  assert.equal(objetivo(348, 10), 'base');
  assert.equal(objetivo(548, 10), 'base');
  assert.equal(objetivo(340, 10), '', 'por encima de la franja no hay blanco');
  assert.equal(objetivo(560, 10), '');
});

test('tope duro: nadie pasa de la cara del hangar enemigo (x 1350 / 90), ni empujado', () => {
  const w = createWorld(INMORTAL);
  for (let i = 0; i < 30; i++)
    seedUnits(w, { side: 0, kind: 'soldado', x: 1340 + (i % 5), y: 300 + i * 10, yg: 300 + i * 10, phase: 'march' });
  for (let i = 0; i < 30; i++)
    seedUnits(w, { side: 1, kind: 'soldado', x: 100 - (i % 5), y: 300 + i * 10, yg: 300 + i * 10, phase: 'march' });
  const pasado = seedUnits(w, { side: 0, kind: 'soldado', x: 1380, y: 448, yg: 448, phase: 'march' }).units[0];
  run(w, 1);
  assert.equal(pasado.x, 1350, 'una unidad pasada del frente queda clavada en la cara del hangar');
  for (let i = 0; i < 300; i++) {
    stepWorld(w);
    for (const u of w.units) {
      if (u.side === 0) assert.ok(u.x <= 1350 + 1e-9, `izq. x ${u.x}`);
      else assert.ok(u.x >= 90 - 1e-9, `der. x ${u.x}`);
    }
  }
});
