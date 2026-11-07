// Dibujo de unidades, restos, proyectiles, bombas y aviones (diseño D21 punto 6; CB-9, CB-18, CB-22). La vista dibuja
// cada unidad en su posición interpolada (`px`/`py` del paso anterior a `x`/`y` del actual), nunca desde los lugares de
// la formación, y solo LEE el estado: nada de lo que hay aquí escribe en el sim.
//
// Orden de las capas 4 a 10 (las que van en LOW o en la pasada de dispositivo):
//   shadows, units (unidades y restos por y), projectiles, airShadows, bombsPlanes (en y − z), effects, icons.

import { bombPosition, bombZ } from '../sim/plane.js';
import { disc, ell } from './pixel.js';
import { PALETA } from '../data/paleta.js';

const INK = PALETA.ink;
const SOMBRA = Object.freeze({ soldado: [4, 1], jeep: [10, 3], tanque: [12, 3], pesado: [17, 4] });
/** Altura de impacto sobre el suelo de cada tipo (`TZ` del prototipo), para dibujar la trayectoria de una bala. */
export const ALTURA = Object.freeze({ soldado: 6, jeep: 7, tanque: 8, pesado: 11 });
/** Paso del ciclo de marcha en px recorridos. */
const ZANCADA = Object.freeze({ soldado: 3.2, jeep: 2.6, tanque: 2.2, pesado: 2.2 });
/** Tamaño de las marcas del LOD (CB-18). */
export const MARCAS = Object.freeze({ soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] });

/**
 * Posición interpolada con `alpha` en [0, 1]. Escribe en `out` (se reutiliza: no reserva objetos por cuadro).
 * Sin posición previa (una entidad recién nacida) se queda donde está.
 * @param {{px?: number, py?: number, x: number, y: number}} u
 * @param {number} alpha
 * @param {{x: number, y: number}} out
 */
export function interpPos(u, alpha, out) {
  const px = u.px ?? u.x;
  const py = u.py ?? u.y;
  out.x = px + (u.x - px) * alpha;
  out.y = py + (u.y - py) * alpha;
  return out;
}

/**
 * Ordena los `n` primeros elementos por `key` con inserción, en el mismo arreglo y de forma estable.
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @param {(t: T) => number} key
 */
export function insertionSortBy(items, n, key) {
  for (let i = 1; i < n; i++) {
    const v = items[i];
    const k = key(v);
    let j = i - 1;
    while (j >= 0 && key(items[j]) > k) {
      items[j + 1] = items[j];
      j--;
    }
    items[j + 1] = v;
  }
  return items;
}

/** Pixel lineal de Bresenham en px de mundo; cada punto se proyecta con `P` (así el trazo escala con la pasada). */
function trazo(P, x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let n = 0; n < 400; n++) {
    P.rect(P.x(x0), P.y(y0), 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) {
      e += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      e += dx;
      y0 += sy;
    }
  }
}

/** Entrada reutilizable de la lista ordenada por y. */
const nuevaEntrada = () => ({ ref: null, wreck: false, x: 0, y: 0, key: 0, kind: '', side: 0, dir: 1 });

/**
 * La capa de entidades: se le pasa a `createRenderer({layers: {entities}})`. Lee `P.frame.scene`, `P.frame.alpha` y
 * `P.frame.time`; el modo de marcas lo decide el renderer (`P.stats.marks`).
 * @param {{bank: ReturnType<import('./sprites.js').createSpriteBank>, team: [number, number]}} o
 */
