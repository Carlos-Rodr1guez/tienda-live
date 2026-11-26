// Geometría de la interfaz (diseño §10.1, NM-10, CB-17): la escala entera `u`, las regiones del HUD y el marco del
// narrador. Módulo PURO: recibe el tamaño del lienzo y devuelve rectángulos en px de dispositivo, todos enteros.
//
// El lienzo virtual mide `W/u × H/u` (480×270 a 1080p, 640×360 a 720p). Las regiones se anclan a los bordes y están
// pensadas para el mínimo de 480×270: el espacio que sobra va al campo.
//
//   banda superior (y 0–40)    panel del equipo izquierdo · panel central (reloj, ronda, cámara) · panel derecho
//   rieles (x 3–60 y 420–477)  cómo unirse, likes y energía de cada equipo
//   campo (y 40–222)           el mundo
//   banda inferior (222–270)   feed · minimapa · botones de cámara · marco "EN VIVO · NARRADOR" (388–476 × 196–266)
//
// Las medidas son provisorias hasta el segundo teléfono del Gate 0 (Q6 (a)). Nada se escala con el zoom (NM-6).

import { WORLD } from '../camera/controller.js';
import { S } from './strings.js';

/** Alto de la banda superior del HUD, en px virtuales: ninguna etiqueta del mundo sube más arriba (D22). */
export const BAND_TOP = 40;
/** Alto de la banda inferior. */
export const BAND_BOTTOM = 48;
/** Medidas del marco del narrador (NM-10), en px virtuales. */
const FRAME = Object.freeze({ w: 88, h: 70, right: 4, bottom: 4 });

const finito = (v, dflt) => (Number.isFinite(v) ? v : dflt);

/** Escala entera de la interfaz: 480×270 virtuales como mínimo (diseño §10.1). Nunca menos de 1 ni más de 64. */
export function uiScale(W, H) {
  const u = Math.floor(Math.min(finito(W, 480) / 480, finito(H, 270) / 270));
  return Math.min(64, Math.max(1, u));
}

/**
 * Rectángulo del minimapa en px de dispositivo: 84 px virtuales de ancho, centrado en la banda inferior (x 198–282 en
 * 480×270) y con la proporción del mundo. Es una función del tamaño del lienzo y nunca de k (NM-6).
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function minimapRect(W, H) {
  const u = uiScale(W, H);
  const w = 84 * u;
  const h = Math.round((w * WORLD.h) / WORLD.w);
  return { x: Math.round((W - w) / 2), y: H - h - 2 * u, w, h };
}

/** Tamaño en px de dispositivo del rótulo de estado (el texto de la cámara): 7 px virtuales por la escala `u`. */
export const statusFontPx = (W, H) => 7 * uiScale(W, H);

/** El marco del narrador está activo salvo que la config diga `enabled: false` (NM-10: sin config, activo). */
export const frameEnabled = (cfg) => cfg?.enabled !== false;

/** Hueco entre botones y alto táctil mínimo (px de dispositivo). */
const BTN_GAP = 4;
const BTN_MIN_H = 44;
/** El rótulo más largo de los botones, en caracteres, y el ancho por carácter de una fuente de respaldo (mayúsculas ≈ 0,72 em). */
const BTN_LONGEST = Math.max(
  ...[S.camera.viewAll, S.camera.zoomIn, S.camera.zoomOut, S.camera.autoButton].map((t) => t.length),
);
const BTN_EM = 0.72;

const rect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

/**
 * Regiones del HUD en px de dispositivo.
 * @param {number} W ancho del lienzo
 * @param {number} H alto del lienzo
 * @param {{frame?: boolean}} [o] `frame: false` apaga el marco (`camera.enabled: false`)
 */
