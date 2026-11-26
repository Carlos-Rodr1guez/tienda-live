// Búferes fijos del render (diseño D21 punto 1; CB-18, C8). Nada se crea por cuadro ni por paso de zoom:
//   LOW   1440x810 px de mundo, reservado una vez al cargar. Cada cuadro se limpia y se dibuja solo el rectángulo visible.
//   MID   2·(min(W, 1440) + 4) x 2·(min(H, 810) + 4), solo para el modo nítido (fd < SHARP_BELOW); por tamaño de canvas.
//   caché de terreno 1440x810, pintada una vez por partido.
// Además: listas de dibujo de capacidad fija (entidades, partículas, etiquetas) y el proyector de coordenadas que
// reparte un único origen entre LOW y la pasada en px de dispositivo.

import { SHARP_BELOW } from './scale.js';

/** Margen de recorte alrededor de la cámara, en px de mundo (R1). */
export const CULL_MARGIN = 50;

/** Topes por cuadro de las listas que no son entidades del sim. */
export const LIST_CAPS = Object.freeze({ particles: 600, labels: 24 });

/**
 * Lista de capacidad fija: no crece ni se vuelve a reservar. Al llenarse descarta y cuenta lo descartado.
 * @template T
 * @param {number} cap
 */
export function createList(cap) {
  const items = /** @type {T[]} */ (new Array(cap));
  let n = 0;
  let dropped = 0;
  return {
    items,
    cap,
    get length() {
      return n;
    },
    get dropped() {
      return dropped;
    },
    /** @param {T} v */
    push(v) {
      if (n >= cap) {
        dropped++;
        return false;
      }
      items[n++] = v;
      return true;
    },
    clear() {
      n = 0;
    },
  };
}

/** Escala que hace entrar el mundo entero en el canvas: `fd = min(W / w, H / h)` (NM-6). */
export const fitScale = (W, H, world) => Math.min(W / world.w, H / world.h);

/** Tamaño del búfer MID para un canvas de W x H. */
export const midSize = (W, H, world) => ({
  w: 2 * (Math.min(W, world.w) + 4),
  h: 2 * (Math.min(H, world.h) + 4),
});

/**
 * Reserva LOW y la caché de terreno una sola vez; MID al cambiar el tamaño del canvas y solo si hace falta.
 * @param {{createCanvas: (w: number, h: number) => any, world: {w: number, h: number}}} o
 */
export function createBuffers({ createCanvas, world }) {
  const low = createCanvas(world.w, world.h);
  const terrain = createCanvas(world.w, world.h);
  const b = {
    low,
    lowCtx: low.getContext('2d'),
    terrain,
    terrainCtx: terrain.getContext('2d'),
    /** @type {any} */
    mid: null,
    midCtx: null,
    midKey: '',
    /** Lienzos reservados en total (F2 y las pruebas). */
    allocated: 2,
    /** Al cambiar el tamaño del canvas: MID solo con `fd < SHARP_BELOW`. */
    resize(W, H) {
      if (fitScale(W, H, world) >= SHARP_BELOW) {
        b.mid = null;
        b.midCtx = null;
        b.midKey = '';
        return;
      }
      const m = midSize(W, H, world);
      const key = `${m.w}x${m.h}`;
      if (key === b.midKey) return;
      b.mid = createCanvas(m.w, m.h);
      b.midCtx = b.mid.getContext('2d');
      b.midKey = key;
      b.allocated++;
    },
  };
  return b;
}

/**
 * Proyector de un cuadro: un solo origen para los dos caminos de dibujo.
 *  - LOW (`mul` 1): una entidad va en `round(x) − xL`, o sea px de mundo enteros dentro de LOW.
 *  - Pasada de dispositivo (`mul` = s entera): `round(x·s) − ox` con `ox = round(x0·s)`.
 * Es un objeto reutilizado: `reset` lo reconfigura sin reservar nada.
 */
export function createProjector(stats, lists) {
  const P = {
    ctx: /** @type {any} */ (null),
    device: false,
    mul: 1,
    offX: 0,
    offY: 0,
    /** Rectángulo de cámara en px de mundo (para el recorte). */
    vx0: 0,
    vy0: 0,
    vx1: 0,
    vy1: 0,
    stats,
    lists,
    /** @param {number} wx px de mundo (ya interpolado) */
    x: (wx) => Math.round(wx * P.mul) + P.offX,
    y: (wy) => Math.round(wy * P.mul) + P.offY,
    /** ¿Cae dentro de la cámara más el margen? Cuenta lo recortado. */
    visible(wx, wy, margin = CULL_MARGIN) {
      const ok = wx >= P.vx0 - margin && wx <= P.vx1 + margin && wy >= P.vy0 - margin && wy <= P.vy1 + margin;
      if (!ok) stats.culled++;
      return ok;
    },
    /** drawImage con contador de llamadas. */
    img(img, dx, dy, dw, dh) {
      stats.drawCalls++;
      if (dw === undefined) P.ctx.drawImage(img, dx, dy);
      else P.ctx.drawImage(img, dx, dy, dw, dh);
    },
    /** Rectángulo en px de mundo relativos a un punto ya proyectado (`px`, `py` en px de pantalla del camino). */
    rect(px, py, w, h) {
      stats.drawCalls++;
      P.ctx.fillRect(px, py, w * P.mul, h * P.mul);
    },
  };
  return P;
}
