import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, ICON_STROKE, iconShapes } from '../../src/lib/icons.js';

test('iconos: el juego propio tiene chevron, check, alert y mail, todos con un solo grosor de trazo', () => {
  assert.deepEqual(ICON_NAMES, ['chevron', 'check', 'alert', 'mail']);
  assert.equal(ICON_STROKE, 1.75);
});

test('iconos: cada icono tiene formas sobre un lienzo de 24 y no trae estilos ni referencias', () => {
  for (const nombre of ICON_NAMES) {
    const formas = iconShapes(nombre);
    assert.ok(formas.length >= 1, nombre);
    assert.match(formas, /^<(?:path|rect)\b/, nombre);
    assert.ok(
      !/style|<style|<script|href|stroke-width|fill=/i.test(formas),
      `${nombre}: el trazo y el relleno los pone el SVG`,
    );
  }
  assert.match(iconShapes('chevron'), /d="M6 9l6 6 6-6"/);
  assert.match(iconShapes('mail'), /<rect /, 'el sobre lleva un rectángulo');
});

test('iconos: uno que no existe falla', () => {
  assert.throws(() => iconShapes('cohete'), /cohete/);
  assert.throws(() => iconShapes(undefined), /undefined/);
});
