// Ayudas para las pruebas de la lista de espera: arma la app con las rutas de inscripción y de confirmación, un
// verificador de Turnstile y un correo falsos, y un cuerpo de inscripción válido.

import { createHarness } from './harness.js';
import { waitlistRoute } from '../../src/waitlist/signup.js';
import { confirmRoute } from '../../src/waitlist/confirm.js';

export const TOKEN_TURNSTILE_BUENO = 'token-bueno';

/** Verificador falso: acepta TOKEN_TURNSTILE_BUENO. `respuesta` fuerza otro resultado para todos los tokens. */
export function createFakeTurnstile(respuesta) {
  const llamadas = [];
  return {
    llamadas,
    async verify(token) {
      llamadas.push(token);
      if (respuesta) return respuesta;
      return token === TOKEN_TURNSTILE_BUENO ? { ok: true } : { ok: false, reason: 'rechazado' };
    },
  };
}

/** Correo falso: guarda lo enviado. `fallo` hace que el envío falle (rechazo) o lance (sincrónico). */
export function createFakeMailer({ fallo } = {}) {
  const enviados = [];
  return {
    enviados,
    sendConfirmation(mensaje) {
      if (fallo === 'lanza') throw new TypeError('correo caído (síncrono)');
      enviados.push(mensaje);
      return fallo === 'rechaza' ? Promise.reject(new TypeError('correo caído')) : Promise.resolve();
    },
  };
}

/**
 * @param {{ turnstile?: any, mailer?: any, env?: Record<string, unknown> }} [opciones]
 *   `mailer: null` simula producción sin proveedor.
 */
export async function armarLista({ turnstile = createFakeTurnstile(), mailer = createFakeMailer(), env } = {}) {
  const h = await createHarness({
    routes: [waitlistRoute, confirmRoute],
    ports: { turnstile, mailer },
    ...(env ? { env } : {}),
  });
  return { ...h, turnstile, mailer };
}

export const cuerpoValido = (extra = {}) => ({
  email: 'Ana@Example.com ',
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['metas', 'accion'],
  consent: true,
  consent_version: 'v1',
  turnstile_token: TOKEN_TURNSTILE_BUENO,
  ...extra,
});

/** Las filas de la tabla tal como están, ordenadas por id. */
export const filasDeLista = (h) =>
  h.db.sqlite
    .prepare('SELECT * FROM waitlist ORDER BY id')
    .all()
    .map((f) => ({ ...f }));

/** El token en claro del último correo enviado (sale del enlace). */
export function tokenDelUltimoCorreo(h) {
  const ultimo = h.mailer.enviados.at(-1);
  return ultimo.link.split('#t=')[1];
}
