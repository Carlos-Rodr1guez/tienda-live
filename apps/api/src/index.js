// @ts-check
// Punto de entrada del Worker: conecta el núcleo (createApp) con el mundo real. Aquí no hay lógica.
// Rutas: eventos del embudo, inscripción y confirmación de la lista de espera. Tarea programada: la purga.

import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createClock } from './adapters/clock.js';
import { createRandom } from './adapters/random.js';
import { createLogger } from './adapters/logger.js';
import { selectMailer } from './adapters/mailer.js';
import { createTurnstileVerifier } from './adapters/turnstile.js';
import { eventsRoute } from './events/track.js';
import { waitlistRoute } from './waitlist/signup.js';
import { confirmRoute } from './waitlist/confirm.js';
import { purgeStale } from './waitlist/purge.js';

/**
 * Lo que Wrangler le entrega al Worker: el enlace D1 y las variables.
 * @typedef {{ DB: import('./ports.js').Db } & Record<string, unknown>} Env
 */

/** @param {Env} env */
function buildApp(env) {
  const config = readConfig(env);
  const logger = createLogger();
  return createApp(
    {
      db: env.DB,
      clock: createClock(),
      random: createRandom(),
      logger,
      config,
      turnstile: createTurnstileVerifier(config.turnstile, { logger }),
      mailer: selectMailer(config),
    },
    { routes: [eventsRoute, waitlistRoute, confirmRoute], jobs: [purgeStale] },
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
