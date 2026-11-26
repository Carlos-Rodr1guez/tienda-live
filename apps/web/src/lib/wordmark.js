// @ts-check
// La marca de la cabecera: el nombre se parte en el último espacio y la última palabra va en dorado. El nombre llega
// de BRAND.name; acá nunca se escribe a mano.

/**
 * @param {unknown} nombre
 * @returns {{ inicio: string, final: string }}
 */
export function splitWordmark(nombre) {
  const limpio = typeof nombre === 'string' ? nombre.trim() : '';
  if (limpio === '') throw new Error('el nombre de la marca está vacío');
  const corte = limpio.lastIndexOf(' ');
  if (corte === -1) return { inicio: '', final: limpio };
  return { inicio: limpio.slice(0, corte).trim(), final: limpio.slice(corte + 1) };
}
