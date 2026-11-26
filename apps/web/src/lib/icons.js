// @ts-check
// Juego de iconos propio: 24px, un solo grosor de trazo y color heredado (currentColor). Nada de emoji ni de símbolos
// de texto como icono. El componente Icon.astro pone el <svg> (trazo, relleno y atributos de accesibilidad) y acá
// viven solo las formas.

/** Grosor de trazo de todos los iconos. */
export const ICON_STROKE = 1.75;

/** @type {Record<string, string>} */
const FORMAS = {
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5L21 19.5H3L12 3.5Z"/><path d="M12 10v4.25"/><path d="M12 17.25h.01"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 8.25l8 5.75 8-5.75"/>',
};

/** Nombres de los iconos. */
export const ICON_NAMES = Object.freeze(['chevron', 'check', 'alert', 'mail']);

/**
 * Las formas de un icono (sin el <svg> que las envuelve). Falla si no existe.
 * @param {unknown} nombre
 * @returns {string}
 */
export function iconShapes(nombre) {
  const formas = typeof nombre === 'string' ? FORMAS[nombre] : undefined;
  if (!formas) throw new Error(`no existe el icono "${String(nombre)}"`);
  return formas;
}
