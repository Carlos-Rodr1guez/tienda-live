// Arte de las bases (diseño D21 punto 11; CB-3, CB-19, CB-2). Dos recetas paramétricas de 110x669 px, de y 112
// (`SKY_H`) a y 781 (`NEAR_Y` + 6), con 4 estados prerenderizados por lado. Desde v2.8 NO hay muralla: la base es un
// HANGAR, el rectángulo de x 14–90 y y 348–548 (lado izquierdo; el derecho es su espejo), con dos portones en la cara y
// las plataformas de las tres torretas delante. Quedan los depósitos como escenografía.
//   base-fortin    hangar de techo plano con torre de control cuadrada (lado izquierdo)
//   base-ciudadela hangar abovedado con costillas y cúpula (lado derecho)
// La silueta distingue a los equipos sin depender del color (CB-3): la ciudadela NO es el espejo del fortín. Los
// estados (entero, grietas, techo hundido, ruinas) y la secuencia de destrucción son solo vista: ninguna regla los lee.
// El arte usa un azar fijo por receta y estado (nunca el de la partida), y el color del equipo entra solo por la paleta
// del tinte.

import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { PALETA } from '../data/paleta.js';
import { disc, ell, line } from './pixel.js';
import { shade, tint } from './sprites.js';

const INK = PALETA.ink;
export const BASE_W = 110;
export const BASE_Y0 = 112; // `SKY_H`
export const BASE_H = 669; // de 112 a 781
export const NEAR_Y = 775;
export const MIDY = 448;
const TURY = [242, MIDY, 655];

/** El hangar (v2.8): x 14–90 y y 348–548 del lado izquierdo (en el derecho, el espejo). Es la zona de asalto. */
export const HANGAR_ART = Object.freeze({ x0: 14, x1: 90, y0: 348, y1: 548 });
/** Altura (y de mundo) de cada depósito. Ninguno toca el hangar. */
export const DEPOT_Y = Object.freeze([196, 286, 586, 676]);
/** Altura (y de mundo) del centro de cada portón de la cara del hangar. */
export const DOOR_Y = Object.freeze([400, 496]);

export const BASE_KINDS = Object.freeze(['base-fortin', 'base-ciudadela']);

/** Umbrales de HP de los 4 estados (cosméticos: se pueden cambiar sin tocar el sim). */
export const BASE_STATE_THRESHOLDS = Object.freeze({ cracks: 0.66, heavy: 0.33 });

/**
 * Estado visual de una base según su HP: 0 entera, 1 con grietas (< 0,66), 2 muy dañada (< 0,33) y 3 en ruinas (0).
 * @param {number} pct HP / HP máximo
 * @param {boolean} fell
 */
export function baseState(pct, fell, th = BASE_STATE_THRESHOLDS) {
  if (fell || pct <= 0) return 3;
  if (pct < th.heavy) return 2;
  if (pct < th.cracks) return 1;
  return 0;
}

/**
 * Pinta una base en `g` (un contexto de 110x669; las coordenadas son las del mundo con y desde 112).
 * @param {any} g contexto 2D (lo prueban un contexto falso y uno real)
 * @param {{kind: 'base-fortin'|'base-ciudadela', hex: string, state: 0|1|2|3}} o
 */
