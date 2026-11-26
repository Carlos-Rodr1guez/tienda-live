import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { formulario as textosFormulario } from '@tienda/contracts/i18n';

// Decisiones de accesibilidad que se ven en el código fuente de los componentes, sin construir. La página ya
// construida se prueba en test/dist (CI).

const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
const formulario = leer('src/components/WaitlistForm.astro');
const poster = leer('src/components/VideoPoster.astro');

/** La etiqueta de apertura que contiene `marca` (por ejemplo un id), con sus atributos. */
function etiquetaCon(fuente, marca) {
  const i = fuente.indexOf(marca);
  assert.ok(i > -1, `no está ${marca}`);
  const inicio = fuente.lastIndexOf('<', i);
  return fuente.slice(inicio, fuente.indexOf('>', i) + 1);
}

test('video: el <video controls> tiene nombre accesible, el mismo texto que el alt del póster', () => {
  const video = etiquetaCon(poster, 'data-seguimiento="video"');
  assert.match(video, /^<video/);
  assert.match(video, /\bcontrols\b/);
  assert.match(video, /aria-label=\{alt\}/);
  // y el póster sin video usa ese mismo texto como alt: una sola fuente para las dos ramas
  assert.match(poster, /alt=\{alt\}/);
});

/** Todos los archivos de texto de src (componentes, páginas, contenido y scripts). */
function archivosDeSrc() {
  const raiz = new URL('../../src/', import.meta.url);
  return readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(astro|md|mdx|html|js|ts)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

test('enlaces: todo target="_blank" avisa que abre otra pestaña (texto solo para lector de pantalla, WCAG G201) y lleva rel="noopener"', () => {
  let encontrados = 0;
  for (const archivo of archivosDeSrc()) {
    const fuente = readFileSync(archivo, 'utf8');
    for (const m of fuente.matchAll(/<a\b[^>]*target="_blank"[^>]*>[\s\S]*?<\/a>/g)) {
      encontrados += 1;
      const enlace = m[0];
      assert.match(enlace, /rel="[^"]*\bnoopener\b[^"]*"/, `${archivo}: falta rel="noopener"`);
      assert.match(
        enlace,
        /<span class="sr-only">\{formulario\.nuevaPestana\}<\/span>/,
        `${archivo}: falta el aviso de nueva pestaña`,
      );
    }
    // Un <a> con target="_blank" que el patrón anterior no vea (otra forma de escribirlo) también cuenta.
    const total = (fuente.match(/target="_blank"/g) ?? []).length;
    const vistos = [...fuente.matchAll(/<a\b[^>]*target="_blank"/g)].length;
    assert.equal(total, vistos, `${archivo}: hay target="_blank" fuera de un <a> escrito a mano`);
  }
  assert.ok(encontrados >= 1, 'el formulario tiene el enlace de privacidad en pestaña nueva');
});

test('formulario: el aviso de nueva pestaña vive en el diccionario, en español neutro', () => {
  assert.equal(textosFormulario.nuevaPestana, '(se abre en otra pestaña)');
});

test('póster: sizes por defecto refleja el ancho real del marco (230px entre 426 y 859px, 330px desde 860px)', () => {
  assert.match(poster, /sizes = '\(min-width: 860px\) 330px, \(min-width: 426px\) 230px, 54vw'/);
});

test('formulario: el resumen de errores se puede enfocar por código (tabindex -1) para recibir el foco tras un error', () => {
  const resumen = etiquetaCon(formulario, 'id="anotarme-resumen"');
  assert.match(resumen, /tabindex="-1"/);
  assert.match(resumen, /role="alert"/);
});

test('formulario: aria-invalid no está escrito en ningún <fieldset> (lo ponen los controles al pintar errores)', () => {
  for (const id of ['campo-live-frequency', 'campo-stream-type', 'campo-interests']) {
    const grupo = etiquetaCon(formulario, `id="${id}"`);
    assert.match(grupo, /^<fieldset/);
    assert.doesNotMatch(grupo, /aria-invalid/);
    assert.match(grupo, /aria-describedby="error-/, `${id} conserva aria-describedby`);
  }
});
