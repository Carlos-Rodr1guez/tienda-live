// @ts-check
// Respuestas de /v1/*. Todas llevan las cabeceras de la política de contracts (sin cookies y sin CORS: todo es del
// mismo origen). El cuerpo de error es { ok:false, error, campos?, mensaje }, con el mensaje del diccionario.

import { API_RESPONSE_HEADERS } from '@tienda/contracts/security-headers';
import { ERROR_STATUS } from '@tienda/contracts/api-errors';
import { respuestas } from '@tienda/contracts/i18n';

/**
 * @param {Record<string, string>} [extra]
 */
function cabeceras(extra = {}) {
  return new Headers({ ...API_RESPONSE_HEADERS, ...extra });
}

/**
 * @param {number} status
 * @param {unknown} cuerpo
 */
export function jsonResponse(status, cuerpo) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: cabeceras({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

/** 204: un 204 no lleva cuerpo ni tipo de contenido. */
export function noContent() {
  return new Response(null, { status: 204, headers: cabeceras() });
}

/**
 * @param {import('@tienda/contracts/api-errors').ErrorCode} codigo
 * @param {{ status?: number, campos?: Record<string, string> }} [opciones]
 */
export function errorResponse(codigo, { status = ERROR_STATUS[codigo], campos } = {}) {
  return jsonResponse(status, {
    ok: false,
    error: codigo,
    ...(campos ? { campos } : {}),
    mensaje: respuestas[codigo],
  });
}

/** 405: todas las rutas de /v1 son POST. La tabla de la especificación no le da código ni mensaje. */
export function methodNotAllowed() {
  return new Response(null, { status: 405, headers: cabeceras({ Allow: 'POST' }) });
}
