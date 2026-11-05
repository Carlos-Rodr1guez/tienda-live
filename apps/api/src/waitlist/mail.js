// @ts-check
// El correo de confirmación (WL-15). Solo lleva el enlace: sin parámetros de seguimiento, sin imágenes, sin otros
// enlaces. El token va en el fragmento (#t=), que el navegador no envía al servidor ni en el Referer.

import { BRAND } from '@tienda/contracts/brand';
import { correo, fmt } from '@tienda/contracts/i18n';

/**
 * @param {string} siteUrl Origen del sitio, sin barra final.
 * @param {string} token
 */
export function confirmationLink(siteUrl, token) {
  return `${siteUrl}/confirmar#t=${token}`;
}

const HORA_MS = 60 * 60 * 1000;

/**
 * Lo que le queda al enlace, dicho para el correo: 2 horas o más -> "{n} horas" (hacia abajo); de 1 a menos de 2 ->
 * "1 hora"; menos de una hora -> "menos de una hora". Un alta nueva (48 h justas) dice "48 horas".
 * @param {number} validezMs
 */
export function vigenciaTexto(validezMs) {
  const horas = Math.floor(validezMs / HORA_MS);
  if (horas >= 2) return fmt(correo.vigencia.horas, { n: horas });
  return horas === 1 ? correo.vigencia.una : correo.vigencia.menos;
}

/**
 * @param {string} enlace
 * @param {number} validezMs Lo que le queda de verdad al enlace (vencimiento menos el reloj con el que se calculó).
 * @returns {{ asunto: string, texto: string }}
 */
export function confirmationMessage(enlace, validezMs) {
  return {
    asunto: fmt(correo.asunto, { marca: BRAND.name }),
    texto: fmt(correo.texto, { marca: BRAND.name, enlace, vigencia: vigenciaTexto(validezMs) }),
  };
}
