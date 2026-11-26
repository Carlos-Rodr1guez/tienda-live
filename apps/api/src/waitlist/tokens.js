// @ts-check
// Token de confirmación: 32 bytes aleatorios en base64url (43 caracteres). En la base solo vive su SHA-256 en
// hexadecimal, así que ni un volcado de la tabla permite confirmar un correo ajeno.

import { CONFIRM_TOKEN_LENGTH } from '@tienda/contracts/limits';

const BYTES_DEL_TOKEN = 32;

/** Un enlace sirve 48 horas (WL-7). Vence en el instante exacto: se comprueba `vence > ahora`. */
export const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * @param {Uint8Array} bytes
 */
function base64url(bytes) {
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * Un token nuevo. Los bytes salen del puerto Random (en producción, crypto.getRandomValues).
 * @param {import('../ports.js').Random} random
 */
export function generateToken(random) {
  const token = base64url(random.bytes(BYTES_DEL_TOKEN));
  if (token.length !== CONFIRM_TOKEN_LENGTH) throw new Error('el token no tiene el largo esperado');
  return token;
}

/**
 * SHA-256 del token en hexadecimal minúscula (64 caracteres): lo único que se guarda.
 * @param {string} token
 */
export async function hashToken(token) {
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(resumen), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
