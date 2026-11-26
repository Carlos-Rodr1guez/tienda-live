import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, SIM_HZ } from '../public/js/sim/defaults.js';
import { submitOrder } from '../public/js/sim/queue.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';

// v2.8 (lote 5): balance de los tipos nuevos medido con escenarios de IGUAL VALOR en monedas. El modelo del juego es una
// escalera de tramos (a más monedas, más fuerte): un tipo gana a lo de abajo y pierde con lo de arriba. Los nuevos tienen que
// caber en esa escalera y ninguno puede aplastar a todo. Cada lado reparte su valor en 10 tandas (el mismo ritmo de donación).

const C = Object.fromEntries(Object.entries(DEFAULTS.units).map(([k, u]) => [k, u.c]));
const orden = (kind, team, count) => ({ kind, team, owner: `${kind}${team}`, count, unitValue: 0, source: 'gift' });

/** Duelo de `a` (lado 1) contra `b` (lado 2) con valor `V` cada uno: la fracción de su valor que le queda a cada lado. */
function duelo(a, b, V, seg = 240) {
  const w = createWorld({ hq: { hp: 1e12 }, limits: { maxAlivePerSide: 300 } }, { phase: 'sandbox' });
  const reparto = (n) => {
    if (n < 10) return [[0, n]];
    const t = [];
    let resto = n;
    for (let i = 0; i < 10; i++) {
      const c = Math.min(resto, i === 9 ? resto : Math.ceil(n / 10));
      t.push([i * 75, c]);
      resto -= c;
    }
    return t;
  };
  const plan = [
    [reparto(V / C[a]), a, 1],
    [reparto(V / C[b]), b, 2],
  ];
  for (let i = 0; i < seg * SIM_HZ; i++) {
    for (const [p, kind, team] of plan)
      for (const [t, c] of p) if (t === i && c > 0) submitOrder(w, orden(kind, team, c));
    stepWorld(w);
  }
  const resto = [0, 0];
  for (const u of w.units) if (u.alive) resto[u.side] += (u.stats.c * u.hp) / u.maxHp;
  return { a: resto[0] / V, b: resto[1] / V };
}

// [nuevo, rival, valor, gana el nuevo?] (medido: ver README, «Balance de los tipos nuevos»)
const ESCALERA = [
  ['francotirador', 'soldado', 200, true],
  ['francotirador', 'tanque', 1200, false],
  ['francotirador', 'pesado', 1000, true],
  ['blindado', 'soldado', 300, true],
  ['blindado', 'tanque', 1200, false],
  ['blindado', 'pesado', 3000, false],
  ['lanzacohetes', 'soldado', 300, true],
  ['lanzacohetes', 'tanque', 1200, true],
  ['lanzacohetes', 'pesado', 3000, false],
  ['lobo', 'tanque', 3000, true],
  ['lobo', 'pesado', 3000, true],
  ['lobo', 'jeep', 3000, false],
];
const resultados = new Map();
for (const [n, r, V] of ESCALERA) resultados.set(`${n}|${r}`, duelo(n, r, V));

test('escalera de tramos: cada tipo nuevo gana a lo de abajo y pierde con lo de arriba, del mismo valor', () => {
  for (const [n, r, , gana] of ESCALERA) {
    const d = resultados.get(`${n}|${r}`);
    if (gana)
      assert.ok(d.a > d.b && d.a > 0.05, `${n} contra ${r}: debería ganar (${d.a.toFixed(2)} vs ${d.b.toFixed(2)})`);
    else
      assert.ok(d.b > d.a && d.b > 0.05, `${n} contra ${r}: debería perder (${d.a.toFixed(2)} vs ${d.b.toFixed(2)})`);
  }
});

test('ningún tipo nuevo aplasta a todo: no gana con ≥ 60 % de su valor contra los tres rivales (soldado, tanque y pesado)', () => {
  for (const n of ['francotirador', 'blindado', 'lanzacohetes', 'lobo']) {
    const abrumadoras = ESCALERA.filter(([k, r]) => k === n && ['soldado', 'tanque', 'pesado'].includes(r)).filter(
      ([k, r]) => resultados.get(`${k}|${r}`).a >= 0.6,
    );
    assert.ok(abrumadoras.length < 3, `${n} aplasta a ${abrumadoras.map((x) => x[1])}`);
  }
});

