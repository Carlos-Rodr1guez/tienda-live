import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld } from '../public/js/sim/world.js';
import { submitOrder } from '../public/js/sim/queue.js';
import { DT, SIM_HZ } from '../public/js/sim/defaults.js';

// CB-22: nadie queda quieto fuera de combate, nadie cruza a un enemigo sin verlo, la separación es blanda y todos
// llegan a la base enemiga. Corrida de 120 s con 40 tanques + 40 soldados + 8 jeeps por lado (la «inundación» con la
// que se midió que antes quedaban quietas entre el 78 % y el 88 %).

const orden = (kind, team, count) => ({ kind, team, owner: `${kind}${team}`, count, unitValue: 0, source: 'gift' });

function corrida(game = {}) {
  const w = createWorld({ hq: { hp: 1e12 }, ...game }, { phase: 'sandbox' });
  for (const team of [1, 2]) {
    submitOrder(w, orden('tanque', team, 40));
    submitOrder(w, orden('soldado', team, 40));
    submitOrder(w, orden('jeep', team, 8));
  }
  const m = {
    unidadPasos: 0,
    quietas: 0,
    cruzan: new Set(),
    vistas: new Set(),
    solapes: [],
    cambios: 0,
    violaciones: [],
    giros: 0,
    a60: null,
    pasoMs: 0,
  };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 120 * SIM_HZ; i++) {
    const antes = new Map(w.units.map((u) => [u.id, { seek: u.seek, dir: u.dir }]));
    stepWorld(w);
    zigzag(w, antes, m);
    for (const u of w.units) m.vistas.add(u.id);
    if (w.step > 15 * SIM_HZ) medir(w, m);
    if (w.step === 60 * SIM_HZ) m.a60 = w.units.map((u) => ({ u, alive: u.alive, x: u.x, tgt: u.tgt, seek: u.seek }));
  }
  m.pasoMs = Number(process.hrtime.bigint() - t0) / 1e6 / (120 * SIM_HZ);
  return { w, m };
}

/** Cambios de blanco de visión: solo valen por la regla de 0,75; y los giros de cara, a lo sumo uno por 0,3 s. */
function zigzag(w, antes, m) {
  for (const u of w.units) {
    const a = antes.get(u.id);
    if (!a) continue;
    if (a.dir !== u.dir) {
      m.giros++;
      u.lastTurn ??= -1e9;
      if (w.step - u.lastTurn < 9) m.violaciones.push(`unidad ${u.id}: dos giros en ${w.step - u.lastTurn} pasos`);
      u.lastTurn = w.step;
    }
    const s = a.seek;
    if (s === null || !s.alive || u.seek === null || u.seek === s) continue;
    m.cambios++;
    const dN = Math.hypot(u.seek.x - u.x, u.seek.y - u.y);
    const dA = Math.hypot(s.x - u.x, s.y - u.y);
    const tol = 4 * (u.stats.speed + s.stats.speed) * DT;
    if (dA <= w.cfg.movement.stickyKeep * u.stats.vision && dN > w.cfg.movement.stickySwitch * dA + tol) {
      m.violaciones.push(`paso ${w.step}: unidad ${u.id} cambió de ${dA.toFixed(1)} a ${dN.toFixed(1)}`);
    }
  }
}

function medir(w, m) {
  for (const u of w.units) {
    m.unidadPasos++;
    const v2 = u.vx * u.vx + u.vy * u.vy;
    if (v2 < 1 && u.tgt === null) m.quietas++;
    // cruce lateral sin blanco: un enemigo a < 8 px en x y entre 29 y 80 px de costado, sin blanco ni visión
    if (u.tgt === null && u.seek === null) {
      for (const o of w.units) {
        if (o.side === u.side) continue;
        const dy = Math.abs(o.y - u.y);
        if (Math.abs(o.x - u.x) < 8 && dy >= 29 && dy <= 80) {
          m.cruzan.add(u.id);
          break;
        }
      }
    }
    // solape: la peor penetración relativa al espaciado del par, con un amigo
    let peor = 0;
    for (const o of w.units) {
      if (o === u || o.side !== u.side) continue;
      const sp = (u.stats.spacing + o.stats.spacing) / 2;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d < sp) peor = Math.max(peor, 1 - d / sp);
    }
    m.solapes.push(peor);
  }
}

const R = corrida();

