// Efectos de la vista (diseño D21 puntos 12 a 14; CB-20, CB-9): partículas, explosiones, cráteres y restos en pools de
// capacidad fija. Con el pool lleno se recicla la entrada MÁS VIEJA y nada se reserva más allá del tope. Todo es
// cosmético: el módulo solo LEE el mundo y nunca escribe en el sim, y su RNG es propio (`mulberry32(seedFrom(...))`
// con una etiqueta de efectos del partido), jamás el del sim ni `Math.random`.
//
// Dos relojes:
//   - de juego (`world.step`, 30 Hz): la vida de restos y cráteres, que se detiene con la pausa y al acabar la ronda;
//   - de vista (`update(dt)`): lo que debe seguir animándose aunque el mundo ya no avance (humo, la secuencia de la base).

import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { PALETA } from '../data/paleta.js';
import { BASE_STATE_THRESHOLDS, HANGAR_ART, MIDY, baseState } from './base-art.js';
import { createFlashLimiter } from './flash.js';
import { createMotion } from './motion.js';
import { disc, ell } from './pixel.js';

const INK = PALETA.ink;

export const FX_CAPS = Object.freeze({ particles: 600, booms: 40, craters: 60, wrecks: 24 });

/** Vida de cada resto y cráter, en segundos de juego (CB-20). */
export const LIFE = Object.freeze({ soldado: 3.1, soldadoFade: 2.5, vehiculo: 7.5, crater: 20, craterFade: 15 });

/**
 * Las unidades a pie (v2.8): al morir dejan un cuerpo que cae y se desvanece (3,1 s) y no arden; el resto son vehículos
 * (carcasa quemada de 7,5 s con fuego y humo).
 */
export const A_PIE = Object.freeze(new Set(['soldado', 'francotirador', 'lobo']));

/** Los vehículos parpadean (o se desvanecen con movimiento reducido) los últimos 1,2 s antes de irse. */
const VEHICULO_AVISO = 6.3;

/** Ids de los efectos: ninguno suena a sangre (CB-9; una prueba lo recorre junto con los ids de los sprites). */
export const FX_IDS = Object.freeze({
  particles: ['spark', 'smoke', 'fire', 'dust', 'debris', 'chunk', 'muzzle', 'exhaust'],
  booms: ['small', 'med', 'large', 'huge'],
  wrecks: ['death', 'wreck', 'ruin'],
});

/** Radios de las explosiones (diseño: 5 / 11 / 18 / 28). */
export const BOOM_R = Object.freeze({ small: 5, med: 11, large: 18, huge: 28 });

const T_SPARK = 0;
const T_SMOKE = 1;
const T_FIRE = 2;
const T_DUST = 3;
const T_DEBRIS = 4;
const T_MUZZLE = 6;

/**
 * Opacidad de un resto: el soldado cae y se desvanece (de 2,5 s a 3,1 s); el vehículo avisa antes de irse.
 * @param {string} kind
 * @param {number} age segundos de juego desde la muerte
 * @param {boolean} [reduced] movimiento reducido: el vehículo se desvanece en vez de parpadear
 */
export function wreckAlpha(kind, age, reduced = false) {
  if (A_PIE.has(kind)) {
    if (age <= LIFE.soldadoFade) return 1;
    return Math.max(0, 1 - (age - LIFE.soldadoFade) / (LIFE.soldado - LIFE.soldadoFade));
  }
  if (age <= VEHICULO_AVISO) return 1;
  if (reduced) return Math.max(0, 1 - (age - VEHICULO_AVISO) / (LIFE.vehiculo - VEHICULO_AVISO));
  return Math.floor(age * 12) % 2 === 1 ? 0 : 1;
}

/** Opacidad de un cráter: entero hasta los 15 s y se borra hasta los 20 s. */
export function craterAlpha(age) {
  if (age <= LIFE.craterFade) return 1;
  return Math.max(0, 1 - (age - LIFE.craterFade) / (LIFE.crater - LIFE.craterFade));
}

const nuevaParticula = () => ({
  a: 0,
  ty: 0,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  l: 0,
  m: 1,
  s: 1,
  c: '#FFFFFF',
  g: 0,
  gy: 0,
  b: 0,
  r: 0,
  vr: 0,
  w: 0,
  h: 0,
  gr: 0,
  d: 0,
});
const nuevaExplosion = () => ({
  a: 0,
  x: 0,
  y: 0,
  gy: 0,
  R: 0,
  t: 0,
  d: 0,
  sd: 0,
  core: false,
  degraded: false,
  white: false,
});

/** Fogonazo por tipo (tamaño del v3) y humo de boca: [tamaño, radio de humo]. */
const BOCA = Object.freeze({
  soldado: [1, 0],
  francotirador: [1, 1],
  jeep: [1, 0],
  blindado: [1, 0],
  tanque: [2, 2],
  lanzacohetes: [3, 4],
  pesado: [3, 3],
  lobo: [0, 0],
});
/** Explosiones secundarias del lanzacohetes al morir (sus cohetes revientan): [segundos, tamaño, desplazamiento en x]. */
const SECUNDARIAS_COHETES = Object.freeze([
  [0.2, 'small', -8],
  [0.4, 'med', 6],
  [0.65, 'small', -2],
]);
/** Explosiones secundarias del pesado al morir: [segundos, tamaño, desplazamiento en x]. */
const SECUNDARIAS = Object.freeze([
  [0.25, 'med', -10],
  [0.5, 'large', 8],
  [0.8, 'med', -2],
  [1.1, 'med', 12],
]);
/** x de un punto a `n` px del borde exterior de la base de esa secuencia (espejado en la derecha). */
const enBase = (s, n) => (s.side === 1 ? s.worldW - n : n);
/** Ancho y ancla en y de un vehículo para echar fuego, si no hay sprites a mano. */
const CASCO = Object.freeze({
  jeep: [22, 14],
  blindado: [26, 16],
  tanque: [28, 18],
  lanzacohetes: [32, 20],
  pesado: [40, 26],
});
const FUEGO = ['#FFF3A0', '#FFD84A', '#FF9A3C', '#E5484D', '#7A1F25'];
const HUMO = ['#4A5064', '#363B4B', '#262A37'];
/** Radio del núcleo blanco respecto del radio de la explosión. */
const CORE = 0.7;
/** Secuencia de destrucción de la base (solo vista): ventana de explosiones, pop de torretas y explosión final. */
const SEQ = Object.freeze({ boomsUntil: 1.75, popAt: 0.8, popGap: 0.3, finalAt: 1.9 });
/** Cuánto humo echa la ruina de una torreta, en segundos de vista. */
const RUINA_SEGUNDOS = 3;
const SLOW_SECONDS = 1.2;
const SLOW_FACTOR = 0.35;
/** Un golpe a la base solo hace temblar si pega fuerte (obús, bomba, energía), no una bala. */
const BASE_SHAKE_DMG = 100;
const ESCAPE_CADA = 0.15;
const ARDE_HASTA = 6;
const MAX_DT = 0.25;

