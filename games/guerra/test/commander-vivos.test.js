import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import * as C from '../public/js/sim/commander.js';

// Enmienda v2.5 (CB-21, H26.3): el comandante pesa cada grupo por sus soldados vivos, en enteros (L-avos).
// L = mcm de los tamaños de grupo (20 por defecto); `wL` y `cL` son el peso y la cuenta de un grupo en L-avos.

const mundo = (game = {}) => createWorld({ hq: { hp: 1e12 }, ...game }, { phase: 'sandbox' });
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
const grupo = (kind, vivos) => ({ kind, members: new Array(vivos).fill(0) });
/** Un grupo enemigo quieto con `n` miembros en (x, y). */
function enemigo(w, side, kind, x, y, n) {
  const sq = seedSquad(w, { side, kind, count: n, x, y, state: 'holding' }).squad;
  sq.postPos = { x, y };
  for (const u of sq.members) {
    u.cd = 1e9;
    u.hp = u.maxHp = 1e9;
  }
  return sq;
}
/** Grupo de ATAQUE propio, quieto, lejos de la puerta. */
const ataque = (w, kind, x, corridor, lane, n) =>
  seedSquad(w, { side: 0, kind, count: n, corridor, lane, x, pinned: false }).squad;

test('scaleL: mcm de los tamaños (20 por defecto) y se recalcula con otra config', () => {
  const w = mundo();
  assert.equal(C.scaleL(w.cfg), 20);
  const w2 = mundo({ squads: { size: { soldado: 6, jeep: 4, tanque: 3, pesado: 1 } } });
  assert.equal(C.scaleL(w2.cfg), 12);
});

test('(a) un grupo lleno pesa lo mismo que antes: peso × L', () => {
  const w = mundo();
  const L = C.scaleL(w.cfg);
  for (const [kind, n, peso] of [
    ['soldado', 10, 1],
    ['jeep', 4, 1],
    ['tanque', 2, 2],
    ['pesado', 1, 2],
  ]) {
    assert.equal(C.wL(w.cfg, grupo(kind, n)), peso * L, kind);
    assert.equal(C.cL(w.cfg, grupo(kind, n)), L, kind);
  }
});

test('(b) un grupo con 3 de 10 vivos pesa 3/10 de uno lleno; un tanque con 1 de 2, la mitad', () => {
  const w = mundo();
  const L = C.scaleL(w.cfg);
  assert.equal(C.wL(w.cfg, grupo('soldado', 3)) * 10, 3 * C.wL(w.cfg, grupo('soldado', 10)));
  assert.equal(C.wL(w.cfg, grupo('soldado', 3)), 6);
  assert.equal(C.cL(w.cfg, grupo('soldado', 3)), 6);
  assert.equal(C.wL(w.cfg, grupo('tanque', 1)), L);
  assert.equal(C.cL(w.cfg, grupo('tanque', 1)), L / 2);
  assert.equal(C.wL(w.cfg, grupo('jeep', 1)), L / 4);
});

test('H y Z se cuentan en L-avos por soldados vivos y el HUD los muestra en unidades humanas', () => {
  const w = mundo();
  enemigo(w, 1, 'soldado', 300, 448, 5); // media banda en la zona de defensa propia
  enemigo(w, 1, 'tanque', 320, 448, 2);
  assert.deepEqual(C.pressure(w, 0), { H: 10 + 40, Z: 10 + 40 });
  run(w, 1);
  assert.equal(w.cmd[0].H, 50);
  assert.equal(w.cmd[0].hud.H, 2.5);
  assert.equal(w.cmd[0].hud.Z, 2.5);
  assert.equal(w.cmd[0].q, C.quotaQuarters(50, 50, 0, 20));
  assert.equal(w.cmd[0].hud.q, w.cmd[0].q / (4 * 20));
});

