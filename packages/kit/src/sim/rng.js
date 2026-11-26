// Azar con semilla, solo para lo cosmético de la vista y el modo automático del simulador.
// El sim de Batalla no lo importa: su resultado no depende de ningún azar.

import { hashKey } from './words.js';

/**
 * @param {number} seed
 * @returns {() => number} valores en [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Semilla de 32 bits a partir de un texto (FNV-1a).
 * @param {string} str
 * @returns {number}
 */
export function seedFrom(str) {
  return hashKey(str);
}
