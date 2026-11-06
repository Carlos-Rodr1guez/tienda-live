// Configuración: mezcla de objetos, errores y topes numéricos. El sim de Batalla valida con esto al cargar.

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Error de configuración inválida: el juego lo muestra y no arranca con valores a medias. */
export class ConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Mezcla `over` sobre `base` sin tocar ninguno. Los arreglos se reemplazan enteros.
 * Ignora __proto__, constructor y prototype (JSON.parse crea "__proto__" como propiedad propia).
 * @param {any} base
 * @param {any} over
 * @returns {any}
 */
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over;
  if (base === null || typeof base !== 'object' || over === null || typeof over !== 'object') return over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (FORBIDDEN.has(k)) continue;
    out[k] = deepMerge(base[k], over[k]);
  }
  return out;
}

/**
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @param {number} dflt valor si `v` no es un número finito
 * @returns {number}
 */
export function clampNumber(v, min, max, dflt) {
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
