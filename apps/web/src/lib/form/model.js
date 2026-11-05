// @ts-check
// Modelo del formulario de la lista de espera: código puro, sin DOM, para probarlo con node:test.
// El controlador (form/controller.js, con el DOM) solo lee los campos, llama a estas funciones y pinta el resultado.
//
// - La validación local es la MISMA que hace la API (validateWaitlist de contracts).
// - Todo código de la API y todo campo tiene un mensaje del diccionario; nunca queda la pantalla sin texto.
// - Los errores salen en una lista ordenada como la página, lista para aria-describedby / aria-invalid / role=alert.

import { validateWaitlist } from '@tienda/contracts/waitlist';
import { CONSENT_VERSION } from '@tienda/contracts/consent';
import { formulario, respuestas } from '@tienda/contracts/i18n';

/** Los campos con mensaje de error, en el orden en que aparecen en la página. */
export const FIELD_ORDER = Object.freeze([
  'email',
  'tiktok_user',
  'live_frequency',
  'stream_type',
  'interests',
  'followers_range',
  'country',
  'consent',
]);

/** Ruta de la API de la lista de espera (mismo origen). */
export const WAITLIST_URL = '/v1/waitlist';

/** Id del título que recibe el foco cuando el envío sale bien. */
export const SUCCESS_FOCUS_ID = 'anotarme-exito';

/** @param {string} campo */
export const fieldId = (campo) => `campo-${campo.replace(/_/g, '-')}`;
/** @param {string} campo */
export const errorId = (campo) => `error-${campo.replace(/_/g, '-')}`;

/**
 * @typedef {object} ErrorDeCampo
 * @property {string} campo
 * @property {string} mensaje
 * @property {string} idCampo  id del control (o del grupo) que recibe el foco y aria-invalid
 * @property {string} idError  id del texto de error, el de aria-describedby
 */

/** @typedef {{ fase: 'editando' | 'enviando' | 'exito' | 'error', errores: ErrorDeCampo[], mensaje: string | null }} EstadoFormulario */

/**
 * Lo que leyó el controlador de la página.
 * @typedef {object} CamposCrudos
 * @property {string} email
 * @property {string} tiktok_user
 * @property {string} live_frequency
 * @property {string} stream_type
 * @property {string[]} interests
 * @property {string} followers_range
 * @property {string} country
 * @property {boolean} consent
 */

/**
 * @param {string} campo
 * @returns {ErrorDeCampo}
 */
function errorDe(campo) {
  const mensajes = /** @type {Record<string, string>} */ (respuestas.campos);
  return { campo, mensaje: mensajes[campo], idCampo: fieldId(campo), idError: errorId(campo) };
}

/**
 * Errores de campo ordenados como la página. Ignora los campos que no conoce.
 * @param {Iterable<string>} campos
 * @returns {ErrorDeCampo[]}
 */
function ordenarErrores(campos) {
  const conErrores = new Set(campos);
  return FIELD_ORDER.filter((c) => conErrores.has(c)).map(errorDe);
}

/**
 * Valida los campos con el mismo validador que la API y arma el cuerpo del pedido: sin los opcionales vacíos
 * (la API no acepta null) y con el correo ya normalizado.
 * @param {CamposCrudos} crudos
 * @param {{ turnstileToken: string }} opciones
 * @returns {{ ok: true, body: Record<string, unknown> } | { ok: false, errores: ErrorDeCampo[] }}
 */
export function validateForm(crudos, { turnstileToken }) {
  const resultado = validateWaitlist({
    email: crudos.email,
    ...(crudos.tiktok_user !== '' && { tiktok_user: crudos.tiktok_user }),
    live_frequency: crudos.live_frequency === '' ? undefined : crudos.live_frequency,
    stream_type: crudos.stream_type === '' ? undefined : crudos.stream_type,
    interests: crudos.interests.length === 0 ? undefined : crudos.interests,
    ...(crudos.followers_range !== '' && { followers_range: crudos.followers_range }),
    ...(crudos.country !== '' && { country: crudos.country }),
    consent: crudos.consent,
    consent_version: CONSENT_VERSION,
  });
  if (!resultado.ok) {
    // Los campos obligatorios sin llenar salen como "requerido" en `campos_invalidos`; una forma rota no pasa por acá.
    return {
      ok: false,
      errores: ordenarErrores(resultado.error === 'campos_invalidos' ? Object.keys(resultado.campos) : []),
    };
  }
  // El token de Turnstile no sale de acá: lo pone el controlador, que es quien lo recibe del widget.
  const body = Object.fromEntries(
    Object.entries(resultado.value).filter(([clave, v]) => v !== null && clave !== 'turnstile_token'),
  );
  return { ok: true, body: { ...body, turnstile_token: turnstileToken } };
}

