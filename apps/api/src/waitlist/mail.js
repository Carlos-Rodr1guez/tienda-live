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

/**
 * @param {string} enlace
 * @returns {{ asunto: string, texto: string }}
 */
export function confirmationMessage(enlace) {
  return {
    asunto: fmt(correo.asunto, { marca: BRAND.name }),
    texto: fmt(correo.texto, { marca: BRAND.name, enlace }),
  };
}
