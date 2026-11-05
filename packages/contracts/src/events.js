// @ts-check
// Eventos del embudo. Solo se aceptan los de esta lista y el cuerpo es únicamente `{ name }`.
// Agregar un evento es editar esta lista (la tabla no tiene lista propia).

import { hasUnknownKeys, isOneOf, isPlainObject } from './shape.js';

export const EVENT_NAMES = Object.freeze(/** @type {const} */ (['video_play', 'form_open']));

/**
 * @param {unknown} entrada
 * @returns {{ ok: true, value: { name: typeof EVENT_NAMES[number] } } | { ok: false, error: 'solicitud_invalida' }}
 */
export function validateEvent(entrada) {
  if (!isPlainObject(entrada) || hasUnknownKeys(entrada, ['name']) || !isOneOf(EVENT_NAMES, entrada.name)) {
    return { ok: false, error: 'solicitud_invalida' };
  }
  return { ok: true, value: { name: /** @type {typeof EVENT_NAMES[number]} */ (entrada.name) } };
}
