// Levanta la API y la web juntas para desarrollar: `npm run dev`.
// Cada salida lleva su etiqueta ([api] o [web]) y Ctrl+C detiene las dos.
//
// La web corre en el puerto 4400 y reenvía /v1 a la API (8790): el navegador ve un solo origen.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEV_PROCESSES = [
  { prefix: '[api]', workspace: '@tienda/api' },
  { prefix: '[web]', workspace: '@tienda/web' },
];

/**
 * Antepone una etiqueta a cada línea de una salida que llega en fragmentos.
 * @param {string} prefix
 * @param {(linea: string) => void} write
 */
export function createLinePrefixer(prefix, write) {
  let pendiente = '';
  const emit = (linea) => write(linea === '' ? prefix : `${prefix} ${linea}`);
  return {
    push(chunk) {
      pendiente += chunk.toString();
      const lineas = pendiente.split(/\r?\n/);
      pendiente = lineas.pop() ?? '';
      lineas.forEach(emit);
    },
    flush() {
      if (pendiente !== '') emit(pendiente.replace(/\r$/, ''));
      pendiente = '';
    },
  };
}

function main() {
  // Dentro de "npm run", npm_execpath apunta al CLI de npm: se lanza con el Node actual, sin shell.
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !/\.c?js$/.test(npmCli)) {
    console.error('error: corré esto con "npm run dev" desde la raíz del repositorio.');
    process.exit(1);
  }

  const hijos = DEV_PROCESSES.map(({ prefix, workspace }) => {
    const child = spawn(process.execPath, [npmCli, 'run', 'dev', '-w', workspace], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const salida = createLinePrefixer(prefix, (l) => console.log(l));
    const errores = createLinePrefixer(prefix, (l) => console.error(l));
    child.stdout.on('data', (d) => salida.push(d));
    child.stderr.on('data', (d) => errores.push(d));
    child.on('close', () => {
      salida.flush();
      errores.flush();
    });
    return { prefix, child };
  });

  let cerrando = false;
  function detenerTodo(codigo) {
    if (cerrando) return;
    cerrando = true;
    for (const { child } of hijos) child.kill();
    setTimeout(() => process.exit(codigo), 500).unref();
  }

  for (const { prefix, child } of hijos) {
    child.on('exit', (code) => {
      if (cerrando) return;
      console.error(`${prefix} terminó con código ${code ?? 'desconocido'}: detengo el resto.`);
      detenerTodo(code || 1);
    });
  }
  process.on('SIGINT', () => detenerTodo(0));
  process.on('SIGTERM', () => detenerTodo(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
