// Saneado de nombres y lista de nombres vetados (KIT-11, KIT-12). Los datos de la lista llegan por argumento.

import { foldForMatch } from './words.js';

export const ANON = 'anónimo';

// Una sola instancia: crear un segmentador por nombre sería caro con miles de eventos.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// Controles, formato (cero ancho, bidi, BOM, etiquetas), uso privado, indicadores regionales (las banderas no se
// dibujan nunca) y el carácter de reemplazo. No se usa \p{Cn}: depende de la versión de Unicode del motor.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\u{1F1E6}-\u{1F1FF}�]/gu;

/**
 * Deja un nombre listo para mostrarlo como texto: nunca como HTML.
 * @param {unknown} raw
 * @param {{maxGraphemes?: number, maxMarks?: number}} [o]
 * @returns {string}
 */
export function sanitizeName(raw, { maxGraphemes = 16, maxMarks = 3 } = {}) {
  let s = String(raw ?? '')
    .toWellFormed()
    .normalize('NFKC')
    .replace(INVISIBLE, '');
  s = s.replace(/[\p{Zl}\p{Zp}]/gu, ' ');
  s =
    maxMarks >= 1
      ? s.replace(new RegExp(String.raw`(\p{M}{${Math.floor(maxMarks)}})\p{M}+`, 'gu'), '$1')
      : s.replace(/\p{M}/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  let out = '';
  let n = 0;
  for (const { segment } of SEGMENTER.segment(s)) {
    if (n++ >= maxGraphemes) break;
    out += segment;
  }
  return out.trim() || ANON;
}

/** @param {unknown} list @returns {string[]} términos ya plegados y sin vacíos */
function folded(list) {
  return Array.isArray(list) ? list.map(foldForMatch).filter(Boolean) : [];
}

/** @param {string} text @param {string} sub @returns {number[]} posiciones (incluye solapadas) */
function positions(text, sub) {
  const out = [];
  for (let i = text.indexOf(sub); i !== -1; i = text.indexOf(sub, i + 1)) out.push(i);
  return out;
}

/**
 * @param {{contains?: string[], token?: string[], allow?: string[]} | null} [terms]
 * @returns {{isBlocked(name: string): boolean}}
 */
export function createBlocklist(terms) {
  const contains = folded(terms?.contains);
  const token = new Set(folded(terms?.token));
  const allow = folded(terms?.allow);
  return {
    isBlocked(name) {
      const whole = foldForMatch(name);
      if (!whole) return false;
      if (token.size) {
        if (token.has(whole)) return true;
        for (const t of String(name ?? '').split(/\s+/)) if (token.has(foldForMatch(t))) return true;
      }
      // Un término dentro del nombre cuenta salvo que una palabra permitida cubra ese tramo ("classic" cubre "ass").
      const covered = allow.flatMap((a) => positions(whole, a).map((p) => [p, p + a.length]));
      for (const term of contains) {
        for (const i of positions(whole, term)) {
          if (!covered.some(([from, to]) => from <= i && to >= i + term.length)) return true;
        }
      }
      return false;
    },
  };
}
