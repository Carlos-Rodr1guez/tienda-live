// @ts-check
// El núcleo de la API: arma la aplicación con sus puertos y sus rutas. No toca el mundo exterior directamente,
// así que las pruebas la corren con dobles. `src/index.js` es quien la conecta con el Worker real.

import { createRouter } from './http/router.js';
import { handleRequest } from './http/pipeline.js';

/**
 * @param {import('./ports.js').AppPorts} ports
 * @param {{ routes: readonly import('./http/pipeline.js').Route[], jobs?: readonly ((ports: import('./ports.js').AppPorts) => Promise<unknown>)[] }} opciones
 *   `routes`: las rutas de /v1. `jobs`: tareas del disparador programado (la purga llega con la lista de espera).
 */
export function createApp(ports, { routes, jobs = [] }) {
  const router = createRouter(routes);
  return {
    /**
     * @param {Request} request
     * @param {import('./ports.js').Ctx} ctx
     */
    fetch: (request, ctx) => handleRequest({ request, ctx, ports, router }),
    /**
     * Cron Trigger. Cada tarea corre dentro de waitUntil para que el Worker no termine antes.
     * @param {unknown} _evento
     * @param {import('./ports.js').Ctx} ctx
     */
    async scheduled(_evento, ctx) {
      for (const tarea of jobs) ctx.waitUntil(tarea(ports));
    },
  };
}
