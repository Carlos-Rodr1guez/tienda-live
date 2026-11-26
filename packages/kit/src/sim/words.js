// Palabras y comparaciones de texto del kit. ESM puro: sin azar, sin reloj y sin nada del entorno.

/** Tabla leet: se aplica ANTES de quitar los símbolos, porque normWord borraría "@" y "$". */
export const LEET = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  8: 'b',
  9: 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '¡': 'i',
  '|': 'i',
  '€': 'e',
  '+': 't',
};

const MARKS = /\p{M}/gu;
const NOT_ALNUM = /[^\p{L}\p{N}]/gu;
// Una bandera son dos indicadores regionales; lo demás es un trozo de texto sin espacios.
const PIECES = /\p{Regional_Indicator}{2}|[^\s\p{Regional_Indicator}]+/gu;
const RI_BASE = 0x1f1e6;

/**
 * NFKC → minúsculas → NFD sin marcas → solo letras y dígitos.
 * Distinto de la versión de ASEDIO: aplica NFKC primero ("２" → "2").
 * @param {unknown} s
 * @returns {string}
 */
export function normWord(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(MARKS, '')
    .replace(NOT_ALNUM, '');
}

/**
 * Tokens de un comentario. Cada bandera (dos indicadores regionales) es un token propio "flag:PE",
 * aunque venga pegada a una palabra. Los demás tokens salen con normWord y los vacíos se descartan.
 * @param {unknown} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const out = [];
  for (const [piece] of String(text ?? '')
    .normalize('NFKC')
    .matchAll(PIECES)) {
    const cps = [...piece];
    if (cps.length === 2 && cps.every((c) => c.codePointAt(0) >= RI_BASE && c.codePointAt(0) <= RI_BASE + 25)) {
      out.push('flag:' + cps.map((c) => String.fromCharCode(65 + c.codePointAt(0) - RI_BASE)).join(''));
      continue;
    }
    const w = normWord(piece);
    if (w) out.push(w);
  }
  return out;
}

/**
 * Pliegue para la lista de nombres vetados: NFKC, minúsculas, leet, sin marcas, sin separadores
 * y con las repeticiones reducidas a una ("aaa" → "a").
 * @param {unknown} s
 * @returns {string}
 */
export function foldForMatch(s) {
  const lower = String(s ?? '')
    .normalize('NFKC')
    .toLowerCase();
  let leet = '';
  for (const ch of lower) leet += Object.hasOwn(LEET, ch) ? LEET[ch] : ch;
  return leet
    .normalize('NFD')
    .replace(MARKS, '')
    .replace(NOT_ALNUM, '')
    .replace(/(.)\1+/gu, '$1');
}

/**
 * Orden por punto de código (no por unidad UTF-16).
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function cmpCodePoints(a, b) {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const d = x.value.codePointAt(0) - y.value.codePointAt(0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
}

/**
 * FNV-1a de 32 bits sin signo: desempates estables, nunca azar.
 * @param {string} s
 * @returns {number}
 */
export function hashKey(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