test('quotaQuarters en L-avos: el tope min(4L, ·) y el recorte a [0, 340L]', () => {
  assert.equal(C.quotaQuarters(0, 0, 0, 20), 60 * 20);
  assert.equal(C.quotaQuarters(80, 80, 0, 20), 60 * 20 + 15 * 80 + 30 * 80, 'H = Z = 4L: llega al tope');
  assert.equal(C.quotaQuarters(81, 999, 0, 20), C.quotaQuarters(80, 80, 0, 20), 'más allá de 4L no suma');
  assert.equal(C.quotaQuarters(0, 0, 100, 20), 340 * 20, 'recorte superior');
  assert.equal(C.quotaQuarters(0, 0, -100, 20), 0, 'recorte inferior');
});

test('(c) empate exacto de corredores: 10 + 10 contra 20 desempata medio > arriba > abajo', () => {
  const w = mundo();
  enemigo(w, 1, 'pesado', 900, 448, 1); // medio: 40, no entra al empate
  enemigo(w, 1, 'soldado', 900, 242, 5); // arriba: 10
  enemigo(w, 1, 'jeep', 900, 242, 2); // arriba: +10 = 20
  enemigo(w, 1, 'soldado', 900, 654, 10); // abajo: 20
  assert.deepEqual(C.corridorOrder(w, 0), [0, 2, 1]);
  // con un soldado menos abajo, abajo gana por 1/10 de grupo
  const w2 = mundo();
  enemigo(w2, 1, 'pesado', 900, 448, 1);
  enemigo(w2, 1, 'soldado', 900, 242, 5);
  enemigo(w2, 1, 'jeep', 900, 242, 2);
  enemigo(w2, 1, 'soldado', 900, 654, 9);
  assert.deepEqual(C.corridorOrder(w2, 0), [2, 0, 1]);
});

test('(d) roleFor: el grupo nuevo cuenta +L aunque aún no tenga miembros', () => {
  const L = 20;
  // sin grupos propios y con la cuota máxima: 400·L·(0 + L) > 340L·(0 + L), o sea ATAQUE (con +0 sería DEFENSA)
  assert.equal(C.roleFor({ kind: 'soldado', S: 0, D: 0, q: 340 * L, postReachable: true, L }), 'ataque');
  // límite exacto: S = 30 (tres grupos a medias), D = 0: defensa si q ≥ 160·L
  assert.equal(C.roleFor({ kind: 'soldado', S: 30, D: 0, q: 160 * L, postReachable: true, L }), 'defensa');
  assert.equal(C.roleFor({ kind: 'soldado', S: 30, D: 0, q: 160 * L - 1, postReachable: true, L }), 'ataque');
});

test('(d) planAlta suma los grupos propios por soldados vivos: 3 grupos de 5 cuentan 1,5, no 3', () => {
  const armar = (bias) => {
    const w = mundo({ commander: { bias } });
    for (let i = 0; i < 3; i++) ataque(w, 'soldado', 600 + i * 40, i, 2, 5);
    return w;
  };
  assert.equal(C.planAlta(armar(25), 0, 'soldado').role, 'defensa', 'cuota 40 % justa');
  assert.equal(C.planAlta(armar(24), 0, 'soldado').role, 'ataque', 'un cuarto menos');
});

test('(e) la torreta propia caída resta L (un grupo entero) al sector, no 1/L', () => {
  const w = mundo({ commander: { bias: 100 } });
  for (let i = 0; i < 6; i++) ataque(w, 'tanque', 600 + i * 40, i % 3, 2, 1);
  // un grupo enemigo a medias en el sector medio: −10; la torreta de arriba caída: −20
  enemigo(w, 1, 'soldado', 300, 448, 5);
  w.bases[0].turrets[0].hp = 0;
  w.bases[0].turrets[0].on = false;
  const plan = C.planAlta(w, 0, 'soldado');
  assert.equal(plan.role, 'defensa');
  assert.equal(plan.sector, 0);
});
