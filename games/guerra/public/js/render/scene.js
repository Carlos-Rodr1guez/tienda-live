// Escena de la vista: lo que el render necesita además del estado de reglas. Lee la bandeja de eventos del mundo
// (`world.drain()`, nunca `registry.drain()`; coordinador, nota 3) y arma pools de capacidad fija: restos, proyectiles
// en vuelo, cráteres y destellos de golpe. Todo es cosmético: ninguna regla lo lee y nada aquí escribe en el sim.

import { ell } from './pixel.js';
import { PALETA } from '../data/paleta.js';
import { ALTURA } from './units.js';

const INK = PALETA.ink;

export const SCENE_CAPS = Object.freeze({ wrecks: 24, projectiles: 256, craters: 60, flashes: 512 });

/** Vida de cada resto y cráter, en segundos de juego (CB-20): el soldado se va a los 3,1 s, el vehículo a los 7,5 s. */
export const LIFE = Object.freeze({ soldado: 3.1, vehiculo: 7.5, crater: 20 });

const BALA = new Set(['soldado', 'jeep']);
/** Pasos que dura el destello blanco de un golpe y pasos hasta el siguiente (0,22 s del v3). */
const FLASH_STEPS = 2;
const FLASH_COOLDOWN = 7;

/**
 * @param {{teamHex: [string, string], sprites: any}} o
 */
