// Arte de las bases (diseño D21 punto 11; CB-3, CB-19, CB-2). Dos recetas paramétricas de 110x669 px, de y 112
// (`SKY_H`) a y 781 (`NEAR_Y` + 6), con 4 estados prerenderizados por lado:
//   base-fortin    HQ cuadrado y torres cuadradas (la base del prototipo v3 aprobado, lado izquierdo)
//   base-ciudadela HQ octogonal con cúpula y torres redondas (lado derecho)
// La silueta distingue a los equipos sin depender del color (CB-3): la ciudadela NO es el espejo del fortín. Los dos
// estados y la secuencia de destrucción son solo vista: ninguna regla los lee. El arte usa un azar fijo por receta y
// estado (nunca el de la partida), y el color del equipo entra solo por la paleta del tinte.

import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { PALETA } from '../data/paleta.js';
import { disc, ell, line } from './pixel.js';
import { shade, tint } from './sprites.js';

const INK = PALETA.ink;
export const BASE_W = 110;
export const BASE_Y0 = 112; // `SKY_H`
export const BASE_H = 669; // de 112 a 781
export const NEAR_Y = 775;
export const WALL_Y0 = BASE_Y0 + 12;
const WB = NEAR_Y + 1;
export const MIDY = 448;
export const HQY = MIDY - 26;
const TURY = [242, MIDY, 655];
const DEPY = [205, 325, 545, 665];

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
  const Y0 = WALL_Y0;
  const hy = HQY;
  const redonda = kind === 'base-ciudadela';
  const bag = (x, y) => {
    R(INK, x, y, 9, 5);
    R('#B59A6A', x + 1, y + 1, 7, 3);
    R('#D2BA8A', x + 1, y + 1, 7, 1);
  };
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

  // muro
  R(ruin ? '#1A202C' : '#2B3446', 0, Y0, 96, WB - Y0);
  if (!ruin) {
    for (let y = Y0 + 14, k = 0; y < WB; y += 24, k++) {
      R('#232B3A', 0, y, 96, 1);
      for (let x = (k % 2) * 12; x < 96; x += 24) R('#232B3A', x, y, 1, Math.min(24, WB - y));
    }
    for (let i = 0; i < 190; i++) R('#323C50', ri(0, 94), ri(Y0 + 2, WB - 2), 1, 1);
    for (let y = Y0 + 18; y < WB - 6; y += 14) R(tD, 5, y, 2, 7);
  } else {
    for (let i = 0; i < 110; i++)
      R(rnd() < 0.5 ? '#10151E' : '#232B3A', ri(0, 92), ri(Y0 + 2, WB - 6), ri(3, 9), ri(2, 5));
  }
  // columna de muralla del frente
  R(INK, 93, Y0, 16, WB - Y0);
  R('#4A5468', 94, Y0 + 1, 14, WB - Y0 - 2);
  R('#6B778D', 95, Y0 + 1, 12, WB - Y0 - 2);
  R('#8794AB', 95, Y0 + 1, 1, WB - Y0 - 2);
  R('#3B4558', 107, Y0 + 1, 1, WB - Y0 - 2);
  for (let yy = Y0 + 2, k = 0; yy < WB - 6; yy += 16, k++) {
    const skip = ruin ? k % 3 !== 0 : st >= 2 ? (k * 7) % 10 < 3 : st >= 1 ? (k * 7) % 10 < 1 : false;
    if (skip) {
      if (ruin) rub(94 + ri(0, 6), yy + ri(0, 4), ri(4, 8), ri(3, 5));
      else R('#141A26', 95, yy + 2, 12, 6);
      continue;
    }
    const hh = ruin ? 5 : 11;
    R(INK, 92, yy, 18, hh + 1);
    R('#6B778D', 93, yy + 1, 16, ruin ? 3 : 6);
    R('#8794AB', 93, yy + 1, 16, 1);
    if (!ruin) {
      R('#4A5468', 93, yy + 7, 16, 4);
      R('#3B4558', 93, yy + 10, 16, 1);
      if (k % 3 === 1) {
        R(hex, 95, yy + 2, 12, 3);
        R(tL, 95, yy + 2, 12, 1);
        R(tD, 95, yy + 8, 12, 2);
      }
    }
  }
  // plataformas de las torretas
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
  if (!ruin) {
    for (let y = Y0 + 22, k = 0; y < WB - 16; y += 30, k++) {
      if (TURY.some((t) => Math.abs(y - t) < 22)) continue;
      if (st >= 2 && k % 2) continue;
      bag(80 + (k % 2) * 4, y);
      bag(80 + (k % 2) * 4, y + 5);
      if (st < 2) bag(84 + (k % 2) * 4, y - 4);
    }
    for (const ty of TURY) {
      bag(78, ty - 26);
      bag(78, ty + 22);
    }
    // torres de las esquinas: cuadradas en el fortín, redondas en la ciudadela
    const torre = (y0) => {
      if (!redonda) {
        R(INK, 71, y0, 39, 37);
        R('#6B778D', 72, y0 + 1, 37, 25);
        R('#8794AB', 72, y0 + 1, 37, 1);
        R('#8794AB', 72, y0 + 1, 1, 25);
        R(INK, 77, y0 + 5, 27, 16);
        R(tD, 78, y0 + 6, 25, 14);
        R(hex, 78, y0 + 6, 25, 11);
        R(tL, 78, y0 + 6, 25, 1);
        R('#4A5468', 72, y0 + 26, 37, 10);
        R('#3B4558', 72, y0 + 34, 37, 2);
        for (const x of [78, 90, 102]) R('#141A26', x, y0 + 29, 3, 5);
        if (st >= 2) {
          R('#141A26', 84, y0 + 8, 10, 8);
          crack([
            [96, y0 + 6],
            [94, y0 + 12],
            [98, y0 + 18],
          ]);
        }
      } else {
        g.fillStyle = INK;
        disc(g, 90, y0 + 19, 18);
        g.fillStyle = '#4A5468';
        disc(g, 90, y0 + 20, 17);
        g.fillStyle = '#6B778D';
        disc(g, 90, y0 + 17, 17);
        g.fillStyle = '#8794AB';
        R('#8794AB', 80, y0 + 3, 12, 1);
        g.fillStyle = INK;
        disc(g, 90, y0 + 15, 12);
        g.fillStyle = tD;
        disc(g, 90, y0 + 16, 11);
        g.fillStyle = hex;
        disc(g, 90, y0 + 14, 11);
        g.fillStyle = tL;
        disc(g, 88, y0 + 10, 5);
        for (const x of [82, 90, 98]) R('#141A26', x, y0 + 29, 3, 5);
        if (st >= 2) {
          g.fillStyle = '#141A26';
          disc(g, 94, y0 + 14, 4);
          crack([
            [96, y0 + 6],
            [94, y0 + 12],
            [98, y0 + 18],
          ]);
        }
      }
    };
    torre(Y0);
    torre(WB - 36);
    // depósitos
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
    for (const y of DEPY) depot(y);
    crate(76, hy - 4);
    crate(76, hy + 6);
    crate(66, hy + 56);
    crate(76, hy + 54);
    for (const y of DEPY) crate(64, y + 5);
    // cuartel general
    if (!redonda) {
      R(INK, 13, hy, 58, 52);
      R(tD, 14, hy + 1, 56, 32);
      R(hex, 14, hy + 1, 56, 30);
      for (let yy = hy + 6; yy < hy + 32; yy += 8) R(tD, 14, yy, 56, 2);
      R(tL, 14, hy + 1, 56, 2);
      R('#8794AB', 14, hy + 33, 56, 1);
      R(INK, 34, hy + 10, 16, 12);
      R('#323B4D', 35, hy + 11, 14, 10);
      R(hex, 37, hy + 13, 10, 6);
      R(tL, 37, hy + 13, 10, 1);
      R(INK, 17, hy + 4, 7, 6);
      R('#5A667C', 18, hy + 5, 5, 4);
    } else {
      // octógono con cúpula: esquinas cortadas en escalera y un domo central
      for (let r = 0; r < 52; r++) {
        const corte = r < 10 ? 10 - r : r > 41 ? r - 41 : 0;
        const c = Math.floor(corte * 0.8);
        R(INK, 13 + c, hy + r, 58 - 2 * c, 1);
      }
      for (let r = 1; r < 51; r++) {
        const corte = r < 10 ? 10 - r : r > 41 ? r - 41 : 0;
        const c = Math.floor(corte * 0.8);
        R(r < 33 ? hex : '#4A5468', 14 + c, hy + r, 56 - 2 * c, 1);
      }
      for (let yy = hy + 12; yy < hy + 32; yy += 8) R(tD, 20, yy, 44, 2);
      R(tL, 20, hy + 1, 44, 2);
      R('#8794AB', 17, hy + 33, 50, 1);
      g.fillStyle = INK;
      ell(g, 42, hy + 14, 17, 10);
      g.fillStyle = tD;
      ell(g, 42, hy + 15, 16, 9);
      g.fillStyle = hex;
      ell(g, 42, hy + 13, 15, 8);
      g.fillStyle = tL;
      ell(g, 38, hy + 9, 6, 3);
      R(INK, 41, hy - 6, 3, 8);
      R('#FFD84A', 41, hy - 6, 3, 2);
      R(INK, 34, hy + 22, 16, 10);
      R('#323B4D', 35, hy + 23, 14, 8);
      R(hex, 37, hy + 25, 10, 4);
    }
    R('#4A5468', 14, hy + 34, 56, 16);
    R('#6B778D', 14, hy + 34, 56, 1);
    R('#3B4558', 14, hy + 48, 56, 2);
    for (let x = 18; x < 70; x += 12) R('#3B4558', x, hy + 36, 1, 12);
    R(INK, 34, hy + 37, 16, 14);
    R('#141A26', 35, hy + 38, 14, 13);
    R(hex, 35, hy + 38, 14, 2);
    R(tL, 35, hy + 38, 14, 1);
    R('#141A26', 18, hy + 39, 7, 4);
    R('#141A26', 59, hy + 39, 7, 4);
    if (st >= 1) {
      crack([
        [22, hy + 1],
        [24, hy + 7],
        [22, hy + 13],
        [27, hy + 19],
      ]);
      crack([
        [56, hy + 1],
        [54, hy + 8],
        [58, hy + 15],
      ]);
      crack([
        [97, TURY[0] + 38],
        [100, TURY[0] + 44],
        [98, TURY[0] + 50],
        [101, TURY[0] + 58],
      ]);
      R('#141A26', 50, hy + 24, 5, 4);
      g.globalAlpha = 0.35;
      R('#000', 44, hy + 34, 40, 2);
      g.fillStyle = '#000';
      ell(g, 100, TURY[1], 12, 7);
      ell(g, 44, hy + 40, 20, 6);
      g.globalAlpha = 1;
    }
    if (st >= 2) {
      R(INK, 26, hy + 6, 24, 16);
      R('#141A26', 27, hy + 7, 22, 14);
      crack([
        [27, hy + 7],
        [31, hy + 11],
        [28, hy + 17],
        [34, hy + 21],
      ]);
      rub(30, hy + 12, 6, 4);
      rub(40, hy + 16, 5, 3);
      crack([
        [96, TURY[1] + 58],
        [99, TURY[1] + 64],
        [97, TURY[1] + 70],
      ]);
      g.globalAlpha = 0.4;
      g.fillStyle = '#000';
      ell(g, 100, TURY[0], 14, 9);
      ell(g, 100, TURY[2], 14, 9);
      ell(g, 34, DEPY[0], 18, 8);
      g.globalAlpha = 1;
    }
  } else {
    for (let i = 0; i < 56; i++) rub(ri(14, 66), ri(hy + 2, hy + 48), ri(3, 9), ri(2, 5));
    for (let i = 0; i < 9; i++) {
      const x = ri(14, 60);
      const y = ri(hy + 4, hy + 44);
      R(INK, x, y, 9, 5);
      R(hex, x + 1, y + 1, 7, 3);
    }
    R(INK, 13, hy + 32, 58, 6);
    R('#3B4558', 14, hy + 33, 56, 4);
    for (const y0 of [Y0, WB - 36]) for (let i = 0; i < 16; i++) rub(ri(72, 104), y0 + ri(0, 30), ri(4, 9), ri(3, 6));
    for (const y0 of DEPY) for (let i = 0; i < 10; i++) rub(ri(19, 56), y0 + ri(0, 22), ri(4, 8), ri(3, 5));
    for (let y = Y0 + 18; y < WB - 16; y += 38) bag(ri(70, 86), y + ri(0, 12));
    g.globalAlpha = 0.45;
    g.fillStyle = '#000';
    ell(g, 42, hy + 24, 34, 24);
    for (const t of TURY) ell(g, 100, t, 10, 6);
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
