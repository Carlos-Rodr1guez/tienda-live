import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fichaHref, fichaIds, splitCatalog, sortByOrden } from '../../src/lib/catalog.js';
import { ABSENT_ROUTES, NOINDEX_ROUTES, indexableRoutes } from '../../src/lib/routes.js';

// Entradas con la forma de la colección de Astro: { id, data }.
const juego = (id, nombre, estado, orden) => ({ id, data: { nombre, estado, orden } });
const asedio = juego('asedio', 'ASEDIO LIVE', 'prototipo', 1);
const carrera = juego('carrera', 'Carrera por equipos', 'concepto', 2);
const acuario = juego('acuario', 'Acuario', 'concepto', 3);
const beta = juego('beta-uno', 'Beta uno', 'beta', 5);

test('catálogo: ordena por orden y, si empatan, por nombre; no modifica el arreglo recibido', () => {
  const entrada = [acuario, asedio, carrera];
  assert.deepEqual(
    sortByOrden(entrada).map((j) => j.id),
    ['asedio', 'carrera', 'acuario'],
  );
  assert.deepEqual(
    entrada.map((j) => j.id),
    ['acuario', 'asedio', 'carrera'],
    'la entrada no se toca',
  );

  const empate = [
    juego('b', 'Bravo', 'concepto', 10),
    juego('a', 'Álamo', 'concepto', 10),
    juego('c', 'Charlie', 'concepto', 9),
  ];
  assert.deepEqual(
    sortByOrden(empate).map((j) => j.id),
    ['c', 'a', 'b'],
  );
});

test('catálogo: las fichas son los juegos que no son concepto; el resto son próximos, sin enlace', () => {
  const { fichas, proximos } = splitCatalog([acuario, beta, asedio, carrera]);
  assert.deepEqual(
    fichas.map((j) => j.id),
    ['asedio', 'beta-uno'],
  );
  assert.deepEqual(
    proximos.map((j) => j.id),
    ['carrera', 'acuario'],
  );
});

test('catálogo: con solo conceptos no hay fichas, y con solo fichas no hay próximos', () => {
  assert.deepEqual(splitCatalog([carrera, acuario]).fichas, []);
  assert.deepEqual(splitCatalog([asedio]).proximos, []);
  assert.deepEqual(splitCatalog([]), { fichas: [], proximos: [] });
});

test('catálogo: un concepto nunca tiene enlace; una ficha apunta a /juegos/<id>', () => {
  assert.equal(fichaHref(asedio), '/juegos/asedio');
  assert.equal(fichaHref(beta), '/juegos/beta-uno');
  assert.equal(fichaHref(carrera), null);
  assert.deepEqual(fichaIds([carrera, asedio, acuario, beta]), ['asedio', 'beta-uno']);
});

test('rutas: lo indexable es la portada, las fichas y las páginas legales; los conceptos no', () => {
  const rutas = indexableRoutes({
    juegos: [carrera, asedio, acuario],
    legales: [{ id: 'privacidad' }, { id: 'aviso' }],
  });
  assert.deepEqual(rutas, ['/', '/juegos/asedio', '/legal/aviso', '/legal/privacidad']);
});

test('rutas: sin juegos ni páginas legales queda solo la portada', () => {
  assert.deepEqual(indexableRoutes({ juegos: [], legales: [] }), ['/']);
});

test('rutas: /confirmar y /404 no se indexan, y no existen /juegos, /categorias ni /como-funciona', () => {
  assert.deepEqual(NOINDEX_ROUTES, ['/confirmar', '/404']);
  assert.deepEqual(ABSENT_ROUTES, ['/juegos', '/categorias', '/como-funciona']);
  const rutas = indexableRoutes({ juegos: [asedio], legales: [{ id: 'aviso' }] });
  for (const prohibida of [...NOINDEX_ROUTES, ...ABSENT_ROUTES])
    assert.equal(rutas.includes(prohibida), false, prohibida);
});
