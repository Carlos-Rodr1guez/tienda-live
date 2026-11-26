// @ts-check
// robots.txt: todo se puede rastrear salvo /confirmar (lleva un enlace personal) y /v1/ (la API).

import { absoluteUrl } from './seo.js';

/**
 * @param {string} site
 * @returns {string}
 */
export function buildRobots(site) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /confirmar',
    'Disallow: /v1/',
    '',
    `Sitemap: ${absoluteUrl(site, '/sitemap.xml')}`,
    '',
  ].join('\n');
}
