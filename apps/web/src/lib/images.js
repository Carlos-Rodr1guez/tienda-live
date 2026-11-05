// @ts-check
// Resuelve el póster de una ficha. El campo `poster` es una ruta relativa a src/assets (por ejemplo
// "juegos/asedio/poster.png"); los componentes arman el mapa de módulos con import.meta.glob y esta función busca ahí.
// Un archivo que falta lanza un error: la construcción falla en lugar de publicar una ficha sin póster.
// Código puro (no usa import.meta.glob), así se prueba con node:test.

/** Carpeta de las imágenes del sitio, tal como la ve import.meta.glob. */
export const ASSETS_BASE = '/src/assets/';

/**
 * @typedef {object} MetadatosImagen
 * @property {string} src
 * @property {number} width
 * @property {number} height
 * @property {string} format
 */

/**
 * @param {string} ruta  relativa a src/assets, sin "..", sin barra inicial
 * @param {Record<string, { default: unknown }>} modulos  mapa de import.meta.glob con eager: true
 * @returns {MetadatosImagen}
 */
export function resolvePoster(ruta, modulos) {
  if (typeof ruta !== 'string' || ruta === '' || ruta.startsWith('/') || ruta.split('/').includes('..')) {
    throw new Error(`la ruta del póster no es válida: "${String(ruta)}"`);
  }
  const modulo = modulos[`${ASSETS_BASE}${ruta}`];
  if (!modulo) throw new Error(`falta el archivo del póster: src/assets/${ruta}`);
  const imagen = /** @type {Partial<MetadatosImagen> | string} */ (modulo.default);
  if (typeof imagen !== 'object' || typeof imagen.width !== 'number' || typeof imagen.height !== 'number') {
    throw new Error(`src/assets/${ruta} no es una imagen que Astro pueda procesar`);
  }
  return /** @type {MetadatosImagen} */ (imagen);
}