test('el héroe lobo cuesta lo que vale: contra 30 tanques del mismo valor sale herido (≤ 50 % de su valor) y contra 300 jeeps pierde', () => {
  const t = resultados.get('lobo|tanque');
  assert.ok(t.a > 0 && t.a <= 0.5, `lobo contra tanques: ${t.a.toFixed(2)}`);
  assert.ok(t.b === 0, 'y los 30 tanques caen');
  assert.ok(resultados.get('lobo|jeep').b > 0, 'los jeeps le ganan');
});

// ---------------------------------------------------------------------------------------- muertes al salir de la puerta

const MEZCLA = [
  ['soldado', 113],
  ['francotirador', 20],
  ['jeep', 25],
  ['blindado', 15],
  ['tanque', 15],
  ['lanzacohetes', 6],
  ['pesado', 5],
  ['lobo', 1],
];

/** Fracción de las salidas (después de los 15 s) que mueren a los 2 s de salir. */
function muertesAlSalir(armar, seg, game = {}) {
  const w = createWorld({ hq: { hp: 1e12 }, ...game }, { phase: 'sandbox' });
  const nac = new Map();
  let salidas = 0;
  let muertes = 0;
  for (let i = 0; i < seg * SIM_HZ && w.over === null; i++) {
    armar(w, i);
    stepWorld(w);
    for (const e of w.drain()) {
      if (e.type === 'spawn' && w.step > 15 * SIM_HZ) {
        nac.set(e.id, w.step);
        salidas++;
      } else if (e.type === 'death' && nac.has(e.id) && w.step - nac.get(e.id) <= 2 * SIM_HZ) muertes++;
    }
  }
  return { salidas, muertes, frac: muertes / Math.max(1, salidas) };
}

test('salida de la puerta, simétrico 200 contra 200 con los tipos nuevos: nadie muere en los 2 s de salir (medido 0 %)', () => {
  const r = muertesAlSalir((w, i) => {
    if (i === 0) for (const t of [1, 2]) for (const [k, n] of MEZCLA) submitOrder(w, orden(k, t, n));
  }, 120);
  assert.ok(r.salidas > 100, `salidas medidas: ${r.salidas}`);
  assert.ok(r.frac <= 0.02, `${r.muertes} de ${r.salidas} mueren a los 2 s de salir`);
});

test('salida de la puerta, asedio S1 con tipos nuevos: el tiro desde lejos agrega poco al asedio (≤ 15 %; medido 10,8 % contra 9,7 % sin ellos)', () => {
  const mezcla = { soldado: 80, francotirador: 30, blindado: 10, tanque: 20, jeep: 10, lanzacohetes: 3, pesado: 4 };
  const r = muertesAlSalir((w, i) => {
    if (i % SIM_HZ !== 0 || i >= 120 * SIM_HZ) return;
    const s = i / SIM_HZ;
    for (const [k, n] of Object.entries(mezcla)) {
      const cada = Math.round(60 / n) || 1;
      if (s % cada !== 0) continue;
      submitOrder(w, orden(k, 1, 1));
      if ((s / cada) % 5 === 0) submitOrder(w, orden(k, 2, 1));
    }
  }, 160);
  assert.ok(r.salidas > 150, `salidas medidas: ${r.salidas}`);
  assert.ok(r.frac <= 0.15, `${r.muertes} de ${r.salidas} mueren a los 2 s de salir (${(r.frac * 100).toFixed(1)} %)`);
});

// ------------------------------------------------------------------------------------------------------------- costo

test('costo: con 400 unidades de la mezcla nueva el paso cuesta ≤ 1 ms en la mediana (medido 0,3 a 0,45; objetivo 0,5)', () => {
  const medianas = [];
  for (let rep = 0; rep < 3; rep++) {
    const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'sandbox' });
    for (const side of [0, 1]) {
      let k = 0;
      for (const [kind, cnt] of MEZCLA)
        for (let i = 0; i < cnt; i++, k++) {
          const y = 160 + (k % 20) * 30;
          const x = side === 0 ? 100 + Math.floor(k / 20) * 36 : 1340 - Math.floor(k / 20) * 36;
          seedUnits(w, { side, kind, x, y, yg: y, phase: 'march' });
        }
    }
    for (let i = 0; i < 30; i++) stepWorld(w);
    const cs = [];
    for (let i = 0; i < 100; i++) {
      const t0 = process.hrtime.bigint();
      stepWorld(w);
      cs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      assert.ok(w.units.length >= 380, `unidades vivas: ${w.units.length}`);
    }
    cs.sort((a, b) => a - b);
    medianas.push(cs[cs.length >> 1]);
  }
  assert.ok(Math.min(...medianas) <= 1, `medianas: ${medianas.map((m) => m.toFixed(3))} ms`);
});
