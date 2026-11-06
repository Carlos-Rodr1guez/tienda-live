import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
