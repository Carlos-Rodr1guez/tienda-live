import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCopy } from '@tienda/contracts/copy-rules';

// La nota fechada de Batalla de países vive en la ADR-008 (decisión del dueño, 2026-11-05).
const adr = readFileSync(new URL('../../../../docs/adr/0008-categorias-del-catalogo.md', import.meta.url), 'utf8');

/** El texto de la sección "Nota (2026-11-05): Batalla de países", hasta el siguiente encabezado o el final. */
function nota() {
  const m = /^## Nota \(2026-11-05\): Batalla de países$\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(adr);
  assert.ok(m, 'falta la sección "## Nota (2026-11-05): Batalla de países" en la ADR-008');
  return m[1];
}

test('ADR-008: la nota de Batalla de países existe, tiene fecha y la ADR sigue Aceptada', () => {
  assert.match(adr, /^- \*\*Estado:\*\* Aceptada$/m);
  assert.ok(nota().trim().length > 200);
});

test('ADR-008: la nota dice que Batalla entra como concepto de Público a pedido del dueño y va antes que Carrera', () => {
  const texto = nota();
  assert.match(texto, /Batalla de países/);
  assert.match(texto, /concepto/);
  assert.match(texto, /Público/);
  assert.match(texto, /dueño/);
  assert.match(texto, /antes que Carrera/);
});

test('ADR-008: los juegos 2 y 3 pasan a ser Acuario (Relax) y Batalla de países (Público), Carrera sigue como concepto', () => {
  const texto = nota();
  assert.match(texto, /Acuario \(Relax\)/);
  assert.match(texto, /Batalla de países \(Público\)/);
  assert.match(texto, /Carrera[^.]*concepto/);
});

test('ADR-008: cuál sale primero lo sigue decidiendo el interés de la lista de espera en el H4, y otra ADR enmienda el orden', () => {
  const texto = nota();
  assert.match(texto, /H4/);
  assert.match(texto, /lista de espera/);
  assert.match(texto, /guerra-paises/);
});

test('ADR-008: la nota respeta las reglas de redacción (sin voseo, sin presión a regalar, sin azar)', () => {
  assert.deepEqual(checkCopy(nota()), []);
});
