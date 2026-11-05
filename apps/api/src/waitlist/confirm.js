// @ts-check
// POST /v1/waitlist/confirm: confirma el correo con el token del enlace. Es POST a propósito: un GET (por ejemplo un
// antivirus que abre los enlaces del correo) no puede confirmar nada. Cualquier fallo (mal formado, desconocido,
// usado o vencido) da el mismo `enlace_invalido`: no se distingue cuál.

import { validateConfirm } from '@tienda/contracts/confirm';
import { BODY_CAPS } from '@tienda/contracts/limits';
import { respuestas } from '@tienda/contracts/i18n';
import { errorResponse, jsonResponse } from '../http/respond.js';
import { hashToken } from './tokens.js';
import { confirmByTokenHash } from './repository.js';

/** @type {import('../http/pipeline.js').Route} */
export const confirmRoute = {
  path: '/v1/waitlist/confirm',
  cap: BODY_CAPS.confirm,
  validate: validateConfirm,
  async handle({ value, ports }) {
    const ahora = new Date(ports.clock.now()).toISOString();
    const confirmado = await confirmByTokenHash(ports.db, await hashToken(value.token), ahora);
    if (!confirmado) return errorResponse('enlace_invalido');
    return jsonResponse(200, { ok: true, mensaje: respuestas.confirmado });
  },
};
