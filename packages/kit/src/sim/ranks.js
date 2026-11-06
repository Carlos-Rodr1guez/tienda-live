// Escalera de rangos (KIT-22). El rango sale de la XP de LIVE, nunca de las monedas solas.
// Los umbrales viven en la config del juego; aquí solo se validan y se consultan.

import { ConfigError } from './config.js';

/** @typedef {{id:string, label:string, xp:number}} Rank */

/** Tabla del diseño (§3.5). El General es el último y se puede apagar con `general: false`. */
export const DEFAULT_LADDER = Object.freeze(
  [
    ['recluta', 'Recluta', 0],
    ['soldado', 'Soldado', 1],
    ['cabo', 'Cabo', 25],
    ['sargento', 'Sargento', 75],
    ['teniente', 'Teniente', 200],
    ['capitan', 'Capitán', 500],
    ['mayor', 'Mayor', 1200],
    ['coronel', 'Coronel', 3000],
    ['general', 'General', 7500],
  ].map(([id, label, xp]) => Object.freeze({ id, label, xp })),
);

/** Id del rango que solo existe si `general` está activo. */
const GENERAL_ID = 'general';

/**
 * Valida la escalera y la devuelve congelada. Lanza ConfigError si no empieza en 0 o si los umbrales no
 * ascienden de forma estricta (el mensaje nombra el umbral repetido o el que baja).
 * @param {{ladder?: Rank[], general?: boolean}} o `general` es true por defecto
 * @returns {readonly Rank[]}
 */
export function compileLadder(o) {
  const list = o?.ladder;
  if (!Array.isArray(list) || list.length === 0) throw new ConfigError('la escalera de rangos está vacía');
  const keep = o.general === false ? list.filter((r) => r?.id !== GENERAL_ID) : list;
  const out = [];
  for (const r of keep) {
    if (!r || typeof r.id !== 'string' || !r.id || typeof r.label !== 'string' || !r.label.trim()) {
      throw new ConfigError('cada rango necesita id y nombre');
    }
    if (!Number.isFinite(r.xp)) throw new ConfigError(`el umbral del rango "${r.id}" no es un número`);
    out.push(Object.freeze({ id: r.id, label: r.label, xp: r.xp }));
  }
  if (out.length === 0) throw new ConfigError('la escalera de rangos está vacía');
  if (out[0].xp !== 0) throw new ConfigError(`el primer rango debe empezar en 0 de XP, no en ${out[0].xp}`);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].xp;
    const cur = out[i].xp;
    if (cur === prev) throw new ConfigError(`umbral ${cur} repetido en la escalera de rangos`);
    if (cur < prev) throw new ConfigError(`el umbral ${cur} baja respecto de ${prev}: la escalera debe ascender`);
  }
  return Object.freeze(out);
}

/**
 * Índice del mayor umbral <= xp, por búsqueda binaria. XP negativa o inválida da 0.
 * @param {readonly Rank[]} ladder escalera ya compilada
 * @param {number} xp
 * @returns {number}
 */
export function rankAt(ladder, xp) {
  if (!(xp > 0)) return 0;
  let lo = 0;
  let hi = ladder.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ladder[mid].xp <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
