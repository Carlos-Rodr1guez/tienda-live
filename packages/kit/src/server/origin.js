// Defensa del servidor local contra páginas ajenas (D6): `/ws` y `/api/simulate` solo aceptan al propio juego. El `Host` tiene
// que ser de loopback (contra el reenlace de DNS) y, si el navegador manda `Origin`, tiene que ser el mismo origen que el
// `Host` (misma dirección y mismo puerto): una página abierta en otro sitio no puede mandar eventos falsos ni leer el puente.
// Un cliente que no es un navegador (sin `Origin`, como el simulador de las pruebas o `curl`) se acepta.

import { HOST_OK } from './session.js';

/**
 * @param {{headers?: Record<string, string | string[] | undefined>}} req
 * @returns {boolean}
 */
export function sameOriginLoopback(req) {
  const host = String(req.headers?.host ?? '');
  if (!HOST_OK.test(host)) return false;
  const origin = req.headers?.origin;
  if (origin === undefined) return true;
  try {
    const u = new URL(String(origin));
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
