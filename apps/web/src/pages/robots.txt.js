// @ts-check
// robots.txt: lo arma lib/robots.js con el origen del sitio (SITE_URL).

import { buildRobots } from '../lib/robots.js';

/** @type {import('astro').APIRoute} */
export const GET = ({ site }) => {
  if (!site) throw new Error('robots.txt necesita `site` en astro.config.mjs (SITE_URL)');
  return new Response(buildRobots(site.origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
