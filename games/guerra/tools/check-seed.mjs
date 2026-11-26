// Revisa la semilla de términos vetados (`public/js/data/nombres-vetados.js`) antes del primer LIVE: cuenta de 40 a 80
// términos (los de `contains` y los de `token`; `allow` no cuenta) y rechaza un término `contains` que se pliega a menos de
// 4 caracteres ("kkk" se pliega a "k": vetaría nombres inocentes), con "usa el modo token". No forma parte de `npm test`:
// lo corre el dueño con `node tools/check-seed.mjs`. Sale con código 1 si algo falla.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { foldForMatch } from '@tienda/kit/sim/words.js';

export const MIN_TERMS = 40;
export const MAX_TERMS = 80;
/** Largo mínimo, ya plegado, de un término del modo `contains`. */
export const MIN_FOLDED = 4;

/**
 * @param {{contains?: unknown[], token?: unknown[]} | null | undefined} seed
 * @returns {{count: number, ok: boolean, errors: string[]}}
 */
export function checkSeed(seed) {
  const contains = Array.isArray(seed?.contains) ? seed.contains : [];
  const token = Array.isArray(seed?.token) ? seed.token : [];
  const count = contains.length + token.length;
  const errors = [];
  // cada término es un texto no vacío, y ninguno se repite una vez plegado (la misma palabra con otra forma cuenta una sola vez)
  const vistos = new Map();
  for (const [modo, lista] of [
    ['contains', contains],
    ['token', token],
  ]) {
    for (const t of lista) {
      if (typeof t !== 'string' || t.trim() === '') {
        errors.push(`un término de "${modo}" no es un texto (o está vacío): ${JSON.stringify(t)}`);
        continue;
      }
      const f = foldForMatch(t);
      if (vistos.has(f)) errors.push(`"${t}" repite a "${vistos.get(f)}" (se comparan plegados)`);
      else vistos.set(f, t);
    }
  }
  if (count < MIN_TERMS || count > MAX_TERMS)
    errors.push(`la semilla tiene ${count} términos y debe tener de ${MIN_TERMS} a ${MAX_TERMS}`);
  for (const t of contains) {
    if (typeof t === 'string' && foldForMatch(t).length < MIN_FOLDED)
      errors.push(`"${t}" se pliega a menos de ${MIN_FOLDED} caracteres: usa el modo token`);
  }
  return { count, ok: errors.length === 0, errors };
}

// Como programa: carga el archivo de datos y dice qué pasa.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = new URL('../public/js/data/nombres-vetados.js', import.meta.url);
  const { NOMBRES_VETADOS } = await import(url.href);
  const r = checkSeed(NOMBRES_VETADOS);
  console.log(`${fileURLToPath(url)}: ${r.count} términos`);
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(r.ok ? 0 : 1);
}
