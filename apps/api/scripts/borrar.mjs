// Runbook de borrado (WL-14): borra de la lista de espera a la persona con ese correo, confirmada o no.
// Uso (desde apps/api): `npm run borrar -- ana@example.com` (base local) o con `--remote` (la real, solo el dueño).
// Imprime cuántas filas borró y nada más: ni el correo ni otros datos.

import { pathToFileURL } from 'node:url';
import { normalizeEmail } from '@tienda/contracts/waitlist';
import { rowCountOf, runD1 } from './wrangler-d1.mjs';

/**
 * @param {string[]} argv
 * @returns {{ email: string, remote: boolean }}
 */
export function parseBorrarArgs(argv) {
  let remote = false;
  /** @type {string[]} */
  const correos = [];
  for (const arg of argv) {
    if (arg === '--remote') remote = true;
    else if (arg.startsWith('--')) throw new Error(`opción desconocida: ${arg} (solo existe --remote)`);
    else correos.push(arg);
  }
  if (correos.length === 0) throw new Error('falta el correo: npm run borrar -- ana@example.com [--remote]');
  if (correos.length > 1) throw new Error('se borra un solo correo por vez');
  return { email: correos[0], remote };
}

/**
 * El DELETE para ese correo, normalizado como al guardarlo. La comilla simple se duplica (estándar SQL), así que el
 * valor nunca sale del texto entre comillas. El mensaje de error no repite lo que se escribió.
 * @param {string} email
 */
export function buildDeleteSql(email) {
  const normalizado = normalizeEmail(email);
  if (!normalizado.ok) throw new Error(`correo inválido (${normalizado.code})`);
  // RETURNING id: así se cuentan las filas borradas aunque Wrangler no informe `changes`. Solo el conteo se imprime.
  return `DELETE FROM waitlist WHERE email = '${normalizado.value.replaceAll("'", "''")}' RETURNING id`;
}

/**
 * @param {number} filas
 * @param {{ remote: boolean }} opciones
 */
export function formatBorrado(filas, { remote }) {
  return `Filas borradas (base ${remote ? 'remota' : 'local'}): ${filas}`;
}

function main() {
  const { email, remote } = parseBorrarArgs(process.argv.slice(2));
  const sql = buildDeleteSql(email);
  console.log(formatBorrado(rowCountOf(runD1({ sql, remote })), { remote }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
