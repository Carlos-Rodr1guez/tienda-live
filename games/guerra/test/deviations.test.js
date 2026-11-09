import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAISES } from '../public/js/data/paises.js';
import { GOLDEN } from '../public/js/data/golden.js';
import { hashMatch } from '../public/js/sim/hash.js';
import { replayMatch } from '../public/js/sim/replay.js';
import { requestBaseDamage } from '../public/js/sim/base.js';
import { createWorld, stepWorld } from '../public/js/sim/world.js';
import { BASE_STATE_THRESHOLDS, baseState } from '../public/js/render/base-art.js';

// Reglas de forma del juego que ninguna otra prueba vigila: sin `three` (CB-18), sin URL de terceros (DOC-2)
// y sin sumideros de HTML ni almacenamiento del navegador (KIT-11, KIT-28, ADR 0012).
const GP = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(GP, 'public');
const GJ = path.join(PUBLIC, 'js');

/** Archivos de una carpeta, de forma recursiva (vacío si la carpeta no existe todavía). */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const TEXT = /\.(html|css|js|mjs|json|svg|txt|md)$/i;

/**
 * Las dos licencias de las fuentes (OFL 1.1) traen las direcciones del proyecto de cada fuente y la de la licencia, y no se
 * pueden editar. El escaneo las exime SOLO por ruta exacta y exige que sus únicas direcciones sean estas (DOC-2).
 */
export const OFL_EXENTOS = Object.freeze({
  'fonts/OFL-pixelify-sans.txt': ['https://github.com/eifetx/Pixelify-Sans', 'https://scripts.sil.org/OFL'],
  'fonts/OFL-silkscreen.txt': ['https://github.com/googlefonts/silkscreen', 'https://scripts.sil.org/OFL'],
});

/**
 * Direcciones http(s) que no son de localhost. Devuelve una lista de `archivo: url`. `exentos` mapea una ruta relativa
 * exacta a las únicas direcciones completas que ese archivo puede traer.
 */
export function findThirdPartyUrls(dir, exentos = {}) {
  const hits = [];
  for (const file of walk(dir).filter((f) => TEXT.test(f))) {
    const rel = path.relative(dir, file).replaceAll('\\', '/');
    if (Object.hasOwn(exentos, rel)) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s)'"`<>\\]+/gi)) {
        const url = m[0].replace(/[.,;:]+$/, '');
        if (!exentos[rel].includes(url)) hits.push(`${rel}: ${url}`);
      }
      continue;
    }
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/https?:\/\/([^\s/'"`)<>\\]+)/gi)) {
      const host = m[1].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (host !== 'localhost') hits.push(`${rel}: ${m[0]}`);
    }
  }
  return hits;
}

const STORAGE_AND_SINKS =
  /innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage|indexedDB|document\.cookie/;
