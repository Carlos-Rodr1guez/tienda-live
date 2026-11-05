// Ayudas compartidas por `embudo.mjs` y `borrar.mjs`: arman y corren `wrangler d1 execute` a través del lanzador
// (scripts/run.mjs), para que Wrangler use la carpeta de estado en D: y no escriba en C:.
// Por defecto la base es la LOCAL. `--remote` apunta a la base real de Cloudflare: solo lo corre el dueño.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_MJS = path.resolve(API_DIR, '..', '..', 'scripts', 'run.mjs');

/**
 * Los argumentos para el lanzador: `wrangler d1 execute DB --local|--remote --json --command <sql>`.
 * @param {{ sql: string, remote: boolean }} opciones
 */
export function buildD1Args({ sql, remote }) {
  return ['wrangler', 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--json', '--command', sql];
}

/**
 * Wrangler puede imprimir avisos antes del JSON: se parte desde la primera línea que abre una lista o un objeto.
 * @param {string} texto
 * @returns {any}
 */
export function parseWranglerJson(texto) {
  const lineas = texto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => /^\s*[[{]/.test(l));
  if (inicio === -1) throw new Error('no pude leer la salida de wrangler (no trae JSON)');
  try {
    return JSON.parse(lineas.slice(inicio).join('\n'));
  } catch {
    throw new Error('no pude leer la salida de wrangler (JSON roto)');
  }
}

/**
 * Cuántas filas devolvió el primer resultado. Para contar filas borradas se usa `DELETE ... RETURNING id`: el
 * `meta.changes` de `wrangler d1 execute --local --json` no viene (solo trae `duration`), pero las filas sí.
 * @param {any} salida
 * @returns {number}
 */
export function rowCountOf(salida) {
  const primero = Array.isArray(salida) ? salida[0] : salida;
  if (!Array.isArray(primero?.results)) throw new Error('la salida de wrangler no trae results');
  return primero.results.length;
}

/**
 * Decide si una corrida de Wrangler salió bien. Con código 0 alcanza que haya JSON. En Windows, Node 24 a veces cae
 * al salir con "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" (código 3221226505) DESPUÉS de haber hecho el
 * trabajo e impreso el resultado: si el JSON trae todos los resultados con `success: true`, se acepta igual. Un error
 * de Wrangler con `--json` imprime `{ "error": ... }` y eso nunca se acepta.
 * @param {{ status: number | null, stdout: string, stderr: string }} corrida
 * @returns {any}
 */
export function interpretWranglerRun({ status, stdout, stderr }) {
  /** @type {any} */
  let salida = null;
  try {
    salida = parseWranglerJson(stdout);
  } catch {
    // sin JSON legible: se decide abajo
  }
  const todoBien = Array.isArray(salida) && salida.length > 0 && salida.every((r) => r?.success === true);
  if (salida !== null && (status === 0 ? !salida?.error : todoBien)) return salida;
  // stderr de Wrangler: no incluye el SQL del pedido ni datos de la tabla
  throw new Error(`wrangler terminó con código ${status}\n${(stderr || stdout).trim()}`);
}

/**
 * Corre una sentencia SQL en D1 y devuelve el JSON que imprime Wrangler.
 * @param {{ sql: string, remote: boolean }} opciones
 */
export function runD1({ sql, remote }) {
  const resultado = spawnSync(process.execPath, [RUN_MJS, ...buildD1Args({ sql, remote })], {
    cwd: API_DIR,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (resultado.error) throw resultado.error;
  return interpretWranglerRun(resultado);
}
