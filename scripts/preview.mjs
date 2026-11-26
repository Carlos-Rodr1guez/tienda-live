// Vista previa local: `npm run preview`. Construye la web y la sirve con el Worker en http://localhost:8790.
//
// La construcción de la web EXIGE SITE_URL y PUBLIC_TURNSTILE_SITE_KEY explícitas (no hay respaldo a localhost ni a la
// clave de prueba). Para que el dueño no tenga que escribirlas, este lanzador las pone aquí, con los valores LOCALES:
// el origen del Worker y la clave PÚBLICA de prueba de Turnstile (no es un secreto). Va en Node y sin shell, así que
// funciona igual en cmd, PowerShell y bash, sin agregar dependencias (nada de cross-env).

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Valores locales de la vista previa. La clave de prueba de Cloudflare siempre aprueba y solo sirve en local. */
export const PREVIEW_ENV = Object.freeze({
  SITE_URL: 'http://localhost:8790',
  PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
});

/**
 * El entorno de la vista previa: el actual con los valores locales por encima (es una vista previa local: un valor de
 * producción que haya en el entorno no debe colarse en ella).
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
export function previewEnv(env) {
  return { ...env, ...PREVIEW_ENV };
}

/**
 * Los dos pasos, en orden, listos para `spawn`: construir la web y servirla. Usa el CLI de npm con el Node actual.
 * @param {{ npmCli: string | undefined, execPath: string, env: Record<string, string | undefined>, cwd: string }} entrada
 */
export function buildPreviewPlan({ npmCli, execPath, env, cwd }) {
  if (!npmCli || !/\.c?js$/.test(npmCli)) {
    throw new Error('ejecuta esto con "npm run preview" desde la raíz del repositorio.');
  }
  const options = { cwd, env: previewEnv(env), stdio: /** @type {const} */ ('inherit') };
  return [
    { command: execPath, args: [npmCli, 'run', 'build:web'], options },
    { command: execPath, args: [npmCli, 'run', 'preview', '-w', '@tienda/api'], options },
  ];
}

/** @param {{ command: string, args: string[], options: import('node:child_process').SpawnOptions }} paso */
function correr(paso) {
  return new Promise((resolver) => {
    const hijo = spawn(paso.command, paso.args, paso.options);
    hijo.on('exit', (code, signal) => resolver(code ?? (signal ? 1 : 0)));
    hijo.on('error', (e) => {
      console.error(`error: no se pudo lanzar el paso: ${e.message}`);
      resolver(1);
    });
  });
}

async function main() {
  const plan = buildPreviewPlan({
    npmCli: process.env.npm_execpath,
    execPath: process.execPath,
    env: process.env,
    cwd: ROOT,
  });
  // Ctrl+C le llega también al hijo: este proceso espera a que termine y devuelve su código.
  process.on('SIGINT', () => {});
  for (const paso of plan) {
    const codigo = await correr(paso);
    if (codigo !== 0) process.exit(codigo);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
