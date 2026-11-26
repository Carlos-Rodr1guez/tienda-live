// Composición de un cuadro (diseño D21): LOW de mundo, copia a pantalla según el modo de escala y, con s entera >= 2,
// la pasada en px de dispositivo para lo que se mueve. Este módulo no conoce el sim ni los sprites: recibe las capas
// como funciones (`layers`), así se prueba con lienzos falsos y se completa capa por capa.
//
//   layers.terrain(ctx, seed)   pinta la caché de terreno (una vez por partido)
//   layers.sky(P)               nubes sobre la caché de terreno, en LOW
//   layers.craters(P)           capa 2, en LOW
//   layers.bases(P)             capa 3, en LOW
//   layers.entities(P)          capas 4 a 10, en LOW o en la pasada de dispositivo
//
// El render solo lee el estado: nunca escribe en el sim.

import { createBuffers, createList, createProjector, fitScale, LIST_CAPS } from './canvas.js';
import { lodFor, LOD_DEFAULTS } from './lod.js';
import { scaleMode } from './scale.js';

const INK = '#0B0F17';
const EPS = 1e-6;

/** Tope de entidades dibujables por cuadro: 2 lados de hasta 300 + restos, aviones, bombas y proyectiles. */
const MAX_ENTITIES = 2 * 300 + 24 + 8 + 48 + 256;

/**
 * @param {{
 *   createCanvas: (w: number, h: number) => any, canvas: any, world: {w: number, h: number},
 *   devicePass?: boolean, lod?: typeof LOD_DEFAULTS, layers?: Record<string, Function>,
 *   trace?: (name: string) => void
 * }} o
 */
export function createRenderer({
  createCanvas,
  canvas,
  world,
  devicePass = true,
  lod = LOD_DEFAULTS,
  layers = {},
  trace,
}) {
  const buffers = createBuffers({ createCanvas, world });
  const lists = {
    entities: createList(MAX_ENTITIES),
    particles: createList(LIST_CAPS.particles),
    labels: createList(LIST_CAPS.labels),
  };
  const stats = {
    canvasesAllocated: buffers.allocated,
    culled: 0,
    drawCalls: 0,
    entities: 0,
    particles: 0,
    labels: 0,
    s: 1,
    mode: 'nearest',
    marks: false,
    devicePass: false,
    /** Origen de la cámara en px de dispositivo: lo usan las etiquetas, que viven en pantalla (`render/project.js`). */
    ox: 0,
    oy: 0,
    fd: 1,
    frames: 0,
  };
  const caps = { entities: MAX_ENTITIES, particles: LIST_CAPS.particles, labels: LIST_CAPS.labels };
  const P = createProjector(stats, lists);
  const ctx = canvas.getContext('2d');
  let marks = false;

  const t = (name) => trace?.(name);
  P.trace = t;

  return {
    buffers,
    ctx,
    stats,
    caps,
    lists,
    /** El canvas principal cambió de tamaño (el llamador ya fijó `canvas.width` y `canvas.height`). */
    resize(W, H) {
      canvas.width = W;
      canvas.height = H;
      buffers.resize(W, H);
      stats.canvasesAllocated = buffers.allocated;
      stats.fd = fitScale(W, H, world);
    },
    /** Partido nuevo: la caché de terreno se pinta una vez. */
    startMatch(seed) {
      layers.terrain?.(buffers.terrainCtx, seed);
    },
    /**
     * @param {{x0: number, y0: number, s: number}} view esquina de la cámara en px de mundo y escala mostrada
     * @param {{alpha: number, time: number, scene?: any}} frame
     */
    draw(view, frame) {
      const W = canvas.width;
      const H = canvas.height;
      const { x0, y0, s } = view;
      stats.culled = 0;
      stats.drawCalls = 0;
      lists.entities.clear();
      lists.particles.clear();
      lists.labels.clear();

      const mode = scaleMode(s);
      marks = lodFor(s, marks, lod);
      const dev = devicePass && s >= 2 - EPS && Math.abs(s - Math.round(s)) < EPS;
      stats.s = s;
      stats.mode = mode.mode;
      stats.marks = marks;
      stats.devicePass = dev;

      // un solo origen en px de dispositivo
      const ox = Math.round(x0 * s);
      const oy = Math.round(y0 * s);
      stats.ox = ox;
      stats.oy = oy;
      // rectángulo visible de LOD con esquina entera y 1 px de margen
      const xL = Math.max(0, Math.floor(x0) - 1);
      const yL = Math.max(0, Math.floor(y0) - 1);
      const xR = Math.min(world.w, Math.ceil(x0 + W / s) + 1);
      const yB = Math.min(world.h, Math.ceil(y0 + H / s) + 1);
      const wL = Math.max(0, xR - xL);
      const hL = Math.max(0, yB - yL);

      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, W, H);
      if (wL === 0 || hL === 0) return;

      // LOW: solo el rectángulo visible
      const g = buffers.lowCtx;
      g.clearRect(0, 0, wL, hL);
      P.ctx = g;
      P.device = false;
      P.mul = 1;
      P.offX = -xL;
      P.offY = -yL;
      P.vx0 = x0;
      P.vy0 = y0;
      P.vx1 = x0 + W / s;
      P.vy1 = y0 + H / s;
      P.frame = frame;
      t('terrain');
      g.drawImage(buffers.terrain, xL, yL, wL, hL, 0, 0, wL, hL);
      stats.drawCalls++;
      t('sky');
      layers.sky?.(P);
      t('craters');
      layers.craters?.(P);
      t('bases');
      layers.bases?.(P);
      if (!dev) layers.entities?.(P);

      // copia de LOW a pantalla según el modo
      const dx = Math.round(xL * s) - ox;
      const dy = Math.round(yL * s) - oy;
      const dw = Math.round(wL * s);
      const dh = Math.round(hL * s);
      t('copy');
      if (mode.mode === 'sharp' && buffers.mid) {
        const mg = buffers.midCtx;
        mg.imageSmoothingEnabled = false;
        mg.drawImage(buffers.low, 0, 0, wL, hL, 0, 0, wL * 2, hL * 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = mode.quality;
        ctx.drawImage(buffers.mid, 0, 0, wL * 2, hL * 2, dx, dy, dw, dh);
      } else if (mode.mode === 'nearest') {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buffers.low, 0, 0, wL, hL, dx, dy, dw, dh);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = mode.quality ?? 'medium';
        ctx.drawImage(buffers.low, 0, 0, wL, hL, dx, dy, dw, dh);
      }
      stats.drawCalls++;

      // pasada en px de dispositivo: lo que se mueve va al canvas principal
      if (dev) {
        ctx.imageSmoothingEnabled = false;
        P.ctx = ctx;
        P.device = true;
        P.mul = s;
        P.offX = -ox;
        P.offY = -oy;
        layers.entities?.(P);
      }
      stats.entities = lists.entities.length;
      stats.particles = lists.particles.length;
      stats.labels = lists.labels.length;
      stats.canvasesAllocated = buffers.allocated;
      stats.frames++;
    },
  };
}
