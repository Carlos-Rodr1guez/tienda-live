// @ts-check
// Tubería común de toda ruta de /v1 (todas son POST). El orden importa y está probado:
//   0 configuración inválida -> 503 (antes que todo; solo pasa en producción con SITE_URL mal puesto)
//   1 ruta -> 404   2 método -> 405   3 origen -> 403   4 tipo de contenido -> 415   5 tope de cuerpo -> 413
//   6 JSON de objeto -> 400   7 validación de contracts -> 400   8 la ruta   9 cualquier excepción -> 500 uniforme
// El 500 no filtra nada: registra la ruta y el nombre del error, nunca su mensaje (podría traer datos del pedido).

import { errorResponse, methodNotAllowed } from './respond.js';
import { readBody } from './body.js';
import { isPlainObject } from '@tienda/contracts/shape';

/**
 * @typedef {{ ok: true, value: any } | { ok: false, error: import('@tienda/contracts/api-errors').ErrorCode, campos?: Record<string, string> }} Validacion
 */

/**
 * Una ruta de la API.
 * @typedef {object} Route
 * @property {string} path Camino exacto, por ejemplo /v1/events.
 * @property {number} cap Tope de bytes del cuerpo.
 * @property {(entrada: unknown) => Validacion} validate Validador de contracts.
 * @property {(contexto: { value: any, request: Request, ports: import('../ports.js').AppPorts, ctx: import('../ports.js').Ctx }) => Promise<Response>} handle
 */

/**
 * @param {string | null} valor Cabecera Content-Type.
 */
function esJson(valor) {
  if (valor === null) return false;
  const [tipo, ...parametros] = valor.split(';').map((parte) => parte.trim().toLowerCase());
  return tipo === 'application/json' && parametros.every((p) => p === 'charset=utf-8');
}

/**
 * @param {Request} request
 * @param {readonly string[]} origenesPermitidos
 */
function origenPermitido(request, origenesPermitidos) {
  const origen = request.headers.get('origin');
  if (origen === null || !origenesPermitidos.includes(origen)) return false;
  const sitio = request.headers.get('sec-fetch-site');
  return sitio === null || sitio === 'same-origin';
}

/**
 * @param {{ request: Request, ctx: import('../ports.js').Ctx, ports: import('../ports.js').AppPorts, router: { match(camino: string): Route | null } }} entrada
 * @returns {Promise<Response>}
 */
export async function handleRequest({ request, ctx, ports, router }) {
  const camino = new URL(request.url).pathname;
  try {
    // Antes de todo: sin configuración utilizable (SITE_URL inválido en producción) nada de /v1 responde con normalidad.
    // Se registra solo el código del motivo, nunca el valor.
    if (ports.config.problems.length > 0) {
      ports.logger.error('config.invalida', { codigo: ports.config.problems.join(',') });
      return errorResponse('no_disponible');
    }
    const ruta = router.match(camino);
    if (!ruta) return errorResponse('no_encontrado');
    if (request.method !== 'POST') return methodNotAllowed();
    if (!origenPermitido(request, ports.config.allowedOrigins)) return errorResponse('origen_no_permitido');
    if (!esJson(request.headers.get('content-type'))) return errorResponse('solicitud_invalida', { status: 415 });

    const cuerpo = await readBody(request, ruta.cap);
    if (cuerpo.estado === 'demasiado_grande') return errorResponse('demasiado_grande');
    if (cuerpo.estado === 'ilegible') return errorResponse('solicitud_invalida');

    /** @type {unknown} */
    let json;
    try {
      json = JSON.parse(cuerpo.texto);
    } catch {
      return errorResponse('solicitud_invalida');
    }
    if (!isPlainObject(json)) return errorResponse('solicitud_invalida');

    const validacion = ruta.validate(json);
    if (!validacion.ok) {
      return errorResponse(validacion.error, validacion.campos ? { campos: validacion.campos } : {});
    }
    return await ruta.handle({ value: validacion.value, request, ports, ctx });
  } catch (error) {
    ports.logger.error('http.error', { ruta: camino, codigo: error instanceof Error ? error.name : 'Error' });
    return errorResponse('error_interno');
  }
}
