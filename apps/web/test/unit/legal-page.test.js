import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFecha, legalMeta } from '../../src/lib/legal.js';

test('fecha: AAAA-MM-DD sale en español, con el mes en letras y sin depender de la zona horaria', () => {
  assert.equal(formatFecha('2026-11-05'), '5 de noviembre de 2026');
  assert.equal(formatFecha('2027-01-31'), '31 de enero de 2027');
  // el 1 de enero no puede caer al 31 de diciembre por la zona horaria
  assert.equal(formatFecha('2026-01-01'), '1 de enero de 2026');
});

test('fecha: lo que no es AAAA-MM-DD válido falla', () => {
  for (const malo of ['', '2026-13-01', '2026-02-30', '05/11/2026', '2026-1-5', undefined]) {
    assert.throws(() => formatFecha(malo), /fecha/, String(malo));
  }
});

test('legal: el título de la página, la descripción y la línea de versión salen del diccionario con la marca', () => {
  const meta = legalMeta({ titulo: 'Aviso legal', version: '0.1', actualizado: '2026-11-05' }, 'Tienda LIVE');
  assert.deepEqual(meta, {
    titulo: 'Aviso legal | Tienda LIVE',
    descripcion: 'Aviso legal de Tienda LIVE.',
    versionActualizado: 'Versión 0.1, actualizada el 5 de noviembre de 2026',
  });
});
