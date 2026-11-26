// @ts-check
// Validador de la lista de espera. Es el mismo en el navegador y en la API.
//
// Resultado:
//   { ok: true, value }                                  carga normalizada
//   { ok: false, error: 'solicitud_invalida' }           forma rota: no es un objeto, sobra una clave o la versión del
//                                                        consentimiento no es la vigente
//   { ok: false, error: 'campos_invalidos', campos }     errores por campo, todos a la vez
//
// `turnstile_token` no genera error de campo: la especificación manda un 403 cuando falta o es inválido, y esa
// decisión es de la API (después de validar los campos). Acá sale como string o null.

import { COUNTRIES, FOLLOWER_RANGES, CATEGORIES, LIVE_FREQUENCY, STREAM_TYPES } from './enums.js';
import { LIMITS } from './limits.js';
import { CONSENT_VERSION } from './consent.js';
import { hasUnknownKeys, isOneOf, isPlainObject } from './shape.js';

/** Códigos de error por campo. */
export const FIELD_ERROR_CODES = Object.freeze(
  /** @type {const} */ (['requerido', 'formato', 'largo', 'opcion', 'cantidad', 'repetido', 'consentimiento']),
);

/** @typedef {typeof FIELD_ERROR_CODES[number]} FieldErrorCode */

/** Claves permitidas en la carga. Cualquier otra se rechaza. */
export const WAITLIST_KEYS = Object.freeze([
  'email',
  'tiktok_user',
  'live_frequency',
  'stream_type',
  'interests',
  'followers_range',
  'country',
  'consent',
  'consent_version',
  'turnstile_token',
]);

/**
 * @typedef {object} WaitlistValue
 * @property {string} email
 * @property {string | null} tiktok_user
 * @property {typeof LIVE_FREQUENCY[number]} live_frequency
 * @property {typeof STREAM_TYPES[number]} stream_type
 * @property {typeof CATEGORIES[number][]} interests  ordenados como CATEGORIES
 * @property {typeof FOLLOWER_RANGES[number] | null} followers_range
 * @property {typeof COUNTRIES[number] | null} country
 * @property {true} consent
 * @property {string} consent_version
 * @property {string | null} turnstile_token
 */

/**
 * @typedef {{ ok: true, value: WaitlistValue }
 *   | { ok: false, error: 'solicitud_invalida' }
 *   | { ok: false, error: 'campos_invalidos', campos: Record<string, FieldErrorCode> }} WaitlistResult
 */

