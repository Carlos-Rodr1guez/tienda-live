import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, seedUnits, snapshotAndGrid, stepWorld } from '../public/js/sim/world.js';
import { scanVision, stepMarch } from '../public/js/sim/march.js';
import { targetHeight } from '../public/js/sim/units.js';
import { DT } from '../public/js/sim/defaults.js';

// CB-21 (salida única y reparto), CB-22 (movimiento individual): cada unidad sale de la puerta, va a su altura `yg`,
// ve enemigos de lejos, va hacia ellos con blanco pegajoso, pelea y retoma su rumbo hacia la base enemiga.

const INMORTAL = { hq: { hp: 1e12 } }; // la base no cae: estos tests no miden el final de ronda
const mundo = (game = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox' });
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const unidad = (w, p) => seedUnits(w, { count: 1, ...p }).units[0];

test('el reparto (v2.7): las 99 primeras salidas ocupan los tres caminos por igual y dentro del suelo útil', () => {
  const w = mundo();
  const [g0, g1] = w.field.ground;
  const { margin } = w.cfg.movement.spread;
  const lo = g0 + margin;
  const hi = g1 - margin;
  const alto = hi - lo;
  const tercios = [0, 0, 0];
  for (let n = 0; n < 99; n++) {
    const yg = targetHeight(w, n);
    assert.ok(yg >= lo && yg <= hi, `yg ${yg} fuera de [${lo}, ${hi}]`);
    tercios[Math.min(2, Math.floor(((yg - lo) / alto) * 3))]++;
  }
  assert.deepEqual(tercios, [33, 33, 33], 'cada camino recibe un tercio (el detalle está en caminos.test.js)');
});

test('el reparto es una función pura de n: sin azar, mismo n da la misma altura', () => {
  const a = mundo();
  const b = mundo();
  for (let n = 0; n < 50; n++) assert.equal(targetHeight(a, n), targetHeight(b, n));
});

test('fase leg: va de la puerta a (puerta.x + dir·300, yg) y de ahí pasa a march; la altura la alcanza al llegar', () => {
  for (const side of [0, 1]) {
    const w = mundo();
    const s = w.field.sides[side];
    const u = unidad(w, { side, kind: 'soldado', x: s.door.x, y: s.door.y, yg: 700, phase: 'leg' });
    assert.equal(u.phase, 'leg');
    const legX = s.door.x + s.dir * w.cfg.movement.spread.legX;
    let paso = -1;
    for (let i = 0; i < 1200 && paso < 0; i++) {
      stepWorld(w);
      if (u.phase === 'march') paso = i;
    }
    assert.ok(paso > 0, 'tiene que pasar a march');
    assert.ok((u.x - legX) * s.dir > -3, `pasó a march en x ${u.x}, el punto de reparto es ${legX}`);
    assert.ok(Math.abs(u.y - 700) < 8, `llegó al tramo con y ${u.y}, su altura es 700`);
  }
});

test('fase leg: avanza a la velocidad máxima de su tipo y sin rampa de llegada (no frena al pasar por el punto de reparto)', () => {
  for (const kind of ['soldado', 'jeep', 'tanque', 'pesado']) {
    const w = mundo();
    const u = unidad(w, { side: 0, kind, x: 124, y: 448, yg: 300, phase: 'leg' });
    let vMin = Infinity;
    for (let i = 0; i < 400 && u.phase === 'leg'; i++) {
      stepWorld(w);
      if (i > 45 && u.phase === 'leg') vMin = Math.min(vMin, Math.hypot(u.vx, u.vy));
    }
    assert.ok(
      vMin >= u.stats.speed - 1e-6,
      `${kind}: la velocidad mínima en la fase leg fue ${vMin}, la máxima es ${u.stats.speed}`,
    );
  }
});

test('fase march: marcha por su altura, se cierra al centro y queda a «alcance − 3» del frente enemigo disparando a la base', () => {
  for (const side of [0, 1]) {
    const w = mundo();
    const s = w.field.sides[side];
    const e = w.field.sides[1 - side];
    const u = unidad(w, { side, kind: 'tanque', x: s.door.x, y: 300, yg: 300, phase: 'march' });
    run(w, 30 * 20);
    assert.ok(Math.abs(u.y - 300) < 1, 'a mitad de camino conserva su altura');
    run(w, 30 * 50);
    assert.equal(u.tgtKind, 'base');
    assert.ok(Math.abs(u.y - e.door.y) < 8, `al final se cerró al centro de la base (y ${u.y})`);
    const d = Math.abs(e.frontX - u.x);
    assert.ok(d <= w.stats.tanque.range && d >= w.stats.tanque.range - 12, `quedó a ${d} px del frente`);
    assert.ok(w.bases[1 - side].hp < w.bases[1 - side].maxHp, 'la base recibe daño');
  }
});

test('nadie queda en una calle: dos unidades en alturas distintas marchan por las suyas sin juntarse', () => {
  const w = mundo();
  const a = unidad(w, { side: 0, kind: 'soldado', x: 124, y: 200, yg: 200, phase: 'march' });
  const b = unidad(w, { side: 0, kind: 'soldado', x: 124, y: 700, yg: 700, phase: 'march' });
  run(w, 300);
  assert.ok(Math.abs(a.y - 200) < 1 && Math.abs(b.y - 700) < 1);
  assert.ok(a.x > 300 && b.x > 300);
});

test('visión: un enemigo a 150 px de costado se persigue y se pelea; después retoma su destino', () => {
  const w = mundo();
  const nuestro = unidad(w, { side: 0, kind: 'soldado', x: 500, y: 300, yg: 300, phase: 'march' });
  // el enemigo pasa a 150 px de costado, en su propia altura, camino a nuestra base
  const enemigo = unidad(w, { side: 1, kind: 'soldado', x: 560, y: 450, yg: 450, phase: 'march' });
  let vio = false;
  let peleo = false;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < 600 && enemigo.alive; i++) {
    stepWorld(w);
    if (nuestro.seek === enemigo) vio = true;
    if (nuestro.tgt === enemigo) peleo = true;
    yMax = Math.max(yMax, nuestro.y);
    yMin = Math.min(yMin, nuestro.y);
  }
  assert.ok(vio, 'tiene que ver al enemigo a 150 px de costado');
  assert.ok(peleo, 'tiene que pelear');
  assert.ok(yMax > 330, `se desvió de su altura (y máx. ${yMax})`);
  assert.ok(yMin > 295, 'no se fue para el otro lado');
});

