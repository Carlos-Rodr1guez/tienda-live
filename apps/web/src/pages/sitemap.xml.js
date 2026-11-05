// @ts-check
// sitemap.xml: solo las rutas indexables (portada, fichas de juegos que no son concepto y páginas legales).

import { getCollection } from 'astro:content';
import { indexableRoutes } from '../lib/routes.js';
import { buildSitemap } from '../lib/sitemap.js';

/** @type {import('astro').APIRoute} */
export const GET = async ({ site }) => {
  if (!site) throw new Error('sitemap.xml necesita `site` en astro.config.mjs (SITE_URL)');
  const [juegos, legales] = await Promise.all([getCollection('juegos'), getCollection('legal')]);
  const rutas = indexableRoutes({ juegos, legales });
  return new Response(buildSitemap(site.origin, rutas), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
