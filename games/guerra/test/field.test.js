import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { ATTACK_LANES, corridorOf, createField, laneY, sideDir } from '../public/js/sim/field.js';

// CB-15, CB-3: geometría del campo con las medidas del prototipo v3 aprobado por el dueño.

const cfg = resolveConfig();
const f = createField(cfg);
const [L, R] = f.sides;

test('descriptor 16:9 sin campo lanes y con las calles declaradas', () => {
  assert.equal(f.aspect, '16:9');
  assert.equal(f.w, 1440);
  assert.equal(f.h, 810);
  assert.ok(!('lanes' in f));
  for (const s of f.sides) {
    assert.deepEqual(s.subLanes, [0, -40, 40]);
    assert.deepEqual(s.postLanes, { A: -80, B: 80 });
  }
  assert.ok(Object.isFrozen(f));
});

test('frentes, salidas, corredores y suelo del v3', () => {
  assert.deepEqual([L.frontX, R.frontX], [108, 1332]);
  assert.deepEqual([L.exitX, R.exitX], [124, 1316]);
  assert.deepEqual(f.ground, [138, 758]);
  assert.deepEqual(f.corridors, [
    [138, 345],
    [345, 551.5],
    [551.5, 758],
  ]);
  assert.deepEqual(L.gates, [242, 448, 655]);
  assert.deepEqual(R.gates, [242, 448, 655]);
  assert.equal(f.midX, 720);
});

test('corridorOf usa los bordes en los puntos medios entre centros', () => {
  assert.equal(corridorOf(f, 138), 0);
  assert.equal(corridorOf(f, 344.9), 0);
  assert.equal(corridorOf(f, 345), 1);
  assert.equal(corridorOf(f, 551.4), 1);
  assert.equal(corridorOf(f, 551.5), 2);
  assert.equal(corridorOf(f, 758), 2);
  assert.equal(corridorOf(f, 10), 0); // fuera del suelo: el corredor más cercano
  assert.equal(corridorOf(f, 800), 2);
});

test('la zona de defensa es el 30 % de la distancia entre los frentes leídos del descriptor', () => {
  const zona = (R.frontX - L.frontX) * 0.3; // 367,2
  assert.ok(Math.abs(L.defenseZone[1] - L.defenseZone[0] - zona) <= 1);
  assert.ok(Math.abs(R.defenseZone[1] - R.defenseZone[0] - zona) <= 1);
  assert.deepEqual(L.defenseZone, [108, 475]);
  assert.deepEqual(R.defenseZone, [965, 1332]);
});

test('puertas por tipo', () => {
  assert.deepEqual(L.gateX, { soldado: 168, jeep: 182, tanque: 186, pesado: 190 });
  assert.deepEqual(R.gateX, { soldado: 1272, jeep: 1258, tanque: 1254, pesado: 1250 });
});

test('puestos de defensa: x 374/328/282/236 y 1066/1112/1158/1204, 4 por calle y por sector', () => {
  assert.equal(L.sectors.length, 3);
  for (let g = 0; g < 3; g++) {
    const s = L.sectors[g];
    assert.equal(s.y, L.gates[g]);
    assert.deepEqual(
      s.posts.A.map((p) => p.x),
      [374, 328, 282, 236],
    );
    assert.deepEqual(
      s.posts.B.map((p) => p.x),
      [374, 328, 282, 236],
    );
    assert.ok(s.posts.A.every((p) => p.y === s.y - 80));
    assert.ok(s.posts.B.every((p) => p.y === s.y + 80));
    assert.deepEqual(
      R.sectors[g].posts.A.map((p) => p.x),
      [1066, 1112, 1158, 1204],
    );
  }
});

test('las calles de ataque y las de puestos son distintas', () => {
  const ataque = new Set(L.subLanes);
  for (const d of Object.values(L.postLanes)) assert.ok(!ataque.has(d));
  assert.deepEqual(ATTACK_LANES, { centro: 0, jeep: 1, bajo: 2 });
  assert.equal(laneY(f, 1, ATTACK_LANES.jeep), 408);
  assert.equal(laneY(f, 0, ATTACK_LANES.bajo), 282);
  assert.equal(laneY(f, 2, ATTACK_LANES.centro), 655);
});

test('la última fila de cada formación llena en su puerta queda delante del frente propio', () => {
  const huellaX = { soldado: 6, jeep: 18, tanque: 24, pesado: 34 };
  const fondo = { soldado: 12, jeep: 26, tanque: 0, pesado: 0 };
  for (const k of Object.keys(huellaX)) {
    assert.ok(L.gateX[k] - fondo[k] - huellaX[k] / 2 > L.frontX, k);
    assert.ok(R.gateX[k] + fondo[k] + huellaX[k] / 2 < R.frontX, k);
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
  const { createWorld, seedSquad, stepWorld } = await import('../public/js/sim/world.js');
  const { launchPlane } = await import('../public/js/sim/plane.js');
  const w = createWorld();
  const g = w.field;
  let lote = 0;
  for (let paso = 0; paso < 9000; paso++) {
    // cada 6 s entra un lote de grupos de los cuatro tipos por lado
    if (paso % 180 === 0) {
      const tipos = ['soldado', 'jeep', 'tanque', 'pesado', 'soldado'];
      for (const side of [0, 1]) {
        const kind = tipos[lote % tipos.length];
        seedSquad(w, { side, kind, corridor: (lote + side) % 3, lane: lote % 3 });
      }
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