export function createEntityLayer({ bank, team }) {
  const out = { x: 0, y: 0 };
  const pool = Array.from({ length: 1100 }, nuevaEntrada);
  const sprites = bank.sprites;

  /** Entradas visibles, unidades vivas y restos, listas para ordenar por y. */
  function reunir(P, scene, alpha) {
    const list = P.lists.entities;
    let n = 0;
    for (let i = 0; i < scene.units.length && n < pool.length; i++) {
      const u = scene.units[i];
      if (!u.alive) continue;
      interpPos(u, alpha, out);
      if (!P.visible(out.x, out.y)) continue;
      const e = pool[n];
      e.ref = u;
      e.wreck = false;
      e.x = out.x;
      e.y = out.y;
      e.key = out.y;
      e.kind = u.kind;
      e.side = u.side;
      e.dir = u.dir;
      if (list.push(e)) n++;
    }
    for (let i = 0; i < scene.wrecks.length && n < pool.length; i++) {
      const w = scene.wrecks[i];
      if (!P.visible(w.x, w.y)) continue;
      const e = pool[n];
      e.ref = w;
      e.wreck = true;
      e.x = w.x;
      e.y = w.y;
      e.key = w.y - 8; // un resto queda un poco por detrás de quien camina sobre él (como en el v3)
      e.kind = w.kind;
      e.side = w.side;
      e.dir = w.dir;
      if (list.push(e)) n++;
    }
    insertionSortBy(list.items, list.length, (e) => e.key);
  }

  function sombras(P) {
    const { ctx } = P;
    const k = P.mul;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = INK;
    const list = P.lists.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list.items[i];
      if (e.wreck && e.kind === 'soldado') continue;
      const s = SOMBRA[e.kind];
      P.stats.drawCalls += s[1] * 2 + 1;
      ell(ctx, P.x(e.x), P.y(e.y) + k, s[0], s[1], k);
    }
    ctx.globalAlpha = 1;
  }

  /** Cuadro y variante de una unidad viva. */
  function dibujarUnidad(P, e, scene, time) {
    const u = e.ref;
    const sp = sprites[u.kind];
    const espejo = e.dir < 0;
    const t = team[u.side];
    const mul = P.mul;
    const rapido = Math.abs(u.vx ?? 0) + Math.abs(u.vy ?? 0) > 4;
    const desde = (u.stats?.cdSteps ?? 30) - u.cd; // pasos desde el último disparo
    const disparo = u.tgt !== null && u.tgt !== undefined && desde <= 10;
    let anim = 'idle';
    let idx = 0;
    if (u.kind === 'soldado') {
      if (disparo) {
        anim = 'shoot';
        idx = desde <= 3 ? 1 : 0;
      } else if (rapido) {
        anim = 'walk';
        idx = Math.floor((Math.abs(e.x) + Math.abs(e.y)) / ZANCADA.soldado);
      } else if (u.tgt) anim = 'shoot';
    } else if (u.kind === 'jeep') {
      if (rapido) {
        anim = 'walk';
        idx = Math.floor((Math.abs(e.x) + Math.abs(e.y)) / ZANCADA.jeep);
      } else if (u.tgt) {
        anim = 'shoot';
        idx = disparo ? Math.floor(time * 18) & 1 : 0;
      }
    } else if (rapido) {
      anim = 'walk';
      idx = Math.floor((Math.abs(e.x) + Math.abs(e.y)) / ZANCADA[u.kind]);
    }
    const blanco = scene.flashUntil(u.id) > scene.step;
    const img = bank.frame(t, u.kind, anim, idx, espejo, blanco);
    const ax = espejo ? sp.w - 1 - sp.ax : sp.ax;
    const X = P.x(e.x);
    const Y = P.y(e.y);
    const dx = X - ax * mul;
    const dy = Y - sp.ay * mul;
    P.img(img, dx, dy, sp.w * mul, sp.h * mul);
    if (sp.barra) {
      const b = sp.barra;
      const bw = b.rows[0].length;
      const bx = espejo ? dx + (sp.w - b.dx - bw) * mul : dx + b.dx * mul;
      const retro = disparo ? Math.max(0, (u.kind === 'pesado' ? 3 : 2) - Math.floor(desde / 2)) : 0;
      const bimg = bank.barra(t, u.kind, espejo, blanco);
      const off = -e.dir * retro * mul;
      P.img(bimg, bx + off, dy + b.dy * mul, bw * mul, b.rows.length * mul);
      if (b.dy2 !== undefined) P.img(bimg, bx + off, dy + b.dy2 * mul, bw * mul, b.rows.length * mul);
    }
  }

  function dibujarResto(P, e, scene, time) {
    const w = e.ref;
    const sp = sprites[w.kind];
    const espejo = e.dir < 0;
    const edad = (scene.step - w.born) / 30 + (P.frame.alpha ?? 0) / 30;
    const mul = P.mul;
    let anim;
    let idx = 0;
    let alfa = 1;
    if (w.kind === 'soldado') {
      anim = 'death';
      idx = edad < 0.12 ? 0 : edad < 0.3 ? 1 : 2;
      if (edad > 2.5) alfa = Math.max(0, 1 - (edad - 2.5) / 0.6);
    } else {
      anim = 'wreck';
      if (edad > 6.3 && Math.floor(edad * 12) % 2 === 1) return; // parpadea antes de irse
    }
    const img = bank.frame(team[w.side], w.kind, anim, idx, espejo);
    const ax = espejo ? sp.w - 1 - sp.ax : sp.ax;
    P.ctx.globalAlpha = alfa;
    P.img(img, P.x(e.x) - ax * mul, P.y(e.y) - sp.ay * mul, sp.w * mul, sp.h * mul);
    P.ctx.globalAlpha = 1;
    void time;
  }

  /** Marcas del LOD: un rectángulo del color del equipo con contorno INK y una sombra de 1 px (CB-18). */
  function dibujarMarca(P, e, hex) {
    const [w, h] = MARCAS[e.kind];
    const mul = P.mul;
    const X = P.x(e.x) - Math.floor(w / 2) * mul;
    const Y = P.y(e.y) - h * mul;
    const { ctx } = P;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = INK;
    P.rect(X, Y + h * mul, w, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    P.rect(X - mul, Y - mul, w + 2, h + 2);
    ctx.fillStyle = hex;
    P.rect(X, Y, w, h);
  }

  function unidades(P, scene, time) {
    const list = P.lists.entities;
    const marks = P.stats.marks;
    for (let i = 0; i < list.length; i++) {
      const e = list.items[i];
      if (e.wreck) {
        if (!marks) dibujarResto(P, e, scene, time);
        continue;
      }
      if (marks) dibujarMarca(P, e, scene.teamHex[e.side]);
      else dibujarUnidad(P, e, scene, time);
    }
  }

  function proyectiles(P, scene, alpha) {
    const { ctx } = P;
    const mul = P.mul;
    const ahora = scene.step + alpha;
    for (let i = 0; i < scene.projectiles.length; i++) {
      const p = scene.projectiles[i];
      const s = Math.max(0, Math.min(1, (ahora - p.step0) / 30 / p.dur));
      const x = p.x0 + (p.tx - p.x0) * s;
      const y = p.y0 + (p.ty - p.y0) * s;
      const z = p.z0 + (p.tz - p.z0) * s + (p.kind === 1 ? (p.arc ?? 0) * 4 * s * (1 - s) : 0);
      if (!P.visible(x, y - z, 20)) continue;
      if (p.kind === 0) {
        const s2 = Math.max(0, s - 6 / (270 * p.dur));
        const xa = p.x0 + (p.tx - p.x0) * s2;
        const ya = p.y0 + (p.ty - p.y0) * s2;
        const za = p.z0 + (p.tz - p.z0) * s2;
        ctx.fillStyle = '#FFE680';
        trazo(P, xa, ya - za, x, y - z);
        ctx.fillStyle = '#FFFFFF';
        P.rect(P.x(Math.round(x)), P.y(Math.round(y - z)), 1, 1);
      } else {
        const tam = p.big ? 3 : 2;
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = INK;
        ell(ctx, P.x(x), P.y(y), p.big ? 3 : 2, 1, mul);
        ctx.globalAlpha = 1;
        const px = P.x(Math.round(x) - 1);
        const py = P.y(Math.round(y - z) - 1);
        ctx.fillStyle = '#FFB347';
        P.rect(px, py, tam + 1, tam + 1);
        ctx.fillStyle = '#FFF0A0';
        P.rect(px, py, tam, tam);
        ctx.fillStyle = '#FFFFFF';
        P.rect(P.x(Math.round(x)), P.y(Math.round(y - z)), 1, 1);
      }
    }
  }

  function sombrasAire(P, scene, alpha) {
    const { ctx } = P;
    const av = sprites.avion;
    const mul = P.mul;
    ctx.globalAlpha = 0.35;
    for (const p of scene.planes) {
      interpPos(p, alpha, out);
      if (!P.visible(out.x, out.y, 60)) continue;
      const espejo = p.side === 1;
      const ax = espejo ? av.w - 1 - av.ax : av.ax;
      const sh = bank.sombraAvion(espejo);
      P.img(sh, P.x(out.x) - ax * mul, P.y(out.y) - (sh.height >> 1) * mul, av.w * mul, sh.height * mul);
    }
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = INK;
    const ahora = scene.step + alpha;
    for (const b of scene.bombs) {
      const pos = bombPosition(b, ahora);
      if (!P.visible(pos.x, pos.y, 20)) continue;
      ell(ctx, P.x(pos.x), P.y(pos.y), 2, 1, mul);
    }
    ctx.globalAlpha = 1;
  }

  function bombasYAviones(P, scene, alpha, time) {
    const mul = P.mul;
    const bs = sprites.bomba;
    const ahora = scene.step + alpha;
    for (const b of scene.bombs) {
      const pos = bombPosition(b, ahora);
      if (!P.visible(pos.x, pos.y, 20)) continue;
      const z = bombZ(scene.cfg, b, ahora);
      const img = bank.frame(team[b.side], 'bomba', 'fall', 0, false);
      P.img(img, P.x(pos.x) - bs.ax * mul, P.y(pos.y - z) - bs.ay * mul, bs.w * mul, bs.h * mul);
    }
    const av = sprites.avion;
    for (const p of scene.planes) {
      interpPos(p, alpha, out);
      if (!P.visible(out.x, out.y, 60)) continue;
      const espejo = p.side === 1;
      const ax = espejo ? av.w - 1 - av.ax : av.ax;
      const X = P.x(out.x) - ax * mul;
      const Y = P.y(out.y - p.z) - av.ay * mul;
      // las bombas que quedan, en sus soportes, van bajo el cuerpo
      const quedan = Math.max(0, Math.min(av.soportes.length, p.bombsLeft));
      for (let i = 0; i < quedan; i++) {
        const sop = av.soportes[i];
        const sw = sop.rows[0].length;
        const sx = espejo ? av.w - sop.x - sw : sop.x;
        P.img(bank.soporte(team[p.side], i, espejo), X + sx * mul, Y + sop.y * mul, sw * mul, sop.rows.length * mul);
      }
      const vy = p.vy ?? 0;
      const alabeo = vy < -18 ? 1 : vy > 18 ? 2 : 0;
      const img = bank.frame(team[p.side], 'avion', 'fly', alabeo * 2 + (Math.floor(time * 24) & 1), espejo);
      P.img(img, X, Y, av.w * mul, av.h * mul);
    }
  }

  return function entities(P) {
    const scene = P.frame.scene;
    if (!scene) return;
    const alpha = P.frame.alpha;
    const time = P.frame.time;
    reunir(P, scene, alpha);
    P.trace?.('shadows');
    if (!P.stats.marks) sombras(P);
    P.trace?.('units');
    unidades(P, scene, time);
    P.trace?.('projectiles');
    proyectiles(P, scene, alpha);
    P.trace?.('airShadows');
    sombrasAire(P, scene, alpha);
    P.trace?.('bombsPlanes');
    bombasYAviones(P, scene, alpha, time);
    P.trace?.('effects');
    scene.drawEffects?.(P);
    P.trace?.('icons');
    scene.drawIcons?.(P);
  };
}

export { disc };
