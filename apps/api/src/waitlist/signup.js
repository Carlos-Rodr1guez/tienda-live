// @ts-check
// POST /v1/waitlist: anotarse en la lista de espera (doble confirmación).
//
// Orden (WL-1): la tubería ya validó método, origen, tipo, tamaño, JSON y campos. Acá siguen
//   Turnstile -> disponibilidad del correo -> escritura -> (después de responder) el correo.
// Anti-enumeración (WL-4): todo envío válido responde el MISMO 202, sea el correo nuevo, pendiente, frenado o ya
// confirmado, y el correo sale con waitUntil para que el tiempo de respuesta no delate si hubo envío.

import { validateWaitlist } from '@tienda/contracts/waitlist';
import { BODY_CAPS } from '@tienda/contracts/limits';
import { respuestas } from '@tienda/contracts/i18n';
import { errorResponse, jsonResponse } from '../http/respond.js';
import { generateToken, hashToken, TOKEN_TTL_MS } from './tokens.js';
import { planSend } from './throttle.js';
import { confirmationLink } from './mail.js';
import { findByEmail, insertPending, updatePending } from './repository.js';

/**
 * Un token nuevo listo para guardar.
 * @param {import('../ports.js').AppPorts} ports
 * @param {number} ahoraMs
 * @param {string[]} recentSends
 */
async function envioNuevo(ports, ahoraMs, recentSends) {
  const token = generateToken(ports.random);
  return {
    token,
    envio: {
      tokenHash: await hashToken(token),
      tokenExpiresAt: new Date(ahoraMs + TOKEN_TTL_MS).toISOString(),
      recentSends,
    },
  };
}

/** @param {unknown} error */
function esChoqueUnique(error) {
  return error instanceof Error && /UNIQUE constraint/i.test(error.message);
}

/**
 * Escribe la inscripción. Devuelve el token en claro si hay que mandar correo, o null si no.
 * @param {import('../ports.js').AppPorts} ports
 * @param {import('@tienda/contracts/waitlist').WaitlistValue} perfil
 * @returns {Promise<string | null>}
 */
async function registrar(ports, perfil) {
  const ahoraMs = ports.clock.now();
  const ahora = new Date(ahoraMs).toISOString();
  let existente = await findByEmail(ports.db, perfil.email);

  if (!existente) {
    const { token, envio } = await envioNuevo(ports, ahoraMs, planSend([], ahoraMs).recentSends);
    try {
      await insertPending(ports.db, { perfil, ahora, ...envio });
      return token;
    } catch (error) {
      // Dos pedidos del mismo correo a la vez: el otro llegó primero. Se sigue como si ya existiera.
      if (!esChoqueUnique(error)) throw error;
      existente = await findByEmail(ports.db, perfil.email);
    }
  }

  // Confirmado: no se toca nada y no se manda nada (y la respuesta es la misma).
  if (!existente || existente.confirmedAt !== null) return null;

  const plan = planSend(existente.recentSends, ahoraMs);
  if (!plan.send) {
    await updatePending(ports.db, existente.id, { perfil, ahora, envio: null });
    return null;
  }
  const { token, envio } = await envioNuevo(ports, ahoraMs, plan.recentSends);
  const cambios = await updatePending(ports.db, existente.id, { perfil, ahora, envio });
  return cambios === 1 ? token : null;
}

/** @type {import('../http/pipeline.js').Route} */
export const waitlistRoute = {
  path: '/v1/waitlist',
  cap: BODY_CAPS.waitlist,
  validate: validateWaitlist,
  async handle({ value, ports, ctx }) {
    if (value.turnstile_token === null) return errorResponse('verificacion_fallida');
    const verificacion = await ports.turnstile.verify(value.turnstile_token);
    if (!verificacion.ok)
      return errorResponse(verificacion.reason === 'rechazado' ? 'verificacion_fallida' : 'no_disponible');

    const mailer = ports.mailer;
    if (mailer === null) return errorResponse('no_disponible');

    const token = await registrar(ports, value);
    if (token !== null) {
      const mensaje = { to: value.email, link: confirmationLink(ports.config.siteUrl, token) };
      ctx.waitUntil(
        (async () => {
          try {
            await mailer.sendConfirmation(mensaje);
          } catch (error) {
            ports.logger.error('mail.error', { codigo: error instanceof Error ? error.name : 'Error' });
          }
        })(),
      );
    }
    return jsonResponse(202, { ok: true, mensaje: respuestas.exito });
  },
};
