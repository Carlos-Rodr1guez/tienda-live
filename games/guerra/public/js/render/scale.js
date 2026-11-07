// Modo de escala del mundo según la escala mostrada `s` (diseño D21 punto 3; NM-6 y CB-18). Función pura.
//
//   s < 1                       suave ('smooth'): bilineal del navegador con quality 'medium' (siempre con marcas)
//   1 < s < 1,9 no entera       nítido ('sharp'): LOW -> MID x2 con vecino más cercano; MID -> pantalla bilineal 'low'
//   s entera o s >= 1,9         vecino más cercano ('nearest')
//
// SHARP_BELOW es una constante, no una clave de config: con un valor configurable, los reposos 1,8 y 1,86 de la
// cámara automática dejarían de ser nítidos.

/** Desde esta escala se amplía siempre con vecino más cercano. */
export const SHARP_BELOW = 1.9;

/** Tolerancia para tomar como entera una `s` con error de coma flotante (k 1,5 en 1080p da 2,0000000000000004). */
const EPS = 1e-6;

/**
 * @param {number} s escala mostrada (px de dispositivo por px de mundo)
 * @returns {{mode: 'smooth'|'sharp'|'nearest', quality: 'medium'|'low'|null}}
 */
export function scaleMode(s) {
  if (s < 1 - EPS) return { mode: 'smooth', quality: 'medium' };
  if (s >= SHARP_BELOW) return { mode: 'nearest', quality: null };
  if (Math.abs(s - Math.round(s)) < EPS) return { mode: 'nearest', quality: null };
  return { mode: 'sharp', quality: 'low' };
}