export function createScene({ teamHex, sprites }) {
  const freeWrecks = Array.from({ length: SCENE_CAPS.wrecks }, () => ({
    x: 0,
    y: 0,
    kind: '',
    side: 0,
    dir: 1,
    born: 0,
  }));
  const freeProj = Array.from({ length: SCENE_CAPS.projectiles }, () => ({
    kind: 0,
    x0: 0,
    y0: 0,
    z0: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    step0: 0,
    dur: 0,
    arc: 0,
    big: false,
  }));
  const freeCraters = Array.from({ length: SCENE_CAPS.craters }, () => ({ x: 0, y: 0, r: 0, born: 0 }));
  /** @type {Map<number, number>} id de unidad -> paso del último destello */
  const flashes = new Map();

  const scene = {
    teamHex,
    step: 0,
    cfg: null,
    units: [],
    planes: [],
    bombs: [],
    bases: null,
    field: null,
    wrecks: /** @type {any[]} */ ([]),
    projectiles: /** @type {any[]} */ ([]),
    craters: /** @type {any[]} */ ([]),
    drawEffects: /** @type {((P: any) => void) | null} */ (null),
    drawIcons: /** @type {((P: any) => void) | null} */ (null),
    flashUntil: (id) => {
      const start = flashes.get(id);
      return start === undefined ? 0 : start + FLASH_STEPS;
    },
    /** Apunta la escena al mundo (por referencia: no copia nada). */
    sync(world) {
      scene.step = world.step;
      scene.cfg = world.cfg;
      scene.units = world.units;
      scene.planes = world.planes;
      scene.bombs = world.bombs;
      scene.bases = world.bases;
      scene.field = world.field;
    },
    /** Una ronda nueva: se vacía todo lo cosmético. */
    reset() {
      for (const w of scene.wrecks) freeWrecks.push(w);
      for (const p of scene.projectiles) freeProj.push(p);
      for (const c of scene.craters) freeCraters.push(c);
      scene.wrecks.length = 0;
      scene.projectiles.length = 0;
      scene.craters.length = 0;
      flashes.clear();
    },
    /**
     * Procesa los eventos de UN paso del sim (se llama después de cada `step`, así `world.step` es el paso siguiente
     * al que los emitió).
     * @param {any[]} events lo que devolvió `world.drain()`
     * @param {any} world solo lectura
     */
    consume(events, world) {
      scene.sync(world);
      const cfg = world.cfg;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        switch (e.type) {
          case 'death':
            agregarResto(e, world.step);
            break;
          case 'hit': {
            // como en el v3: un golpe pinta la unidad de blanco un instante (2 pasos) y no vuelve a hacerlo hasta 0,22 s después
            const antes = flashes.get(e.id);
            if (antes === undefined || world.step - antes >= FLASH_COOLDOWN) flashes.set(e.id, world.step);
            break;
          }
          case 'shot':
            disparo(e, cfg, world.step);
            break;
          case 'turretShot': {
            const t = world.bases[e.side].turrets[e.k];
            proyectil(0, t.x, t.y, 7, e.tx, e.ty, 6, cfg.projectiles.bullet, world.step, 0, false);
            break;
          }
          case 'bombImpact':
            agregarCrater(e.x, e.y, 14, world.step);
            break;
          default:
            break;
        }
      }
      podar(world.step);
    },
    drawCraters(P) {
      const ctx = P.ctx;
      const ahora = scene.step + (P.frame.alpha ?? 0);
      for (let i = 0; i < scene.craters.length; i++) {
        const c = scene.craters[i];
        if (!P.visible(c.x, c.y, 30)) continue;
        const edad = (ahora - c.born) / 30;
        const a = edad > 16 ? 1 - (edad - 16) / 4 : 1;
        const ry = Math.max(2, Math.ceil(c.r * 0.5));
        ctx.globalAlpha = Math.max(0, a) * 0.85;
        ctx.fillStyle = '#3E3A44';
        ell(ctx, P.x(c.x), P.y(c.y + 1), c.r, ry, P.mul);
        ctx.fillStyle = '#1A1E22';
        ell(ctx, P.x(c.x), P.y(c.y), c.r - 1 > 0 ? c.r - 1 : c.r, Math.max(1, ry - 1), P.mul);
        P.stats.drawCalls += 2 * (ry * 2 + 1);
      }
      ctx.globalAlpha = 1;
      void INK;
    },
    caps: SCENE_CAPS,
  };

  function agregarResto(e, step) {
    const w = scene.wrecks.length >= SCENE_CAPS.wrecks ? scene.wrecks.shift() : freeWrecks.pop();
    w.x = e.x;
    w.y = e.y;
    w.kind = e.kind;
    w.side = e.side;
    w.dir = e.side === 0 ? 1 : -1;
    w.born = step;
    scene.wrecks.push(w);
  }

  function agregarCrater(x, y, r, step) {
    const c = scene.craters.length >= SCENE_CAPS.craters ? scene.craters.shift() : freeCraters.pop();
    c.x = Math.round(x);
    c.y = Math.round(y);
    c.r = r;
    c.born = step;
    scene.craters.push(c);
  }

  function proyectil(kind, x0, y0, z0, tx, ty, tz, speed, step, arc, big) {
    const p = scene.projectiles.length >= SCENE_CAPS.projectiles ? scene.projectiles.shift() : freeProj.pop();
    const dist = Math.sqrt((tx - x0) * (tx - x0) + (ty - y0) * (ty - y0));
    p.kind = kind;
    p.x0 = x0;
    p.y0 = y0;
    p.z0 = z0;
    p.tx = tx;
    p.ty = ty;
    p.tz = tz;
    // el mismo tiempo de vuelo que programó el sim: max(1, ceil(dist / velocidad · 30)) pasos
    p.dur = Math.max(1, Math.ceil((dist / speed) * 30)) / 30;
    p.step0 = step;
    p.arc = arc;
    p.big = big;
    scene.projectiles.push(p);
  }

  function disparo(e, cfg, step) {
    const sp = sprites[e.kind];
    const dir = e.tx >= e.x ? 1 : -1;
    const mx = e.x + dir * (sp.mz[0] - sp.ax);
    const z0 = sp.ay - sp.mz[1];
    if (BALA.has(e.kind)) {
      proyectil(0, mx, e.y, z0, e.tx, e.ty, ALTURA.soldado, cfg.projectiles.bullet, step, 0, false);
    } else {
      const grande = e.kind === 'pesado';
      const v = grande ? cfg.projectiles.shellPesado : cfg.projectiles.shellTanque;
      const dist = Math.sqrt((e.tx - e.x) * (e.tx - e.x) + (e.ty - e.y) * (e.ty - e.y));
      proyectil(1, mx, e.y, z0, e.tx, e.ty, ALTURA.tanque, v, step, Math.min(18, dist * 0.25), grande);
    }
  }

  /** Quita lo que ya cumplió su vida (se recicla el objeto, no se descarta). */
  function podar(step) {
    const w = scene.wrecks;
    let k = 0;
    for (let i = 0; i < w.length; i++) {
      const r = w[i];
      const edad = (step - r.born) / 30;
      if (edad > (r.kind === 'soldado' ? LIFE.soldado : LIFE.vehiculo)) freeWrecks.push(r);
      else w[k++] = r;
    }
    w.length = k;
    const p = scene.projectiles;
    k = 0;
    for (let i = 0; i < p.length; i++) {
      const r = p[i];
      if (step - r.step0 > r.dur * 30 + 2) freeProj.push(r);
      else p[k++] = r;
    }
    p.length = k;
    const c = scene.craters;
    k = 0;
    for (let i = 0; i < c.length; i++) {
      if ((step - c[i].born) / 30 > LIFE.crater) freeCraters.push(c[i]);
      else c[k++] = c[i];
    }
    c.length = k;
    if (flashes.size > SCENE_CAPS.flashes)
      for (const [id, start] of flashes) if (start + FLASH_COOLDOWN <= step) flashes.delete(id);
  }

  return scene;
}
