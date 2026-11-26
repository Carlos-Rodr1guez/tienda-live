// @ts-check
// sitemap.xml: solo páginas indexables, con URL absoluta y sin repetidas.

import { absoluteUrl } from './seo.js';
import { NOINDEX_ROUTES } from './routes.js';

/** @param {string} texto */
function escaparXml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {string} site
 * @param {readonly string[]} rutas  salen de `indexableRoutes`; si trae una ruta no indexable, falla
 * @returns {string}
 */
export function buildSitemap(site, rutas) {
  for (const ruta of rutas) {
    if (NOINDEX_ROUTES.includes(ruta)) throw new Error(`${ruta} no se indexa: no va en el sitemap`);
  }
  const urls = [...new Set(rutas)].map((ruta) => `  <url><loc>${escaparXml(absoluteUrl(site, ruta))}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