// Espacios, controles y mitades sueltas de par sustituto (\p{Cs}; con la bandera u un par completo NO coincide). No se
// usa String.isWellFormed porque este validador también corre en navegadores.
const CARACTER_PROHIBIDO_EMAIL = /[\s\p{Cc}\p{Cs}]/u;
// Parte local: separadores de listas de direcciones, de cabeceras y de comillas (, ; : < > ( ) [ ] " \).
const CARACTER_PROHIBIDO_LOCAL = /[,;:<>()[\]"\\]/;
// Cada etiqueta del dominio: letras, marcas, dígitos y guion (los dominios IDN siguen valiendo).
const ETIQUETA_VALIDA = /^[\p{L}\p{M}\p{N}-]+$/u;
// Caracteres de formato invisibles (espacio de ancho cero, unión, BOM, guion blando, inversión de dirección...).
const CARACTER_INVISIBLE_EMAIL = /\p{Cf}/u;
const TIKTOK_USER_VALIDO = /^[A-Za-z0-9._]+$/;

/**
 * Normaliza un correo: Unicode NFC, recorta y pasa a minúsculas. La forma devuelta es la que se guarda y la que debe
 * ser única. No colapsa alias (`+etiqueta`), no toca los puntos de la parte local y admite dominios IDN.
 * @param {unknown} crudo
 * @returns {{ ok: true, value: string } | { ok: false, code: FieldErrorCode }}
 */
export function normalizeEmail(crudo) {
  if (crudo === undefined) return { ok: false, code: 'requerido' };
  if (typeof crudo !== 'string') return { ok: false, code: 'formato' };
  const compuesto = crudo.normalize('NFC');
  // Antes de recortar: String.trim() quita U+FEFF (es de formato), y un BOM al borde tiene que rechazarse igual.
  if (CARACTER_INVISIBLE_EMAIL.test(compuesto)) return { ok: false, code: 'formato' };
  const email = compuesto.trim().toLowerCase().normalize('NFC');
  if (email === '') return { ok: false, code: 'requerido' };
  if (email.length > LIMITS.email.max) return { ok: false, code: 'largo' };
  if (CARACTER_PROHIBIDO_EMAIL.test(email)) return { ok: false, code: 'formato' };
  const partes = email.split('@');
  if (partes.length !== 2) return { ok: false, code: 'formato' };
  const [local, dominio] = partes;
  const etiquetas = dominio.split('.');
  // El dominio necesita al menos dos etiquetas, ninguna vacía y ninguna que empiece o termine en guion.
  const etiquetaMala = etiquetas.some((e) => !ETIQUETA_VALIDA.test(e) || e.startsWith('-') || e.endsWith('-'));
  if (local === '' || CARACTER_PROHIBIDO_LOCAL.test(local) || etiquetas.length < 2 || etiquetaMala)
    return { ok: false, code: 'formato' };
  return { ok: true, value: email };
}

/**
 * @param {unknown} crudo
 * @returns {{ ok: true, value: string | null } | { ok: false, code: FieldErrorCode }}
 */
function normalizeTiktokUser(crudo) {
  if (crudo === undefined) return { ok: true, value: null };
  if (typeof crudo !== 'string') return { ok: false, code: 'formato' };
  let usuario = crudo.trim();
  if (usuario.startsWith('@')) usuario = usuario.slice(1);
  if (usuario === '') return { ok: true, value: null };
  if (usuario.length > LIMITS.tiktokUser.max) return { ok: false, code: 'largo' };
  if (usuario.length < LIMITS.tiktokUser.min || !TIKTOK_USER_VALIDO.test(usuario))
    return { ok: false, code: 'formato' };
  return { ok: true, value: usuario };
}

/**
 * @template {string} T
 * @param {readonly T[]} lista
 * @param {unknown} crudo
 * @returns {{ ok: true, value: T } | { ok: false, code: FieldErrorCode }}
 */
function requiredOption(lista, crudo) {
  if (crudo === undefined) return { ok: false, code: 'requerido' };
  if (!isOneOf(lista, crudo)) return { ok: false, code: 'opcion' };
  return { ok: true, value: /** @type {T} */ (crudo) };
}

/**
 * Opcional: ausente o cadena vacía (la opción en blanco de un select) equivale a "no contestó".
 * @template {string} T
 * @param {readonly T[]} lista
 * @param {unknown} crudo
 * @returns {{ ok: true, value: T | null } | { ok: false, code: FieldErrorCode }}
 */
function optionalOption(lista, crudo) {
  if (crudo === undefined || crudo === '') return { ok: true, value: null };
  if (!isOneOf(lista, crudo)) return { ok: false, code: 'opcion' };
  return { ok: true, value: /** @type {T} */ (crudo) };
}

/**
 * @param {unknown} crudo
 * @returns {{ ok: true, value: typeof CATEGORIES[number][] } | { ok: false, code: FieldErrorCode }}
 */
function normalizeInterests(crudo) {
  if (crudo === undefined) return { ok: false, code: 'requerido' };
  if (!Array.isArray(crudo)) return { ok: false, code: 'formato' };
  if (crudo.length < LIMITS.interests.min || crudo.length > LIMITS.interests.max)
    return { ok: false, code: 'cantidad' };
  if (!crudo.every((c) => isOneOf(CATEGORIES, c))) return { ok: false, code: 'opcion' };
  if (new Set(crudo).size !== crudo.length) return { ok: false, code: 'repetido' };
  const elegidas = /** @type {string[]} */ (crudo);
  return { ok: true, value: CATEGORIES.filter((c) => elegidas.includes(c)) };
}

/**
 * @param {unknown} entrada  lo que salió de JSON.parse
 * @returns {WaitlistResult}
 */
export function validateWaitlist(entrada) {
  if (!isPlainObject(entrada) || hasUnknownKeys(entrada, WAITLIST_KEYS))
    return { ok: false, error: 'solicitud_invalida' };
  if (entrada.consent_version !== CONSENT_VERSION) return { ok: false, error: 'solicitud_invalida' };

  /** @type {Record<string, FieldErrorCode>} */
  const campos = {};
  /**
   * @template V
   * @param {string} campo
   * @param {{ ok: true, value: V } | { ok: false, code: FieldErrorCode }} resultado
   * @returns {V | undefined}
   */
  const tomar = (campo, resultado) => {
    if (resultado.ok) return resultado.value;
    campos[campo] = resultado.code;
    return undefined;
  };

  const email = tomar('email', normalizeEmail(entrada.email));
  const tiktok_user = tomar('tiktok_user', normalizeTiktokUser(entrada.tiktok_user));
  const live_frequency = tomar('live_frequency', requiredOption(LIVE_FREQUENCY, entrada.live_frequency));
  const stream_type = tomar('stream_type', requiredOption(STREAM_TYPES, entrada.stream_type));
  const interests = tomar('interests', normalizeInterests(entrada.interests));
  const followers_range = tomar('followers_range', optionalOption(FOLLOWER_RANGES, entrada.followers_range));
  const country = tomar('country', optionalOption(COUNTRIES, entrada.country));
  if (entrada.consent !== true) campos.consent = 'consentimiento';

  if (Object.keys(campos).length > 0) return { ok: false, error: 'campos_invalidos', campos };

  const token = entrada.turnstile_token;
  const turnstile_token =
    typeof token === 'string' && token.length >= 1 && token.length <= LIMITS.turnstileToken.max ? token : null;

  return {
    ok: true,
    value: /** @type {WaitlistValue} */ ({
      email,
      tiktok_user,
      live_frequency,
      stream_type,
      interests,
      followers_range,
      country,
      consent: true,
      consent_version: CONSENT_VERSION,
      turnstile_token,
    }),
  };
}
