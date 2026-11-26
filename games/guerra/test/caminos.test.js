import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { DEFAULTS, resolveConfig } from '../public/js/sim/defaults.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { submitOrder } from '../public/js/sim/queue.js';
import { targetHeight, unitStats } from '../public/js/sim/units.js';
import * as campo from '../public/js/sim/field.js';

// v2.7 (pedidos del dueño tras su playtest): las oleadas se reparten en TRES caminos (arriba, medio, abajo) y, cerca de
// la base enemiga, TODAS convergen en su punto central; solo ahí se ataca la base. Las torretas de arriba y de abajo no
// son blanco de nadie. El alcance de las unidades es ×1,5 y el pesado tiene un tercio menos de vida.

const INMORTAL = { hq: { hp: 1e12 } };
const mundo = (game = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox' });
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const unidad = (w, p) => seedUnits(w, { count: 1, ...p }).units[0];
const orden = (kind, team, count) => ({ kind, team, owner: null, count, unitValue: 0, source: 'gift' });

const [G0, G1] = [138, 758];
// en el orden de la rotación (n mod 3): medio, abajo, arriba
const CENTROS = [3 / 6, 5 / 6, 1 / 6].map((f) => G0 + f * (G1 - G0));
const ARRIBA = CENTROS[2];

// ------------------------------------------------------------------------------------------------ tres caminos

test('hay tres caminos a 1/6, 3/6 y 5/6 del alto útil del suelo, con ±40 px de dispersión', () => {
  const l = DEFAULTS.movement.lanes;
  assert.equal(l.fractions.length, 3);
  assert.deepEqual([...l.fractions].sort(), [1 / 6, 3 / 6, 5 / 6]);
  assert.deepEqual(CENTROS.map(Math.round).sort(), [241, 448, 655]);
  assert.equal(l.halfWidth, 40);
  assert.throws(() => resolveConfig({ movement: { lanes: { fractions: [] } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { lanes: { fractions: [0.2, 1.2] } } }), ConfigError);
  assert.throws(() => resolveConfig({ movement: { lanes: { halfWidth: -1 } } }), ConfigError);
});

test('el camino rota con el número de salida (medio, abajo, arriba) y cada yg cae a ≤ 40 px del centro de su camino', () => {
  const w = mundo();
  const cuenta = [0, 0, 0];
  for (let n = 0; n < 300; n++) {
    const yg = targetHeight(w, n);
    const c = n % 3;
    assert.ok(Math.abs(yg - CENTROS[c]) <= 40 + 1e-9, `n = ${n}: yg ${yg} lejos del camino ${c} (${CENTROS[c]})`);
    cuenta[c]++;
  }
  assert.deepEqual(cuenta, [100, 100, 100]);
  // los centros dejan el suelo entero a salvo: nadie nace fuera de [138, 758]
  for (let n = 0; n < 300; n++) assert.ok(targetHeight(w, n) >= G0 && targetHeight(w, n) <= G1);
});

test('dentro de cada camino las unidades se dispersan (no es una fila india) y sin azar: mismo n, misma altura', () => {
  const a = mundo();
  const b = mundo();
  const porCamino = [new Set(), new Set(), new Set()];
  for (let n = 0; n < 150; n++) {
    assert.equal(targetHeight(a, n), targetHeight(b, n));
    porCamino[n % 3].add(Math.round(targetHeight(a, n)));
  }
  for (const [c, s] of porCamino.entries()) assert.ok(s.size >= 20, `camino ${c}: ${s.size} alturas distintas`);
  // ancho usado: cubre casi todo el ±40
  for (const [c, s] of porCamino.entries()) {
    const lo = Math.min(...s);
    const hi = Math.max(...s);
    assert.ok(hi - lo >= 70, `camino ${c}: dispersión ${hi - lo} px (se esperan ≈ 80)`);
  }
});

test('en la partida las oleadas salen en abanico y marchan por tres caminos (tres racimos de altura a mitad del mapa)', () => {
  const w = mundo();
  submitOrder(w, orden('soldado', 1, 90));
  const alturas = [];
  const visto = new Set();
  for (let i = 0; i < 30 * 40; i++) {
    stepWorld(w);
    for (const u of w.units) {
      if (visto.has(u.id) || u.x < 560) continue;
      visto.add(u.id);
      alturas.push(u.y);
    }
  }
  assert.ok(alturas.length >= 60, `cruzaron x = 560: ${alturas.length}`);
  for (const y of alturas) {
    const d = Math.min(...CENTROS.map((c) => Math.abs(y - c)));
    assert.ok(d <= 48, `una unidad cruzó x = 560 a y ${y.toFixed(0)}: a ${d.toFixed(0)} px del camino más cercano`);
  }
  const por = [0, 0, 0];
  for (const y of alturas) por[CENTROS.reduce((m, c, i) => (Math.abs(y - c) < Math.abs(y - CENTROS[m]) ? i : m), 0)]++;
  for (const n of por) assert.ok(n >= alturas.length / 3 - 4 && n <= alturas.length / 3 + 4, `reparto ${por}`);
});

// ------------------------------------------------------------------------------------------------ convergencia

test('convergencia: por su camino hasta el último ~24 % del ancho; ahí se cierra hacia el centro de la base enemiga', () => {
  for (const side of [0, 1]) {
    const w = mundo();
    const s = w.field.sides[side];
    const e = w.field.sides[1 - side];
    const u = unidad(w, { side, kind: 'tanque', x: s.door.x + s.dir * 300, y: ARRIBA, yg: ARRIBA, phase: 'march' });
    u.hp = u.maxHp = 1e9; // las torretas del centro no lo paran
    const largo = w.cfg.movement.converge.fraction * w.field.w;
    // x donde empieza a cerrarse: el largo del embudo más lo que apunta por delante
    const inicio = e.frontX - s.dir * (u.stats.halt + largo + w.cfg.movement.converge.lookahead);
    const cierre = (largo + w.cfg.movement.converge.lookahead) / w.field.w;
    assert.ok(cierre >= 0.2 && cierre <= 0.25, `el cierre abarca ${(cierre * 100).toFixed(1)} % del ancho`);
    let yAntes = null;
    let yPrev = u.y;
    for (let i = 0; i < 30 * 90; i++) {
      stepWorld(w);
      if ((u.x - inicio) * s.dir < -10) yAntes = u.y;
      // el cierre es monótono: nunca se aleja del centro
      assert.ok(Math.abs(u.y - e.door.y) <= Math.abs(yPrev - e.door.y) + 1e-6, `paso ${i}: se alejó del centro`);
      yPrev = u.y;
    }
    assert.ok(Math.abs(yAntes - ARRIBA) < 1, `antes de la zona de cierre conserva su camino (y ${yAntes})`);
    assert.ok(Math.abs(u.y - e.door.y) < 8, `termina en el centro de la base enemiga (y ${u.y}, centro ${e.door.y})`);
    assert.equal(u.tgtKind, 'base');
    assert.ok(Math.abs(e.frontX - u.x) <= u.stats.range, `a ${Math.abs(e.frontX - u.x)} px del frente`);
  }
});

test('los tres caminos terminan en el mismo punto: arriba, medio y abajo se juntan en el centro de la base', () => {
  const w = mundo();
  const us = CENTROS.map((c) => unidad(w, { side: 0, kind: 'tanque', x: 500, y: c, yg: c, phase: 'march' }));
  run(w, 30 * 60);
  for (const u of us) {
    assert.equal(u.tgtKind, 'base');
    assert.ok(Math.abs(u.y - 448) <= w.cfg.movement.assault.halfY, `y ${u.y} fuera de la zona de asalto`);
  }
  const ys = us.map((u) => u.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 2 * w.cfg.movement.assault.halfY);
});

test('ninguna unidad pasa de largo: con 120 por lado cerrando sobre el centro, nadie rebasa el frente enemigo', () => {
  const w = mundo();
  for (const team of [1, 2]) {
    submitOrder(w, orden('soldado', team, 80));
    submitOrder(w, orden('tanque', team, 20));
    submitOrder(w, orden('jeep', team, 20));
  }
  let rebase = 0;
  for (let i = 0; i < 30 * 100; i++) {
    stepWorld(w);
    for (const u of w.units) {
      const e = w.field.sides[1 - u.side];
      if ((u.x - e.frontX) * w.field.sides[u.side].dir > 0) rebase++;
    }
  }
  assert.equal(rebase, 0, `${rebase} unidad-pasos más allá del frente enemigo`);
});

// ------------------------------------------------------------------------------------------------ solo el centro

test('la zona de asalto es el tramo central del frente: ±halfY alrededor de la puerta', () => {
  const w = mundo();
  const door = w.field.sides[0].door;
  const h = w.cfg.movement.assault.halfY;
  assert.ok(h > 0 && h < 206, 'cabe entre el centro y las torretas laterales (206 px)');
  assert.equal(campo.inAssaultZone(door, h, door.y), true);
  assert.equal(campo.inAssaultZone(door, h, door.y + h), true);
  assert.equal(campo.inAssaultZone(door, h, door.y - h), true);
  assert.equal(campo.inAssaultZone(door, h, door.y + h + 1), false);
  assert.equal(campo.inAssaultZone(door, h, 242), false);
  assert.equal(campo.inAssaultZone(door, h, 655), false);
});

test('fuera del centro NO se ataca la base: a la altura de una torreta lateral, aun a tiro, no hay blanco y se va al centro', () => {
  for (const side of [0, 1]) {
    for (const y0 of [242, 655]) {
      const w = mundo();
      const e = w.field.sides[1 - side];
      const x0 = e.frontX - e.dir * 0 - w.field.sides[side].dir * 20; // a 20 px del frente enemigo
      const u = unidad(w, { side, kind: 'tanque', x: x0, y: y0, yg: y0, phase: 'march' });
      stepWorld(w);
      assert.equal(u.tgt, null, `side ${side}, y ${y0}: nadie le apunta a la base ni a la torreta lateral`);
      assert.equal(u.tgtKind, '');
      run(w, 30 * 6);
      assert.ok(Math.abs(u.y - 448) < Math.abs(y0 - 448), `y ${y0} → ${u.y}: tiene que ir hacia el centro`);
    }
  }
});

test('las torretas laterales no son blanco de nadie, ni de un pesado de alcance 117 a 20 px; la central sí', () => {
  const w = mundo();
  const e = w.field.sides[1];
  for (const y of [242, 655]) {
    const u = unidad(w, { side: 0, kind: 'pesado', x: e.frontX - 20, y, yg: y, phase: 'march', pinned: true });
    stepWorld(w);
    assert.equal(u.tgt, null, `y ${y}: sin blanco`);
  }
  const c = unidad(w, { side: 0, kind: 'pesado', x: e.frontX - 20, y: 448, yg: 448, phase: 'march', pinned: true });
  stepWorld(w);
  assert.equal(c.tgtKind, 'turret', 'en el centro la torreta central (más cerca que la base) es el blanco');
  assert.equal(c.tgt.k, 1);
});

test('las torretas laterales siguen disparando a quien les entra en rango y NO se eliminan', () => {
  const w = mundo();
  const e = w.field.sides[1];
  const u = unidad(w, { side: 0, kind: 'tanque', x: e.frontX - 40, y: 250, yg: 250, phase: 'march', pinned: true });
  u.hp = u.maxHp = 1e9;
  stepWorld(w);
  assert.equal(w.bases[1].turrets.length, 3);
  assert.equal(w.bases[1].turrets[0].tgt, u, 'la torreta de arriba le apunta');
  run(w, 60);
  assert.ok(u.hp < u.maxHp, 'y le pega');
  assert.ok(
    w.bases[1].turrets.every((t) => t.hp === t.maxHp && t.on),
    'ninguna torreta recibe daño de nadie (sin tiradores)',
  );
});

test('una unidad enemiga a la vista o al alcance sigue atacándose primero, también a la altura de un camino lateral', () => {
  const w = mundo();
  const a = unidad(w, { side: 0, kind: 'soldado', x: 700, y: ARRIBA, yg: ARRIBA, phase: 'march' });
  const b = unidad(w, { side: 1, kind: 'soldado', x: 730, y: ARRIBA, yg: ARRIBA, phase: 'march' });
  stepWorld(w);
  assert.equal(a.tgt, b);
  assert.equal(b.tgt, a);
});

test('la visión sigue igual: si ve un enemigo va hacia él y después retoma su camino', () => {
  const w = mundo();
  const nuestro = unidad(w, { side: 0, kind: 'tanque', x: 500, y: ARRIBA, yg: ARRIBA, phase: 'march' });
  const enemigo = unidad(w, { side: 1, kind: 'soldado', x: 560, y: ARRIBA + 150, yg: ARRIBA + 150, phase: 'march' });
  let vio = false;
  for (let i = 0; i < 400 && enemigo.alive; i++) {
    stepWorld(w);
    if (nuestro.seek === enemigo) vio = true;
  }
  assert.ok(vio && !enemigo.alive);
  const y1 = nuestro.y;
  run(w, 30 * 2);
  assert.equal(nuestro.seek, null);
  assert.ok(Math.abs(nuestro.y - ARRIBA) < Math.abs(y1 - ARRIBA) + 1e-6, 'vuelve hacia su camino');
});

// ------------------------------------------------------------------------------------------------ alcance y vida

test('el alcance de toda unidad de tierra es ×1,5 dos veces (v2.7 y v2.8): soldado 63, jeep 81, tanque 99, pesado 117; torretas 105', () => {
  const cfg = resolveConfig();
  assert.deepEqual(
    ['soldado', 'jeep', 'tanque', 'pesado'].map((k) => unitStats(cfg, k).range),
    [63, 81, 99, 117],
  );
  assert.equal(cfg.turret.range, 105);
  for (const [k, r] of Object.entries({ soldado: 28, jeep: 36, tanque: 44, pesado: 52 }))
    assert.equal(cfg.units[k].range, r * 2.25, k);
});

test('la visión sigue siendo mayor que el alcance en todos los tipos (200/240/240/260 contra 63/81/99/117)', () => {
  const cfg = resolveConfig();
  assert.deepEqual(cfg.movement.vision, {
    soldado: 200,
    francotirador: 230,
    jeep: 240,
    blindado: 240,
    tanque: 240,
    lanzacohetes: 280,
    pesado: 260,
    lobo: 240,
  });
  for (const k of ['soldado', 'jeep', 'tanque', 'pesado']) {
    const s = unitStats(cfg, k);
    assert.ok(s.vision > s.range * 2, `${k}: visión ${s.vision} contra alcance ${s.range}`);
    assert.equal(s.halt, s.range - 3, `${k}: se detiene a «alcance − 3»`);
  }
});

test('el pesado pierde un tercio de vida: 90 000 → 60 000 (bonoHP 1,5 → 1); el resto de los tipos no cambia', () => {
  const cfg = resolveConfig();
  assert.equal(cfg.units.pesado.bonoHP, 1);
  assert.equal(unitStats(cfg, 'pesado').hp, 60000);
  assert.ok(Math.abs(unitStats(cfg, 'pesado').hp / 90000 - 2 / 3) < 1e-9, '−33,3 %');
  assert.deepEqual(
    ['soldado', 'jeep', 'tanque'].map((k) => unitStats(cfg, k).hp),
    [60, 600, 7500],
  );
  // el daño del pesado no cambia
  assert.equal(unitStats(cfg, 'pesado').dps, 3000);
});

test('al llegar a la base sigue hasta «alcance − 3» del frente (no se frena al primer contacto) y desde ahí dispara', () => {
  for (const kind of ['soldado', 'jeep', 'tanque', 'pesado']) {
    const w = mundo();
    const e = w.field.sides[1];
    // sin torretas: con ellas en pie el blanco por alcance es la central (v2.8: 10 px delante de la cara) y se frena antes
    for (const t of w.bases[1].turrets) {
      t.on = false;
      t.hp = 0;
    }
    const u = unidad(w, { side: 0, kind, x: e.frontX - 250, y: 448, yg: 448, phase: 'march' });
    u.hp = u.maxHp = 1e9;
    run(w, 30 * 20);
    const d = e.frontX - u.x;
    assert.ok(Math.abs(d - u.stats.halt) < 1, `${kind}: a ${d.toFixed(1)} px del frente (alcance ${u.stats.range})`);
    assert.ok(u.tgt !== null, `${kind}: tiene blanco`);
  }
});

test('el frente enemigo es un tope: ni la presión de quienes llegan detrás saca a nadie más allá de él', () => {
  const w = mundo();
  const e = w.field.sides[1];
  // 60 tanques que llegan a la vez a un mismo punto: se empujan entre sí
  for (let i = 0; i < 60; i++) {
    const u = unidad(w, {
      side: 0,
      kind: 'tanque',
      x: e.frontX - 120 - (i % 6) * 10,
      y: 448 + (i % 5) * 3,
      yg: 448,
      phase: 'march',
    });
    u.hp = u.maxHp = 1e12;
  }
  for (let i = 0; i < 30 * 40; i++) {
    stepWorld(w);
    for (const u of w.units) assert.ok(u.x <= e.frontX + 1e-9, `paso ${i}: x ${u.x} más allá del frente ${e.frontX}`);
  }
});