/** @returns {EstadoFormulario} */
export function initialState() {
  return { fase: 'editando', errores: [], mensaje: null };
}

/** @type {Record<number, string>} */
const MENSAJE_POR_ESTADO = {
  403: respuestas.verificacion_fallida,
  413: respuestas.demasiado_grande,
  415: respuestas.solicitud_invalida,
  503: respuestas.no_disponible,
};

/**
 * Convierte la respuesta de la API en el estado que se pinta. Si el cuerpo no se entiende, decide el estado HTTP.
 * @param {number} status
 * @param {unknown} body
 * @returns {EstadoFormulario}
 */
export function interpretResponse(status, body) {
  const cuerpo = typeof body === 'object' && body !== null ? /** @type {Record<string, unknown>} */ (body) : {};
  if (status === 202 && cuerpo.ok === true) return { fase: 'exito', errores: [], mensaje: respuestas.exito };

  if (cuerpo.error === 'campos_invalidos') {
    const campos = typeof cuerpo.campos === 'object' && cuerpo.campos !== null ? Object.keys(cuerpo.campos) : [];
    return { fase: 'error', errores: ordenarErrores(campos), mensaje: respuestas.campos_invalidos };
  }

  const mensajes = /** @type {Record<string, unknown>} */ (respuestas);
  const porCodigo = typeof cuerpo.error === 'string' ? mensajes[cuerpo.error] : undefined;
  const mensaje = typeof porCodigo === 'string' ? porCodigo : (MENSAJE_POR_ESTADO[status] ?? respuestas.error_interno);
  return { fase: 'error', errores: [], mensaje };
}

/**
 * Acciones: enviar (arranca un envío), invalido (la validación local falló), respuesta (llegó la de la API),
 * falloRed (no hubo respuesta) y sinVerificacion (Turnstile no entregó su token).
 * @param {EstadoFormulario} estado
 * @param {{ type: string, errores?: ErrorDeCampo[], status?: number, body?: unknown }} accion
 * @returns {EstadoFormulario}
 */
export function reduce(estado, accion) {
  switch (accion.type) {
    case 'enviar':
      // Con un envío en curso o ya anotado no se vuelve a enviar.
      if (estado.fase === 'enviando' || estado.fase === 'exito') return estado;
      return { fase: 'enviando', errores: [], mensaje: null };
    case 'invalido':
      if (estado.fase === 'enviando' || estado.fase === 'exito') return estado;
      return { fase: 'editando', errores: accion.errores ?? [], mensaje: respuestas.campos_invalidos };
    case 'sinVerificacion':
      if (estado.fase === 'exito') return estado;
      return { fase: 'error', errores: [], mensaje: respuestas.verificacion_fallida };
    case 'respuesta':
      if (estado.fase !== 'enviando') return estado;
      return interpretResponse(accion.status ?? 0, accion.body);
    case 'falloRed':
      if (estado.fase !== 'enviando') return estado;
      return { fase: 'error', errores: [], mensaje: formulario.errorRed };
    default:
      return estado;
  }
}

/** @param {EstadoFormulario} estado */
export const isSubmitDisabled = (estado) => estado.fase === 'enviando' || estado.fase === 'exito';

/** @param {EstadoFormulario} estado */
export const submitLabel = (estado) => (estado.fase === 'enviando' ? formulario.enviando : formulario.enviar);

/**
 * Valor de aria-describedby de un campo: el id de su error, o nada si no tiene.
 * @param {EstadoFormulario} estado
 * @param {string} campo
 * @returns {string | undefined}
 */
export function describedBy(estado, campo) {
  return estado.errores.some((e) => e.campo === campo) ? errorId(campo) : undefined;
}

/**
 * Hacia dónde va el foco tras pintar el estado: el primer campo con error, o el título de éxito.
 * @param {EstadoFormulario} estado
 * @returns {string | null}
 */
export function focusTarget(estado) {
  if (estado.fase === 'exito') return SUCCESS_FOCUS_ID;
  return estado.errores[0]?.idCampo ?? null;
}

/**
 * El pedido de fetch para enviar el formulario. Sin cookies: la API no las usa.
 * @param {Record<string, unknown>} cuerpo
 */
export function buildRequest(cuerpo) {
  return {
    url: WAITLIST_URL,
    init: {
      method: 'POST',
      credentials: /** @type {RequestCredentials} */ ('omit'),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    },
  };
}
