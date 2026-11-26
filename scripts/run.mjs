// Lanzador de herramientas de desarrollo (Astro y Wrangler) con el entorno redirigido a la carpeta de estado en D:.
//
// Uso: node scripts/run.mjs [--port N]... <herramienta> [argumentos de la herramienta]
//   node scripts/run.mjs --port 8790 --port 9290 wrangler dev
//   node scripts/run.mjs astro check
//
// - Revisa que los puertos pedidos estén libres y falla enseguida si no (no se mueve a otro puerto).
// - Crea las carpetas de estado, apps/web/dist vacía (Wrangler no arranca si falta) y .dev.vars desde el ejemplo.
// - Busca el JS de la herramienta en su package.json y lo lanza con el Node actual, sin shell:
//   así no hay problemas con los .cmd de Windows.

import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDevEnv } from './dev-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Separa `--port N` (repetible, antes de la herramienta), la herramienta y sus argumentos.
 * Todo lo que viene después del nombre de la herramienta se le pasa tal cual.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const ports = [];
  let i = 0;
  while (argv[i] === '--port') {
    const valor = argv[i + 1];
    const port = Number(valor);
    if (!valor || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`puerto inválido: ${valor ?? '(falta el número)'}`);
    }
    ports.push(port);
    i += 2;
  }
  const tool = argv[i];
  if (!tool) throw new Error('falta la herramienta que hay que lanzar (por ejemplo: wrangler o astro)');
  return { ports, tool, toolArgs: argv.slice(i + 1) };
}

/**
 * Busca `node_modules/<tool>` desde `cwd` hacia arriba (como hace Node) y devuelve la ruta de su JS ejecutable.
 * @param {string} tool
 * @param {string} cwd
 */
export function findToolBin(tool, cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const pkgPath = path.join(dir, 'node_modules', tool, 'package.json');
    if (existsSync(pkgPath)) {
      const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const rel = typeof bin === 'string' ? bin : (bin?.[tool] ?? Object.values(bin ?? {})[0]);
      if (!rel) throw new Error(`${tool} no declara un ejecutable (campo "bin") en ${pkgPath}`);
      return path.join(path.dirname(pkgPath), rel);
    }
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(`no encontré ${tool} en ningún node_modules desde ${cwd}. ¿Corriste npm install?`);
}

function escucharEn(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (e) => {
      // ::1 puede no existir en la máquina: eso no cuenta como puerto ocupado
      if (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT') resolve();
      else reject(e);
    });
    server.listen(port, host, () => server.close(() => resolve()));
  });
}

/**
 * Falla enseguida si alguno de los puertos ya está en uso, en IPv4 o IPv6.
 * @param {number[]} ports
 */
export async function ensureFreePorts(ports) {
  for (const port of ports) {
    try {
      await escucharEn(port, '127.0.0.1');
      await escucharEn(port, '::1');
    } catch (e) {
      if (e.code === 'EADDRINUSE' || e.code === 'EACCES') {
        throw new Error(
          `el puerto ${port} está ocupado: cerrá lo que lo usa y probá de nuevo (no se mueve a otro puerto).`,
          { cause: e },
        );
      }
      throw e;
    }
  }
}

/**
 * Prepara el disco antes de lanzar: carpetas de estado, apps/web/dist vacía y .dev.vars desde su ejemplo.
 * No pisa nada que ya exista.
 * @param {{ dirs: { config: string, logs: string, tmp: string }, repoRoot: string, cwd: string }} opciones
 */
export function prepareFiles({ dirs, repoRoot, cwd }) {
  for (const dir of [dirs.config, dirs.logs, dirs.tmp]) mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(repoRoot, 'apps', 'web', 'dist'), { recursive: true });
  const ejemplo = path.join(cwd, '.dev.vars.example');
  const destino = path.join(cwd, '.dev.vars');
  if (existsSync(ejemplo) && !existsSync(destino)) copyFileSync(ejemplo, destino);
}

/**
 * Arma el comando que se va a ejecutar, sin ejecutarlo.
 * @param {{ argv: string[], repoRoot: string, cwd: string, env: Record<string, string | undefined>, platform: NodeJS.Platform }} opciones
 */
export function buildInvocation({ argv, repoRoot, cwd, env, platform }) {
  const { ports, tool, toolArgs } = parseArgs(argv);
  const dev = buildDevEnv({ env, platform, repoRoot });
  const bin = findToolBin(tool, cwd);
  return {
    command: process.execPath,
    args: [bin, ...toolArgs],
    options: { cwd, env: dev.env, stdio: 'inherit' },
    ports,
    dirs: dev.dirs,
    warnings: dev.warnings,
  };
}

async function main() {
  const cwd = process.cwd();
  const inv = buildInvocation({
    argv: process.argv.slice(2),
    repoRoot: ROOT,
    cwd,
    env: process.env,
    platform: process.platform,
  });
  await ensureFreePorts(inv.ports);
  prepareFiles({ dirs: inv.dirs, repoRoot: ROOT, cwd });
  for (const w of inv.warnings) console.warn(`aviso: ${w}`);

  const child = spawn(inv.command, inv.args, inv.options);
  // Ctrl+C le llega también a la herramienta: este proceso espera a que termine y devuelve su código.
  process.on('SIGINT', () => {});
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on('error', (e) => {
    console.error(`error: no se pudo lanzar la herramienta: ${e.message}`);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
