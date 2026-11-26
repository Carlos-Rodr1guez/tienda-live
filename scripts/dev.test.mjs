import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinePrefixer, DEV_PROCESSES, planStop, spawnOptionsFor, stopTree } from './dev.mjs';

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

test('planStop: en Windows se mata el árbol entero con taskkill /T /F, con argumentos sueltos (nada de shell)', () => {
  assert.deepEqual(planStop('win32', 4321), {
    tipo: 'comando',
    comando: 'taskkill',
    args: ['/pid', '4321', '/T', '/F'],
  });
  assert.deepEqual(planStop('win32', 7), { tipo: 'comando', comando: 'taskkill', args: ['/pid', '7', '/T', '/F'] });
});

test('planStop: fuera de Windows se señala al grupo de procesos (pid negativo)', () => {
  for (const plataforma of ['linux', 'darwin']) {
    assert.deepEqual(planStop(plataforma, 4321), { tipo: 'grupo', pid: -4321, senal: 'SIGTERM' });
  }
  assert.deepEqual(planStop('linux', 9), { tipo: 'grupo', pid: -9, senal: 'SIGTERM' });
});

test('spawnOptionsFor: solo fuera de Windows el hijo nace en su propio grupo (detached)', () => {
  assert.equal(spawnOptionsFor('win32').detached, false);
  assert.equal(spawnOptionsFor('linux').detached, true);
  assert.equal(spawnOptionsFor('darwin').detached, true);
  for (const p of ['win32', 'linux']) assert.notEqual(spawnOptionsFor(p).shell, true);
});

test('stopTree: en Windows llama a taskkill con spawnSync, sin shell, y no usa child.kill', () => {
  const llamadas = [];
  const child = { pid: 555, kill: () => assert.fail('no debe matar solo al proceso de npm') };
  stopTree(child, {
    plataforma: 'win32',
    spawnSync: (comando, args, opciones) => llamadas.push({ comando, args, opciones }),
    kill: () => assert.fail('en Windows no se señala un grupo'),
  });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].comando, 'taskkill');
  assert.deepEqual(llamadas[0].args, ['/pid', '555', '/T', '/F']);
  assert.notEqual(llamadas[0].opciones?.shell, true);
});

test('stopTree: fuera de Windows señala al grupo; si el grupo ya no existe, cae a child.kill', () => {
  const senales = [];
  stopTree(
    { pid: 321, kill: () => assert.fail('el grupo existe') },
    {
      plataforma: 'linux',
      spawnSync: () => assert.fail('sin taskkill'),
      kill: (pid, senal) => senales.push([pid, senal]),
    },
  );
  assert.deepEqual(senales, [[-321, 'SIGTERM']]);

  let directo = 0;
  stopTree(
    { pid: 321, kill: () => (directo += 1) },
    {
      plataforma: 'linux',
      spawnSync: () => assert.fail('sin taskkill'),
      kill: () => {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      },
    },
  );
  assert.equal(directo, 1);
});

test('stopTree: un hijo que nunca arrancó (sin pid) no rompe nada', () => {
  assert.doesNotThrow(() =>
    stopTree(
      { pid: undefined, kill() {} },
      { plataforma: 'win32', spawnSync: () => assert.fail('sin pid'), kill: () => {} },
    ),
  );
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
