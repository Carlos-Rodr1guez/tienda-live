// @ts-check
// Token de confirmación de la lista de espera: 32 bytes en base64url, 43 caracteres. Llega en el cuerpo de
// POST /v1/waitlist/confirm, nunca en la URL de la API.

import { CONFIRM_TOKEN_LENGTH } from './limits.js';
import { hasUnknownKeys, isPlainObject } from './shape.js';

export const CONFIRM_TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${CONFIRM_TOKEN_LENGTH}}$`);

/**
 * @param {unknown} valor
 * @returns {valor is string}
 */
export function isConfirmToken(valor) {
  return typeof valor === 'string' && CONFIRM_TOKEN_PATTERN.test(valor);
}

/**
 * Un token mal formado, ausente o de otro tipo da el mismo "enlace_invalido" que uno vencido o usado
 * (no se distingue nada). Un cuerpo que no es un objeto o que trae claves de más es "solicitud_invalida".
 * @param {unknown} entrada
 * @returns {{ ok: true, value: { token: string } } | { ok: false, error: 'solicitud_invalida' | 'enlace_invalido' }}
 */
export function validateConfirm(entrada) {
  if (!isPlainObject(entrada) || hasUnknownKeys(entrada, ['token'])) return { ok: false, error: 'solicitud_invalida' };
  if (!isConfirmToken(entrada.token)) return { ok: false, error: 'enlace_invalido' };
  return { ok: true, value: { token: entrada.token } };
}
