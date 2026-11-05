import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinePrefixer, DEV_PROCESSES } from './dev.mjs';

function recolector() {
  const lineas = [];
  return { lineas, write: (l) => lineas.push(l) };
}

test('prefijo: cada línea completa sale con la etiqueta delante', () => {
  const { lineas, write } = recolector();
  const p = createLinePrefixer('[api]', write);
  p.push('listo\nescuchando en 8790\n');
  assert.deepEqual(lineas, ['[api] listo', '[api] escuchando en 8790']);
});

test('prefijo: una línea partida en dos fragmentos sale una sola vez y completa', () => {
  const { lineas, write } = recolector();
  const p = createLinePrefixer('[web]', write);
  p.push('escuch');
  assert.deepEqual(lineas, []);
  p.push('ando en 4400\nsegunda');
  assert.deepEqual(lineas, ['[web] escuchando en 4400']);
  p.flush();
  assert.deepEqual(lineas, ['[web] escuchando en 4400', '[web] segunda']);
});

test('prefijo: acepta Buffer y finales de línea de Windows', () => {
  const { lineas, write } = recolector();
  const p = createLinePrefixer('[api]', write);
  p.push(Buffer.from('uno\r\ndos\r\n'));
  assert.deepEqual(lineas, ['[api] uno', '[api] dos']);
});

test('prefijo: las líneas vacías conservan la etiqueta y flush sin pendientes no escribe nada', () => {
  const { lineas, write } = recolector();
  const p = createLinePrefixer('[api]', write);
  p.push('a\n\nb\n');
  p.flush();
  assert.deepEqual(lineas, ['[api] a', '[api]', '[api] b']);
});

test('procesos: api y web, cada uno con su etiqueta y su script de npm', () => {
  assert.deepEqual(
    DEV_PROCESSES.map((p) => [p.prefix, p.workspace]),
    [
      ['[api]', '@tienda/api'],
      ['[web]', '@tienda/web'],
    ],
  );
});