export function paintBase(g, { kind, hex, state: st }) {
  const rnd = mulberry32(seedFrom(`${kind}:${st}`));
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  g.translate(0, -BASE_Y0);
  const R = (col, x, y, w, h) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const tD = shade(hex, 0.35);
  const tL = tint(hex, 0.25);
  const ruin = st === 3;
  const redonda = kind === 'base-ciudadela';
  const { x0: HX0, x1: HX1, y0: HY0, y1: HY1 } = HANGAR_ART;
  const HW = HX1 - HX0; // 76 de fondo
  const HH = HY1 - HY0; // 200 de alto
  const crate = (x, y) => {
    R(INK, x, y, 8, 8);
    R('#7A6642', x + 1, y + 1, 6, 6);
    R('#9A8458', x + 1, y + 1, 6, 1);
    R('#5E4E32', x + 1, y + 4, 6, 1);
  };
  const crack = (pts) => {
    g.fillStyle = INK;
    for (let i = 1; i < pts.length; i++) line(g, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  };
  const rub = (x, y, w, h) => {
    R(INK, x, y, w + 2, h + 2);
    R(pick(['#4A5468', '#3B4558', '#6B778D', '#323B4D']), x + 1, y + 1, w, h);
  };

  // plataformas de las torretas (delante de la cara del hangar)
  for (const ty of TURY) {
    g.fillStyle = INK;
    disc(g, 100, ty + 2, 10);
    g.fillStyle = '#3B4558';
    disc(g, 100, ty + 2, 9);
    g.fillStyle = '#5A667C';
    disc(g, 100, ty - 1, 9);
    g.fillStyle = '#323B4D';
    disc(g, 100, ty - 1, 6);
    if (ruin) {
      g.fillStyle = '#141A26';
      disc(g, 100, ty, 6);
    }
  }

  // depósitos: escenografía, ninguno toca el hangar
  const depot = (y0) => {
    R(INK, 19, y0, 40, 26);
    R(tD, 20, y0 + 1, 38, 15);
    R(hex, 20, y0 + 1, 38, 13);
    R(tL, 20, y0 + 1, 38, 1);
    R(tD, 20, y0 + 7, 38, 2);
    R('#4A5468', 20, y0 + 16, 38, 9);
    R('#6B778D', 20, y0 + 16, 38, 1);
    R('#141A26', 34, y0 + 18, 10, 7);
  };
  if (!ruin) {
    for (const y of DEPOT_Y) {
      depot(y);
      crate(64, y + 5);
    }
  } else {
    for (const y0 of DEPOT_Y) for (let i = 0; i < 10; i++) rub(ri(19, 56), y0 + ri(0, 22), ri(4, 8), ri(3, 5));
  }

  // ---------------------------------------------------------------- el hangar
  // contorno y cimientos: todo el rectángulo queda pintado (un píxel sin pintar dejaría ver el suelo dentro del edificio)
  R(INK, HX0 - 1, HY0 - 1, HW + 2, HH + 3);
  if (ruin) {
    R('#1A202C', HX0, HY0, HW, HH + 1);
    for (let i = 0; i < 160; i++)
      R(rnd() < 0.5 ? '#10151E' : '#232B3A', ri(HX0, HX1 - 8), ri(HY0, HY1 - 4), ri(3, 9), ri(2, 5));
    // el esqueleto del techo, caído y retorcido, y cascotes con el color del equipo
    for (let i = 0; i < 4; i++) {
      const x = ri(HX0 + 4, HX1 - 34); // la viga llega a x + 30: no se sale del hangar
      const y = ri(HY0 + 8, HY1 - 14);
      crack([
        [x, y],
        [x + ri(8, 18), y + ri(-6, 6)],
        [x + ri(20, 30), y + ri(-4, 10)],
      ]);
    }
    for (let i = 0; i < 70; i++) rub(ri(HX0 + 1, HX1 - 12), ri(HY0 + 2, HY1 - 8), ri(3, 9), ri(2, 5));
    for (let i = 0; i < 12; i++) {
      const x = ri(HX0 + 2, HX1 - 14);
      const y = ri(HY0 + 6, HY1 - 10);
      R(INK, x, y, 9, 5);
      R(hex, x + 1, y + 1, 7, 3);
    }
    // portones caídos en la cara
    for (const dy of DOOR_Y) {
      R(INK, HX1 - 9, dy - 12, 10, 24);
      R('#141A26', HX1 - 8, dy - 11, 9, 22);
      rub(HX1 - 7, dy - 6 + ri(0, 4), ri(4, 6), ri(3, 5));
    }
    g.globalAlpha = 0.45;
    g.fillStyle = '#000';
    ell(g, 52, MIDY, 36, 90);
    for (const t of TURY) ell(g, 100, t, 10, 6);
    g.globalAlpha = 1;
    return;
  }

  // techo
  if (!redonda) {
    // fortín: techo plano de planchas con costuras, franja del equipo en la cara y dos marcas de equipo
    R('#6B778D', HX0, HY0, HW, HH + 1);
    R('#5A667C', HX0, HY0, 6, HH + 1); // el fondo, en sombra
    for (let y = HY0 + 18, k = 0; y < HY1; y += 20, k++) {
      R('#4A5468', HX0, y, HW, 1);
      R('#8794AB', HX0, y + 1, HW, 1);
      for (let x = HX0 + 10 + (k % 2) * 12; x < HX1 - 12; x += 24) R('#4A5468', x, y + 2, 1, Math.min(18, HY1 - y - 1));
    }
    R('#8794AB', HX0, HY0, HW, 1);
    for (const y of [HY0 + 30, HY1 - 50]) {
      R(INK, 30, y, 28, 22);
      R(tD, 31, y + 1, 26, 20);
      R(hex, 31, y + 1, 26, 17);
      R(tL, 31, y + 1, 26, 1);
    }
    // torre de control cuadrada sobre el centro
    R(INK, 28, MIDY - 20, 30, 38);
    R('#8794AB', 29, MIDY - 19, 28, 26);
    R('#6B778D', 30, MIDY - 18, 26, 24);
    R(INK, 33, MIDY - 14, 20, 12);
    R('#323B4D', 34, MIDY - 13, 18, 10);
    R(hex, 36, MIDY - 11, 14, 6);
    R(tL, 36, MIDY - 11, 14, 1);
    R('#4A5468', 29, MIDY + 7, 28, 10);
    R('#3B4558', 29, MIDY + 15, 28, 2);
    for (const x of [33, 41, 49]) R('#141A26', x, MIDY + 9, 3, 4);
  } else {
    // ciudadela: techo abovedado (más claro en la cresta, por filas), costillas y cúpula con aguja
    const tonos = ['#4A5468', '#5A667C', '#6B778D', '#7C89A0', '#8794AB'];
    for (let y = HY0; y <= HY1; y++) {
      const t = 1 - Math.abs(y - MIDY) / (HH / 2);
      R(tonos[Math.min(4, Math.floor(t * 5))], HX0, y, HW, 1);
    }
    for (let x = HX0 + 8; x < HX1 - 6; x += 12) {
      R('#3B4558', x, HY0, 1, HH + 1);
      R('#9DA9BF', x + 1, HY0, 1, HH + 1);
    }
    R('#8794AB', HX0, HY0, HW, 1);
    for (const y of [HY0 + 22, HY1 - 40]) {
      R(INK, 22, y, 44, 6);
      R(hex, 23, y + 1, 42, 4);
      R(tL, 23, y + 1, 42, 1);
    }
    g.fillStyle = INK;
    ell(g, 42, MIDY, 18, 26);
    g.fillStyle = tD;
    ell(g, 42, MIDY + 1, 17, 25);
    g.fillStyle = hex;
    ell(g, 42, MIDY - 1, 15, 23);
    g.fillStyle = tL;
    ell(g, 37, MIDY - 9, 6, 8);
    R(INK, 41, MIDY - 34, 3, 9);
    R('#FFD84A', 41, MIDY - 34, 3, 2);
  }
  // cara del hangar: parapeto con la franja del equipo y dos portones
  R('#4A5468', HX1 - 10, HY0, 10, HH + 1);
  R('#6B778D', HX1 - 10, HY0, 1, HH + 1);
  R(hex, HX1 - 8, HY0 + 2, 6, HH - 3);
  R(tL, HX1 - 8, HY0 + 2, 6, 1);
  R(tD, HX1 - 3, HY0 + 2, 1, HH - 3);
  for (const dy of DOOR_Y) {
    R(INK, HX1 - 9, dy - 12, 10, 24);
    R('#141A26', HX1 - 8, dy - 11, 9, 22);
    R(hex, HX1 - 8, dy - 11, 9, 2);
    R(tL, HX1 - 8, dy - 11, 9, 1);
    for (let y = dy - 8; y < dy + 11; y += 5) R('#232B3A', HX1 - 8, y, 9, 1);
  }

  // estado 1: grietas en el techo, hollín y un panel de la cara rajado
  if (st >= 1) {
    crack([
      [26, HY0 + 3],
      [30, HY0 + 14],
      [27, HY0 + 26],
      [33, HY0 + 38],
    ]);
    crack([
      [62, HY1 - 4],
      [58, HY1 - 16],
      [63, HY1 - 28],
    ]);
    crack([
      [HX1 - 10, DOOR_Y[0] + 14],
      [HX1 - 6, DOOR_Y[0] + 22],
      [HX1 - 9, DOOR_Y[0] + 30],
    ]);
    R('#141A26', 50, HY0 + 24, 5, 4);
    g.globalAlpha = 0.35;
    g.fillStyle = '#000';
    ell(g, 40, HY0 + 60, 18, 10);
    ell(g, 56, HY1 - 40, 16, 9);
    g.globalAlpha = 1;
  }
  // estado 2: el techo se hunde (agujero con vigas), escombros sobre el techo y un portón reventado
  if (st >= 2) {
    R(INK, 24, MIDY - 40, 36, 30);
    R('#141A26', 25, MIDY - 39, 34, 28);
    for (const x of [30, 38, 46, 54]) R('#3B4558', x, MIDY - 39, 2, 28);
    crack([
      [25, MIDY - 39],
      [31, MIDY - 33],
      [28, MIDY - 26],
      [37, MIDY - 20],
    ]);
    R(INK, 28, MIDY + 22, 40, 22);
    R('#141A26', 29, MIDY + 23, 38, 20);
    for (const x of [34, 44, 54]) R('#3B4558', x, MIDY + 23, 2, 20);
    rub(30, MIDY - 6, 6, 4);
    rub(46, MIDY + 4, 5, 3);
    rub(60, HY0 + 12, 7, 4);
    rub(26, HY1 - 18, 8, 5);
    R(INK, HX1 - 9, DOOR_Y[1] - 12, 10, 24);
    R('#0B0F17', HX1 - 8, DOOR_Y[1] - 11, 9, 22);
    rub(HX1 - 7, DOOR_Y[1] - 4, 5, 3);
    crack([
      [HX1 - 10, DOOR_Y[1] - 22],
      [HX1 - 5, DOOR_Y[1] - 28],
      [HX1 - 8, DOOR_Y[1] - 36],
    ]);
    g.globalAlpha = 0.4;
    g.fillStyle = '#000';
    ell(g, 100, TURY[0], 14, 9);
    ell(g, 100, TURY[2], 14, 9);
    ell(g, 34, DEPOT_Y[0], 18, 8);
    g.globalAlpha = 1;
  }
}

/**
 * Hornea los 4 estados de una base para un equipo. Una base se hornea al empezar el partido, nunca por cuadro.
 * @param {{createCanvas: (w: number, h: number) => any}} o
 * @param {'base-fortin'|'base-ciudadela'} kind
 * @param {string} hex color del equipo
 * @param {boolean} espejo la base del lado derecho mira a la izquierda: el mismo arte, de frente al campo
 */
export function bakeBase({ createCanvas }, kind, hex, espejo) {
  return [0, 1, 2, 3].map((state) => {
    const c = createCanvas(BASE_W, BASE_H);
    const g = c.getContext('2d');
    if (espejo) {
      g.translate(BASE_W, 0);
      g.scale(-1, 1);
    }
    paintBase(g, { kind, hex, state: /** @type {0|1|2|3} */ (state) });
    return c;
  });
}