test('inundación de 120 s: quietas fuera de combate ≤ 3 % de las unidad-pasos después de 15 s', () => {
  const f = R.m.quietas / R.m.unidadPasos;
  assert.ok(R.m.unidadPasos > 50000, `unidad-pasos medidos: ${R.m.unidadPasos}`);
  assert.ok(f <= 0.03, `quietas fuera de combate: ${(f * 100).toFixed(2)} %`);
});

test('inundación de 120 s: los cruces laterales a ≤ 80 px sin blanco son ≤ 2 % de las unidades', () => {
  const f = R.m.cruzan.size / R.m.vistas.size;
  assert.ok(
    f <= 0.02,
    `${R.m.cruzan.size} de ${R.m.vistas.size} unidades cruzaron sin blanco (${(f * 100).toFixed(2)} %)`,
  );
});

test('inundación de 120 s: solape medio ≤ 10 % y p95 ≤ 40 % del espaciado', () => {
  const s = [...R.m.solapes].sort((a, b) => a - b);
  const media = s.reduce((a, b) => a + b, 0) / s.length;
  const p95 = s[Math.floor(s.length * 0.95)];
  assert.ok(media <= 0.1, `solape medio ${(media * 100).toFixed(2)} %`);
  assert.ok(p95 <= 0.4, `solape p95 ${(p95 * 100).toFixed(2)} %`);
});

test('sin zigzag: ningún blanco de visión cambia sin la regla de 0,75 y la cara no gira más de una vez por 0,3 s', () => {
  assert.ok(R.m.cambios > 4, `la prueba tiene que ver cambios de blanco (${R.m.cambios})`); // v2.7: ~12 (tres caminos: menos cruces); v2.8: ~8 (más alcance, se pelea antes de cruzarse)
  // v2.7: con los tres caminos todos avanzan hacia la base enemiga y casi nadie se da vuelta (0 giros medidos aquí); el giro
  // con histéresis lo ejercita march.test.js («la orientación gira con histéresis») con enemigos que cruzan de lado a lado
  assert.deepEqual(R.m.violaciones.slice(0, 5), []);
});

test('a los 60 s toda unidad viva está a ≤ 1100 px de la base enemiga o peleando', () => {
  assert.ok(R.m.a60.length > 0);
  for (const f of R.m.a60) {
    if (!f.alive) continue;
    const frente = R.w.field.sides[1 - f.u.side].frontX;
    const peleando = f.tgt !== null || f.seek !== null;
    assert.ok(Math.abs(frente - f.x) <= 1100 || peleando, `unidad ${f.u.id} (${f.u.kind}) en x ${f.x}`);
  }
});

test('los tanques se reparten en al menos 8 alturas distintas (sin fila india)', () => {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
  submitOrder(w, orden('tanque', 1, 40));
  for (let i = 0; i < 30 * 40; i++) stepWorld(w);
  const alturas = new Set(w.units.filter((u) => u.side === 0).map((u) => Math.round(u.yg / 40)));
  assert.ok(alturas.size >= 8, `${alturas.size} alturas`);
});

// Escenario simétrico de `?carga`: 200 por lado con 150 soldados, 30 jeeps, 15 tanques y 5 pesados. La salida por la
// ranura libre del tipo (D30) abre a los tanques y pesados YA en la puerta; antes salían encimados y recién se abrían
// durante el tramo `leg` (solape p95 en leg: tanques 63 %, pesados 73 %; global 42 %).

const MEZCLA = [
  ['soldado', 150],
  ['jeep', 30],
  ['tanque', 15],
  ['pesado', 5],
];

/** Solape de `u` con sus amigos (grilla propia; el radio cubre que las celdas son del inicio del paso). */
let peorVecino = 0;
let uActual = null;
const visitar = (o) => {
  if (o === uActual || !o.alive) return;
  const sp = (uActual.stats.spacing + o.stats.spacing) / 2;
  const d = Math.hypot(o.x - uActual.x, o.y - uActual.y);
  if (d < sp) peorVecino = Math.max(peorVecino, 1 - d / sp);
};

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

