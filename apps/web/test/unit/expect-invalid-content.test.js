import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CASOS, evaluateRun, relativeFromWeb, stripAnsi } from '../../scripts/expect-invalid-content.mjs';

// Lo que imprime Astro de verdad cuando una ficha no cumple el esquema (con colores ANSI).
const SALIDA_REAL = [
  '\u001b[31m[InvalidContentEntryDataError]\u001b[39m \u001b[1mjuegos → sin-categoria\u001b[22m data does not match collection schema.',
  '',
  '  \u001b[1mcategoria\u001b[22m: Invalid option: expected one of "accion"|"publico"|"relax"|"metas"',
  '',
  '  \u001b[1mLocation:\u001b[22m',
  '    \u001b[4mD:\\repo\\apps\\web\\test\\fixtures\\juegos-invalidos\\sin-categoria.md:0:0\u001b[24m',
].join('\n');

test('casos: una ficha sin categoria y otra sin rolStreamer, las dos de test/fixtures/juegos-invalidos', () => {
  assert.deepEqual(CASOS, [
    { archivo: 'sin-categoria.md', campo: 'categoria' },
    { archivo: 'sin-rol.md', campo: 'rolStreamer' },
  ]);
});

test('stripAnsi: quita los colores y deja el texto', () => {
  assert.equal(stripAnsi('\u001b[1mcategoria\u001b[22m: x'), 'categoria: x');
  assert.equal(stripAnsi('sin colores'), 'sin colores');
});

test('evaluateRun: sale con error y nombra el archivo y el campo en stderr: bien', () => {
  const r = evaluateRun({ status: 1, stdout: '', stderr: SALIDA_REAL }, CASOS[0]);
  assert.deepEqual(r, { ok: true });
});

test('evaluateRun: también acepta que el mensaje salga por stdout', () => {
  assert.equal(evaluateRun({ status: 1, stdout: SALIDA_REAL, stderr: '' }, CASOS[0]).ok, true);
});

test('evaluateRun: si la construcción NO falla, es un error aunque el texto sea el correcto', () => {
  const r = evaluateRun({ status: 0, stdout: '', stderr: SALIDA_REAL }, CASOS[0]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no falló/);
});

test('evaluateRun: falla por otro motivo (no nombra el archivo): es un error', () => {
  const r = evaluateRun({ status: 1, stdout: '', stderr: 'Error: algo se rompió' }, CASOS[0]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /sin-categoria\.md/);
});

test('evaluateRun: nombra el archivo pero no el campo: es un error (el nombre del archivo no cuenta como campo)', () => {
  const sinCampo = 'juegos → sin-categoria data does not match\nsin-categoria.md:0:0\nrolStreamer: Invalid option';
  const r = evaluateRun({ status: 1, stdout: '', stderr: sinCampo }, CASOS[0]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /categoria/);
  // el mismo texto sí sirve para el otro caso, porque ahí el campo es rolStreamer
  const otro = 'juegos → sin-rol data does not match\nsin-rol.md:0:0\nrolStreamer: Invalid option';
  assert.equal(evaluateRun({ status: 1, stdout: '', stderr: otro }, CASOS[1]).ok, true);
});

test('relativeFromWeb: Astro exige una ruta relativa al proyecto (una absoluta de Windows la toma por una URL)', () => {
  // Las rutas se arman con path.join para que la prueba valga igual en Windows y en Linux.
  const raiz = path.parse(process.cwd()).root;
  const web = path.join(raiz, 'repo', 'apps', 'web');
  assert.equal(relativeFromWeb(web, path.join(raiz, 'repo', '.dev-state', 'x')), '../../.dev-state/x');
  assert.equal(relativeFromWeb(web, path.join(web, 'test', 'fixtures')), './test/fixtures');
});
