// DT-9: el paquete que se subiría a Cloudflare solo debe tener código propio (el Worker no tiene dependencias de
// ejecución). Corre `wrangler deploy --dry-run` (no sube nada y no pide credenciales), mira los archivos de salida y
// los mapas de fuentes, y falla si aparece algo de node_modules. Se corre en CI (`npm run check:bundle -w @tienda/api`);
// los agentes locales no lo corren.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_MJS = path.resolve(API_DIR, '..', '..', 'scripts', 'run.mjs');
const SALIDA = path.join('.wrangler', 'dry-run');

/** Las plantillas de middleware que Wrangler inyecta no son dependencias del Worker. */
const PLANTILLAS_DE_WRANGLER = /(^|\/)node_modules\/wrangler\/templates\//;

/** @param {string} ruta */
const conBarras = (ruta) => ruta.replaceAll('\\', '/');

/**
 * La lista `sources` de un mapa de fuentes; vacía si no es un mapa.
 * @param {string} texto
 * @returns {string[]}
 */
export function mapSources(texto) {
  try {
    const mapa = JSON.parse(texto);
    return Array.isArray(mapa?.sources) ? mapa.sources.filter((/** @type {unknown} */ s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ archivos: string[], fuentes: string[] }} paquete  rutas de los archivos de salida y fuentes de los mapas
 * @returns {string[]} los problemas encontrados (vacío = todo bien)
 */
export function findViolations({ archivos, fuentes }) {
  const problemas = [];
  if (!archivos.some((a) => a.endsWith('.js')))
    problemas.push('el paquete no tiene ningún .js: algo salió mal al empaquetar');
  for (const archivo of archivos.map(conBarras)) {
    if (archivo.split('/').includes('node_modules'))
      problemas.push(`archivo dentro de node_modules en el paquete: ${archivo}`);
  }
  for (const fuente of fuentes.map(conBarras)) {
    if (fuente.split('/').includes('node_modules') && !PLANTILLAS_DE_WRANGLER.test(fuente)) {
      problemas.push(`el paquete incluye código de una dependencia (node_modules): ${fuente}`);
    }
  }
  return problemas;
}

/** @param {string} dir @returns {string[]} rutas relativas a `dir` */
function listar(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    return e.isDirectory() ? listar(ruta, base) : [path.relative(base, ruta)];
  });
}

function main() {
  const destino = path.join(API_DIR, SALIDA);
  rmSync(destino, { recursive: true, force: true });
  const resultado = spawnSync(process.execPath, [RUN_MJS, 'wrangler', 'deploy', '--dry-run', '--outdir', SALIDA], {
    cwd: API_DIR,
    stdio: 'inherit',
  });
  if (resultado.status !== 0) throw new Error(`wrangler deploy --dry-run terminó con código ${resultado.status}`);

  const archivos = listar(destino);
  const fuentes = archivos
    .filter((a) => a.endsWith('.map'))
    .flatMap((a) => mapSources(readFileSync(path.join(destino, a), 'utf8')));
  const problemas = findViolations({ archivos, fuentes });
  if (problemas.length > 0) {
    for (const problema of problemas) console.error(`error: ${problema}`);
    process.exit(1);
  }
  console.log(`Paquete del Worker OK: ${archivos.length} archivos, ${fuentes.length} fuentes, solo código propio.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
