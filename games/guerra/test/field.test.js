import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { createField, doorOffsets, inDoorZone, sideDir } from '../public/js/sim/field.js';

// CB-15, CB-3: geometría del campo con las medidas del prototipo v3 aprobado por el dueño; desde v2.6 una sola puerta
// de salida por lado con sus cinco ranuras (D30). Sin corredores, calles, puestos, sectores ni zona de defensa.

const cfg = resolveConfig();
const f = createField(cfg);
const [L, R] = f.sides;

test('descriptor 16:9 con la puerta y sus ranuras, y sin las estructuras de la v2.5', () => {
  assert.equal(f.aspect, '16:9');
  assert.equal(f.w, 1440);
  assert.equal(f.h, 810);
  assert.ok(!('lanes' in f));
  assert.equal(f.corridors, undefined);
  for (const s of f.sides) {
    assert.deepEqual(s.door.slots, [0, 1, -1, 2, -2]);
    assert.equal(s.door.slotMin, 9);
    assert.equal(s.door.slotStep, 0.5);
    assert.equal(s.door.freeFactor, 0.9);
    assert.equal(s.door.y, 448);
    for (const viejo of ['gates', 'gateX', 'subLanes', 'postLanes', 'defenseZone', 'sectors']) {
      assert.equal(s[viejo], undefined, `s.${viejo} ya no existe`);
    }
  }
  assert.ok(Object.isFrozen(f));
});

test('frentes, puertas y suelo del v3', () => {
  assert.deepEqual([L.frontX, R.frontX], [90, 1350], 'v2.8: el frente es la cara del hangar');
  assert.deepEqual([L.exitX, R.exitX], [124, 1316]);
  assert.deepEqual([L.door.x, R.door.x], [124, 1316]);
  assert.deepEqual(f.ground, [138, 758]);
  assert.equal(f.midX, 720);
});

test('la puerta sale de la config (movement.door) y la puerta queda delante del frente propio', () => {
  const g = createField(resolveConfig({ movement: { door: { y: 400, slotMin: 12 } } }));
  assert.equal(g.sides[0].door.y, 400);
  assert.equal(g.sides[1].door.slotMin, 12);
  assert.deepEqual(doorOffsets(g.sides[1].door, 9), [0, 12, -12, 24, -24]);
  assert.ok(L.door.x > L.frontX && R.door.x < R.frontX);
  // y las cinco ranuras de cada tipo (hasta ±38 px) caen dentro del suelo
  for (const s of f.sides)
    for (const sp of [9, 20, 28, 38])
      for (const dy of doorOffsets(s.door, sp)) {
        assert.ok(s.door.y + dy >= f.ground[0] && s.door.y + dy <= f.ground[1]);
      }
});

test('dos bases con ids de arte distintos, direcciones y torretas', () => {
  assert.notEqual(L.art, R.art);
  assert.equal(L.art, 'base-fortin');
  assert.equal(R.art, 'base-ciudadela');
  assert.equal(sideDir(0), 1);
  assert.equal(sideDir(1), -1);
  assert.deepEqual(
    L.turrets.map((t) => [t.x, t.y]),
    [
      [100, 242],
      [100, 448],
      [100, 655],
    ],
  );
  assert.deepEqual(
    R.turrets.map((t) => [t.x, t.y]),
    [
      [1340, 242],
      [1340, 448],
      [1340, 655],
    ],
  );
});

test('estrés de 5 min: nadie sale del suelo ni del mundo y los aviones solo salen en su ruta', async () => {
  const { createWorld, seedUnits, stepWorld } = await import('../public/js/sim/world.js');
  const { launchPlane } = await import('../public/js/sim/plane.js');
  const w = createWorld();
  const g = w.field;
  let lote = 0;
  for (let paso = 0; paso < 9000; paso++) {
    // cada 6 s entra un lote de unidades de los cuatro tipos por lado
    if (paso % 180 === 0) {
      const tipos = ['soldado', 'jeep', 'tanque', 'pesado', 'soldado'];
      for (const side of [0, 1])
        seedUnits(w, { side, kind: tipos[lote % tipos.length], count: 5, dy: 20, y: 200 + ((lote * 70) % 400) });
      lote++;
    }
    if (paso % 400 === 100) {
      launchPlane(w, 0);
      launchPlane(w, 1);
    }
    stepWorld(w);
    if (paso % 50 === 0) {
      for (const u of w.units) {
        assert.ok(u.y >= g.ground[0] && u.y <= g.ground[1], `y=${u.y} fuera del suelo`);
        assert.ok(u.x >= -1 && u.x <= g.w + 1, `x=${u.x} fuera del mundo`);
      }
      for (const p of w.planes) assert.ok(p.x >= -44 - 1e-9 && p.x <= g.w + 44 + 1e-9);
    }
    if (w.over !== null) break;
  }
  assert.ok(w.step > 1000);
});

test('umbral de la puerta: la zona donde un amigo todavía taparía una ranura de cualquier tipo', () => {
  const door = L.door;
  const M = 38;
  // soldado: x ≤ 0,9 × (9 + 38) / 2 = 21,15 ; y ≤ 2 × 19 + 1,2 × 23,5 = 66,2
  assert.ok(inDoorZone(door, 1, 9, M, door.x + 21, door.y + 66));
  assert.ok(!inDoorZone(door, 1, 9, M, door.x + 21.2, door.y));
  assert.ok(!inDoorZone(door, 1, 9, M, door.x, door.y + 66.3));
  // pesado: x ≤ 0,9 × 38 = 34,2 ; y ≤ 38 + 1,2 × 38 = 83,6
  assert.ok(inDoorZone(door, 1, 38, M, door.x + 34, door.y - 83));
  assert.ok(!inDoorZone(door, 1, 38, M, door.x + 34.3, door.y));
  // el lado derecho es el espejo
  assert.ok(inDoorZone(R.door, -1, 9, M, R.door.x - 21, R.door.y));
  assert.ok(!inDoorZone(R.door, -1, 9, M, R.door.x - 21.2, R.door.y));
  // un amigo fuera del umbral no tapa ninguna ranura de ningún tipo por distancia libre (criterio de queue.js)
  for (const sp of [9, 20, 28, 38]) {
    const par = (sp + M) / 2;
    for (const dy of doorOffsets(door, M)) {
      for (let x = 0; x <= 40; x += 0.5) {
        for (let y = -100; y <= 100; y += 0.5) {
          const tapa = Math.hypot(x, y - dy) < door.freeFactor * par;
          if (tapa)
            assert.ok(inDoorZone(door, 1, sp, M, door.x + x, door.y + y), `sp ${sp}: (${x}, ${y}) tapa y queda fuera`);
        }
      }
    }
  }
});
