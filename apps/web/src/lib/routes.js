// @ts-check
// Qué rutas existen y cuáles se indexan. Es la única lista que usan el sitemap y las pruebas de dist.

import { fichaHref, sortByOrden } from './catalog.js';

/** Páginas que existen pero no se indexan ni van en el sitemap. */
export const NOINDEX_ROUTES = Object.freeze(['/confirmar', '/404']);

/** Rutas que NO deben existir (la portada es la única vitrina; no hay índice de juegos ni páginas por categoría). */
export const ABSENT_ROUTES = Object.freeze(['/juegos', '/categorias', '/como-funciona']);

/**
 * Rutas indexables, en orden: la portada, las fichas de juegos (los conceptos no tienen) y las páginas legales.
 * @param {{ juegos: readonly import('./catalog.js').EntradaJuego[], legales: readonly { id: string }[] }} contenido
 * @returns {string[]}
 */
export function indexableRoutes({ juegos, legales }) {
  const fichas = sortByOrden(juegos)
    .map((j) => fichaHref(j))
    .filter((href) => href !== null);
  const legal = legales.map((l) => `/legal/${l.id}`).sort();
  return ['/', ...fichas, ...legal];
}
