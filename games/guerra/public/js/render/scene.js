// Escena de la vista: lo que el render necesita además del estado de reglas. Lee la bandeja de eventos del mundo
// (`world.drain()`, nunca `registry.drain()`; coordinador, nota 3) y arma pools de capacidad fija: restos, proyectiles
// en vuelo, cráteres y destellos de golpe. Todo es cosmético: ninguna regla lo lee y nada aquí escribe en el sim.

import { ALTURA } from './units.js';
import { createFx, FX_CAPS, LIFE } from './fx.js';

/** Topes de la escena. Restos y cráteres son de `fx.js` (un solo dueño por pool); aquí quedan los proyectiles. */
export const SCENE_CAPS = Object.freeze({
  wrecks: FX_CAPS.wrecks,
  projectiles: 256,
  craters: FX_CAPS.craters,
  flashes: 512,
});

export { LIFE };

const BALA = new Set(['soldado', 'jeep', 'blindado']);
/**
 * Pasos que dura el destello blanco de un golpe y pasos hasta el siguiente. CB-20: a lo sumo 3 destellos grandes por
 * segundo, así que entre inicios hay 11 pasos (0,37 s): en una ventana cerrada de 31 pasos caben 3 inicios (con 10
 * cabrían 4). El v3 dejaba 0,22 s.
 */
const FLASH_STEPS = 2;
const FLASH_COOLDOWN = 11;

/**
 * @param {{teamHex: [string, string], sprites: any, fx?: ReturnType<typeof createFx>}} o `fx` es el dueño de los pools
 *   de partículas, explosiones, cráteres y restos; sin él la escena crea el suyo.
 */
