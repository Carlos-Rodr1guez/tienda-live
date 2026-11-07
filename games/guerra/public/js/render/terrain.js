// Terreno de Batalla (diseño D21 punto 8): la receta del prototipo v3 aprobado, a 1440x810, con el RNG de vista
// sembrado por partido (nunca `Math.random`). Se pinta una vez por partido en la caché; las nubes se dibujan por cuadro
// y con movimiento reducido quedan quietas. Los colores de la superficie transitable salen de `data/paleta.js`.

import { mulberry32 } from '@tienda/kit/sim/rng.js';
import { PALETA } from '../data/paleta.js';
import { disc, ell } from './pixel.js';

const INK = PALETA.ink;
const W = 1440;
const H = 810;
const SKY_H = 112;
const NEAR_Y = H - 35;
const CENTROS = [242, 448, 655]; // centro de cada corredor (`TURY` del v3)
const TER = Object.fromEntries(PALETA.terrain.map((t) => [t.id, t.hex]));

/** Matriz de tramado 4x4 del prototipo (transiciones del cielo y del borde de la franja cercana). */
const BAY = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Mancha orgánica con borde tramado. */
function blob(g, cx, cy, rx, ry) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    const b = (y - cy) / ry;
    const b2 = b * b;
    if (b2 > 1) continue;
    const xo = rx * Math.sqrt(1 - b2);
    let xs = 1;
    let xe = 0;
    if (b2 < 0.55) {
      const xi = rx * Math.sqrt(0.55 - b2);
      xs = Math.ceil(cx - xi);
      xe = Math.floor(cx + xi);
      if (xe >= xs) g.fillRect(xs, y, xe - xs + 1, 1);
    }
    for (let x = Math.ceil(cx - xo); x <= Math.floor(cx + xo); x++) {
      if (x >= xs && x <= xe) continue;
      const a = (x - cx) / rx;
      const d = a * a + b2;
      if (d <= 1 && BAY[y & 3][x & 3] < ((1 - d) / 0.45) * 16) g.fillRect(x, y, 1, 1);
    }
  }
}

/** Posición x de una nube: deriva con el tiempo; con movimiento reducido queda quieta. */
export const cloudX = (c, time, reduced) => ((c.x + (reduced ? 0 : Math.floor(time * c.s))) % (W + 180)) - 120;

