// (CI) Reglas globales sobre TODAS las páginas construidas: idioma, un h1, alt, controles con nombre, enlace para
// saltar, nada en línea, nada de otro origen y el aviso de no afiliación en el pie. Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND } from '@tienda/contracts/brand';
import { fmt, pie } from '@tienda/contracts/i18n';
import { leerDist, paginasDeDist, reglasGlobales, rutasProhibidasEnDist } from './support/html.js';

const aviso = fmt(pie.noAfiliacion, { marca: BRAND.name });
const paginas = paginasDeDist();

test('dist: están las páginas de este lote (portada, 404, confirmar, aviso y privacidad)', () => {
  for (const esperada of ['index.html', '404.html', 'confirmar.html', 'legal/aviso.html', 'legal/privacidad.html']) {
    assert.ok(paginas.includes(esperada), `falta ${esperada}; hay: ${paginas.join(', ')}`);
  }
});

test('dist: cada página cumple las reglas globales de la vitrina', () => {
  assert.ok(paginas.length >= 5);
  const problemas = [];
  for (const pagina of paginas) {
    for (const p of reglasGlobales(leerDist(pagina), { aviso })) problemas.push(`${pagina}: ${p}`);
  }
  assert.deepEqual(problemas, []);
});

test('dist: no existen /juegos, /categorias ni /como-funciona (la portada es la única vitrina)', () => {
  assert.deepEqual(rutasProhibidasEnDist(paginas), []);
});
