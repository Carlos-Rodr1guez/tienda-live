import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { checkCopy } from '@tienda/contracts/copy-rules';
import { BRAND } from '@tienda/contracts/brand';
import { juego as juegoTextos } from '@tienda/contracts/i18n';
// Solo lectura: la configuración real de ASEDIO es la fuente de los niveles de regalo.
import { DEFAULT_CONFIG } from '../../../../games/asedio/public/js/sim/defaults.js';
import { createJuegoSchema, createLegalSchema } from '../../src/content/schema.js';
import { parseFrontmatter } from '../support/frontmatter.js';

// Lee los .md tal cual están en disco: el slug es el nombre del archivo y el texto se revisa antes de que Astro lo vea.
const CARPETA_JUEGOS = new URL('../../src/content/juegos/', import.meta.url);
const CARPETA_LEGAL = new URL('../../src/content/legal/', import.meta.url);

function leerCarpeta(carpeta) {
  return readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith('.md'))
    .map((nombre) => {
      const texto = readFileSync(new URL(nombre, carpeta), 'utf8');
      return { slug: nombre.slice(0, -'.md'.length), texto, ...parseFrontmatter(texto) };
    });
}

const juegos = leerCarpeta(CARPETA_JUEGOS);
const legales = leerCarpeta(CARPETA_LEGAL);

test('entradas: la carpeta de juegos tiene asedio y los conceptos batalla, carrera y acuario', () => {
  const slugs = juegos.map((j) => j.slug);
  for (const esperado of ['asedio', 'batalla', 'carrera', 'acuario']) {
    assert.ok(slugs.includes(esperado), `falta ${esperado}.md`);
  }
});

test('asedio: prototipo de Acción que juega el streamer, con póster real, sin video y todo sacado del juego', () => {
  const asedio = juegos.find((j) => j.slug === 'asedio').data;
  assert.equal(asedio.categoria, 'accion');
  assert.equal(asedio.rolStreamer, 'juega');
  assert.equal(asedio.estado, 'prototipo');
  assert.deepEqual(asedio.idealPara, ['gaming']);
  assert.equal(asedio.orden, 1);
  assert.equal(asedio.poster, 'juegos/asedio/poster.png');
  assert.equal(asedio.video, undefined, 'todavía no hay un clip: la ficha muestra "Video próximamente"');
  assert.ok(existsSync(new URL(`../../src/assets/${asedio.poster}`, import.meta.url)), 'falta el archivo del póster');
  assert.ok(asedio.mecanicas.length >= 3);
  assert.ok(asedio.requisitos.length >= 1);
  assert.ok(asedio.nombre.length <= 60 && asedio.resumen.length <= 160);
});

test('asedio: los regalos de la ficha son los niveles de la configuración real del juego (nada inventado)', () => {
  const asedio = juegos.find((j) => j.slug === 'asedio').data;
  const niveles = DEFAULT_CONFIG.tiers;
  assert.equal(asedio.regalos.length, niveles.length);
  niveles.forEach((nivel, i) => {
    const siguiente = niveles[i + 1];
    const esperado = siguiente ? `${nivel.minCoins}-${siguiente.minCoins - 1}` : `${nivel.minCoins}+`;
    // una moneda sola no es un rango: 1-9 sí, pero el último nivel es "1000+"
    assert.equal(asedio.regalos[i].monedas, esperado, `nivel ${nivel.unit}`);
    assert.match(asedio.regalos[i].efecto.toLowerCase(), new RegExp(nivel.unit), `el efecto nombra ${nivel.unit}`);
  });
});

test('asedio: la escalera del diccionario sigue los mismos niveles y unidades que el juego', () => {
  const niveles = DEFAULT_CONFIG.tiers;
  assert.deepEqual(
    juegoTextos.escalera.map((n) => n.unidad.toLowerCase()),
    niveles.map((n) => n.unit),
  );
  niveles.forEach((nivel, i) => {
    const siguiente = niveles[i + 1];
    const esperado = siguiente ? `${nivel.minCoins} a ${siguiente.minCoins - 1}` : `${nivel.minCoins} o más`;
    assert.equal(juegoTextos.escalera[i].monedas, esperado, nivel.unit);
  });
});

test('batalla: concepto de Público que conduce el streamer, antes que carrera y acuario, con nombre provisional', () => {
  const batalla = juegos.find((j) => j.slug === 'batalla');
  assert.equal(batalla.data.nombre, 'Batalla de países');
  assert.equal(batalla.data.estado, 'concepto');
  assert.equal(batalla.data.categoria, 'publico');
  assert.equal(batalla.data.rolStreamer, 'conduce');
  assert.deepEqual(batalla.data.idealPara, ['charla', 'gaming']);
  assert.match(batalla.body, /nombre es provisional/i);
  assert.match(batalla.data.resumen, /narras/, 'el streamer narra la batalla en cámara');
});