/** @param {{createCanvas: (w: number, h: number) => any}} o */
export function createTerrain({ createCanvas }) {
  /** @type {{cv: any, x: number, y: number, s: number}[]} */
  let clouds = [];

  /** Sub-flujo de azar de la vista: una semilla de partido da cielo, relieve y detalles repetibles. */
  const flujo = (seed, n) => mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);

  function paint(g, seed) {
    const rnd = flujo(seed, 0);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const SH = SKY_H;
    const SKY = ['#14123A', '#241A55', '#3A2370', '#6A2F78', '#B04A74', '#F0805A'];
    const B = [14, 30, 46, 64, 80];
    // cielo en bandas con tramado
    for (let y = 0; y < SH; y++) {
      let k = 0;
      while (k < 5 && y >= B[k]) k++;
      let bi = -1;
      for (let i = 0; i < 5; i++) if (Math.abs(y - B[i]) < 4) bi = i;
      if (bi < 0) {
        g.fillStyle = SKY[k];
        g.fillRect(0, y, W, 1);
        continue;
      }
      const t = (y - (B[bi] - 4) + 0.5) / 8;
      for (let x = 0; x < W; x++) {
        g.fillStyle = BAY[y & 3][x & 3] < t * 16 ? SKY[bi + 1] : SKY[bi];
        g.fillRect(x, y, 1, 1);
      }
    }
    // estrellas
    const r = flujo(seed, 11);
    for (let i = 0; i < 140; i++) {
      const x = Math.floor(r() * W);
      const y = 1 + Math.floor(r() * 40);
      g.fillStyle = r() < 0.3 ? '#FFFFFF' : r() < 0.5 ? '#CFD6FF' : '#8E96D8';
      g.fillRect(x, y, 1, 1);
      if (i % 11 === 0) {
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
      }
    }
    // sol
    const sx = Math.round(W * 0.72);
    const sy = 99;
    for (let y = sy - 34; y < SH; y++) {
      for (let x = sx - 34; x < sx + 34; x++) {
        const d = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy));
        if (d <= 15) {
          g.fillStyle = d < 9 ? '#FFE9A8' : '#FFC878';
          g.fillRect(x, y, 1, 1);
        } else if (d < 30 && BAY[y & 3][x & 3] < ((30 - d) / 15) * 16 * 0.55) {
          g.fillStyle = '#F7A263';
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    // colinas
    const colina = (base, amp, col, hz, n) => {
      const q = flujo(seed, n);
      const p = [q() * 6, q() * 6, q() * 6];
      const hs = [];
      for (let x = 0; x < W; x++) {
        const h = Math.round(
          base -
            amp *
              (Math.sin(x * 0.011 + p[0]) * 0.5 + Math.sin(x * 0.027 + p[1]) * 0.3 + Math.sin(x * 0.061 + p[2]) * 0.2),
        );
        hs.push(h);
        g.fillStyle = col;
        g.fillRect(x, h, 1, SH + 4 - h);
        if (hz) {
          g.fillStyle = hz;
          g.fillRect(x, h, 1, 1);
        }
      }
      return hs;
    };
    colina(72, 10, '#69498B', '#7D5DA2', 21);
    colina(85, 10, '#46386F', '#55467F', 22);
    const nh = colina(96, 7, '#2B2C50', '#37385F', 23);
    const q = flujo(seed, 5);
    // pinos lejanos y cercanos
    for (let x = 6; x < W - 6; x += 6 + Math.floor(q() * 12)) {
      const hh = 8 + Math.floor(q() * 9);
      const by = nh[x];
      g.fillStyle = '#20213F';
      for (let j = 0; j < hh; j++) {
        const w = Math.floor(j * 0.45);
        g.fillRect(x - w, by - hh + j + 2, w * 2 + 1, 1);
      }
      g.fillRect(x, by + 1, 1, 3);
    }
    for (let x = 2; x < W; x += 4 + Math.floor(q() * 5)) {
      const hh = 10 + Math.floor(q() * 9);
      const by = SH + 1;
      g.fillStyle = '#171934';
      for (let j = 0; j < hh; j++) {
        const w = Math.floor(j * 0.42);
        g.fillRect(x - w, by - hh + j, w * 2 + 1, 1);
      }
      g.fillStyle = '#232549';
      g.fillRect(x + 1, by - hh + 4, 1, hh - 6);
    }
    // campo
    g.fillStyle = TER.fondo;
    g.fillRect(0, SH, W, H - SH);
    g.fillStyle = '#3A2E4F';
    g.fillRect(0, SH, W, 2);
    for (let y = SH + 2; y < SH + 42; y++) {
      for (let x = 0; x < W; x++) {
        if (BAY[y & 3][x & 3] < (SH + 42 - y) * 0.4) {
          g.fillStyle = '#3A2E4F';
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    for (let n = 0; n < 130; n++) {
      const cx = ri(40, W - 40);
      const cy = ri(SH + 30, NEAR_Y - 5);
      const rx = ri(20, 60);
      const ry = ri(10, 30);
      g.fillStyle = n % 2 ? TER.parche : TER.sombra;
      blob(g, cx, cy, rx, ry);
    }
    // los tres caminos
    for (const [ty, am, fq, ph] of [
      [CENTROS[0], 14, 0.004, 1],
      [CENTROS[1], 16, 0.0035, 3.5],
      [CENTROS[2], 12, 0.0045, 5.2],
    ]) {
      for (let x = 112; x <= W - 112; x++) {
        const cy = Math.round(ty + am * Math.sin(x * fq + ph) + 8 * Math.sin(x * 0.017 + ph * 2));
        g.fillStyle = TER.mancha;
        g.fillRect(x, cy - 2, 1, 5);
        g.fillStyle = TER.huella;
        for (const dy of [-4, -3, 3, 4])
          if (BAY[(cy + dy) & 3][x & 3] < (Math.abs(dy) === 3 ? 10 : 5)) g.fillRect(x, cy + dy, 1, 1);
        if (x % 7 < 5) {
          g.fillStyle = '#332F3B';
          g.fillRect(x, cy - 1, 1, 1);
          g.fillRect(x, cy + 1, 1, 1);
        }
      }
    }
    for (let i = 0; i < 3200; i++) {
      g.fillStyle = q() < 0.5 ? TER.parche : TER.sombra;
      g.fillRect(ri(0, W - 3), ri(SH + 10, NEAR_Y - 5), ri(1, 2), 1);
    }
    // matas (decorativas, exentas del contraste) y piedras
    for (let i = 0; i < 720; i++) {
      const x = ri(112, W - 114);
      const y = ri(SH + 18, NEAR_Y - 5);
      g.fillStyle = q() < 0.5 ? '#3A4A44' : '#46594F';
      g.fillRect(x, y, 1, 2);
      g.fillRect(x + 1, y - 1, 1, 2);
      if (q() < 0.5) g.fillRect(x - 1, y, 1, 1);
      if (q() < 0.12) {
        g.fillStyle = '#5E7462';
        g.fillRect(x + 1, y - 1, 1, 1);
      }
    }
    const piedra = (x, y, rx, ry) => {
      g.fillStyle = '#1B2228';
      ell(g, x, y + ry, rx, ry);
      g.fillStyle = '#3D4650';
      ell(g, x, y, rx, ry);
      g.fillStyle = '#4F5A66';
      g.fillRect(x - 1, y - ry, Math.max(1, rx - 1), 1);
      if (q() < 0.15) {
        g.fillStyle = '#7A6566';
        g.fillRect(x + rx - 1, y - ry, 1, 1);
      }
    };
    for (let i = 0; i < 112; i++) piedra(ri(116, W - 120), ri(SH + 22, NEAR_Y - 7), ri(2, 3), ri(1, 2));
    for (let i = 0; i < 20; i++) {
      const cx = ri(130, W - 130);
      const cy = ri(SH + 30, NEAR_Y - 15);
      for (let k = 0, n = 3 + (i % 3); k < n; k++) piedra(cx + ri(-9, 9), cy + ri(-5, 5), ri(1, 2), 1);
    }
    // franja cercana con arbustos y rocas
    g.fillStyle = '#1C2426';
    g.fillRect(0, NEAR_Y, W, H - NEAR_Y);
    g.fillStyle = TER.fondo;
    g.fillRect(0, NEAR_Y, W, 1);
    for (let y = NEAR_Y - 11; y < NEAR_Y; y++) {
      for (let x = 0; x < W; x++) {
        if (BAY[y & 3][x & 3] < (y - (NEAR_Y - 11)) * 1.2) {
          g.fillStyle = '#1C2426';
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    for (let x = ri(4, 20); x < W; x += ri(24, 58)) {
      const y = ri(NEAR_Y + 17, NEAR_Y + 30);
      const rx = ri(8, 15);
      const ry = ri(5, 8);
      g.fillStyle = INK;
      ell(g, x, y, rx + 1, ry + 1);
      g.fillStyle = '#22362F';
      ell(g, x, y, rx, ry);
      g.fillStyle = '#2E4A40';
      ell(g, x - 2, y - 2, rx - 4, ry - 3);
      g.fillStyle = '#46594F';
      for (let k = 0; k < 5; k++) g.fillRect(x + ri(-rx + 4, rx - 4), y - ry + ri(1, 3), 1, 1);
    }
    for (let x = ri(10, 40); x < W; x += ri(50, 120)) {
      const y = ri(NEAR_Y + 15, NEAR_Y + 29);
      const rx = ri(4, 8);
      const ry = ri(3, 5);
      g.fillStyle = INK;
      ell(g, x, y, rx + 1, ry + 1);
      g.fillStyle = '#2F3841';
      ell(g, x, y, rx, ry);
      g.fillStyle = '#4F5A66';
      ell(g, x - 1, y - 1, rx - 2, ry - 2);
    }
    clouds = paintClouds(seed);
  }

  /** Tres nubes prerenderizadas; derivan despacio por el cielo. */
  function paintClouds(seed) {
    const defs = [
      [58, 16],
      [44, 13],
      [70, 18],
    ];
    return defs.map((c, i) => {
      const cv = createCanvas(c[0] + 8, c[1] + 8);
      const cg = cv.getContext('2d');
      const rr = flujo(seed, 30 + i);
      const ds = [];
      for (let j = 0; j < 5; j++)
        ds.push([
          6 + (j * (c[0] - 14)) / 4,
          c[1] - 4 - Math.floor(rr() * (c[1] / 2.2)),
          3 + Math.floor(rr() * (c[1] / 3)),
        ]);
      const pasada = (col, dy, sh) => {
        cg.fillStyle = col;
        for (const d of ds) disc(cg, Math.round(d[0]), d[1] + dy, Math.max(1, d[2] - sh));
        cg.fillRect(4, c[1] - 1 + dy, c[0] - 6, 2);
      };
      pasada('#F29B7A', 3, 0);
      pasada('#B15A86', 0, 0);
      pasada('#5A3685', -4, 1);
      return { cv, y: [8, 26, 46][i], x: [90, 630, 1140][i], s: [2.2, 3.1, 1.6][i] };
    });
  }

  return {
    paint,
    get clouds() {
      return clouds;
    },
    /** Capa 'sky' del cuadro (en LOW): las nubes en su posición de este instante. */
    drawClouds(P, time, reduced) {
      for (const c of clouds) {
        const x = cloudX(c, time, reduced);
        P.img(c.cv, P.x(x), P.y(c.y));
      }
    },
  };
}