test('después de pelear retoma el destino: seek vuelve a null y avanza hacia la base', () => {
  const w = mundo();
  const nuestro = unidad(w, { side: 0, kind: 'tanque', x: 500, y: 300, yg: 300, phase: 'march' });
  const enemigo = unidad(w, { side: 1, kind: 'soldado', x: 560, y: 450, yg: 450, phase: 'march' });
  run(w, 200);
  assert.equal(enemigo.alive, false);
  assert.equal(nuestro.seek, null);
  const x0 = nuestro.x;
  run(w, 90);
  assert.ok(nuestro.x > x0 + 20, 'retomó la marcha');
  assert.ok(Math.abs(nuestro.y - 300) < Math.abs(450 - 300) / 2, 'vuelve hacia su altura de destino');
});

/** Mundo con una unidad nuestra y enemigos quietos puestos a mano; escanea en el paso que le toca. */
function escaneo() {
  const w = mundo();
  const u = unidad(w, { side: 0, kind: 'soldado', x: 500, y: 448, yg: 448, phase: 'march' });
  // paso de escaneo: (step + id) % scanEvery === 0
  while ((w.step + u.id) % w.cfg.movement.scanEvery !== 0) w.step++;
  const scan = () => {
    snapshotAndGrid(w);
    scanVision(w);
  };
  return { w, u, scan };
}

