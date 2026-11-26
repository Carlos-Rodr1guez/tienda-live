// @ts-check
// Modelo de la página /confirmar: código puro, sin DOM. El enlace del correo trae el token en el fragmento
// (#t=<token>), que no llega al servidor ni a los registros ni al Referer. La página lo lee, lo borra de la URL
// y solo manda la confirmación cuando la persona pulsa el botón (un GET nunca cambia nada).

import { CONFIRM_TOKEN_PATTERN } from '@tienda/contracts/confirm';
import { confirmar, respuestas } from '@tienda/contracts/i18n';

/** La URL a la que la página vuelve (history.replaceState) para que el token no quede en la barra ni en el historial. */
export const CLEAN_PATH = '/confirmar';

/** Ruta de la API de confirmación (mismo origen). */
export const CONFIRM_URL = '/v1/waitlist/confirm';

/** Tiempo máximo de la confirmación. Pasado, se aborta y sigue el camino de "error-red": el botón vuelve a "Intentar de nuevo". */
export const CONFIRM_TIMEOUT_MS = 15_000;

/** @typedef {{ fase: 'sin-enlace' | 'listo' | 'enviando' | 'confirmado' | 'invalido' | 'error-red' | 'demasiados-intentos', token: string | null }} EstadoConfirmar */

/**
 * Saca el token del fragmento. Tiene que ser exactamente `t=<43 caracteres base64url>`, con o sin el `#`.
 * @param {unknown} fragmento  location.hash
 * @returns {string | null}
 */
export function parseFragment(fragmento) {
  if (typeof fragmento !== 'string') return null;
  const m = /^#?t=(.+)$/.exec(fragmento);
  return m && CONFIRM_TOKEN_PATTERN.test(m[1]) ? m[1] : null;
}

/**
 * @param {unknown} fragmento
 * @returns {EstadoConfirmar}
 */
export function initialConfirmState(fragmento) {
  const token = parseFragment(fragmento);
  return token ? { fase: 'listo', token } : { fase: 'sin-enlace', token: null };
}

/**
 * Acciones: confirmar (la persona pulsó el botón), respuesta (llegó la de la API) y falloRed.
 * Un enlace inválido (400) no se reintenta; un error de red o del servidor sí, con el mismo token, y un 429 (la regla de
 * límite de Cloudflare) también, pero con su propio mensaje: pide esperar en lugar de culpar a la conexión.
 * @param {EstadoConfirmar} estado
 * @param {{ type: string, status?: number, body?: unknown }} accion
 * @returns {EstadoConfirmar}
 */
export function reduceConfirm(estado, accion) {
  switch (accion.type) {
    case 'confirmar':
      return estado.fase === 'listo' || estado.fase === 'error-red' || estado.fase === 'demasiados-intentos'
        ? { fase: 'enviando', token: estado.token }
        : estado;
    case 'respuesta': {
      if (estado.fase !== 'enviando') return estado;
      if (accion.status === 200) return { fase: 'confirmado', token: null };
      if (accion.status === 400) return { fase: 'invalido', token: null };
      if (accion.status === 429) return { fase: 'demasiados-intentos', token: estado.token };
      return { fase: 'error-red', token: estado.token };
    }
    case 'falloRed':
      return estado.fase === 'enviando' ? { fase: 'error-red', token: estado.token } : estado;
    default:
      return estado;
  }
}

/**
 * El texto que se muestra en cada estado.
 * @param {EstadoConfirmar} estado
 * @returns {string}
 */
export function messageFor(estado) {
  switch (estado.fase) {
    case 'sin-enlace':
      return confirmar.sinEnlace;
    case 'listo':
      return confirmar.listo;
    case 'enviando':
      return confirmar.enviando;
    case 'confirmado':
      return respuestas.confirmado;
    case 'invalido':
      return respuestas.enlace_invalido;
    case 'error-red':
      return confirmar.errorRed;
    case 'demasiados-intentos':
      return respuestas.demasiados_intentos;
  }
}

/**
 * Qué muestra la página en cada estado: el mensaje, su tono, el botón y si hay enlace para volver al inicio.
 * @typedef {{
 *   mensaje: string,
 *   tono: 'neutro' | 'ok' | 'error',
 *   boton: { visible: boolean, deshabilitado: boolean, texto: string },
 *   volver: boolean,
 * }} VistaConfirmar
 * @param {EstadoConfirmar} estado
 * @returns {VistaConfirmar}
 */
export function viewFor(estado) {
  const mensaje = messageFor(estado);
  const sinBoton = { visible: false, deshabilitado: false, texto: confirmar.boton };
  switch (estado.fase) {
    case 'listo':
      return {
        mensaje,
        tono: 'neutro',
        boton: { visible: true, deshabilitado: false, texto: confirmar.boton },
        volver: false,
      };
    case 'enviando':
      return {
        mensaje,
        tono: 'neutro',
        boton: { visible: true, deshabilitado: true, texto: confirmar.enviando },
        volver: false,
      };
    case 'confirmado':
      return { mensaje, tono: 'ok', boton: sinBoton, volver: true };
    case 'error-red':
    case 'demasiados-intentos':
      return {
        mensaje,
        tono: 'error',
        boton: { visible: true, deshabilitado: false, texto: confirmar.reintentar },
        volver: false,
      };
    case 'sin-enlace':
    case 'invalido':
      return { mensaje, tono: 'error', boton: sinBoton, volver: true };
  }
}

/**
 * El pedido de fetch de la confirmación: el token va en el cuerpo, nunca en la URL. Con tiempo máximo, para que una
 * conexión colgada no deje la página en "Confirmando…".
 * @param {string} token
 * @param {{ timeoutMs?: number }} [opciones]
 */
export function buildConfirmRequest(token, { timeoutMs = CONFIRM_TIMEOUT_MS } = {}) {
  return {
    url: CONFIRM_URL,
    init: {
      method: 'POST',
      credentials: /** @type {RequestCredentials} */ ('omit'),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  };
}
