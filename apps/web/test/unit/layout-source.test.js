import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerPropiedades } from '../support/css.js';

// Comprobaciones sobre el texto de los componentes. La página ya construida se prueba en test/dist (CI); acá se
// fijan las decisiones que se pueden ver en el código fuente sin construir.

const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
const layout = leer('src/layouts/BaseLayout.astro');
const pie = leer('src/components/SiteFooter.astro');
const tokens = leerPropiedades(leer('src/styles/tokens.css'));

test('layout: importa la fuente, los tokens y la base de estilos, en ese orden', () => {
  const orden = ["'@fontsource-variable/oxanium'", "'../styles/tokens.css'", "'../styles/base.css'"].map((s) =>
    layout.indexOf(s),
  );
  assert.ok(
    orden.every((i) => i > -1),
    'faltan imports',
  );
  assert.deepEqual(
    [...orden].sort((a, b) => a - b),
    orden,
  );
});

test('layout: precarga el woff2 latino que el CSS de la fuente pide (mismo archivo, con crossorigin)', () => {
  assert.match(layout, /oxanium-latin-wght-normal\.woff2\?url/);
  assert.match(layout, /<link\s+rel="preload"\s+as="font"\s+type="font\/woff2"\s+href=\{fuenteUrl\}\s+crossorigin/);
  const cssDeLaFuente = readFileSync(
    new URL('../../../../node_modules/@fontsource-variable/oxanium/index.css', import.meta.url),
    'utf8',
  );
  assert.match(cssDeLaFuente, /url\(\.\/files\/oxanium-latin-wght-normal\.woff2\)/);
});

test('layout: theme-color es el color de fondo del token, y el color-scheme es oscuro', () => {
  assert.match(layout, new RegExp(`<meta name="theme-color" content="${tokens.get('--bg')}"`, 'i'));
  assert.match(layout, /<meta name="color-scheme" content="dark"/);
});

test('layout: enlace para saltar primero, un solo <main id="contenido"> y el pie después', () => {
  const posiciones = [
    'class="skip-link" href="#contenido"',
    '<header',
    '<main id="contenido"',
    '<slot',
    '<SiteFooter',
  ].map((s) => layout.indexOf(s));
  assert.ok(
    posiciones.every((i) => i > -1),
    JSON.stringify(posiciones),
  );
  assert.deepEqual(
    [...posiciones].sort((a, b) => a - b),
    posiciones,
  );
});

test('layout: la cabecera lleva solo la marca (BRAND.name partido en el último espacio), sin nombre escrito a mano', () => {
  assert.match(layout, /splitWordmark\(BRAND\.name\)/);
  assert.match(layout, /href="\/"/);
  assert.ok(!/Tienda LIVE/.test(layout + pie), 'el nombre solo sale de brand.js');
  const cabecera = /<header[\s\S]*?<\/header>/.exec(layout)?.[0] ?? '';
  assert.ok(!/<nav/.test(cabecera), 'la cabecera no lleva menú');
});

test('layout: canonical solo en páginas indexables; robots, referrer y OG/Twitter salen de lib/seo.js', () => {
  assert.match(layout, /\{!noindex && <link rel="canonical"/);
  assert.match(layout, /buildSeo\(/);
  assert.match(layout, /OG_IMAGE_PATH/);
  assert.match(layout, /seo\.openGraph\.map/);
  assert.match(layout, /seo\.twitter\.map/);
  assert.match(layout, /\{referrer && <meta name="referrer"/);
});

test('layout: el beacon se carga desde un módulo agrupado, nunca con un script en línea ni de otro origen', () => {
  assert.match(layout, /<script>\s*import '\.\.\/lib\/beacon-entry\.js';\s*<\/script>/);
  assert.match(layout, /data-analytics=\{analytics \? 'on' : 'off'\}/);
  assert.ok(!/is:inline|cloudflareinsights/.test(layout));
});

test('beacon: sin token al construir, el módulo del beacon ni se incluye (import dinámico detrás de una condición constante)', () => {
  const entrada = leer('src/lib/beacon-entry.js');
  assert.match(entrada, /const token = import\.meta\.env\.PUBLIC_CF_BEACON_TOKEN;/);
  assert.match(entrada, /if \(token\) \{[\s\S]*import\('\.\/beacon\.js'\)/);
  assert.ok(
    !/^import .*beacon\.js/m.test(entrada),
    'un import estático metería el origen de Cloudflare en todas las páginas',
  );
});

test('pie: el aviso de no afiliación sale del diccionario con la marca, y el contacto cae a "pendiente"', () => {
  assert.match(pie, /fmt\(pie\.noAfiliacion, \{ marca: BRAND\.name \}\)/);
  assert.match(pie, /BRAND\.contactEmail/);
  assert.match(pie, /pie\.pendiente/);
  for (const enlace of ['/legal/aviso', '/legal/privacidad', '/licencias/oxanium-OFL.txt']) {
    assert.ok(pie.includes(`href="${enlace}"`), enlace);
  }
});
