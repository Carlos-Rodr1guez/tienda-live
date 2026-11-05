// Comprueba que una ficha de juego inválida rompe la construcción y que el error nombra el archivo y el campo
// (requisito GC-R3). Corre `astro sync`, que es el primer paso de la construcción y es donde Astro valida el contenido,
// así que no hace falta una construcción completa. Solo lo corre la CI: `npm run check:schema -w @tienda/web`.
//
// Astro se detiene en la primera ficha inválida, así que se corre una vez por ficha. Cada una se copia a una carpeta
// propia dentro de .dev-state/ (gitignored, en el repo y en D:) y se apunta JUEGOS_DIR ahí (ver src/content.config.js).

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(WEB_DIR, '..', '..');
const RUN_MJS = path.join(REPO_DIR, 'scripts', 'run.mjs');
const FIXTURES = path.join(WEB_DIR, 'test', 'fixtures', 'juegos-invalidos');
const TRABAJO = path.join(REPO_DIR, '.dev-state', 'check-schema');

/** Cada ficha inválida y el campo que el error tiene que nombrar. */
export const CASOS = Object.freeze([
  Object.freeze({ archivo: 'sin-categoria.md', campo: 'categoria' }),
  Object.freeze({ archivo: 'sin-rol.md', campo: 'rolStreamer' }),
]);

/** @param {string} texto */
export function stripAnsi(texto) {
  // eslint-disable-next-line no-control-regex -- los colores de la terminal empiezan con el carácter ESC
  return texto.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Ruta de `destino` relativa a la carpeta de la web, con barras normales y empezando con "./" o "../". Astro trata
 * una ruta absoluta de Windows como una URL, así que JUEGOS_DIR tiene que ser relativa.
 * @param {string} web
 * @param {string} destino
 */
export function relativeFromWeb(web, destino) {
  const rel = path.relative(web, destino).split(path.sep).join('/');
  return rel.startsWith('..') ? rel : `./${rel}`;
}

/**
 * Decide si una corrida de `astro sync` sobre una ficha inválida salió como se espera: con error, nombrando el
 * archivo y el campo. El campo cuenta solo si Astro lo imprime como "campo: mensaje" (no basta con que esté en el
 * nombre del archivo).
 * @param {{ status: number | null, stdout: string, stderr: string }} corrida
 * @param {{ archivo: string, campo: string }} caso
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
export function evaluateRun({ status, stdout, stderr }, { archivo, campo }) {
  if (status === 0) return { ok: false, motivo: `la sincronización no falló con ${archivo}, y tenía que fallar` };
  const salida = stripAnsi(`${stderr}\n${stdout}`);
  if (!salida.includes(archivo.replace(/\.md$/, ''))) {
    return { ok: false, motivo: `falló, pero el error no nombra ${archivo}:\n${salida.trim()}` };
  }
  if (!new RegExp(`^\\s*${campo}:`, 'm').test(salida)) {
    return { ok: false, motivo: `falló, pero el error no nombra el campo ${campo}:\n${salida.trim()}` };
  }
  return { ok: true };
}

function main() {
  let fallos = 0;
  try {
    for (const caso of CASOS) {
      const carpeta = path.join(TRABAJO, caso.archivo.replace(/\.md$/, ''));
      rmSync(carpeta, { recursive: true, force: true });
      mkdirSync(carpeta, { recursive: true });
      copyFileSync(path.join(FIXTURES, caso.archivo), path.join(carpeta, caso.archivo));

      const corrida = spawnSync(process.execPath, [RUN_MJS, 'astro', 'sync'], {
        cwd: WEB_DIR,
        encoding: 'utf8',
        env: { ...process.env, JUEGOS_DIR: relativeFromWeb(WEB_DIR, carpeta) },
      });
      if (corrida.error) throw corrida.error;

      const veredicto = evaluateRun(corrida, caso);
      if (veredicto.ok)
        console.log(`ok: ${caso.archivo} rompe la construcción y el error nombra el campo ${caso.campo}`);
      else {
        fallos += 1;
        console.error(`error: ${veredicto.motivo}`);
      }
    }
  } finally {
    rmSync(TRABAJO, { recursive: true, force: true });
  }
  if (fallos > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
