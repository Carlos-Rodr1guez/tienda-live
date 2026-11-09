// La lista de palabras vetadas del proyecto para los textos que ve el público (CB-4, H15, H23) y el escáner que la
// aplica. Es el ÚNICO archivo del juego que contiene estas palabras: ningún texto del producto puede traerlas.
//
// - Coincidencia por PALABRA completa (límite con letras y dígitos Unicode, no con `\b`, que no trata bien las tildes).
// - Se pliegan acentos y mayúsculas antes de comparar: "GUERRA", "Guérra" y "guerra" son lo mismo.
// - `trench`, `warfare` y `1917` cubren el título del juego comercial de referencia (SHOULD de CB-4).
// - `directo` va entero: "Nuevo directo" falla; "director" o "indirecto" pasan (el mercado LATAM dice "en vivo").

/** Palabras vetadas, ya plegadas (sin acentos, en minúsculas). */
export const FORBIDDEN = Object.freeze(['guerra', 'trench', 'warfare', '1917', 'directo']);

/** Pliega acentos y mayúsculas. */
export const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const WORD = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${FORBIDDEN.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');

/**
 * Las palabras vetadas que contiene un texto (vacío si cumple).
 * @param {unknown} text
 * @returns {string[]}
 */
export function findForbidden(text) {
  return [...fold(text).matchAll(WORD)].map((m) => m[0]);
}

/** Ejemplos para probar el escáner: textos que deben fallar y textos parecidos que deben pasar. Viven aquí con la lista. */
export const EJEMPLOS = Object.freeze({
  mal: Object.freeze(['GUERRA', 'Trench', 'WARFARE', 'año 1917', 'Nuevo directo', 'la Guérra final', 'Trench-Run']),
  bien: Object.freeze(['El director del juego', 'Nuevo en vivo', 'indirecto', 'guerrero', 'año 19170', 'Pausa']),
});

/** Nombres del peor caso (break-ui): bidi, ancho cero, emoji, CJK, 1 y 200 caracteres. Se arman por código de punto. */
export const WORST_NAMES = Object.freeze([
  String.fromCodePoint(0x202e) + 'Ana' + String.fromCodePoint(0x200b) + '_23',
  String.fromCodePoint(0x1f600).repeat(24),
  '田中太郎さんの動画チャンネル',
  'x',
  'x'.repeat(200),
  'xX_el_mas_capo_del_live_Xx',
  '',
]);

/** Argumentos de muestra para llamar las plantillas: nombres, números y valores raros (tipo equivocado). */
const SAMPLE_ARGS = Object.freeze([
  ...WORST_NAMES,
  0,
  1,
  5000,
  -3,
  1e21,
  Number.NaN,
  Infinity,
  undefined,
  null,
  {},
  [],
]);

/**
 * Recorre todo lo que exporta un módulo de textos: las hojas de texto tal cual y las plantillas (funciones) llamadas
 * con argumentos de muestra. Devuelve `{path, text}` por cada texto que produce. Una plantilla que lanza o que no
 * devuelve un texto es un error: los datos del público nunca deben romper la pantalla.
 * @param {unknown} node
 * @param {readonly unknown[]} [samples]
 * @param {string} [path]
 * @returns {{path: string, text: string}[]}
 */
export function collectTexts(node, samples = SAMPLE_ARGS, path = 'S') {
  if (typeof node === 'string') return [{ path, text: node }];
  if (typeof node === 'function') {
    const out = [];
    const arity = Math.max(node.length, 3);
    for (let i = 0; i < samples.length; i++) {
      // la misma muestra en todos los argumentos, y una distinta por posición
      const args = Array.from({ length: arity }, (_, j) => samples[(i + j * 3) % samples.length]);
      for (const a of [args, Array.from({ length: arity }, () => samples[i])]) {
        const r = node(...a);
        if (typeof r !== 'string') throw new TypeError(`${path}(…) no devolvió un texto`);
        out.push({ path: `${path}(${a.map(String).join(', ').slice(0, 40)})`, text: r });
      }
    }
    return out;
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => collectTexts(v, samples, `${path}.${k}`));
  }
  return [];
}