test('blanco pegajoso: conserva el blanco mientras viva y esté a ≤ 1,25× la visión; cambia solo si hay uno a ≤ 0,75× la distancia', () => {
  const { w, u, scan } = escaneo();
  const e1 = unidad(w, { side: 1, kind: 'soldado', x: 500, y: 548, phase: 'march' }); // d = 100
  scan();
  assert.equal(u.seek, e1);
  // uno un poco más cerca (d = 90, razón 0,9 > 0,75): no cambia
  const e2 = unidad(w, { side: 1, kind: 'soldado', x: 500, y: 358, phase: 'march' });
  scan();
  assert.equal(u.seek, e1, 'no cambia por un 10 % más cerca');
  // uno a 74 (razón 0,74 ≤ 0,75): cambia
  const e3 = unidad(w, { side: 1, kind: 'soldado', x: 574, y: 448, phase: 'march' });
  scan();
  assert.equal(u.seek, e3);
  // uno a exactamente 0,76 del actual (74 · 0,76... nuevo a 56, razón 0,757 > 0,75): no cambia
  unidad(w, { side: 1, kind: 'soldado', x: 500 + 56, y: 448, phase: 'march' });
  scan();
  assert.equal(u.seek, e3, 'razón 0,757: no cambia');
  assert.ok(e2.alive);
});

test('blanco pegajoso: el blanco lejano se conserva hasta 250 px y se suelta más allá; un muerto se suelta', () => {
  const { w, u, scan } = escaneo();
  const e = unidad(w, { side: 1, kind: 'soldado', x: 500, y: 448 + 190, phase: 'march' }); // d = 190 (< 200)
  scan();
  assert.equal(u.seek, e);
  e.y = 448 + 240; // 240 > visión 200 pero ≤ 250: se conserva
  scan();
  assert.equal(u.seek, e, 'dentro de 1,25× la visión se conserva');
  e.y = 448 + 260; // > 250
  scan();
  assert.equal(u.seek, null, 'más allá de 1,25× la visión se suelta');
  e.y = 448 + 100;
  scan();
  assert.equal(u.seek, e);
  e.alive = false;
  stepMarch(w);
  assert.equal(u.seek, null, 'un blanco muerto se suelta en el mismo paso');
});

test('la visión se escalona: solo escanea cuando (paso + id) % 4 === 0 y el costo no pasa de una consulta por unidad cada 4 pasos', () => {
  const w = mundo();
  const us = [];
  for (let i = 0; i < 4; i++) us.push(unidad(w, { side: 0, kind: 'soldado', x: 500, y: 448, phase: 'march' }));
  const e = unidad(w, { side: 1, kind: 'soldado', x: 560, y: 448, phase: 'march' });
  snapshotAndGrid(w);
  const vieron = [];
  for (let k = 0; k < 4; k++) {
    for (const u of us) u.seek = null;
    scanVision(w);
    vieron.push(us.filter((u) => u.seek === e).map((u) => u.id));
    w.step++;
  }
  // en 4 pasos consecutivos, cada unidad escanea exactamente una vez
  const todos = vieron.flat().sort((a, b) => a - b);
  assert.deepEqual(
    todos,
    us.map((u) => u.id).sort((a, b) => a - b),
  );
  for (const v of vieron) assert.ok(v.length <= 2);
});

test('el blanco por alcance manda sobre el de visión y frena la marcha (velocidad deseada 0)', () => {
  const w = mundo();
  const u = unidad(w, { side: 0, kind: 'soldado', x: 500, y: 448, yg: 448, phase: 'march' });
  const e = unidad(w, { side: 1, kind: 'soldado', x: 520, y: 448, yg: 448, phase: 'march' }); // d = 20 ≤ 28
  run(w, 1);
  assert.equal(u.tgt, e);
  assert.equal(u.dvx, 0);
  assert.equal(u.dvy, 0);
});

