// Horneado de sprites por equipo (diseño D21 punto 9; CB-9, CB-18). Los sprites son filas de texto indexadas por
// paleta (`data/sprites.js`); al empezar el partido, cada color de equipo produce una variante normal, una blanca
// (golpe) y una espejada de cada cuadro. `bakeCount` sube uno por color de equipo y nunca por cuadro.

import { PALETA } from '../data/paleta.js';

const INK = PALETA.ink;

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = (r) =>
  `#${r
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** Oscurece un color hexadecimal en la fracción `k`. */
export const shade = (hex, k) => rgbToHex(hexToRgb(hex).map((v) => v * (1 - k)));
/** Aclara un color hexadecimal en la fracción `k`. */
export const tint = (hex, k) => rgbToHex(hexToRgb(hex).map((v) => v + (255 - v) * k));

/** Paleta de un equipo: `t` es el color, `h` aclarado 25 % y `d` oscurecido 35 % (el resto es fijo). */
export function teamPalette(hex) {
  return {
    o: INK,
    d: shade(hex, 0.35),
    t: hex,
    h: tint(hex, 0.25),
    s: '#E9B98F',
    k: '#2A3140',
    g: '#4F5A70',
    l: '#9DA9BF',
    m: '#6C7890',
    b: '#171C27',
    w: '#FFFFFF',
    y: '#FFD84A',
    r: '#E5484D',
    f: '#FF8B3D',
    a: '#8FD3F4',
    c: '#C7D0E2',
  };
}

/**
 * @param {{createCanvas: (w: number, h: number) => any, sprites: any}} o
 */
export function createSpriteBank({ createCanvas, sprites }) {
  /** Una fila de píxeles por clave de la paleta. */
  const pintar = (rows, pal, espejo) => {
    const w = rows[0].length;
    const h = rows.length;
    const c = createCanvas(w, h);
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = pal[rows[y][x]];
        if (col) {
          g.fillStyle = col;
          g.fillRect(espejo ? w - 1 - x : x, y, 1, 1);
        }
      }
    }
    return c;
  };
  /** Variante blanca (golpe): la misma silueta toda en blanco. */
  const blanca = (c) => {
    const o = createCanvas(c.width, c.height);
    const g = o.getContext('2d');
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, c.width, c.height);
    return o;
  };
  const par = (c) => ({ n: c, w: blanca(c) });

  const teams = [];
  const byColor = new Map();
  let bakeCount = 0;
  /** @type {any[] | null} */
  let sombras = null;

  /** Sombra del avión: su silueta (sin contorno) a media altura, en INK; se dibuja con alfa 0,35. */
  const hornearSombras = () => {
    const f = sprites.avion.anims.fly[0];
    const w = sprites.avion.w;
    const h = Math.ceil(f.length / 2);
    const mk = (espejo) => {
      const c = createCanvas(w, h);
      const g = c.getContext('2d');
      g.fillStyle = INK;
      for (let y = 0; y < h; y++) {
        const r = f[Math.min(f.length - 1, y * 2)];
        for (let x = 0; x < w; x++) if (r[x] !== '.' && r[x] !== 'o') g.fillRect(espejo ? w - 1 - x : x, y, 1, 1);
      }
      return c;
    };
    return [mk(false), mk(true)];
  };

  return {
    get bakeCount() {
      return bakeCount;
    },
    /**
     * Hornea (una vez por color) y devuelve el índice del equipo.
     * @param {string} hex color del equipo (#RRGGBB)
     * @returns {number}
     */
    bake(hex) {
      const prev = byColor.get(hex);
      if (prev !== undefined) return prev;
      const pal = teamPalette(hex);
      const orient = [false, true].map((espejo) => {
        const por = {};
        for (const [kind, sp] of Object.entries(sprites)) {
          if (!sp || typeof sp !== 'object' || !sp.anims) continue;
          const t = { anims: {}, barra: null, soportes: null };
          for (const [anim, frames] of Object.entries(sp.anims))
            t.anims[anim] = frames.map((f) => par(pintar(f, pal, espejo)));
          if (sp.barra) t.barra = par(pintar(sp.barra.rows, pal, espejo));
          if (sp.soportes) t.soportes = sp.soportes.map((s) => par(pintar(s.rows, pal, espejo)));
          por[kind] = t;
        }
        return por;
      });
      const idx = teams.length;
      teams.push(orient);
      byColor.set(hex, idx);
      bakeCount++;
      return idx;
    },
    /**
     * Un cuadro horneado.
     * @param {number} team índice de `bake`
     * @param {string} kind soldado, jeep, tanque, pesado, avion o bomba
     * @param {string} anim
     * @param {number} frame se envuelve al largo de la animación
     * @param {boolean} espejo mira al oeste
     * @param {boolean} [blanco] variante de golpe
     */
    frame(team, kind, anim, frame, espejo, blanco = false) {
      const list = teams[team][espejo ? 1 : 0][kind].anims[anim];
      const f = list[((frame % list.length) + list.length) % list.length];
      return blanco ? f.w : f.n;
    },
    /** El cañón aparte (retroceso) de tanque y pesado. */
    barra(team, kind, espejo, blanco = false) {
      const b = teams[team][espejo ? 1 : 0][kind].barra;
      return blanco ? b.w : b.n;
    },
    /** La bomba `i` de los soportes del avión. */
    soporte(team, i, espejo) {
      return teams[team][espejo ? 1 : 0].avion.soportes[i].n;
    },
    sombraAvion(espejo) {
      sombras ??= hornearSombras();
      return sombras[espejo ? 1 : 0];
    },
    sprites,
  };
}
