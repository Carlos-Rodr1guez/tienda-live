// @ts-check
// Web Analytics de Cloudflare, sin cookies. Solo se agrega si al construir hubo token (PUBLIC_CF_BEACON_TOKEN), si la
// página tiene la analítica encendida (<html data-analytics="on">) y nunca en /confirmar, cuya URL lleva un enlace
// personal. El script se agrega desde un módulo agrupado y no con un <script> en línea: así la política de contenido
// no necesita hashes ni 'unsafe-inline'.

import { isTrackedPath } from './analytics.js';

/** Script del beacon (su origen está permitido en la CSP solo cuando se construye con token). */
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/**
 * Los atributos del <script> del beacon, o null si no hay un token usable.
 * @param {unknown} token
 * @returns {{ src: string, defer: string, 'data-cf-beacon': string } | null}
 */
export function beaconAttributes(token) {
  if (typeof token !== 'string' || token.trim() === '') return null;
  return { src: BEACON_SRC, defer: '', 'data-cf-beacon': JSON.stringify({ token: token.trim() }) };
}

/**
 * Agrega el beacon al <head> si corresponde.
 * @param {{
 *   token: unknown,
 *   doc: Document,
 *   pathname: string,
 * }} entrada
 * @returns {boolean}  true si se agregó
 */
export function injectBeacon({ token, doc, pathname }) {
  const atributos = beaconAttributes(token);
  if (!atributos || doc.documentElement.dataset.analytics !== 'on' || !isTrackedPath(pathname)) return false;
  const script = doc.createElement('script');
  for (const [nombre, valor] of Object.entries(atributos)) script.setAttribute(nombre, valor);
  doc.head.append(script);
  return true;
}