test('persecución: va hasta «alcance − 3» del blanco y ahí se detiene a disparar', () => {
  const w = mundo();
  const u = unidad(w, { side: 0, kind: 'tanque', x: 500, y: 448, yg: 448, phase: 'march' });
  // un pesado enemigo inmóvil en su altura (sin avanzar: lo clavamos con vx = 0 cada paso)
  const e = unidad(w, { side: 1, kind: 'soldado', x: 640, y: 448, yg: 448, phase: 'march' });
  e.hp = e.maxHp = 1e9;
  let minD = Infinity;
  for (let i = 0; i < 150; i++) {
    e.x = 640;
    e.y = 448;
    e.vx = 0;
    e.vy = 0;
    stepWorld(w);
    minD = Math.min(minD, Math.hypot(e.x - u.x, e.y - u.y));
  }
  assert.ok(u.tgt === e, 'termina peleando con él');
  assert.ok(minD > 30 && minD <= w.stats.tanque.range, `se detuvo a ${minD} px (alcance ${w.stats.tanque.range})`);
});

test('un jeep no se frena por config: jeepMarchCap null deja su velocidad; con un tope numérico lo limita en la marcha', () => {
  const libre = mundo();
  const j = unidad(libre, { side: 0, kind: 'jeep', x: 124, y: 300, yg: 300, phase: 'march' });
  run(libre, 60);
  assert.ok(Math.hypot(j.vx, j.vy) > 60, `jeep sin tope: ${Math.hypot(j.vx, j.vy)}`);
  const tope = mundo({ movement: { jeepMarchCap: 1.25 } });
  const k = unidad(tope, { side: 0, kind: 'jeep', x: 124, y: 300, yg: 300, phase: 'march' });
  run(tope, 60);
  assert.ok(Math.hypot(k.vx, k.vy) <= 1.25 * tope.stats.soldado.speed + 1e-9);
});

test('aceleración acotada: la velocidad cambia a lo sumo accel·vmax·DT por paso', () => {
  const w = mundo();
  const u = unidad(w, { side: 0, kind: 'soldado', x: 124, y: 300, yg: 300, phase: 'march' });
  const lim = w.cfg.movement.accel * u.stats.speed * DT;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < 90; i++) {
    stepWorld(w);
    assert.ok(Math.hypot(u.vx - vx, u.vy - vy) <= lim + 1e-9, `paso ${i}`);
    vx = u.vx;
    vy = u.vy;
  }
});

test('el suelo: ninguna unidad sale de [138, 758] en y', () => {
  const w = mundo();
  const u = unidad(w, { side: 0, kind: 'soldado', x: 124, y: 140, yg: 100, phase: 'march' });
  const v = unidad(w, { side: 1, kind: 'soldado', x: 1316, y: 756, yg: 900, phase: 'march' });
  for (let i = 0; i < 200; i++) {
    stepWorld(w);
    assert.ok(u.y >= 138 && v.y <= 758);
  }
});

test('la orientación gira con histéresis: nunca más de un giro por 0,3 s', () => {
  const w = mundo();
  const u = unidad(w, { side: 0, kind: 'soldado', x: 500, y: 300, yg: 300, phase: 'march' });
  for (let i = 0; i < 8; i++) unidad(w, { side: 1, kind: 'soldado', x: 520 + i * 20, y: 150 + i * 80, phase: 'march' });
  const giros = [];
  let dir = u.dir;
  for (let i = 0; i < 400; i++) {
    stepWorld(w);
    if (u.dir !== dir) {
      giros.push(i);
      dir = u.dir;
    }
  }
  for (let i = 1; i < giros.length; i++)
    assert.ok(giros[i] - giros[i - 1] >= 9, `giros en ${giros[i - 1]} y ${giros[i]}`);
});

test('el sim no importa el tiempo real ni Math.random (determinismo del núcleo)', () => {
  const real = Math.random;
  Math.random = () => {
    throw new Error('Math.random en el sim');
  };
  try {
    const w = mundo();
    for (let i = 0; i < 10; i++) {
      unidad(w, { side: 0, kind: 'tanque', x: 300, y: 200 + i * 40, yg: 200 + i * 40, phase: 'march' });
      unidad(w, { side: 1, kind: 'soldado', x: 700, y: 210 + i * 40, yg: 210 + i * 40, phase: 'march' });
    }
    run(w, 300);
  } finally {
    Math.random = real;
  }
});
