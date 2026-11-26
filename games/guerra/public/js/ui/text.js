// Texto del lienzo (CB-16, CB-17, D21 punto 16): lo que llega del público se limpia antes de dibujarse, se recorta por
// ANCHO MEDIDO (nunca por cantidad de caracteres) y las cifras se dibujan en celdas fijas para que no bailen al cambiar.
//
//   cleanText         quita caracteres de formato (bidi, ancho cero) y controles: un carácter bidi no puede dar vuelta
//                     el resto de la línea ni dejar un nombre invisible. Acepta cualquier tipo y nunca lanza
//   createTextFitter  recorte por grafemas con "…", con caché por valor (fuente, texto, ancho): lo que solo cambia
//                     con eventos no se re-mide ni se re-arma en cada cuadro
//   drawTabular       cifras tabulares: cada dígito ocupa la misma celda, así "1:11" y "9:59" miden lo mismo
//
// El módulo no toca el DOM: el dibujo recibe el contexto y la medición llega por argumento.

/** Una sola instancia: crear un segmentador por texto sería caro con miles de eventos. */
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const MAX_CHARS = 400;
/** Como mucho tantas celdas por texto tabular. */
const MAX_CELLS = 64;
const ELLIPSIS = '…';

/**
 * Texto limpio y seguro para dibujar: sin caracteres de formato (\p{Cf}: bidi, ancho cero, unión) ni controles
 * (\p{Cc}, que se vuelven espacio), con los espacios colapsados y como mucho 400 unidades.
 * @param {unknown} v
 */
export function cleanText(v) {
  let s;
  try {
    s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  } catch {
    return ''; // un objeto sin `toString` no rompe la pantalla
  }
  if (s.length > MAX_CHARS * 4) s = s.slice(0, MAX_CHARS * 4);
  s = s
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) : s;
}

/** Grafemas de un texto (un emoji compuesto es uno solo). */
function grafemas(text) {
  const out = [];
  for (const { segment } of SEGMENTER.segment(text)) out.push(segment);
  return out;
}

/**
 * Recortador con caché. `measure(font, text)` da el ancho en px de dispositivo con esa fuente.
 * @param {{measure: (font: string, text: string) => number, maxEntries?: number}} o
 */
export function createTextFitter({ measure, maxEntries = 512 }) {
  /** @type {Map<string, {text: string, width: number, cut: boolean}>} */
  const cache = new Map();
  let hits = 0;
  let misses = 0;

  function calcular(font, text, maxWidth) {
    const w = measure(font, text);
    if (w <= maxWidth) return { text, width: w, cut: false };
    const gs = grafemas(text);
    // el ancho de un prefijo + "…" crece con el prefijo: búsqueda binaria del más largo que cabe
    let lo = 0;
    let hi = gs.length - 1;
    let mejor = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cand = gs.slice(0, mid).join('').trimEnd() + ELLIPSIS;
      const cw = measure(font, cand);
      if (cw <= maxWidth) {
        mejor = { text: cand, width: cw, cut: true };
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // ni siquiera "…" cabe: se devuelve igual (una caja de 0 px no tiene salida mejor)
    return mejor ?? { text: ELLIPSIS, width: measure(font, ELLIPSIS), cut: true };
  }

  return {
    /**
     * @param {string} font valor de `ctx.font` con que se medirá y se dibujará
     * @param {unknown} raw texto crudo (se limpia)
     * @param {number} maxWidth ancho máximo en px de dispositivo
     */
    fit(font, raw, maxWidth) {
      const text = cleanText(raw);
      const limite = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
      const key = `${font}\u0000${limite}\u0000${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) {
        hits++;
        return hit;
      }
      misses++;
      const r = text === '' ? { text: '', width: 0, cut: false } : calcular(font, text, limite);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value); // el más viejo
      cache.set(key, r);
      return r;
    },
    /** Vacía la caché: llegó una fuente y los anchos cambian. */
    clear() {
      cache.clear();
    },
    stats: () => ({ hits, misses, size: cache.size }),
  };
}

/** Anchos medidos por fuente: la celda de una cifra (el mayor de 0 a 9) y los demás caracteres, sin re-medir por cuadro. */
const anchos = new Map();
function tabla(font) {
  let t = anchos.get(font);
  if (t === undefined) {
    if (anchos.size > 32) anchos.clear();
    t = new Map();
    anchos.set(font, t);
  }
  return t;
}
/** Llegó una fuente (mismo `ctx.font`, otros anchos) o cambió la escala: las celdas y los anchos medidos se vuelven a medir. */
export function clearWidths() {
  anchos.clear();
}
function celdaDigito(ctx, font) {
  const t = tabla(font);
  let c = t.get('digit');
  if (c === undefined) {
    c = 0;
    for (let d = 0; d <= 9; d++) c = Math.max(c, Number(ctx.measureText(String(d))?.width) || 0);
    t.set('digit', c);
  }
  return c;
}

/**
 * Dibuja cifras en celdas fijas: cada dígito ocupa la misma celda (la de la cifra más ancha de la fuente) y el resto
 * de los caracteres su ancho. Deja `ctx.textAlign = 'left'`. Para el reloj, los porcentajes y la XP.
 * @param {any} ctx contexto 2D con `font` ya puesta
 * @param {unknown} raw
 * @param {number} x
 * @param {number} y
 * @param {'left'|'right'|'center'} align
 * @param {string} font el mismo valor que `ctx.font` (clave de la caché de la celda)
 */
export function drawTabular(ctx, raw, x, y, align, font) {
  const text = cleanText(raw).slice(0, MAX_CELLS);
  if (text === '') return;
  const cell = celdaDigito(ctx, font);
  const t = tabla(font);
  const ancho = (ch) => {
    if (ch >= '0' && ch <= '9') return cell;
    let w = t.get(ch);
    if (w === undefined) {
      w = Number(ctx.measureText(ch)?.width) || 0;
      t.set(ch, w);
    }
    return w;
  };
  let total = 0;
  for (const ch of text) total += ancho(ch);
  let px = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, Math.round(px), y);
    px += ancho(ch);
  }
}