export function createScene({ teamHex, sprites, fx = createFx({ seed: 'efectos:escena' }) }) {
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
    splash: 0,
    landed: false,
  }));
  /** @type {Map<number, number>} id de unidad -> paso del último destello */
  const flashes = new Map();

  const scene = {
    teamHex,
    fx,
    step: 0,
    cfg: null,
    units: [],
    /** Grupos del mundo (por referencia): los íconos de rol se arman con ellos. */
    planes: [],
    bombs: [],
    bases: null,
    field: null,
    /** Restos y cráteres son los arreglos de `fx` (mismo objeto, un solo dueño). */
    wrecks: fx.wrecks,
    projectiles: /** @type {any[]} */ ([]),
    craters: fx.craters,
    drawEffects: /** @type {((P: any) => void) | null} */ ((P) => fx.draw(P)),
    /** ¿Se dibuja la torreta en pie? (la ruina y la secuencia de la base las decide `fx`). */
    turretShown: (side, k, simAlive) => fx.turretShown(side, k, simAlive),
    /** ¿Se dibuja la base en ruinas? (tras la explosión final de su secuencia). */
    baseFell: (side, b) => fx.baseFell(side, b),
    flashUntil: (id) => {
      if (!fx.motion.politica.flicker) return 0; // movimiento reducido: el golpe no parpadea en blanco
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
      fx.reset();
      for (const p of scene.projectiles) freeProj.push(p);
      scene.projectiles.length = 0;
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
      fx.teamHex = scene.teamHex;
      fx.sprites ??= sprites;
      const cfg = world.cfg;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        switch (e.type) {
          case 'death':
            fx.consume(e, world);
            break;
          case 'hit': {
            fx.consume(e, world);
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
            fx.consume(e, world);
            break;
          }
          case 'bombImpact':
          case 'turretDown':
          case 'baseHit':
            fx.consume(e, world);
            break;
          default:
            break;
        }
      }
      llegadas(world);
      fx.checkBases(world);
      podar(world.step);
    },
    drawCraters(P) {
      fx.drawCraters(P, scene.step + (P.frame.alpha ?? 0));
    },
    caps: SCENE_CAPS,
  };

  function proyectil(kind, x0, y0, z0, tx, ty, tz, speed, step, arc, big, splash = 0) {
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
    p.splash = splash;
    p.landed = false;
    scene.projectiles.push(p);
  }

  function disparo(e, cfg, step) {
    const sp = sprites[e.kind];
    const dir = e.tx >= e.x ? 1 : -1;
    const mx = e.x + dir * (sp.mz[0] - sp.ax);
    const z0 = sp.ay - sp.mz[1];
    if (e.kind === 'lobo') {
      // cuerpo a cuerpo: el zarpazo no vuela, es un tajo delante de él (el golpe lo da el sim un paso después)
      fx.claw(mx, e.y - z0, dir);
      return;
    }
    if (e.kind === 'francotirador') {
      // trazador largo y fino (kind 2): llega casi de inmediato
      proyectil(2, mx, e.y, z0, e.tx, e.ty, ALTURA.soldado, cfg.projectiles.sniper, step, 0, false);
    } else if (e.kind === 'lanzacohetes') {
      // cohete con estela (kind 3): arco bajo, estalla como un obús mediano
      const dist = Math.sqrt((e.tx - e.x) * (e.tx - e.x) + (e.ty - e.y) * (e.ty - e.y));
      const splash = cfg.units.lanzacohetes.splash;
      proyectil(
        3,
        mx,
        e.y,
        z0,
        e.tx,
        e.ty,
        ALTURA.tanque,
        cfg.projectiles.rocket,
        step,
        Math.min(10, dist * 0.12),
        false,
        splash,
      );
    } else if (BALA.has(e.kind)) {
      proyectil(0, mx, e.y, z0, e.tx, e.ty, ALTURA.soldado, cfg.projectiles.bullet, step, 0, false);
    } else {
      const grande = e.kind === 'pesado';
      const v = grande ? cfg.projectiles.shellPesado : cfg.projectiles.shellTanque;
      const dist = Math.sqrt((e.tx - e.x) * (e.tx - e.x) + (e.ty - e.y) * (e.ty - e.y));
      proyectil(
        1,
        mx,
        e.y,
        z0,
        e.tx,
        e.ty,
        ALTURA.tanque,
        v,
        step,
        Math.min(18, dist * 0.25),
        grande,
        cfg.units[e.kind].splash,
      );
    }
    fx.muzzle(e.kind, mx, e.y - z0, dir);
  }

  /**
   * Un obús que cumplió su tiempo de vuelo estalla (una sola vez) y cava su cráter si no iba al hangar; una bala que llega a
   * la cara del hangar suelta chispas ahí.
   */
  function llegadas(world) {
    const step = world.step;
    for (let i = 0; i < scene.projectiles.length; i++) {
      const p = scene.projectiles[i];
      if (p.landed || step < p.step0 + Math.round(p.dur * 30)) continue;
      p.landed = true;
      // la cara del hangar (v2.8) es el frente: lo que llega a su x apuntaba al hangar
      const lado = world.bases[0].frontX === p.tx ? 0 : world.bases[1].frontX === p.tx ? 1 : -1;
      if (p.kind === 1 || p.kind === 3) fx.shellImpact(p.tx, p.ty, p.tz, p.big, p.splash, lado >= 0, step);
      else if (lado >= 0) fx.faceSpark(lado, p.tx, p.ty);
    }
  }

  /** Quita lo que ya cumplió su vida (el objeto se recicla, no se descarta). */
  function podar(step) {
    fx.prune(step);
    const p = scene.projectiles;
    let k = 0;
    for (let i = 0; i < p.length; i++) {
      const r = p[i];
      if (step - r.step0 > r.dur * 30 + 2) freeProj.push(r);
      else p[k++] = r;
    }
    p.length = k;
    if (flashes.size > SCENE_CAPS.flashes)
      for (const [id, start] of flashes) if (start + FLASH_COOLDOWN <= step) flashes.delete(id);
  }

  return scene;
}
