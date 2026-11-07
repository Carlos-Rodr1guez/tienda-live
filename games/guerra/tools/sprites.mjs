// Genera `public/js/data/sprites.js` desde `tools/sprite-recipes.js` (solo desarrollo; el navegador carga el archivo
// generado). Se corre a propósito: `npm run sprites -w batalla-paises`. El archivo generado se versiona.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSprites } from './sprite-recipes.js';

const sprites = buildSprites();

const fila = (r) => JSON.stringify(r);
const lista = (rows, sangria) => `[\n${rows.map((r) => `${sangria}  ${fila(r)},`).join('\n')}\n${sangria}]`;

function emitir(valor, sangria = '') {
  if (Array.isArray(valor) && valor.every((v) => typeof v === 'string')) return lista(valor, sangria);
  if (Array.isArray(valor) && valor.every((v) => Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
    return `[\n${valor.map((v) => `${sangria}  ${emitir(v, `${sangria}  `)},`).join('\n')}\n${sangria}]`;
  }
  if (Array.isArray(valor)) return `[${valor.map((v) => emitir(v, sangria)).join(', ')}]`;
  if (valor !== null && typeof valor === 'object') {
    const partes = Object.entries(valor).map(([k, v]) => `${sangria}  ${k}: ${emitir(v, `${sangria}  `)},`);
    return `{\n${partes.join('\n')}\n${sangria}}`;
  }
  return JSON.stringify(valor);
}

const salida = [
  '// GENERADO por `npm run sprites -w batalla-paises` (tools/sprites.mjs). No se edita a mano: se cambia la receta.',
  '// Sprites en filas de texto indexadas por paleta (o d t h s k g l m b w y r f a c; "." es transparente). Solo datos:',
  '// ningún dato por país (CB-2) y ningún archivo ráster. Miran al este; el espejo y las variantes se hornean al cargar.',
  '',
  `export const SPRITES = ${emitir(sprites)};`,
  '',
].join('\n');

const destino = fileURLToPath(new URL('../public/js/data/sprites.js', import.meta.url));
fs.writeFileSync(destino, salida);
const n = Object.keys(sprites).filter((k) => typeof sprites[k] === 'object' && sprites[k].anims).length;
console.log(`sprites.js escrito: ${n} sprites`);