const IMPORTS_THREE = /(?:from|import)\s*\(?\s*['"]three(?:\/[^'"]*)?['"]|require\(\s*['"]three/;

test('CB-18: el import map solo tiene los dos prefijos del kit, sin three ni three/addons/', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const raw = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(raw, 'index.html tiene un import map');
  const { imports } = JSON.parse(raw);
  assert.deepEqual(imports, {
    '@tienda/kit/sim/': './kit/sim/',
    '@tienda/kit/client/': './kit/client/',
  });
  assert.doesNotMatch(raw, /three/);
});

test('CB-18: ningún archivo de public/js importa three y package.json no lo lista', () => {
  for (const f of walk(GJ).filter((x) => /\.m?js$/.test(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), IMPORTS_THREE, path.relative(GP, f));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(GP, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.ok(!('three' in (pkg[field] ?? {})), `${field} no lista three`);
  }
  assert.equal(pkg.name, 'batalla-paises');
  assert.equal(pkg.dependencies['@tienda/kit'] !== undefined, true);
});

test('el detector de importar three reconoce las formas habituales', () => {
  for (const s of [
    "import * as THREE from 'three';",
    'import { OrbitControls } from "three/addons/controls/OrbitControls.js";',
    "const t = await import('three');",
    "const t = require('three');",
  ]) {
    assert.match(s, IMPORTS_THREE, s);
  }
  assert.doesNotMatch("import { x } from './three-shake.js';", IMPORTS_THREE);
});

test('DOC-2: public/ no trae ninguna URL de terceros (solo localhost) salvo las de las dos licencias OFL, por ruta exacta', () => {
  assert.deepEqual(findThirdPartyUrls(PUBLIC, OFL_EXENTOS), []);
  // sin la exención las licencias sí saltan: la exención existe y es la única razón por la que pasan
  const sinExencion = findThirdPartyUrls(PUBLIC);
  assert.ok(sinExencion.some((h) => h.startsWith('fonts/OFL-pixelify-sans.txt')));
  assert.ok(
    sinExencion.every((h) => h.startsWith('fonts/OFL-')),
    'solo las licencias traen direcciones',
  );
  assert.deepEqual(Object.keys(OFL_EXENTOS), ['fonts/OFL-pixelify-sans.txt', 'fonts/OFL-silkscreen.txt']);
});

test('DOC-2: una URL de más dentro de un OFL-*.txt falla; un .txt cualquiera con URL falla; la misma licencia en otra ruta falla', () => {
  const fx = (n) => path.join(GP, 'test', 'fixtures', n);
  assert.deepEqual(findThirdPartyUrls(fx('ofl-ok'), OFL_EXENTOS), [], 'las direcciones exactas pasan');
  const extra = findThirdPartyUrls(fx('ofl-extra'), OFL_EXENTOS);
  assert.deepEqual(extra, ['fonts/OFL-pixelify-sans.txt: https://example.org/mas']);
  const otro = findThirdPartyUrls(fx('ofl-otro-txt'), OFL_EXENTOS);
  assert.equal(otro.length, 1);
  assert.match(otro[0], /^fonts\/notas\.txt: https:\/\/scripts\.sil\.org/);
  const otraRuta = findThirdPartyUrls(fx('ofl-otra-ruta'), OFL_EXENTOS);
  assert.ok(otraRuta.length >= 1, 'la exención es por ruta exacta, no por nombre de archivo');
  // y el escaneo sigue fallando con https://example.com/x.png aunque haya exenciones
  assert.equal(findThirdPartyUrls(fx('third-party-url'), OFL_EXENTOS).length, 1);
});

test('DOC-2: el escáner de URL falla con un archivo que trae https://example.com/x.png y deja pasar localhost', () => {
  const fixture = path.join(GP, 'test', 'fixtures', 'third-party-url');
  const hits = findThirdPartyUrls(fixture);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /recurso\.css: https:\/\/example\.com/);
});

test('KIT-11 y KIT-28: public/js no usa sumideros de HTML, localStorage, sessionStorage, indexedDB ni cookies', () => {
  for (const f of walk(GJ).filter((x) => /\.m?js$/.test(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), STORAGE_AND_SINKS, path.relative(GP, f));
  }
  for (const s of [
    'el.innerHTML = x',
    'el.outerHTML = x',
    'el.insertAdjacentHTML("beforeend", x)',
    'document.write(x)',
    'localStorage.setItem("a", "b")',
    'sessionStorage.a',
    'indexedDB.open("x")',
    'document.cookie = "a=b"',
  ]) {
    assert.match(s, STORAGE_AND_SINKS, s);
  }
});

test('CB-9: el arte del mundo está en código: ningún archivo ráster ni SVG bajo public/ (png, jpg, gif, webp, svg)', () => {
  const rasters = walk(PUBLIC).filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(f));
  assert.deepEqual(
    rasters.map((f) => path.relative(PUBLIC, f)),
    [],
  );
});

/**
 * Archivos que recorre el escáner CB-2: todo `render/` y, desde el lote 6, todo `ui/`, porque los textos visibles
 * se mudaron a `ui/strings.js` y los HUD y pantallas se dibujan desde `ui/` (ampliación de cobertura, decisión 4).
 */
const cb2Files = () => ['render', 'ui'].flatMap((dir) => walk(path.join(GJ, dir)).filter((x) => /\.js$/.test(x)));

test('CB-2 (ampliación): el escáner recorre también GJ/ui/**, donde viven los textos visibles', () => {
  const rel = cb2Files().map((f) => path.relative(GJ, f).replaceAll('\\', '/'));
  assert.ok(rel.includes('ui/strings.js'), 'ui/strings.js está en el recorrido');
  assert.ok(rel.includes('render/labels.js'), 'render/ sigue en el recorrido');
  // y detecta un texto prohibido dentro de ui/ (la leyenda "Escudo" de la nota 40)
  const prohibido = /\b(bandera|flag|escudo|himno|anthem|coat[-_ ]?of[-_ ]?arms)s?\b/i;
  assert.match("legend: 'Escudo: grupo en defensa'", prohibido);
});

test('CB-2: public/js no contiene datos de banderas, escudos ni himnos en ningún archivo de render ni de ui', () => {
  const prohibido = /\b(bandera|flag|escudo|himno|anthem|coat[-_ ]?of[-_ ]?arms)s?\b/i;
  // los comentarios pueden decir "sin bandera"; el código no define datos con esos nombres
  for (const f of cb2Files()) {
    const src = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(src, prohibido, path.relative(GP, f));
  }
});

test('CB-19 (cosmético): ningún archivo del sim importa nada de render/: los estados y la secuencia no pueden leer reglas al revés', () => {
  for (const f of walk(path.join(GJ, 'sim')).filter((x) => /\.js$/.test(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /from\s+['"][^'"]*render\//, path.relative(GP, f));
  }
});

test('CB-19 (cosmético): con otros umbrales de estado el sim da el mismo hash, y la ronda termina en el paso en que la base llega a 0', () => {
  // la vista cambia sus umbrales y el sim ni se entera: mismo log, mismo hash
  const corre = () => hashMatch(replayMatch(GOLDEN.log, { steps: 3000, paises: PAISES, game: GOLDEN.game }));
  const a = corre();
  const otros = { cracks: 0.9, heavy: 0.1 };
  assert.notEqual(baseState(0.8, false, otros), baseState(0.8, false, BASE_STATE_THRESHOLDS));
  assert.equal(corre(), a);
  // la base llegó a 0 en este paso: ese mismo paso cierra la ronda, sin esperar a ninguna secuencia de la vista
  const w = createWorld({ hq: { hp: 1000 } });
  w.phase = 'battle';
  w.bases[1].bucket = 1e9; // cubo lleno: toda la vida sale de una vez
  requestBaseDamage(w, 1, 5000, { side: 0 });
  assert.equal(w.bases[1].hp, 0);
  const paso = w.step;
  stepWorld(w);
  assert.equal(w.over?.step, paso);
  assert.equal(w.over?.winner, 0);
});
