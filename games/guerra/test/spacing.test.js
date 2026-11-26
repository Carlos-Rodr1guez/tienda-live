import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, seedUnits, snapshotAndGrid, stepWorld } from '../public/js/sim/world.js';
import { GROUND_KINDS, DT } from '../public/js/sim/defaults.js';
import { frac } from '../public/js/sim/units.js';

// CB-22 (R8): los amigos nunca se bloquean pero guardan una separación blanda por tipo que NUNCA frena el avance.

const INMORTAL = { hq: { hp: 1e12 }, limits: { maxAlivePerSide: 300 } };
const mundo = (game = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox' });
const unidad = (w, p) => seedUnits(w, { count: 1, ...p }).units[0];
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};

test('los espaciados por tipo (9, 20, 28 y 38 los de siempre, más los nuevos) salen de la config', () => {
  const w = mundo();
  const esperado = {
    soldado: 9,
    francotirador: 12,
    jeep: 20,
    blindado: 24,
    tanque: 28,
    lanzacohetes: 32,
    pesado: 38,
    lobo: 28,
  };
  for (const k of GROUND_KINDS) {
    assert.equal(w.cfg.movement.spacing[k], esperado[k]);
    assert.equal(w.stats[k].spacing, esperado[k]);
  }
  assert.equal(w.cfg.movement.sepGain, 6);
  assert.equal(w.cfg.movement.sepMaxLateral, 0.6);
  assert.equal(w.cfg.movement.sepMaxFiring, 0.4);
  assert.equal(w.cfg.movement.enemySpacing, 0);
});

test('dos unidades superpuestas se abren; no se bloquean (se pueden atravesar)', () => {
  const w = mundo();
  const a = unidad(w, { side: 0, kind: 'soldado', x: 300, y: 400, yg: 400, phase: 'march' });
  const b = unidad(w, { side: 0, kind: 'soldado', x: 300, y: 400, yg: 400, phase: 'march' });
  const d0 = Math.hypot(a.x - b.x, a.y - b.y);
  assert.equal(d0, 0);
  run(w, 90);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d >= 0.9 * w.stats.soldado.spacing, `quedaron a ${d} px, el espaciado es 9`);
});

test('el par mezcla usa el promedio de los dos espaciados', () => {
  // soldado (9) y tanque (28): promedio 18,5. A 15 px se empujan; a 19 px no.
  const prueba = (dist) => {
    const w = mundo();
    const s = unidad(w, { side: 0, kind: 'soldado', x: 300, y: 400, yg: 400, phase: 'march' });
    unidad(w, { side: 0, kind: 'tanque', x: 300, y: 400 + dist, yg: 400 + dist, phase: 'march' });
    stepWorld(w);
    return { empujado: s.wx !== s.dvx || s.wy !== s.dvy };
  };
  assert.equal(prueba(15).empujado, true);
  assert.equal(prueba(19).empujado, false);
});

test('los enemigos no se separan (enemySpacing 0): dos enemigos encimados no se empujan', () => {
  const w = mundo();
  const a = unidad(w, { side: 0, kind: 'soldado', x: 700, y: 400, yg: 400, phase: 'march' });
  const b = unidad(w, { side: 1, kind: 'soldado', x: 702, y: 400, yg: 400, phase: 'march' });
  stepWorld(w);
  for (const u of [a, b]) {
    assert.equal(u.wx, u.dvx);
    assert.equal(u.wy, u.dvy);
  }
});

/** Una oleada densa de 200 unidades mezcladas, apretadas en un cuadro de 60×60, de un solo lado. */
function oleada() {
  const w = mundo();
  const tipos = ['soldado', 'soldado', 'soldado', 'jeep', 'tanque', 'soldado', 'pesado', 'soldado'];
  for (let i = 0; i < 200; i++) {
    const x = 160 + frac(i, 0.754877666) * 60;
    const y = 300 + frac(i, 0.56984029) * 120;
    unidad(w, { side: 0, kind: tipos[i % tipos.length], x, y, yg: 160 + frac(i, 0.618034) * 580, phase: 'march' });
  }
  return w;
}

test('la separación NUNCA frena: la velocidad deseada a lo largo del rumbo es ≥ la que se quería en el 100 % de los pasos', () => {
  const w = oleada();
  let medidas = 0;
  let empujadas = 0;
  for (let i = 0; i < 240; i++) {
    stepWorld(w);
    for (const u of w.units) {
      if (u.tgt !== null || u.seek !== null) continue;
      const m = Math.hypot(u.dvx, u.dvy);
      if (m < 1e-9) continue;
      const hx = u.dvx / m;
      const hy = u.dvy / m;
      const adelante = u.wx * hx + u.wy * hy;
      assert.ok(adelante >= m - 1e-9, `paso ${i}, unidad ${u.id}: adelante ${adelante} < deseada ${m}`);
      medidas++;
      if (u.wx !== u.dvx || u.wy !== u.dvy) empujadas++;
    }
  }
  assert.ok(medidas > 5000, `solo ${medidas} medidas`);
  assert.ok(empujadas > 200, `la separación tiene que actuar (${empujadas} empujes)`);
});

