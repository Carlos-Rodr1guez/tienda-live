// LOD de marcas con histéresis (diseño D21 punto 5; CB-18). Se decide por cuadro y nunca por unidad: con la escala
// mostrada bajo `enterBelow` cada unidad es un rectángulo del color del equipo; vuelve a sprites con `exitAbove`.
// En el medio se conserva el estado anterior, así oscilar entre 0,95 y 1,05 cambia como máximo una vez.

import { ConfigError } from '@tienda/kit/sim/config.js';

export const LOD_DEFAULTS = Object.freeze({ enterBelow: 1.0, exitAbove: 1.1, marks: true });

const MIN = 0.5;
const MAX = 1.5;

/**
 * Valida `render.lod` de la config: los dos umbrales van en [0,5; 1,5] con `exitAbove > enterBelow`.
 * @param {{enterBelow?: number, exitAbove?: number, marks?: boolean}} [cfg]
 */
export function resolveLod(cfg = {}) {
  const lod = { ...LOD_DEFAULTS, ...cfg };
  for (const key of ['enterBelow', 'exitAbove']) {
    const v = lod[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN || v > MAX) {
      throw new ConfigError(`render.lod.${key} debe ser un número entre ${MIN} y ${MAX}`);
    }
  }
  if (!(lod.exitAbove > lod.enterBelow)) throw new ConfigError('render.lod.exitAbove debe ser mayor que enterBelow');
  lod.marks = lod.marks !== false;
  return lod;
}

/**
 * ¿Se dibujan marcas en este cuadro?
 * @param {number} s escala mostrada
 * @param {boolean} prev lo que se decidió en el cuadro anterior
 * @param {{enterBelow: number, exitAbove: number, marks: boolean}} [lod]
 */
export function lodFor(s, prev, lod = LOD_DEFAULTS) {
  if (!lod.marks) return false;
  if (s < lod.enterBelow) return true;
  if (s >= lod.exitAbove) return false;
  return prev;
}
