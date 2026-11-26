// @ts-check
// Reglas de redacción del producto, con listas negras que las pruebas aplican a todo el texto visible:
//   - voseo: el producto habla en español neutral con "tú", nunca con "vos" (tenés, podés, hacé...).
//   - presion-regalo: ningún texto empuja a regalar ni promete algo a cambio de regalar.
//   - azar: nada de ruletas, sorteos ni premios; el efecto de un regalo depende de su valor, no de la suerte.
// Las listas se pueden ampliar sin tocar nada más: son datos.

/** Formas de vos, con y sin pronombre, que no existen en español neutral con "tú". */
export const VOSEO = Object.freeze([
  'vos',
  'tenés',
  'tenes',
  'podés',
  'podes',
  'querés',
  'queres',
  'sos',
  'sabés',
  'hacés',
  'hacé',
  'tené',
  'poné',
  'vení',
  'andá',
  'dejá',
  'decí',
  'contá',
  'pedí',
  'elegí',
  'escribí',
  'seguí',
  'entrá',
  'mirá',
  'probá',
  'anotate',
  'registrate',
  'ponete',
  'fijate',
  'sumate',
  'apurate',
]);

/** Frases que presionan a regalar o prometen algo por regalar. */
export const GIFT_PRESSURE = Object.freeze([
  'regala para',
  'regala más',
  'regala ahora',
  'regálale',
  'regalale',
  'regálame',
  'gana regalando',
  'gánate',
  'tienes que regalar',
  'debes regalar',
  'multiplica tus regalos',
  'recupera lo que regalaste',
]);

/** Términos de azar a cambio de regalos. */
export const CHANCE = Object.freeze([
  'ruleta',
  'ruletas',
  'sorteo',
  'sorteos',
  'sortear',
  'premio',
  'premios',
  'azar',
  'suerte',
  'suertes',
]);

/** Las reglas por nombre. */
export const COPY_RULES = Object.freeze({
  voseo: VOSEO,
  'presion-regalo': GIFT_PRESSURE,
  azar: CHANCE,
});

/** @param {string} termino */
function escapar(termino) {
  return termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
}

/**
 * Una sola expresión por regla. El límite de palabra se arma con lookarounds Unicode porque `\b` de JavaScript
 * no trata las letras con tilde como parte de la palabra.
 * @param {readonly string[]} terminos
 */
function armarExpresion(terminos) {
  const alternativas = [...terminos].sort((a, b) => b.length - a.length).map(escapar);
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternativas.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
}

const EXPRESIONES = Object.entries(COPY_RULES).map(([regla, terminos]) => ({
  regla,
  expresion: armarExpresion(terminos),
}));

/**
 * Busca incumplimientos en un texto.
 * @param {unknown} texto
 * @returns {{ regla: string, termino: string }[]}  vacío si el texto cumple todas las reglas
 */
export function checkCopy(texto) {
  if (typeof texto !== 'string' || texto === '') return [];
  const encontrados = [];
  for (const { regla, expresion } of EXPRESIONES) {
    for (const m of texto.matchAll(expresion)) {
      encontrados.push({ regla, termino: m[0].toLowerCase().replace(/\s+/g, ' ') });
    }
  }
  return encontrados;
}