export function layoutFor(W, H, { frame = true } = {}) {
  W = Math.max(1, Math.round(finito(W, 480)));
  H = Math.max(1, Math.round(finito(H, 270)));
  const u = uiScale(W, H);
  const vw = W / u;
  const vh = H / u;
  const minimap = minimapRect(W, H);

  const marco = rect(W - (FRAME.w + FRAME.right) * u, H - (FRAME.h + FRAME.bottom) * u, FRAME.w * u, FRAME.h * u);
  const center = rect(W / 2 - 84 * u, 3 * u, 168 * u, 34 * u);
  const bandaY = H - (BAND_BOTTOM - 2) * u;
  return {
    u,
    vw,
    vh,
    top: rect(0, 0, W, BAND_TOP * u),
    panelL: rect(3 * u, 3 * u, 150 * u, 34 * u),
    panelR: rect(W - 153 * u, 3 * u, 150 * u, 34 * u),
    center,
    /** Línea de estado de la cámara: dentro del panel central, aparte de los botones (S3). */
    status: rect(center.x + 2 * u, center.y + 22 * u, center.w - 4 * u, 10 * u),
    railL: rect(3 * u, 44 * u, 57 * u, 96 * u),
    railR: rect(W - 60 * u, 44 * u, 57 * u, 96 * u),
    field: rect(0, BAND_TOP * u, W, H - (BAND_TOP + BAND_BOTTOM) * u),
    bottom: rect(0, H - BAND_BOTTOM * u, W, BAND_BOTTOM * u),
    feed: rect(3 * u, bandaY, Math.max(1, minimap.x - 6 * u), 44 * u),
    minimap,
    /** Los cuatro botones de cámara (DOM, 2×2), a la izquierda del marco: ver `cameraButtonsGrid`. */
    buttons: buttonsRect(W, H, u, marco),
    frame: frame ? marco : null,
  };
}

/**
 * Lo que muestran los controles de cámara: el ESTADO (lo que hace la cámara ahora) y los botones (lo que hacen al
 * pulsarlos), por separado (S3 de la revisión de 5c). Con la automática encendida pero esperando sus 7 s el estado
 * dice MANUAL y el botón la APAGA; con ella apagada el botón la ENCIENDE.
 * @param {{mode: string, autoEnabled: boolean, k: number, kShown: number, level: number, levels: number}} st
 */
export function cameraControls(st) {
  return {
    status: st.mode === 'auto' ? S.camera.auto : S.camera.manual,
    viewAll: { text: S.camera.viewAll, disabled: st.k === 1 && st.kShown === 1 },
    zoomIn: { text: S.camera.zoomIn, disabled: st.level >= st.levels - 1 },
    zoomOut: { text: S.camera.zoomOut, disabled: st.k === 1 },
    // botón de alternar: rótulo fijo (no copia el estado) y `pressed` para `aria-pressed`
    auto: { text: S.camera.autoButton, pressed: Boolean(st.autoEnabled), disabled: false },
  };
}

/** Región de los botones: 98×44 virtuales, y nunca menos de dos filas de 44 px ni de un ancho en que quepa el rótulo más largo a 9 px. */
function buttonsRect(W, H, u, marco) {
  const w = Math.max(98 * u, 2 * Math.ceil(BTN_LONGEST * 9 * BTN_EM + 8) + BTN_GAP);
  const h = Math.max(44 * u, 2 * BTN_MIN_H + BTN_GAP);
  return rect(marco.x - 4 * u - w, H - 2 * u - h, w, h);
}

/**
 * La cuadrícula 2×2 de los botones de cámara: su región, el tamaño de cada celda (≥ 44 px de alto) y la fuente en px de
 * dispositivo, calculada para que el rótulo más largo quepa con una fuente de respaldo a cualquier escala `u`.
 */
export function cameraButtonsGrid(W, H) {
  const L = layoutFor(W, H);
  const r = L.buttons;
  const cell = { w: Math.floor((r.w - BTN_GAP) / 2), h: Math.floor((r.h - BTN_GAP) / 2) };
  const fontPx = Math.max(8, Math.min(7 * L.u, Math.floor((cell.w - 8) / (BTN_LONGEST * BTN_EM))));
  return { rect: r, cols: 2, rows: 2, gap: BTN_GAP, cell, fontPx };
}
