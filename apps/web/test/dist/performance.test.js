// (CI) Rendimiento y peticiones externas de la portada: JavaScript propio de hasta 20 KB comprimido, sin pedir nada a otros
// orígenes (salvo Turnstile, que se carga al abrir el formulario, y el beacon, solo si hay token) y `_headers` con y sin
// beacon. Necesita `dist` (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildHeadersFile } from '@tienda/contracts/security-headers';
import { DIST, atributo, buscar, elementos, leerDist, parsear } from './support/html.js';

const LIMITE_JS_GZIP = 20 * 1024;
const CON_BEACON = Boolean(process.env.PUBLIC_CF_BEACON_TOKEN);
const home = parsear(leerDist('index.html'));

/** Los módulos que carga la portada: sus <script src> y todo lo que esos módulos importan, de forma transitiva. */
function modulosDeLaPortada() {
  const pendientes = buscar(home, 'script')
    .map((s) => atributo(s, 'src'))
    .filter(Boolean);
  const vistos = new Map();
  while (pendientes.length > 0) {
    const ruta = pendientes.pop();
    if (vistos.has(ruta)) continue;
    const texto = leerDist(ruta.replace(/^\//, ''));
    vistos.set(ruta, texto);
    for (const m of texto.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      // las rutas de los módulos son relativas a la carpeta _astro
      pendientes.push(`/_astro/${m[1].replace(/^\.\.?\//, '')}`);
    }
  }
  return vistos;
}

test('rendimiento: el JavaScript propio de la portada pesa 20 KB comprimido o menos', () => {
  const modulos = modulosDeLaPortada();
  assert.ok(modulos.size >= 1, 'la portada carga al menos un módulo (formulario)');
  const total = [...modulos.values()].reduce((suma, js) => suma + gzipSync(js).length, 0);
  assert.ok(total <= LIMITE_JS_GZIP, `${total} bytes comprimidos (límite ${LIMITE_JS_GZIP})`);
});

test('rendimiento: la portada no pide nada a otro origen en su HTML (Turnstile y el beacon se cargan desde el JavaScript)', () => {
  const externos = elementos(home)
    .flatMap((e) => [atributo(e, 'src'), e.tagName === 'link' ? atributo(e, 'href') : null])
    .filter((url) => /^(?:https?:)?\/\//.test(url ?? ''));
  assert.deepEqual(externos, []);
});

test('rendimiento: Turnstile aparece solo como cadena del módulo del formulario y el beacon solo con token', () => {
  const js = [...modulosDeLaPortada().values()].join('\n');
  assert.ok(js.includes('challenges.cloudflare.com/turnstile/v0/api.js'), 'el módulo del formulario conoce Turnstile');
  const todos = readdirSync(join(DIST, '_astro'))
    .filter((n) => n.endsWith('.js'))
    .map((n) => leerDist(`_astro/${n}`))
    .join('\n');
  assert.equal(todos.includes('cloudflareinsights'), CON_BEACON);
});

test('rendimiento: _headers existe y permite el beacon solo cuando se construyó con token', () => {
  assert.ok(existsSync(join(DIST, '_headers')), 'falta dist/_headers');
  const real = leerDist('_headers');
  assert.equal(real, buildHeadersFile({ beacon: CON_BEACON }));
  assert.equal(real.includes('static.cloudflareinsights.com'), CON_BEACON);
  // y las dos variantes cumplen los límites de Cloudflare
  for (const beacon of [false, true]) {
    const contenido = buildHeadersFile({ beacon });
    assert.ok(contenido.split('\n').every((linea) => linea.length <= 2000));
  }
  assert.ok(
    buildHeadersFile({ beacon: true }).includes('static.cloudflareinsights.com') &&
      !buildHeadersFile({ beacon: false }).includes('static.cloudflareinsights.com'),
  );
});