test('el empuje lateral no pasa de 0,6·vmax', () => {
  const w = oleada();
  let max = 0;
  for (let i = 0; i < 240; i++) {
    stepWorld(w);
    for (const u of w.units) {
      if (u.tgt !== null || u.seek !== null) continue;
      const m = Math.hypot(u.dvx, u.dvy);
      if (m < 1e-9) continue;
      const hx = u.dvx / m;
      const hy = u.dvy / m;
      const adelante = u.wx * hx + u.wy * hy;
      const lx = u.wx - adelante * hx;
      const ly = u.wy - adelante * hy;
      const lat = Math.hypot(lx, ly);
      max = Math.max(max, lat / u.stats.speed);
      assert.ok(lat <= 0.6 * u.stats.speed + 1e-9, `lateral ${lat / u.stats.speed}·vmax`);
    }
  }
  assert.ok(max > 0.05, 'hubo empuje lateral');
});

test('los del mismo tipo quedan a ≥ 0,9× el espaciado en la mediana una vez abiertos', () => {
  const w = oleada();
  run(w, 240);
  const vistos = [];
  for (const a of w.units) {
    let cerca = Infinity;
    for (const b of w.units) {
      if (a === b || a.kind !== b.kind) continue;
      cerca = Math.min(cerca, Math.hypot(a.x - b.x, a.y - b.y));
    }
    if (cerca < Infinity) vistos.push(cerca / a.stats.spacing);
  }
  vistos.sort((p, q) => p - q);
  const p50 = vistos[Math.floor(vistos.length / 2)];
  assert.ok(p50 >= 0.9, `mediana ${p50}`);
});

test('quien dispara se desliza como mucho sepMaxFiring·vmax y solo mientras siga a ≤ alcance − 2 de su blanco', () => {
  const w = mundo();
  const e = w.field.sides[1];
  for (const t of w.bases[1].turrets) {
    t.on = false; // sin torretas: el blanco por alcance es el hangar
    t.hp = 0;
  }
  const x = e.frontX - 20; // dentro del alcance del hangar (63)
  const a = unidad(w, { side: 0, kind: 'soldado', x, y: 400, yg: 400, phase: 'march' });
  const b = unidad(w, { side: 0, kind: 'soldado', x, y: 401, yg: 401, phase: 'march' });
  stepWorld(w);
  assert.equal(a.tgtKind, 'base');
  assert.ok(Math.hypot(a.wx, a.wy) > 0, 'el que dispara también se separa');
  assert.ok(Math.hypot(a.wx, a.wy) <= w.cfg.movement.sepMaxFiring * a.stats.speed + 1e-9);
  assert.ok(Math.hypot(b.wx, b.wy) <= w.cfg.movement.sepMaxFiring * b.stats.speed + 1e-9);
  // fuera de «alcance − 2» del blanco (a 62 de 63) la separación no mueve a quien dispara
  const w2 = mundo();
  const c = unidad(w2, { side: 0, kind: 'soldado', x: 700, y: 400, yg: 400, phase: 'march' });
  unidad(w2, { side: 0, kind: 'soldado', x: 700, y: 401, yg: 401, phase: 'march' });
  const enemigo = unidad(w2, { side: 1, kind: 'soldado', x: 762, y: 400, yg: 400, phase: 'march', pinned: true });
  enemigo.hp = enemigo.maxHp = 1e9;
  stepWorld(w2);
  assert.equal(c.tgt, enemigo);
  assert.equal(c.wx, 0);
  assert.equal(c.wy, 0);
});

test('con unidades encimadas exactamente el desempate es por id: determinista y no se quedan pegadas', () => {
  const w = mundo();
  const us = [];
  for (let i = 0; i < 6; i++) us.push(unidad(w, { side: 0, kind: 'soldado', x: 400, y: 400, yg: 400, phase: 'march' }));
  run(w, 120);
  for (let i = 0; i < us.length; i++) {
    for (let j = i + 1; j < us.length; j++) {
      assert.ok(Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y) > 3, `${i} y ${j} siguen pegadas`);
    }
  }
});

test('la separación usa las posiciones del inicio del paso: el orden de las unidades no cambia el resultado', () => {
  const crear = (invertir) => {
    const w = mundo();
    const lista = [];
    for (let i = 0; i < 30; i++) lista.push({ x: 300 + (i % 6) * 5, y: 300 + Math.floor(i / 6) * 5 });
    if (invertir) lista.reverse();
    const us = lista.map((p) => unidad(w, { side: 0, kind: 'soldado', x: p.x, y: p.y, yg: 400, phase: 'march' }));
    snapshotAndGrid(w);
    return { w, us, lista };
  };
  const a = crear(false);
  const b = crear(true);
  stepWorld(a.w);
  stepWorld(b.w);
  // la misma unidad (misma posición inicial) termina en el mismo lugar sin importar su orden en la lista
  const clave = (p) => `${p.x},${p.y}`;
  const mapa = new Map(a.lista.map((p, i) => [clave(p), a.us[i]]));
  for (let i = 0; i < b.us.length; i++) {
    const ua = mapa.get(clave(b.lista[i]));
    assert.ok(Math.abs(ua.vx - b.us[i].vx) < 1e-9 && Math.abs(ua.vy - b.us[i].vy) < 1e-9, `unidad ${i}`);
  }
  assert.ok(DT > 0);
});
