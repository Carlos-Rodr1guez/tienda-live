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
import { findByEmail, insertPending, replacePending, rotatePending } from './repository.js';
import { RETENCION_PENDIENTES_MS } from './purge.js';

/**
 * Un token nuevo listo para guardar.
 * @param {import('../ports.js').AppPorts} ports
 * @param {number} ahoraMs
 * @param {string[]} recentSends
 * @param {number} [venceComoMuchoMs] Tope del vencimiento (el enlace nunca sobrevive a la promesa de los 7 días).
 */
async function envioNuevo(ports, ahoraMs, recentSends, venceComoMuchoMs = Number.POSITIVE_INFINITY) {
  const token = generateToken(ports.random);
  const venceMs = Math.min(ahoraMs + TOKEN_TTL_MS, venceComoMuchoMs);
  return {
    token,
    // Lo que le queda al enlace, con la MISMA lectura del reloj que fijó el vencimiento (el correo lo dice).
    validezMs: venceMs - ahoraMs,
    envio: {
      tokenHash: await hashToken(token),
      tokenExpiresAt: new Date(venceMs).toISOString(),
      recentSends,
    },
  };
}

/** @param {unknown} error */
function esChoqueUnique(error) {
  return error instanceof Error && /UNIQUE constraint/i.test(error.message);
}

/**
 * Escribe la inscripción. Devuelve el token en claro y su vigencia si hay que mandar correo, o null si no.
 *
 * Reglas para quien ya existe (WL-11, enmendada por el dueño el 2026-11-05):
 *   - confirmado: no se toca nada;
 *   - pendiente dentro de sus 7 días: NUNCA se cambian perfil, consentimiento ni created_at. Si el límite de reenvíos
 *     deja enviar, se rota el token (vence a lo sumo en created_at + 7 días) y se anota el envío; si no, no se escribe;
 *   - pendiente pasado de sus 7 días y sin purgar: se trata como una inscripción nueva.
 * Las dos escrituras son compare-and-swap, y solo quien cambia una fila manda el correo (ver repository.js).
 * @param {import('../ports.js').AppPorts} ports
 * @param {import('@tienda/contracts/waitlist').WaitlistValue} perfil
 * @returns {Promise<{ token: string, validezMs: number } | null>}
 */
async function registrar(ports, perfil) {
  const ahoraMs = ports.clock.now();
  const ahora = new Date(ahoraMs).toISOString();
  let existente = await findByEmail(ports.db, perfil.email);

  if (!existente) {
    const { token, validezMs, envio } = await envioNuevo(ports, ahoraMs, planSend([], ahoraMs).recentSends);
    try {
      await insertPending(ports.db, { perfil, ahora, ...envio });
      return { token, validezMs };
    } catch (error) {
      // Dos pedidos del mismo correo a la vez: el otro llegó primero. Se sigue como si ya existiera.
      if (!esChoqueUnique(error)) throw error;
      existente = await findByEmail(ports.db, perfil.email);
    }
  }

  // Confirmado: no se toca nada y no se manda nada (y la respuesta es la misma).
  if (!existente || existente.confirmedAt !== null) return null;

  const venceLaVentanaMs = Date.parse(existente.createdAt) + RETENCION_PENDIENTES_MS;
  if (venceLaVentanaMs <= ahoraMs) {
    // Pasó la ventana y la purga diaria aún no lo borró: es una inscripción nueva, con su perfil y su consentimiento.
    const { token, validezMs, envio } = await envioNuevo(ports, ahoraMs, planSend([], ahoraMs).recentSends);
    const cambios = await replacePending(ports.db, existente.id, {
      perfil,
      ahora,
      envio,
      createdAtLeido: existente.createdAt,
    });
    return cambios === 1 ? { token, validezMs } : null;
  }

  const plan = planSend(existente.recentSends, ahoraMs);
  if (!plan.send) return null; // frenado: no se escribe nada
  const { token, validezMs, envio } = await envioNuevo(ports, ahoraMs, plan.recentSends, venceLaVentanaMs);
  const cambios = await rotatePending(ports.db, existente.id, {
    ahora,
    envio,
    recentSendsLeido: existente.recentSendsRaw,
  });
  return cambios === 1 ? { token, validezMs } : null;
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

    const envio = await registrar(ports, value);
    if (envio !== null) {
      const mensaje = {
        to: value.email,
        link: confirmationLink(ports.config.siteUrl, envio.token),
        validezMs: envio.validezMs,
      };
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