function corridaSimetrica() {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
  for (const team of [1, 2]) for (const [k, n] of MEZCLA) submitOrder(w, orden(k, team, n));
  const m = { unidadPasos: 0, quietas: 0, trabadas: 0, cruzan: new Set(), nSalidas: [] };
  const racha = new Map(); // pasos seguidos quieta fuera de combate: un giro que cruza v = 0 un solo paso no es estar trabada
  for (let i = 0; i < 120 * SIM_HZ; i++) {
    stepWorld(w);
    for (const e of w.drain()) if (e.type === 'spawn') m.nSalidas.push({ kind: e.kind, side: e.side, paso: w.step });
    if (w.step <= 15 * SIM_HZ) continue;
    for (const u of w.units) {
      m.unidadPasos++;
      if (u.vx * u.vx + u.vy * u.vy < 1 && u.tgt === null) {
        m.quietas++;
        const r = (racha.get(u.id) ?? 0) + 1;
        racha.set(u.id, r);
        if (r === 3) m.trabadas++;
      } else racha.delete(u.id);
      if (u.tgt === null && u.seek === null) {
        for (const o of w.units) {
          if (o.side === u.side) continue;
          const dy = Math.abs(o.y - u.y);
          if (Math.abs(o.x - u.x) < 8 && dy >= 29 && dy <= 80) {
            m.cruzan.add(u.id);
            break;
          }
        }
      }
    }
  }
  return { w, m };
}

/** Solape por tipo y por fase durante todo el reparto (desde el paso 1: la salida es lo que se mide). */
function solapes() {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
  for (const team of [1, 2]) for (const [k, n] of MEZCLA) submitOrder(w, orden(k, team, n));
  const g = [];
  const porTipo = { soldado: [], jeep: [], tanque: [], pesado: [] };
  const porFase = { leg: [], march: [], combate: [] };
  const legTipo = { soldado: [], jeep: [], tanque: [], pesado: [] };
  for (let i = 0; i < 120 * SIM_HZ; i++) {
    stepWorld(w);
    for (const u of w.units) {
      uActual = u;
      peorVecino = 0;
      w.grids[u.side].forEachInRadius(u.x, u.y, 42, visitar);
      g.push(peorVecino);
      porTipo[u.kind].push(peorVecino);
      const fase = u.tgt !== null ? 'combate' : u.phase;
      porFase[fase].push(peorVecino);
      if (fase === 'leg') legTipo[u.kind].push(peorVecino);
    }
  }
  return { w, g, porTipo, porFase, legTipo };
}

const S = solapes();

test('escenario simétrico de 200 por lado: solape p95 global ≤ 40 %', () => {
  assert.ok(S.g.length > 100000, `muestras: ${S.g.length}`);
  assert.ok(pct(S.g, 0.95) <= 0.4, `solape p95 global ${(pct(S.g, 0.95) * 100).toFixed(1)} %`);
});

test('escenario simétrico: el solape p95 de los tanques en leg ≤ 40 % (y el de los pesados en leg también)', () => {
  assert.ok(S.legTipo.tanque.length > 500, `muestras de tanques en leg: ${S.legTipo.tanque.length}`);
  assert.ok(
    pct(S.legTipo.tanque, 0.95) <= 0.4,
    `tanques en leg p95 ${(pct(S.legTipo.tanque, 0.95) * 100).toFixed(1)} %`,
  );
  assert.ok(
    pct(S.legTipo.pesado, 0.95) <= 0.4,
    `pesados en leg p95 ${(pct(S.legTipo.pesado, 0.95) * 100).toFixed(1)} %`,
  );
});

test('escenario simétrico: el solape p95 por tipo ≤ 40 %', () => {
  for (const k of Object.keys(S.porTipo))
    assert.ok(pct(S.porTipo[k], 0.95) <= 0.4, `${k} p95 ${(pct(S.porTipo[k], 0.95) * 100).toFixed(1)} %`);
});

test('escenario simétrico: nadie trabado fuera de combate (quietas < 0,01 %), 0 cruces laterales sin blanco', () => {
  const R2 = corridaSimetrica();
  assert.equal(R2.m.trabadas, 0, `${R2.m.trabadas} unidades quietas 3 pasos seguidos fuera de combate`);
  assert.ok(R2.m.quietas / R2.m.unidadPasos < 1e-4, `quietas fuera de combate: ${R2.m.quietas} de ${R2.m.unidadPasos}`);
  assert.equal(R2.m.cruzan.size, 0, `${R2.m.cruzan.size} cruces laterales sin blanco`);
  // nadie trabado en la cola: salieron los 200 de cada lado (el tope de vivos no se alcanza antes de que lleguen)
  const porLado = [0, 0];
  for (const s of R2.m.nSalidas) porLado[s.side]++;
  assert.ok(porLado[0] >= 200 && porLado[1] >= 200, `salidas por lado: ${porLado}`);
});

test('costo: el paso promedio de la inundación cabe en el presupuesto (≤ 2 ms)', () => {
  assert.ok(R.m.pasoMs <= 2, `${R.m.pasoMs.toFixed(3)} ms por paso`);
});