/**
 * @param {{seed?: string, sprites?: any, flash?: {maxLargePerSecond?: number, largeArea?: number, frameArea?: number},
 *   motion?: ReturnType<typeof createMotion>}} [o]
 *   `seed` es la etiqueta de efectos del partido (`efectos:<par>:<n>`); `flash` la config de `fx.flash` (se recorta);
 *   `motion` la política de movimiento reducido (se comparte con el resto de la vista).
 */
export function createFx({ seed = 'efectos', sprites, flash, motion = createMotion() } = {}) {
  const politica = motion.politica;
  let rnd = mulberry32(seedFrom(seed));
  // el temblor tiene su propio RNG: pedirlo por cuadro no debe cambiar los efectos que salen del RNG principal
  let shakeRnd = mulberry32(seedFrom(`${seed}:temblor`));
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  const particles = Array.from({ length: FX_CAPS.particles }, nuevaParticula);
  const booms = Array.from({ length: FX_CAPS.booms }, nuevaExplosion);
  let pHead = 0;
  let bHead = 0;

  const freeWrecks = Array.from({ length: FX_CAPS.wrecks }, () => ({
    x: 0,
    y: 0,
    kind: '',
    side: 0,
    dir: 1,
    born: 0,
    fl: 0,
  }));
  /** Explosiones que aún no estallan (secundarias del pesado): tiempo restante y qué soltar. */
  const later = Array.from({ length: 16 }, () => ({ on: false, t: 0, x: 0, y: 0, size: 'med' }));
  const view = { W: 1920, H: 1080, s: 4 / 3, marks: false };
  const limiter = createFlashLimiter(flash);
  const stats = {
    ruinPuffs: 0,
    spawned: 0,
    secondary: 0,
    largeGranted: 0,
    degraded: 0,
    coreArea: 0,
    coresDegraded: 0,
    faceSparks: 0,
    hangarSmoke: 0,
  };
  /** Hangar: cuándo (reloj de vista) saltó la última chispa de cada cara y cuánto falta para la próxima bocanada de humo. */
  const lastFace = [-1e9, -1e9];
  const hangarAcc = [0, 0];
  let exhaustT = 0;
  let shakeMag = 0;
  let slowLeft = 0;
  /** Por torreta (lado·8 + k): ya cayó / sigue "en pie" a la vista hasta su pop en la secuencia de la base. */
  const downed = new Uint8Array(16);
  const pending = new Uint8Array(16);
  /** Humo de las ruinas de torreta: 3 s cada una. */
  const ruins = Array.from({ length: 16 }, () => ({ on: false, left: 0, acc: 0, x: 0, y: 0 }));
  const mkSeq = () => ({
    side: 0,
    t: 0,
    nextB: 0,
    sm: 0,
    ruin: false,
    finalAt: -1,
    booms: 0,
    boomTimes: /** @type {number[]} */ ([]),
    pops: /** @type {number[]} */ ([]),
    turrets: /** @type {any[]} */ ([]),
    worldW: 1440,
    g0: 200,
    g1: 700,
  });
  const seqPool = [mkSeq(), mkSeq()];
  const seqs = /** @type {(ReturnType<typeof mkSeq> | null)[]} */ ([null, null]);
  const freeCraters = Array.from({ length: FX_CAPS.craters }, () => ({ x: 0, y: 0, r: 0, born: 0 }));
  const wrecks = /** @type {any[]} */ ([]);
  const craters = /** @type {any[]} */ ([]);

  /** Siguiente casilla del anillo: la más vieja si el pool está lleno. */
  function np() {
    const p = particles[pHead];
    pHead = (pHead + 1) % FX_CAPS.particles;
    stats.spawned++;
    p.a = 1;
    p.d = 0;
    p.b = 0;
    p.g = 0;
    p.gy = 0;
    p.r = 0;
    p.vr = 0;
    p.gr = 0;
    p.w = 0;
    p.h = 0;
    p.s = 1;
    p.vx = 0;
    p.vy = 0;
    return p;
  }

  /** Lo que se ve al morir una unidad: el soldado cae (polvo); el vehículo explota con su casco. */
  function muerte(e) {
    const col = fx.teamHex[e.side];
    const dir = e.side === 0 ? 1 : -1;
    if (e.kind === 'soldado' || e.kind === 'francotirador') {
      fx.dust(e.x, e.y - 1, 4, 0.3);
    } else if (e.kind === 'lobo') {
      // héroe: cae con una gran nube de polvo y un destello blanco (sin explosión, sin nada rojo)
      fx.dust(e.x, e.y - 1, 10, 0.6);
      fx.dust(e.x - dir * 6, e.y - 6, 6, 0.5);
      fx.spark(e.x, e.y - 12, 8, '#FFFFFF');
    } else if (e.kind === 'jeep') {
      fx.boom(e.x, e.y, 'med', 6);
      fx.debris(e.x, e.y - 8, 6, col, e.y);
    } else if (e.kind === 'blindado') {
      fx.boom(e.x, e.y, 'med', 8);
      fx.debris(e.x, e.y - 9, 8, col, e.y);
      fx.chunk(e.x - dir * 2, e.y - 10, dir, col, 6, 3, e.y);
    } else if (e.kind === 'lanzacohetes') {
      fx.boom(e.x, e.y, 'large', 10);
      fx.debris(e.x, e.y - 11, 10, col, e.y);
      programar(e, SECUNDARIAS_COHETES);
    } else if (e.kind === 'tanque') {
      fx.boom(e.x, e.y, 'large', 9);
      fx.debris(e.x, e.y - 10, 9, col, e.y);
      fx.chunk(e.x - dir * 2, e.y - 12, dir, col, 8, 3, e.y);
    } else {
      fx.boom(e.x, e.y, 'huge', 12);
      fx.debris(e.x, e.y - 12, 14, col, e.y);
      fx.chunk(e.x, e.y - 17, dir, col, 12, 5, e.y);
      programar(e, SECUNDARIAS);
    }
  }

  /** Reserva las explosiones secundarias de una muerte (`later`): [segundos, tamaño, desplazamiento en x]. */
  function programar(e, lista) {
    let n = 0;
    for (const [t, size, dx] of lista) {
      while (n < later.length && later[n].on) n++;
      if (n >= later.length) break;
      const l = later[n];
      l.on = true;
      l.t = t;
      l.x = e.x + dx;
      l.y = e.y;
      l.size = size;
    }
  }

  /** Los vehículos destruidos echan fuego y humo durante 6 s de juego (v3 `deadStep`). */
  function arden(dt, world) {
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      if (A_PIE.has(w.kind) || (world.step - w.born) / 30 >= ARDE_HASTA) continue;
      w.fl -= dt;
      if (w.fl > 0) continue;
      w.fl = 0.1;
      const sp = fx.sprites?.[w.kind];
      const [ancho, ay] = sp ? [sp.w, sp.ay] : CASCO[w.kind];
      fx.fire(w.x + (rnd() - 0.5) * ancho * 0.5, w.y - ay * 0.5);
      if (rnd() < 0.6) {
        fx.smoke(
          w.x + (rnd() - 0.5) * ancho * 0.4,
          w.y - ay * 0.7,
          2 + (w.kind === 'pesado' ? 1 : 0),
          (rnd() - 0.5) * 6,
          -12,
          1.1,
        );
      }
    }
  }

  /**
   * Humo (y de vez en cuando fuego) en la cara de un hangar dañado: con grietas (HP < 66 %) una bocanada cada 0,5 s y muy
   * dañado (< 33 %) una cada 0,2 s, más una llama cada dos. Un hangar caído lo deja a su secuencia. Solo vista.
   */
  function humoDeHangar(dt, world) {
    for (let side = 0; side < 2; side++) {
      const b = world.bases?.[side];
      if (!b || !(b.maxHp > 0) || b.fell || seqs[side]) continue;
      const st = baseState(b.hp / b.maxHp, false, BASE_STATE_THRESHOLDS);
      if (st < 1) {
        hangarAcc[side] = 0;
        continue;
      }
      const cada = st >= 2 ? 0.2 : 0.5;
      hangarAcc[side] += dt;
      const hg = world.field?.sides?.[side]?.hangar;
      const y0 = hg?.y0 ?? HANGAR_ART.y0;
      const y1 = hg?.y1 ?? HANGAR_ART.y1;
      const w = world.field?.w ?? 1440;
      while (hangarAcc[side] >= cada) {
        hangarAcc[side] -= cada;
        const n = ri(HANGAR_ART.x1 - 14, HANGAR_ART.x1 - 2); // pegado a la cara
        const x = side === 1 ? w - n : n;
        const y = ri(y0 + 12, y1 - 12);
        const p = fx.smoke(x, y, 2 + (st >= 2 ? 1 : 0), (rnd() - 0.5) * 4, -14, 1.4);
        if (politica.stillSmoke) {
          p.vx = 0;
          p.vy = 0;
          p.gr = 0;
        }
        stats.hangarSmoke++;
        if (st >= 2 && stats.hangarSmoke % 2 === 0) fx.fire(x, y);
      }
    }
  }

  /** Bocanadas de escape desde las góndolas de cada avión, cada 0,15 s. */
  function escape(dt, world) {
    exhaustT += dt;
    while (exhaustT >= ESCAPE_CADA - 1e-9) {
      exhaustT -= ESCAPE_CADA;
      for (const p of world.planes) {
        const dir = p.side === 0 ? 1 : -1;
        fx.smoke(p.x - dir * 8, p.y - p.z - 8, 1, -dir * 16, -2, 0.4);
        fx.smoke(p.x - dir * 8, p.y - p.z + 8, 1, -dir * 16, -2, 0.4);
      }
    }
  }

  /** Círculo irregular del v3 (`rag`): filas de ancho variable según una semilla. En px de destino con escala `k`. */
  function rag(g, cx, cy, r, seed, k) {
    for (let dy = -r; dy <= r; dy++) {
      const j = ((((dy * 73856093) ^ (seed * 19349663)) >>> 0) % 3) - 1;
      const w = Math.max(0, Math.floor(Math.sqrt(r * r + r * 0.8 - dy * dy)) + (r > 3 ? j : 0));
      g.fillRect(cx - w * k, cy + dy * k, (w * 2 + 1) * k, k);
    }
  }

  /** Humo de ruina: con movimiento reducido queda quieto (sin deriva ni crecimiento). */
  function puff(x, y, r, vx, vy, life) {
    const p = fx.smoke(x, y, r, vx, vy, life);
    if (politica.stillSmoke) {
      p.vx = 0;
      p.vy = 0;
      p.gr = 0;
    }
    stats.ruinPuffs++;
  }

  /** La torreta (lado, k) cayó: queda su ruina echando humo 3 s. */
  function ruinaDeTorreta(side, k, x, y) {
    downed[side * 8 + k] = 1;
    pending[side * 8 + k] = 0;
    for (const r of ruins) {
      if (r.on) continue;
      r.on = true;
      r.left = RUINA_SEGUNDOS;
      r.acc = 0;
      r.x = x;
      r.y = y;
      return;
    }
  }

  /** Arranca la secuencia de la base `side`: las torretas que seguían en pie a la vista harán su pop. */
  function empezarSecuencia(side, world) {
    const s = seqPool[side];
    s.side = side;
    s.t = 0;
    s.nextB = 0;
    s.sm = 0;
    s.ruin = false;
    s.finalAt = -1;
    s.booms = 0;
    s.boomTimes.length = 0;
    s.turrets = world.bases[side].turrets;
    s.pops.length = s.turrets.length;
    s.pops.fill(-1);
    s.worldW = world.field?.w ?? 1440;
    // las explosiones de la secuencia caen DENTRO del hangar (v2.8): su franja de y
    const hg = world.field?.sides?.[side]?.hangar;
    s.hy0 = hg?.y0 ?? HANGAR_ART.y0;
    s.hy1 = hg?.y1 ?? HANGAR_ART.y1;
    for (let k = 0; k < s.turrets.length; k++) pending[side * 8 + k] = downed[side * 8 + k] ? 0 : 1;
    seqs[side] = s;
    fx.shake(3);
    fx.beginSlowMotion();
  }

  /** Avanza una secuencia de base `dt` segundos de vista. Todo pasa por `boom`, o sea por el limitador de destellos. */
  function avanzarSecuencia(s, dt) {
    s.t += dt;
    const dirIn = s.side === 0 ? 1 : -1;
    const col = fx.teamHex[s.side];
    while (s.nextB <= s.t && s.nextB < SEQ.boomsUntil) {
      const x = enBase(s, ri(HANGAR_ART.x0 + 2, HANGAR_ART.x1 - 2));
      const y = ri(s.hy0 + 4, s.hy1 - 4);
      fx.boom(x, y, rnd() < 0.4 ? 'large' : 'med', ri(0, 6));
      fx.debris(x, y - 8, 5, col, y);
      s.boomTimes.push(s.nextB);
      s.booms++;
      s.nextB += 0.07 + rnd() * 0.06;
    }
    for (let k = 0; k < s.turrets.length; k++) {
      if (!pending[s.side * 8 + k] || s.t < SEQ.popAt + SEQ.popGap * k) continue;
      const t = s.turrets[k];
      fx.chunk(t.x, t.y - 4, dirIn, '#5A667C', 9, 5, t.y + 6);
      fx.chunk(t.x, t.y - 4, -dirIn, col, 7, 4, t.y + 6);
      fx.boom(t.x, t.y, 'large', 6);
      ruinaDeTorreta(s.side, k, t.x, t.y);
      s.pops[k] = s.t;
    }
    if (!s.ruin && s.t >= SEQ.finalAt) {
      const hx = enBase(s, 52); // el centro del hangar
      fx.boom(hx, MIDY - 7, 'huge', 8);
      fx.boom(hx + (rnd() - 0.5) * 30, MIDY - 42, 'large', 6);
      fx.boom(hx, MIDY + 38, 'large', 6);
      fx.debris(hx, MIDY - 22, 22, '#6B778D', MIDY + 4);
      fx.shake(3);
      s.ruin = true;
      s.finalAt = s.t;
    }
    if (s.ruin) {
      s.sm -= dt;
      if (s.sm <= 0) {
        s.sm = 0.12;
        const y = ri(s.hy0 + 10, s.hy1 - 10);
        puff(enBase(s, ri(HANGAR_ART.x0 + 4, HANGAR_ART.x1 - 4)), y, 3, (rnd() - 0.5) * 4, -16, 1.8);
        if (rnd() < 0.4) fx.fire(enBase(s, ri(HANGAR_ART.x0 + 4, HANGAR_ART.x1 - 4)), ri(s.hy0 + 20, s.hy1 - 20));
      }
    }
  }

  /**
   * Radio (px de mundo) del núcleo blanco que esta explosión mostraría ahora, o 0 si ya pasó su etapa de núcleo.
   * Etapa 1 (t < 0,04 s): el disco blanco de 0,7·R. Etapa 2 (hasta el 30 % de su vida): el centro de la bola.
   */
  function radioDeNucleo(b) {
    if (b.t < 0.04) return b.R * CORE;
    if (b.t <= b.d && b.t / b.d < 0.3) {
      const s = b.t / b.d;
      return Math.max(1, Math.round(b.R * (1 - (1 - s) * (1 - s)))) * 0.55;
    }
    return 0;
  }

  /**
   * Decide, ANTES de pintar el cuadro, qué explosiones llevan núcleo blanco (`b.white`) y cuáles quedan degradadas.
   * Dos casos distintos:
   *  - movimiento reducido: no hay núcleo blanco (núcleo amarillo) pero la explosión sigue entera, NO está degradada;
   *  - limitador: si lo negó al nacer, o si el presupuesto del 5 % del cuadro le niega el núcleo, queda DEGRADADA para
   *    el resto de su vida: sin núcleo, sin bola de fuego y sin brillo naranja, solo el humo y el escombro que ya soltó.
   */
  function decidirNucleos(P) {
    for (let i = 0; i < booms.length; i++) {
      const b = booms[i];
      b.white = false;
      if (!b.a || b.degraded) continue;
      if (b.x < P.vx0 - b.R - 20 || b.x > P.vx1 + b.R + 20 || b.y < P.vy0 - b.R - 20 || b.y > P.vy1 + b.R + 20)
        continue;
      const r = radioDeNucleo(b);
      if (r <= 0 || !politica.whiteCores) continue;
      if (limiter.take(r)) b.white = true;
      else b.degraded = true;
    }
  }

  const fx = {
    caps: FX_CAPS,
    particles,
    booms,
    wrecks,
    craters,
    /** Reloj de vista acumulado, en segundos. */
    now: 0,
    /** Colores de equipo (la escena los fija al consumir: cambian con cada par). */
    teamHex: /** @type {string[]} */ (['#8794AB', '#8794AB']),
    /** Sprites (tamaños de los cascos para el fuego); la escena los fija si no vinieron. */
    sprites,
    stats,
    view,
    limiter,
    motion,

    // -------------------------------------------------------------------------------------------------------------
    // Torretas y bases (CB-19): lo que la vista muestra mientras el sim ya dio la ronda por terminada

    /** La secuencia de destrucción de esa base (para las pruebas y F2), o null. */
    sequence(side) {
      return seqs[side];
    },
    /** ¿Ya hubo la explosión final de esa base (arte en ruinas)? */
    baseRuined(side) {
      return seqs[side]?.ruin ?? false;
    },
    /**
     * ¿Se dibuja la base en ruinas? Con secuencia en marcha, solo tras la explosión final; si no, lo que dice el sim.
     * @param {number} side
     * @param {{fell?: boolean}} b
     */
    baseFell(side, b) {
      const s = seqs[side];
      return s ? s.ruin : Boolean(b?.fell);
    },
    /**
     * ¿Se dibuja la torreta (side, k) en pie? Una que cayó es un disco oscuro; las que el sim apagó al caer la base
     * siguen a la vista hasta su pop.
     * @param {number} side
     * @param {number} k
     * @param {boolean} simAlive
     */
    turretShown(side, k, simAlive) {
      const i = side * 8 + k;
      if (pending[i]) return true;
      if (downed[i]) return false;
      return simAlive;
    },
    /** La torreta (side, k) cayó: explosión de radio 18 por el limitador y su ruina con humo 3 s. */
    turretDown(side, k, x, y) {
      if (downed[side * 8 + k]) return;
      ruinaDeTorreta(side, k, x, y);
      fx.boom(x, y, 'large', 6);
    },
    /** Después de cada paso: si una base cayó y aún no tiene secuencia, empieza. */
    checkBases(world) {
      for (let side = 0; side < 2; side++) {
        if (!seqs[side] && world.bases?.[side]?.fell) empezarSecuencia(side, world);
      }
    },
    /**
     * La vista de este cuadro: tamaño del canvas, escala mostrada y LOD de marcas. Con marcas no se crean las
     * partículas de 1 px (chispas y polvo).
     * @param {{W: number, H: number, s: number, marks?: boolean}} v
     */
    setView(v) {
      view.W = v.W;
      view.H = v.H;
      view.s = v.s;
      view.marks = Boolean(v.marks);
      limiter.setView(v.W, v.H, v.s);
    },

    /** Semilla nueva para un partido (misma etiqueta, mismos efectos). */
    startMatch(label) {
      rnd = mulberry32(seedFrom(label));
      shakeRnd = mulberry32(seedFrom(`${label}:temblor`));
    },
    /** Una ronda nueva: se vacía todo lo cosmético. */
    reset() {
      for (const p of particles) p.a = 0;
      for (const b of booms) b.a = 0;
      for (const w of wrecks) freeWrecks.push(w);
      for (const c of craters) freeCraters.push(c);
      for (const l of later) l.on = false;
      exhaustT = 0;
      downed.fill(0);
      pending.fill(0);
      for (const r of ruins) r.on = false;
      seqs[0] = seqs[1] = null;
      shakeMag = 0;
      slowLeft = 0;
      limiter.reset();
      wrecks.length = 0;
      craters.length = 0;
      pHead = 0;
      bHead = 0;
      fx.now = 0;
    },
    /** Destellos grandes concedidos en el último segundo del reloj de vista. */
    recentLarge() {
      return limiter.recent(fx.now);
    },
    usage() {
      let p = 0;
      let b = 0;
      for (let i = 0; i < particles.length; i++) if (particles[i].a) p++;
      for (let i = 0; i < booms.length; i++) if (booms[i].a) b++;
      return { particles: p, booms: b, craters: craters.length, wrecks: wrecks.length };
    },

    // -------------------------------------------------------------------------------------------------------------
    // Partículas (coordenadas visuales: `y` ya incluye la altitud; `gy` es el suelo donde rebotan)

    spark(x, y, n, col) {
      if (view.marks || !politica.flicker) return;
      for (let i = 0; i < n; i++) {
        const p = np();
        const a = rnd() * 6.28;
        const v = 30 + rnd() * 90;
        p.ty = T_SPARK;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - 40;
        p.g = 320;
        p.l = p.m = 0.2 + rnd() * 0.3;
        p.s = 1;
        p.c = rnd() < 0.5 ? '#FFF3A0' : (col ?? '#FFB347');
      }
    },
    smoke(x, y, r, vx, vy, life) {
      const p = np();
      p.ty = T_SMOKE;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.l = p.m = life;
      p.s = r;
      p.gr = r * 1.1 + 0.6;
      return p;
    },
    fire(x, y) {
      if (!politica.flicker) return;
      const p = np();
      p.ty = T_FIRE;
      p.x = x;
      p.y = y;
      p.vx = (rnd() - 0.5) * 8;
      p.vy = -14 - rnd() * 18;
      p.l = p.m = 0.28 + rnd() * 0.25;
      p.s = 1 + (rnd() < 0.4 ? 1 : 0);
    },
    /** @param {number} [delay] segundos de espera antes de aparecer */
    dust(x, y, n, delay = 0) {
      if (view.marks) return;
      for (let i = 0; i < n; i++) {
        const p = np();
        p.ty = T_DUST;
        p.x = x + (rnd() - 0.5) * 6;
        p.y = y;
        p.vx = (rnd() - 0.5) * 40;
        p.vy = -6 - rnd() * 10;
        p.l = p.m = 0.5 + rnd() * 0.3;
        p.s = 1 + rnd() * 1.5;
        p.gr = 3;
        p.d = delay;
      }
    },
    debris(x, y, n, col, gy) {
      const cs = [col, col, '#4F5A70', '#2A3140', '#9DA9BF'];
      for (let i = 0; i < n; i++) {
        const p = np();
        p.ty = T_DEBRIS;
        p.x = x + (rnd() - 0.5) * 8;
        p.y = y;
        const a = -Math.PI * (0.15 + rnd() * 0.7);
        const v = 50 + rnd() * 110;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.g = 380;
        p.gy = gy + rnd() * 6 - 3;
        p.l = p.m = 1.2 + rnd() * 0.8;
        p.s = 1 + Math.floor(rnd() * 2.4);
        p.c = cs[i % 5];
      }
    },
    /** Pedazo grande que gira (casco de un vehículo). */
    chunk(x, y, dir, col, w, h, gy) {
      const p = np();
      p.ty = T_DEBRIS;
      p.x = x;
      p.y = y;
      p.vx = dir * (25 + rnd() * 40);
      p.vy = -150 - rnd() * 50;
      p.g = 380;
      p.gy = gy + rnd() * 4;
      p.l = p.m = 2.6;
      p.w = w;
      p.h = h;
      p.c = col;
      p.vr = (rnd() < 0.5 ? -1 : 1) * (7 + rnd() * 5);
    },

    /**
     * Explosión de radio `BOOM_R[size]` con su humo, chispas, escombro y polvo.
     * @param {number} x
     * @param {number} gy suelo
     * @param {'small'|'med'|'large'|'huge'} size
     * @param {number} [z] altura sobre el suelo
     */
    boom(x, gy, size, z = 0) {
      const R = BOOM_R[size] ?? BOOM_R.med;
      const vy = gy - z - R * 0.3;
      const b = booms[bHead];
      bHead = (bHead + 1) % FX_CAPS.booms;
      b.a = 1;
      b.x = Math.round(x);
      b.y = Math.round(vy);
      b.gy = Math.round(gy);
      b.R = R;
      b.t = 0;
      b.d = 0.2 + R * 0.012;
      b.sd = ri(0, 99);
      // el limitador decide si lleva núcleo blanco; si no, se degrada a humo y escombro (CB-20)
      b.core = limiter.admit(R * CORE, fx.now);
      b.degraded = !b.core;
      b.white = false;
      if (b.core) {
        if (limiter.isLarge(R * CORE)) stats.largeGranted++;
      } else {
        stats.degraded++;
        for (let i = 0; i < 3; i++)
          fx.smoke(
            x + (rnd() - 0.5) * R,
            vy + (rnd() - 0.5) * R * 0.6,
            2 + R / 6,
            (rnd() - 0.5) * 20,
            -14 - rnd() * 18,
            0.9 + rnd() * 0.9,
          );
        fx.debris(x, vy, 4, '#4F5A70', gy);
      }
      const n = size === 'small' ? 2 : size === 'med' ? 4 : size === 'large' ? 7 : 12;
      for (let i = 0; i < n; i++) {
        fx.smoke(
          x + (rnd() - 0.5) * R,
          vy + (rnd() - 0.5) * R * 0.6,
          2 + R / 6,
          (rnd() - 0.5) * 20,
          -14 - rnd() * 18,
          0.9 + rnd() * 0.9,
        );
      }
      fx.spark(x, vy, Math.min(10, Math.floor(2 + R / 3)));
      if (R >= 11) fx.debris(x, vy, R >= 18 ? 8 : 4, '#4F5A70', gy);
      if (R >= 11) fx.dust(x, gy, 3);
      return b;
    },

    /** Pide temblor de intensidad `m` (1 a 3). Con movimiento reducido o `graphics.shake = 0` no hace nada. */
    shake(m) {
      if (politica.shake > 0) shakeMag = Math.max(shakeMag, m);
    },
    /**
     * Desplazamiento de cámara de este cuadro, en px enteros de mundo (≤ 2 con la config por defecto).
     * @param {{x: number, y: number}} out
     */
    shakeOffset(out) {
      out.x = 0;
      out.y = 0;
      if (shakeMag <= 0 || politica.shake <= 0) return out;
      const amp = (shakeMag * politica.shake * 4) / 3;
      const m = Math.ceil(amp - 1e-9);
      if (m <= 0) return out;
      out.x = Math.floor(shakeRnd() * (2 * m + 1)) - m;
      out.y = Math.floor(shakeRnd() * (2 * m + 1)) - m;
      return out;
    },
    /** Cámara lenta de 1,2 s al 0,35× del reloj de vista (solo los efectos; el sim no se entera). */
    beginSlowMotion() {
      if (politica.slowMotion) slowLeft = SLOW_SECONDS;
    },
    /** Factor del reloj de vista ahora mismo: 0,35 durante la cámara lenta y 1 el resto del tiempo. */
    timeScale() {
      return slowLeft > 0 && politica.slowMotion ? SLOW_FACTOR : 1;
    },

    /**
     * Fogonazo de boca y, en los cañones, el humo (v3 `fxFlash`).
     * @param {string} kind
     * @param {number} x boca
     * @param {number} y boca, ya con la altura
     * @param {number} dir 1 o -1
     */
    muzzle(kind, x, y, dir) {
      const [sz, sr] = BOCA[kind] ?? BOCA.soldado;
      if (politica.flicker) {
        const p = np();
        p.ty = T_MUZZLE;
        p.x = x + dir;
        p.y = y;
        p.l = p.m = 0.07;
        p.s = sz;
        fx.spark(x, y, sz, '#FFE680');
      }
      if (sr > 0) fx.smoke(x + dir * sr, y, sr, dir * (kind === 'pesado' ? 14 : 12), -6, kind === 'pesado' ? 0.6 : 0.5);
    },
    /**
     * Zarpazo del lobo (v2.8): un tajo de tres arcos de chispas blancas y amarillas delante de él, en la dirección `dir`.
     * Son puntos quietos de 0,16 s: no parpadean, así que valen también con movimiento reducido.
     * @param {number} x garra
     * @param {number} y garra, ya con la altura
     * @param {number} dir 1 o -1
     */
    claw(x, y, dir) {
      if (view.marks) return;
      for (let arco = 0; arco < 3; arco++) {
        for (let i = 0; i < 6; i++) {
          // tres tajos paralelos inclinados, de seis puntos quietos que duran 0,16 s
          const p = np();
          p.ty = T_SPARK;
          p.x = x + dir * (3 + arco * 4 + (i >> 1));
          p.y = y - 10 + arco + i * 3;
          p.l = p.m = 0.16;
          p.s = 1;
          p.c = i & 1 ? '#FFD84A' : '#FFFFFF';
        }
      }
    },
    /**
     * Una bala llegó a la cara del hangar (lado `side`): chispas y una nubecilla de polvo en el punto de impacto. Como mucho
     * una cada 0,06 s de vista por cara, para que cientos de balas no llenen el pool de partículas.
     * @param {number} side
     * @param {number} x
     * @param {number} y
     */
    faceSpark(side, x, y) {
      if (fx.now - lastFace[side] < 0.06) return;
      lastFace[side] = fx.now;
      stats.faceSparks++;
      fx.spark(x, y - 6, 2, '#FFE680');
      fx.dust(x, y - 4, 1);
    },
    /**
     * Un obús llegó: explota (mediano; grande el del pesado) y, si no iba a la base, cava un cráter.
     * @param {number} tx
     * @param {number} ty
     * @param {number} tz altura del blanco
     * @param {boolean} big
     * @param {number} splash radio de área en px
     * @param {boolean} base ¿apuntaba a la base?
     * @param {number} step
     */
    shellImpact(tx, ty, tz, big, splash, base, step) {
      fx.boom(tx, ty, big ? 'large' : 'med', tz * 0.6);
      if (!base) fx.addCrater(tx, ty, Math.max(4, Math.round(splash * 0.55)), step);
    },

    // -------------------------------------------------------------------------------------------------------------
    // Dibujo (capa 9 del orden de D21). `P` es el proyector del cuadro: coordenadas de mundo -> destino.

    /** @param {any} P */
    draw(P) {
      const g = P.ctx;
      const k = P.mul;
      const list = P.lists.particles;
      limiter.beginFrame();
      stats.coresDegraded = 0;
      decidirNucleos(P);
      // sombras del escombro en el suelo
      g.fillStyle = INK;
      g.globalAlpha = 0.22;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p.a || p.d > 0 || p.ty !== T_DEBRIS || p.gy - p.y < 2 || !P.visible(p.x, p.gy, 20)) continue;
        P.stats.drawCalls += 3;
        ell(g, P.x(Math.round(p.x)), P.y(Math.round(p.gy)), p.w ? Math.ceil(p.w / 2) : 1, 1, k);
      }
      g.globalAlpha = 1;
      // brillo de las explosiones sobre el suelo
      for (let i = 0; i < booms.length; i++) {
        const b = booms[i];
        if (!b.a || b.degraded || b.t > b.d * 1.1 || !P.visible(b.x, b.gy, b.R + 20)) continue;
        const s = Math.min(1, b.t / b.d);
        g.globalAlpha = 0.55 * (1 - s * 0.6);
        g.fillStyle = s < 0.4 ? '#FF9A3C' : '#8E2A2E';
        const ry = Math.max(1, Math.round(b.R * 0.3));
        P.stats.drawCalls += 2 * ry + 1;
        ell(g, P.x(b.x), P.y(b.gy), Math.round(b.R * (0.5 + s * 0.7)), ry, k);
      }
      g.globalAlpha = 1;
      // partículas
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p.a || p.d > 0 || !P.visible(p.x, p.y, 20)) continue;
        // el escombro parpadea antes de irse (con movimiento reducido no)
        if (p.ty === T_DEBRIS && !p.w && p.l < 0.3 && i & 1 && politica.flicker) continue;
        if (!list.push(p)) continue;
        const kf = 1 - p.l / p.m;
        const x = P.x(Math.round(p.x));
        const y = P.y(Math.round(p.y));
        switch (p.ty) {
          case T_SMOKE:
            g.globalAlpha = Math.max(0, (1 - kf) * 0.78);
            g.fillStyle = HUMO[Math.min(2, Math.floor(kf * 3))];
            P.stats.drawCalls += 2 * Math.round(p.s) + 1;
            disc(g, x, y, Math.round(p.s), k);
            g.globalAlpha = 1;
            break;
          case T_DUST:
            g.globalAlpha = (1 - kf) * 0.6;
            g.fillStyle = '#8A7A66';
            P.stats.drawCalls += 2 * Math.round(p.s) + 1;
            disc(g, x, y, Math.round(p.s), k);
            g.globalAlpha = 1;
            break;
          case T_FIRE:
            g.fillStyle = FUEGO[Math.min(4, 1 + Math.floor(kf * 4))];
            P.stats.drawCalls++;
            g.fillRect(x, y, p.s * k, (p.s + ((i + Math.round(p.x)) & 1)) * k);
            break;
          case T_SPARK:
            g.fillStyle = p.c;
            P.stats.drawCalls++;
            g.fillRect(x, y, k, k);
            break;
          case T_DEBRIS:
            if (p.w) {
              g.save();
              g.translate(x, y);
              g.rotate(p.r);
              g.fillStyle = INK;
              g.fillRect((-p.w / 2 - 1) * k, (-p.h / 2 - 1) * k, (p.w + 2) * k, (p.h + 2) * k);
              g.fillStyle = p.c;
              g.fillRect((-p.w / 2) * k, (-p.h / 2) * k, p.w * k, p.h * k);
              g.restore();
              P.stats.drawCalls += 4;
            } else {
              g.fillStyle = p.c;
              P.stats.drawCalls++;
              g.fillRect(x, y, p.s * k, p.s * k);
            }
            break;
          case T_MUZZLE:
            g.fillStyle = '#FFF3A0';
            P.stats.drawCalls += 2 * p.s + 1;
            disc(g, x, y, p.s, k);
            g.fillStyle = '#FFFFFF';
            g.fillRect(x, y, k, k);
            break;
          default:
            break;
        }
      }
      // cuerpo de las explosiones (por encima del humo)
      for (let i = 0; i < booms.length; i++) {
        const b = booms[i];
        if (!b.a || !P.visible(b.x, b.y, b.R + 20)) continue;
        if (b.degraded) {
          stats.coresDegraded++;
          continue;
        }
        const t = b.t;
        const s = Math.min(1, t / b.d);
        const X = P.x(b.x);
        const Y = P.y(b.y);
        if (t < 0.04) {
          g.fillStyle = b.white ? '#FFFFFF' : '#FFD84A';
          P.stats.drawCalls += 2 * Math.round(b.R * CORE) + 1;
          rag(g, X, Y, Math.round(b.R * CORE), b.sd + 1, k);
        } else if (t <= b.d) {
          const r = Math.max(1, Math.round(b.R * (1 - (1 - s) * (1 - s))));
          g.fillStyle = s < 0.3 ? '#FFE680' : s < 0.65 ? '#FF9A3C' : '#D9392B';
          P.stats.drawCalls += 2 * r + 1;
          rag(g, X, Y, r, b.sd + ((t * 30) | 0), k);
          g.fillStyle = s < 0.3 ? (b.white ? '#FFFFFF' : '#FFD84A') : s < 0.65 ? '#FFD84A' : '#FF9A3C';
          P.stats.drawCalls += Math.round(r * 1.1) + 1;
          rag(g, X, Y, Math.round(r * 0.55), b.sd + 7, k);
        } else {
          const f = (t - b.d) / (b.d * 0.7);
          const r = Math.round(b.R * (1 - Math.min(1, f)) * 0.9);
          if (r > 0) {
            g.fillStyle = f < 0.5 ? '#8E2A2E' : '#4A1F26';
            P.stats.drawCalls += 2 * r + 1;
            rag(g, X, Y, r, b.sd + ((t * 20) | 0), k);
          }
        }
      }
      stats.coreArea = limiter.frameArea();
    },

    /**
     * Cráteres (capa 2, en LOW): enteros hasta los 15 s y borrándose hasta los 20 s.
     * @param {any} P
     * @param {number} stepNow paso del sim con su parte fraccional (`scene.step + alpha`)
     */
    drawCraters(P, stepNow) {
      const g = P.ctx;
      for (let i = 0; i < craters.length; i++) {
        const c = craters[i];
        if (!P.visible(c.x, c.y, 30)) continue;
        const a = craterAlpha((stepNow - c.born) / 30);
        const ry = Math.max(2, Math.ceil(c.r * 0.5));
        g.globalAlpha = Math.max(0, a) * 0.85;
        g.fillStyle = '#3E3A44';
        ell(g, P.x(c.x), P.y(c.y + 1), c.r, ry, P.mul);
        g.fillStyle = '#1A1E22';
        ell(g, P.x(c.x), P.y(c.y), c.r - 1 > 0 ? c.r - 1 : c.r, Math.max(1, ry - 1), P.mul);
        P.stats.drawCalls += 2 * (ry * 2 + 1);
      }
      g.globalAlpha = 1;
    },

    // -------------------------------------------------------------------------------------------------------------
    // Restos y cráteres (reloj de juego)

    addWreck(e, step) {
      const w = wrecks.length >= FX_CAPS.wrecks ? wrecks.shift() : freeWrecks.pop();
      w.x = e.x;
      w.y = e.y;
      w.kind = e.kind;
      w.side = e.side;
      w.dir = e.side === 0 ? 1 : -1;
      w.born = step;
      w.fl = 0;
      wrecks.push(w);
      return w;
    },
    addCrater(x, y, r, step) {
      const c = craters.length >= FX_CAPS.craters ? craters.shift() : freeCraters.pop();
      c.x = Math.round(x);
      c.y = Math.round(y);
      c.r = r;
      c.born = step;
      craters.push(c);
      return c;
    },
    /** Quita lo que ya cumplió su vida (el objeto se recicla, no se descarta). */
    prune(step) {
      let k = 0;
      for (let i = 0; i < wrecks.length; i++) {
        const r = wrecks[i];
        const edad = (step - r.born) / 30;
        if (edad > (A_PIE.has(r.kind) ? LIFE.soldado : LIFE.vehiculo)) freeWrecks.push(r);
        else wrecks[k++] = r;
      }
      wrecks.length = k;
      k = 0;
      for (let i = 0; i < craters.length; i++) {
        if ((step - craters[i].born) / 30 > LIFE.crater) freeCraters.push(craters[i]);
        else craters[k++] = craters[i];
      }
      craters.length = k;
    },

    // -------------------------------------------------------------------------------------------------------------
    // Eventos del sim (la escena los entrega uno a uno, después de cada paso)

    /**
     * @param {any} e evento de `world.drain()`
     * @param {any} world solo lectura
     */
    consume(e, world) {
      switch (e.type) {
        case 'death':
          fx.addWreck(e, world.step);
          muerte(e);
          if (e.kind === 'jeep' || e.kind === 'blindado') fx.shake(1);
          else if (e.kind === 'tanque' || e.kind === 'lanzacohetes' || e.kind === 'lobo') fx.shake(2);
          else if (e.kind === 'pesado') fx.shake(3);
          break;
        case 'baseHit':
          if (e.dmg >= BASE_SHAKE_DMG) fx.shake(1);
          break;
        case 'turretDown': {
          const t = world.bases[e.side].turrets[e.k];
          fx.turretDown(e.side, e.k, t.x, t.y);
          break;
        }
        case 'hit':
          fx.spark(e.x, e.y - 6, 2, '#FFB347');
          break;
        case 'turretShot': {
          const t = world.bases[e.side].turrets[e.k];
          fx.muzzle('soldado', t.x, t.y - 7, e.side === 0 ? 1 : -1);
          break;
        }
        case 'bombImpact':
          // la alfombra suelta una bomba cada 40 px: sobre el vacío (hits 0) es un estallido pequeño y sin cráter; si
          // dañó unidades, mediano y con cráter. Un evento sin `hits` cuenta como ninguna unidad.
          if (e.hits > 0) {
            fx.boom(e.x, e.y, 'med', 2);
            fx.addCrater(e.x, e.y, 14, world.step);
          } else {
            fx.boom(e.x, e.y, 'small', 2);
          }
          break;
        default:
          break;
      }
    },

    /**
     * Avanza el reloj de vista `dt` segundos (0 en pausa).
     * @param {number} dt
     * @param {any} [world]
     */
    update(realDt, world) {
      let dt = Math.min(realDt, MAX_DT);
      if (slowLeft > 0) {
        slowLeft = Math.max(0, slowLeft - dt);
        if (politica.slowMotion) dt *= SLOW_FACTOR;
      }
      fx.now += dt;
      if (shakeMag > 0) {
        shakeMag *= Math.pow(0.002, dt);
        if (shakeMag < 0.4) shakeMag = 0;
      }
      for (let i = 0; i < later.length; i++) {
        const l = later[i];
        if (!l.on) continue;
        l.t -= dt;
        if (l.t > 0) continue;
        l.on = false;
        stats.secondary++;
        fx.boom(l.x, l.y + (rnd() - 0.5) * 6, l.size, 8);
      }
      for (const r of ruins) {
        if (!r.on) continue;
        r.left -= dt;
        r.acc += dt;
        while (r.acc >= 0.18) {
          r.acc -= 0.18;
          puff(r.x + (rnd() - 0.5) * 6, r.y - 6, 2, (rnd() - 0.5) * 4, -14, 1.1);
        }
        if (r.left <= 0) r.on = false;
      }
      for (const s of seqs) if (s) avanzarSecuencia(s, dt);
      if (world) {
        arden(dt, world);
        escape(dt, world);
        humoDeHangar(dt, world);
      }
      const f = Math.pow(0.985, dt * 60);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p.a) continue;
        if (p.d > 0) {
          p.d -= dt;
          continue;
        }
        p.l -= dt;
        if (p.l <= 0) {
          p.a = 0;
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.ty === T_SPARK) p.vy += p.g * dt;
        else if (p.ty === T_SMOKE || p.ty === T_DUST) {
          p.vx *= f;
          p.s += p.gr * dt;
        } else if (p.ty === T_DEBRIS) {
          p.vy += p.g * dt;
          p.r += p.vr * dt;
          if (p.y >= p.gy && p.vy > 0) {
            if (!p.b) {
              p.b = 1;
              p.vy *= -0.35;
              p.vx *= 0.6;
              p.y = p.gy;
              p.vr *= 0.5;
            } else {
              p.y = p.gy;
              p.vy = 0;
              p.vx *= 0.85;
              p.vr *= 0.5;
            }
          }
        }
      }
      for (let i = 0; i < booms.length; i++) {
        const b = booms[i];
        if (!b.a) continue;
        b.t += dt;
        if (b.t > b.d * 1.7) b.a = 0;
      }
    },
  };
  return fx;
}
