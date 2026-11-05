// @ts-check
// Ayudas internas de los validadores: forma del objeto y claves permitidas.

/**
 * Un objeto "plano": el que sale de JSON.parse o de un literal. Arreglos, null y clases quedan afuera.
 * @param {unknown} valor
 * @returns {valor is Record<string, unknown>}
 */
export function isPlainObject(valor) {
  if (typeof valor !== 'object' || valor === null) return false;
  const proto = Object.getPrototypeOf(valor);
  return proto === Object.prototype || proto === null;
}

/**
 * ¿Tiene el objeto alguna clave propia fuera de la lista? Incluye `__proto__` cuando viene de JSON.parse.
 * @param {Record<string, unknown>} objeto
 * @param {readonly string[]} permitidas
 */
export function hasUnknownKeys(objeto, permitidas) {
  return Object.keys(objeto).some((clave) => !permitidas.includes(clave));
}

/**
 * @param {readonly string[]} lista
 * @param {unknown} valor
 */
export function isOneOf(lista, valor) {
  return typeof valor === 'string' && lista.includes(valor);
}