// ------------------------------------------------------------------------------------------------ v2.7: asedio

/** Solape de `u` con sus amigos (para medir la zona de asalto). */
function solapeDe(w, u) {
  uActual = u;
  peorVecino = 0;
  w.grids[u.side].forEachInRadius(u.x, u.y, 42, visitar);
  return peorVecino;
}

/** ¿Está `u` a ≤ 150 px del punto central del frente enemigo (la zona donde converge todo el mundo)? */
const enZonaDeAsalto = (w, u) => {
  const e = w.field.sides[1 - u.side];
  return Math.hypot(e.frontX - u.x, e.door.y - u.y) <= 150;
};

// Escenario asimétrico S1 (el asedio): el equipo 1 manda 120 soldados, 30 tanques, 10 jeeps y 5 pesados en 60 s y sigue
// alimentando la cola al mismo ritmo hasta los 120 s; el equipo 2 a un 20 %. Antes de v2.7 la base de 2 caía a los 136,7 s.
function asedio() {
  const w = createWorld({}, { phase: 'sandbox' });
  const mezcla = { soldado: 120, tanque: 30, jeep: 10, pesado: 5 };
  const zona = [];
  const racha = new Map();
  const m = { trabadas: 0, rebasan: 0 };
  for (let i = 0; i < 400 * SIM_HZ && w.over === null; i++) {
    if (i % SIM_HZ === 0 && i < 120 * SIM_HZ) {
      const s = i / SIM_HZ;
      for (const [k, n] of Object.entries(mezcla)) {
        const cada = Math.round(60 / n);
        if (s % cada !== 0) continue;
        submitOrder(w, orden(k, 1, 1));
        if ((s / cada) % 5 === 0) submitOrder(w, orden(k, 2, 1));
      }
    }
    stepWorld(w);
    for (const u of w.units) {
      if (enZonaDeAsalto(w, u)) zona.push(solapeDe(w, u));
      if ((u.x - w.field.sides[1 - u.side].frontX) * w.field.sides[u.side].dir > 0) m.rebasan++;
      if (w.step > 15 * SIM_HZ && u.vx * u.vx + u.vy * u.vy < 1 && u.tgt === null) {
        const r = (racha.get(u.id) ?? 0) + 1;
        racha.set(u.id, r);
        if (r === 3) m.trabadas++;
      } else racha.delete(u.id);
    }
  }
  return { w, zona, m };
}

test('asedio S1: la base cae, nadie queda quieto 3 pasos fuera de combate y nadie pasa de largo del frente', () => {
  const A = asedio();
  assert.ok(A.w.over !== null && A.w.over.winner === 0, 'la base del equipo 2 cae');
  assert.equal(A.w.bases[1].hp, 0);
  const seg = A.w.over.step / SIM_HZ;
  assert.ok(seg > 100 && seg < 160, `la ronda duró ${seg.toFixed(1)} s (antes 136,7 s)`);
  assert.equal(A.m.trabadas, 0, `${A.m.trabadas} unidades quietas 3 pasos seguidos fuera de combate`);
  assert.equal(A.m.rebasan, 0, 'ninguna pasada de largo');
});

test('asedio S1: la zona de asalto es un frente, no una pila (solape mediano ≤ 50 %, p95 ≤ 80 %; medido 40 % y 66 %)', () => {
  const A = asedio();
  assert.ok(A.zona.length > 50000, `muestras en la zona: ${A.zona.length}`);
  assert.ok(pct(A.zona, 0.5) <= 0.5, `solape mediano de la zona ${(pct(A.zona, 0.5) * 100).toFixed(1)} %`);
  assert.ok(pct(A.zona, 0.95) <= 0.8, `solape p95 de la zona ${(pct(A.zona, 0.95) * 100).toFixed(1)} %`);
});

test('escenario simétrico de 200 por lado: el solape p95 de la zona de asalto también se mide (≤ 60 %; medido 43 %)', () => {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
  for (const team of [1, 2]) for (const [k, n] of MEZCLA) submitOrder(w, orden(k, team, n));
  const zona = [];
  for (let i = 0; i < 120 * SIM_HZ; i++) {
    stepWorld(w);
    for (const u of w.units) if (enZonaDeAsalto(w, u)) zona.push(solapeDe(w, u));
  }
  assert.ok(zona.length > 500, `muestras en la zona: ${zona.length}`);
  assert.ok(pct(zona, 0.95) <= 0.6, `solape p95 de la zona ${(pct(zona, 0.95) * 100).toFixed(1)} %`);
});
