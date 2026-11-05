import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Las ADR y su índice (docs/adr/README.md) tienen que decir lo mismo: cada archivo tiene su fila y el estado coincide.
const CARPETA = fileURLToPath(new URL('../docs/adr/', import.meta.url));
const leer = (nombre) => readFileSync(CARPETA + nombre, 'utf8').replace(/\r\n/g, '\n');

const archivos = readdirSync(CARPETA).filter((n) => /^\d{4}-.+\.md$/.test(n));
const indice = leer('README.md');

/** Filas de la tabla del índice: { numero, archivo, decision, estado }. */
function filasDelIndice() {
  const filas = [];
  for (const linea of indice.split('\n')) {
    const m = /^\|\s*\[(\d{3})\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(linea);
    if (m) filas.push({ numero: m[1], archivo: m[2], decision: m[3], estado: m[4] });
  }
  return filas;
}

const estadoDelArchivo = (nombre) => /^- \*\*Estado:\*\* (.+)$/m.exec(leer(nombre))?.[1].trim();

test('ADR: el índice tiene una fila por cada archivo, con el mismo estado que dice el archivo', () => {
  const filas = filasDelIndice();
  assert.deepEqual(
    filas.map((f) => f.archivo).sort(),
    [...archivos].sort(),
    'cada ADR tiene su fila en el índice y viceversa',
  );
  for (const fila of filas) {
    // el archivo se numera con 4 cifras (0003-...) y el índice con 3 (003)
    assert.equal(fila.archivo.slice(1, 4), fila.numero, `el número de ${fila.archivo}`);
    assert.equal(fila.estado, estadoDelArchivo(fila.archivo), `estado de ${fila.archivo}`);
  }
});

test('ADR: 003, 008 y 009 están Aceptadas; las demás siguen como estaban', () => {
  const estados = Object.fromEntries(filasDelIndice().map((f) => [f.numero, f.estado]));
  assert.equal(estados['003'], 'Aceptada');
  assert.equal(estados['008'], 'Aceptada');
  assert.equal(estados['009'], 'Aceptada');
  for (const n of ['001', '002', '004', '005', '006', '007']) assert.equal(estados[n], 'Propuesta', n);
});

test('ADR: toda ADR tiene estado válido, fecha y las cuatro secciones; una aceptada dice "Decisión", no "Decisión propuesta"', () => {
  const validos = new Set(['Propuesta', 'Aceptada', 'Descartada']);
  for (const nombre of archivos) {
    const texto = leer(nombre);
    const estado = estadoDelArchivo(nombre);
    assert.ok(validos.has(estado) || /^Reemplazada por ADR-\d{3}$/.test(estado), `${nombre}: estado ${estado}`);
    assert.match(texto, /^- \*\*Fecha:\*\* \d{4}-\d{2}-\d{2}$/m, `${nombre}: falta la fecha`);
    for (const seccion of ['Contexto', 'Opciones', 'Consecuencias']) {
      assert.match(texto, new RegExp(`^## ${seccion}$`, 'm'), `${nombre}: falta ${seccion}`);
    }
    const titulo = estado === 'Aceptada' ? 'Decisión' : 'Decisión propuesta';
    assert.match(texto, new RegExp(`^## ${titulo}$`, 'm'), `${nombre}: la sección tiene que llamarse "${titulo}"`);
    if (estado === 'Aceptada') assert.doesNotMatch(texto, /^## Decisión propuesta$/m, nombre);
  }
});

test('ADR-003: un Worker con assets estáticos, y la consecuencia de astro en dependencies nombra lightningcss y sharp', () => {
  const texto = leer('0003-stack-de-la-pagina.md');
  assert.match(texto, /Worker/);
  assert.match(texto, /mismo origen/);
  assert.match(texto, /wrangler deploy/);
  const consecuencia = texto.split('\n').find((l) => l.includes('`astro`') && l.includes('dependencies'));
  assert.ok(consecuencia, 'falta la consecuencia sobre astro en dependencies');
  assert.match(consecuencia, /lightningcss/);
  assert.match(consecuencia, /MPL-2\.0/);
  assert.match(consecuencia, /sharp/);
  assert.match(consecuencia, /libvips/);
  assert.match(consecuencia, /LGPL-3\.0-or-later/);
  assert.match(consecuencia, /sin modificar/);
  assert.match(consecuencia, /no viaja|no se distribuye|no se publica/);
});

test('ADR-008: aceptada, con las consecuencias que ya cumple el código (contracts, intereses y frecuencia, esquema)', () => {
  const texto = leer('0008-categorias-del-catalogo.md');
  assert.match(texto, /@tienda\/contracts/);
  assert.match(texto, /live_frequency/);
  assert.match(texto, /waitlist\.interests/);
  assert.match(texto, /rolStreamer/);
  // el orden de los juegos 2 y 3 sigue decidiéndose en el H4
  assert.match(texto, /H4/);
  assert.match(texto, /Acuario/);
  assert.match(texto, /Carrera/);
});

test('ADR-009: TypeScript 7 en la raíz, TypeScript 6 solo en apps/web, JavaScript con JSDoc', () => {
  const nombre = archivos.find((n) => n.startsWith('0009-'));
  assert.ok(nombre, 'falta el archivo de la ADR-009');
  const texto = leer(nombre);
  assert.match(texto, /^# ADR-009: /m);
  assert.match(texto, /TypeScript 7/);
  assert.match(texto, /TypeScript 6/);
  assert.match(texto, /JSDoc/);
  assert.match(texto, /apps\/web/);
  assert.match(texto, /@astrojs\/check/);
  assert.match(texto, /Dependabot/);
  assert.match(texto, /^## Cuándo revisarla$/m);
  for (const opcion of ['A', 'B', 'C', 'D']) assert.match(texto, new RegExp(`\\*\\*${opcion}\\.`), `opción ${opcion}`);
});