test('batalla: nada de banderas, escudos, himnos, conflictos reales ni la palabra guerra (decisión del dueño)', () => {
  const batalla = juegos.find((j) => j.slug === 'batalla');
  // los comentarios del encabezado también cuentan: el texto completo del archivo
  assert.doesNotMatch(batalla.texto, /guerra/i);
  assert.doesNotMatch(batalla.texto, /bandera|escudo|himno|conflicto/i);
  assert.doesNotMatch(batalla.texto, /[\u{1F1E6}-\u{1F1FF}]/u, 'sin emoji de bandera');
  assert.doesNotMatch(batalla.texto, /\p{Extended_Pictographic}/u);
});

test('orden del catálogo: ASEDIO, Batalla de países, Acuario y Carrera, sin repetidos', () => {
  const orden = Object.fromEntries(juegos.map((j) => [j.slug, j.data.orden]));
  assert.deepEqual(
    juegos.toSorted((a, b) => a.data.orden - b.data.orden).map((j) => j.slug),
    ['asedio', 'batalla', 'acuario', 'carrera'],
  );
  assert.equal(new Set(Object.values(orden)).size, juegos.length, JSON.stringify(orden));
  assert.equal(orden.carrera, 4);
  assert.equal(orden.acuario, 3);
  assert.equal(orden.batalla, 2);
});

test('entradas: cada juego tiene un slug válido, cuerpo de hasta 8000 caracteres y pasa el esquema', () => {
  assert.ok(juegos.length >= 2);
  for (const juego of juegos) {
    assert.match(juego.slug, /^[a-z0-9-]{1,40}$/, juego.slug);
    assert.ok(juego.body.length <= 8000, `${juego.slug}: el cuerpo pasa de 8000 caracteres`);
    const r = createJuegoSchema().safeParse(juego.data);
    assert.equal(r.success, true, `${juego.slug}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
  }
});

test('entradas: carrera es Público/conduce y acuario es Relax/acompaña, los dos en estado concepto', () => {
  const por = Object.fromEntries(juegos.map((j) => [j.slug, j.data]));
  assert.equal(por.carrera.categoria, 'publico');
  assert.equal(por.carrera.rolStreamer, 'conduce');
  assert.equal(por.carrera.estado, 'concepto');
  assert.equal(por.acuario.categoria, 'relax');
  assert.equal(por.acuario.rolStreamer, 'acompana');
  assert.equal(por.acuario.estado, 'concepto');
});

test('entradas: los nombres de los conceptos están marcados como provisionales', () => {
  for (const juego of juegos.filter((j) => j.data.estado === 'concepto')) {
    assert.match(juego.body, /nombre es provisional/i, `${juego.slug}: falta avisar que el nombre es provisional`);
  }
});

test('entradas: ningún texto de juego usa azar, presiona a regalar ni usa voseo', () => {
  for (const juego of juegos) {
    assert.deepEqual(checkCopy(juego.texto), [], juego.slug);
  }
});

test('entradas legales: aviso y privacidad existen, pasan el esquema y están marcados como borrador', () => {
  const slugs = legales.map((l) => l.slug).sort();
  assert.deepEqual(slugs, ['aviso', 'privacidad']);
  for (const pagina of legales) {
    assert.match(pagina.slug, /^[a-z0-9-]{1,40}$/);
    assert.ok(pagina.body.length <= 8000, `${pagina.slug}: el cuerpo pasa de 8000 caracteres`);
    const r = createLegalSchema().safeParse(pagina.data);
    assert.equal(r.success, true, `${pagina.slug}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
    assert.equal(pagina.data.borrador, true, `${pagina.slug} debe ser borrador`);
    assert.deepEqual(checkCopy(pagina.texto), [], pagina.slug);
  }
});

test('entradas legales: dicen lo que prometen el aviso y el diccionario (no afiliación, 7 días, borrado, 18+)', () => {
  const por = Object.fromEntries(legales.map((l) => [l.slug, l.body]));
  assert.match(por.aviso, /TikTok/);
  assert.match(por.aviso, /ByteDance/);
  assert.match(por.privacidad, /7 días/);
  assert.match(por.privacidad, /correo/i);
  assert.match(por.privacidad, /18 años/);
  assert.match(por.privacidad, /borr/i);
});

test('entradas: el nombre de la marca no está escrito en ningún .md (el escaneo de marca no mira markdown)', () => {
  for (const entrada of [...juegos, ...legales]) {
    assert.equal(entrada.texto.toLowerCase().includes(BRAND.name.toLowerCase()), false, entrada.slug);
  }
});
