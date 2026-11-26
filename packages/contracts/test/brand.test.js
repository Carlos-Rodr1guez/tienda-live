import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from '../src/brand.js';
import { CONSENT_VERSION } from '../src/consent.js';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const EXTENSIONES = new Set(['.js', '.mjs', '.ts', '.astro', '.html', '.css', '.svg']);
const IGNORAR = new Set(['node_modules', 'dist', '.astro', '.wrangler', '.dev-state']);

/** Todos los archivos de código y marcado de `apps/*\/src` y `packages/*\/src`. */
function archivosFuente() {
  const salida = [];
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      if (IGNORAR.has(nombre)) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (EXTENSIONES.has(nombre.slice(nombre.lastIndexOf('.')))) salida.push(ruta);
    }
  };
  for (const grupo of ['apps', 'packages']) {
    for (const paquete of readdirSync(join(RAIZ, grupo))) {
      const src = join(RAIZ, grupo, paquete, 'src');
      try {
        if (statSync(src).isDirectory()) recorrer(src);
      } catch {
        // el paquete no tiene src todavía
      }
    }
  }
  return salida;
}

test('brand: la configuración tiene nombre, lema, URL por defecto, correo y entidad legal', () => {
  assert.equal(BRAND.name, 'Tienda LIVE');
  assert.equal(typeof BRAND.tagline, 'string');
  assert.ok(BRAND.tagline.length > 0);
  assert.equal(BRAND.siteUrlDefault, 'http://localhost:8790');
  assert.equal(BRAND.contactEmail, null, 'el correo de contacto queda pendiente hasta tener marca');
  assert.equal(BRAND.legalEntity, null, 'la entidad legal queda pendiente hasta tener marca');
  assert.ok(Object.isFrozen(BRAND));
});

test('brand: el escaneo encuentra archivos de código (si no, el escaneo de abajo no probaría nada)', () => {
  const rutas = archivosFuente().map((r) => relative(RAIZ, r).split(sep).join('/'));
  assert.ok(rutas.includes('packages/contracts/src/brand.js'), 'brand.js debería estar entre los escaneados');
  assert.ok(rutas.includes('packages/contracts/src/enums.js'));
});

test('brand: el nombre de la marca no está escrito en ningún otro archivo de apps/*/src ni packages/*/src', () => {
  const infractores = [];
  for (const ruta of archivosFuente()) {
    const rel = relative(RAIZ, ruta).split(sep).join('/');
    if (rel === 'packages/contracts/src/brand.js') continue;
    if (readFileSync(ruta, 'utf8').toLowerCase().includes(BRAND.name.toLowerCase())) infractores.push(rel);
  }
  assert.deepEqual(infractores, [], 'usa {marca} en el diccionario o BRAND.name en el código');
});

test('consent: la versión vigente es v1 y cumple el formato de la especificación', () => {
  assert.equal(CONSENT_VERSION, 'v1');
  assert.match(CONSENT_VERSION, /^v[0-9]{1,3}$/);
});
