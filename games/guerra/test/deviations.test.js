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

/** Direcciones http(s) que no son de localhost. Devuelve una lista de `archivo: url`. */
export function findThirdPartyUrls(dir) {
  const hits = [];
  for (const file of walk(dir).filter((f) => TEXT.test(f))) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/https?:\/\/([^\s/'"`)<>\\]+)/gi)) {
      const host = m[1].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (host !== 'localhost') hits.push(`${path.relative(dir, file)}: ${m[0]}`);
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

test('DOC-2: public/ no trae ninguna URL de terceros (solo localhost)', () => {
  assert.deepEqual(findThirdPartyUrls(PUBLIC), []);
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

test('CB-2: public/js no contiene datos de banderas, escudos ni himnos en ningún archivo de render', () => {
  const prohibido = /\b(bandera|flag|escudo|himno|anthem|coat[-_ ]?of[-_ ]?arms)s?\b/i;
  // los comentarios pueden decir "sin bandera"; el código no define datos con esos nombres
  for (const f of walk(path.join(GJ, 'render')).filter((x) => /\.js$/.test(x))) {
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
