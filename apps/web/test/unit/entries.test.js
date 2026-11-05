import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { checkCopy } from '@tienda/contracts/copy-rules';
import { BRAND } from '@tienda/contracts/brand';
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

test('entradas: la carpeta de juegos tiene los conceptos carrera y acuario', () => {
  const slugs = juegos.map((j) => j.slug);
  assert.ok(slugs.includes('carrera'), 'falta carrera.md');
  assert.ok(slugs.includes('acuario'), 'falta acuario.md');
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
