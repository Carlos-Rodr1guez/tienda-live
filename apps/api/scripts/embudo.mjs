// Informe del embudo H1. Uso (desde la raíz): `npm run embudo` (base local) o `npm run embudo -- --remote` (la real,
// solo el dueño). No imprime correos.

import { pathToFileURL } from 'node:url';
import { buildEmbudoSql, extractRows, formatEmbudo } from '../src/report/embudo.js';
import { runD1 } from './wrangler-d1.mjs';

/**
 * @param {string[]} argv
 * @returns {{ remote: boolean }}
 */
export function parseEmbudoArgs(argv) {
  let remote = false;
  for (const arg of argv) {
    if (arg === '--remote') remote = true;
    else throw new Error(`opción desconocida: ${arg} (solo existe --remote)`);
  }
  return { remote };
}

function main() {
  const { remote } = parseEmbudoArgs(process.argv.slice(2));
  const hoy = new Date().toISOString().slice(0, 10);
  const filas = extractRows(runD1({ sql: buildEmbudoSql(hoy), remote }));
  console.log(`(base ${remote ? 'remota' : 'local'})\n`);
  console.log(formatEmbudo(filas, { hoy }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
