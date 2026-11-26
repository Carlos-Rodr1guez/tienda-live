// @ts-check
// POST /v1/events: cuenta un evento del embudo. Responde 204 siempre que el evento sea válido, incluso si el
// contador ya está en el tope. No lee ni guarda nada del pedido salvo el nombre del evento.

import { validateEvent } from '@tienda/contracts/events';
import { BODY_CAPS } from '@tienda/contracts/limits';
import { noContent } from '../http/respond.js';
import { incrementEvent, utcDay } from './repository.js';

/** @type {import('../http/pipeline.js').Route} */
export const eventsRoute = {
  path: '/v1/events',
  cap: BODY_CAPS.events,
  validate: validateEvent,
  async handle({ value, ports }) {
    await incrementEvent(ports.db, utcDay(ports.clock.now()), value.name);
    return noContent();
  },
};
