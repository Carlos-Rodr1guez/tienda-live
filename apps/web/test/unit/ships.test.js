import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHIPS, SHIP_NAMES, shipPath, shipTransform } from '../../src/lib/ships.js';

test('naves: las cuatro siluetas de la dirección A, con el trazado exacto sobre un lienzo de 48x48', () => {
  assert.deepEqual(SHIP_NAMES, ['caza', 'bombardero', 'coloso', 'acorazado']);
  assert.equal(SHIPS.caza.d, 'M24 4 34 42 24 34 14 42Z');
  assert.equal(SHIPS.bombardero.d, 'M24 6 28 18 45 30 45 39 28 34 24 43 20 34 3 39 3 30 20 18Z');
  assert.equal(SHIPS.coloso.d, 'M15 4H33L37 14 45 20V38L37 45H11L3 38V20L11 14ZM19 20V32H29V20Z');
  assert.equal(SHIPS.acorazado.d, 'M24 2 30 9V15L38 21V41L32 46H16L10 41V21L18 15V9ZM21 24V38H27V24Z');
  assert.equal(SHIPS.caza.evenodd, false);
  assert.equal(SHIPS.coloso.evenodd, true);
  assert.equal(SHIPS.acorazado.evenodd, true);
  assert.ok(Object.isFrozen(SHIPS));
});

test('naves: shipTransform escala el lienzo de 48 al tamaño pedido y lo coloca en x, y', () => {
  assert.equal(shipTransform(10, 20, 48), 'translate(10 20) scale(1)');
  assert.equal(shipTransform(14, 6, 24), 'translate(14 6) scale(0.5)');
  assert.equal(shipTransform(0, 0, 26), 'translate(0 0) scale(0.542)');
});

test('naves: con ángulo gira sobre el centro de la nave (x + tamaño/2, y + tamaño/2)', () => {
  // el caza invasor del arte de Acción: x=14, y=6, tamaño 26, vuelto 180 grados
  assert.equal(shipTransform(14, 6, 26, 180), 'rotate(180 27 19) translate(14 6) scale(0.542)');
  assert.equal(shipTransform(30, 132, 24, 90), 'rotate(90 42 144) translate(30 132) scale(0.5)');
  assert.equal(shipTransform(130, 150, 24, -90), 'rotate(-90 142 162) translate(130 150) scale(0.5)');
});

test('naves: shipPath arma el <path> con clase, transform y relleno par-impar solo donde hace falta', () => {
  assert.equal(
    shipPath('caza', { x: 26, y: 146, tamano: 24, clase: 'k1' }),
    '<path class="k1" transform="translate(26 146) scale(0.5)" d="M24 4 34 42 24 34 14 42Z"/>',
  );
  const coloso = shipPath('coloso', { x: 0, y: 0, tamano: 48, clase: 'k2', angulo: 180 });
  assert.match(coloso, /fill-rule="evenodd"/);
  assert.match(coloso, /transform="rotate\(180 24 24\) translate\(0 0\) scale\(1\)"/);
  assert.ok(!/fill-rule/.test(shipPath('bombardero', { x: 1, y: 1, tamano: 10, clase: 'k1' })));
});

test('naves: una nave desconocida o un tamaño inválido fallan, no dibujan nada a medias', () => {
  assert.throws(() => shipPath('crucero', { x: 0, y: 0, tamano: 10, clase: 'k1' }), /crucero/);
  assert.throws(() => shipPath('caza', { x: 0, y: 0, tamano: 0, clase: 'k1' }), /tamaño/);
  assert.throws(() => shipTransform(Number.NaN, 0, 10), /número/);
});
