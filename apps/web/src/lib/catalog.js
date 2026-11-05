// @ts-check
// Lógica pura del catálogo de juegos. Recibe entradas con la forma de la colección de Astro ({ id, data }) y no
// toca el sistema de archivos, así que se prueba con node:test sin Vite.
//
// Regla del catálogo: solo los juegos que NO son concepto tienen ficha (/juegos/<id>). Los conceptos salen como
// tarjetas "Próximamente" sin enlace.

/**
 * @typedef {object} DatosJuego
 * @property {string} nombre
 * @property {string} estado
 * @property {number} orden
 */
/** @typedef {{ id: string, data: DatosJuego }} EntradaJuego */

/**
 * Ordena por `orden` y, si empatan, por nombre (según el español). No modifica el arreglo recibido.
 * @template {EntradaJuego} T
 * @param {readonly T[]} entradas
 * @returns {T[]}
 */
export function sortByOrden(entradas) {
  return [...entradas].sort((a, b) => a.data.orden - b.data.orden || a.data.nombre.localeCompare(b.data.nombre, 'es'));
}

/**
 * Separa las fichas (juegos que no son concepto) de los próximos (conceptos), cada grupo ordenado.
 * @template {EntradaJuego} T
 * @param {readonly T[]} entradas
 * @returns {{ fichas: T[], proximos: T[] }}
 */
export function splitCatalog(entradas) {
  const ordenadas = sortByOrden(entradas);
  return {
    fichas: ordenadas.filter((j) => j.data.estado !== 'concepto'),
    proximos: ordenadas.filter((j) => j.data.estado === 'concepto'),
  };
}

/**
 * Enlace a la ficha, o null si el juego es un concepto (nunca se enlaza).
 * @param {EntradaJuego} entrada
 * @returns {string | null}
 */
export function fichaHref(entrada) {
  return entrada.data.estado === 'concepto' ? null : `/juegos/${entrada.id}`;
}

/**
 * Los id con página propia, para `getStaticPaths` de /juegos/[slug].
 * @param {readonly EntradaJuego[]} entradas
 * @returns {string[]}
 */
export function fichaIds(entradas) {
  return splitCatalog(entradas).fichas.map((j) => j.id);
}
