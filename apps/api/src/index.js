// @ts-check
// Punto de entrada del Worker: conecta el núcleo (createApp) con el mundo real. Aquí no hay lógica.
// Rutas por ahora: solo los eventos del embudo. La lista de espera se suma en el lote siguiente.

import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createClock } from './adapters/clock.js';
import { createRandom } from './adapters/random.js';
import { createLogger } from './adapters/logger.js';
import { eventsRoute } from './events/track.js';

/**
 * Lo que Wrangler le entrega al Worker: el enlace D1 y las variables.
 * @typedef {{ DB: import('./ports.js').Db } & Record<string, unknown>} Env
 */

/** @param {Env} env */
function buildApp(env) {
  return createApp(
    {
      db: env.DB,
      clock: createClock(),
      random: createRandom(),
      logger: createLogger(),
      config: readConfig(env),
    },
    { routes: [eventsRoute] },
  );
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {import('./ports.js').Ctx} ctx
   */
  fetch: (request, env, ctx) => buildApp(env).fetch(request, ctx),

  /**
   * @param {unknown} evento
   * @param {Env} env
   * @param {import('./ports.js').Ctx} ctx
   */
  scheduled: (evento, env, ctx) => buildApp(env).scheduled(evento, ctx),
};
