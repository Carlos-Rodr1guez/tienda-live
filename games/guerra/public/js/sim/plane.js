// Bombardero (diseño D16 y D31, R3, CB-9; v2.6 D-R3/D-R5). Vuela RECTO a velocidad constante: al lanzarlo se fija la
// `y` de su línea (el centro de la banda de 48 px con más fuerza enemiga) y desde ahí `vy` es 0 siempre. Suelta una
// alfombra: una bomba cada `bombSpacing` px de IMPACTO, desde que el impacto cae sobre el frente propio hasta el borde
// enemigo (34 con la config por defecto). El avión no tiene HP: nadie le apunta, no choca ni dispara, y las bombas
// nunca dañan a su equipo (`applyArea` solo mira lo del otro lado). Vuela a z 48 y cada bomba nace a z 44 y cae 14
// pasos (0,481 s con gravedad 380). Todo es función pura del estado: sin azar.

import { DT } from './defaults.js';
import { retire } from './credit.js';

/** Pasos que tarda una bomba en caer desde z 44 con gravedad 380: sqrt(2·44/380)/DT ≈ 14,4, redondeado a 14. */
export const FALL_STEPS = 14;

/** Holgura de coma flotante al comparar la x del avión con un punto de suelta (la x suma 4 px por paso). */
const EPS = 1e-6;

/** ¿Puede lanzarse otro avión de este lado ahora? ≤ 2 vivos y ≥ 1,5 s desde el lanzamiento anterior. */
export function canLaunchPlane(world, side) {
  const { cfg } = world;
  let vivos = 0;
  for (const p of world.planes) if (p.side === side) vivos++;
  if (vivos >= cfg.limits.maxPlanesPerTeam) return { ok: false, reason: 'cap' };
  if (world.step - world.lastLaunch[side] < Math.round(cfg.limits.planeGapSeconds / DT)) {
    return { ok: false, reason: 'gap' };
  }
  return { ok: true };
}

/**
 * La `y` de la línea de un avión del lado `side`: el centro de la banda de `plane.band` px (contadas desde el borde
 * superior del suelo) con más fuerza enemiga, o sea Σ c·hp/maxHp de las unidades vivas del otro lado. Empate (y sin
 * enemigos): la banda más cercana a la altura de la puerta, y a igual distancia la de arriba.
 * @returns {number}
 */
export function planeLine(world, side) {
  const { cfg, field } = world;
  const [g0, g1] = field.ground;
  const band = cfg.plane.band;
  const n = Math.max(1, Math.ceil((g1 - g0) / band));
  const fuerza = new Array(n).fill(0);
  for (const u of world.units) {
    if (u.side === side || !u.alive) continue;
    const i = Math.min(n - 1, Math.max(0, Math.floor((u.y - g0) / band)));
    fuerza[i] += u.stats.c * (u.hp / u.maxHp);
  }
  const door = field.sides[0].door.y;
  const centro = (i) => g0 + i * band + Math.min(band, g1 - (g0 + i * band)) / 2;
  let mejor = 0;
  for (let i = 1; i < n; i++) {
    if (fuerza[i] > fuerza[mejor]) mejor = i;
    else if (fuerza[i] === fuerza[mejor] && Math.abs(centro(i) - door) < Math.abs(centro(mejor) - door)) mejor = i;
  }
  return centro(mejor);
}

/**
 * Lanza un avión del lado `side`: entra por su borde a z 48 con `vx = ±120` y vuela por su línea hasta el borde
 * opuesto. `value` es lo que pagó su dueño. `bombsTotal` es N, las bombas de la pasada; `bombsLeft` baja con cada suelta.
 * @returns {{ok:true, plane:any} | {ok:false, reason:string}}
 */
export function launchPlane(world, side, owner = null, value = 0) {
  const can = canLaunchPlane(world, side);
  if (!can.ok) return can;
  const { cfg, field } = world;
  const dir = field.sides[side].dir;
  const frente = field.sides[side].frontX;
  const x = dir > 0 ? -cfg.plane.margin : field.w + cfg.plane.margin;
  const y = planeLine(world, side);
  // el impacto de la primera bomba cae sobre el frente propio; el del último punto, a lo más en el borde enemigo
  const tramo = dir > 0 ? field.w - frente : frente;
  const total = Math.floor(tramo / cfg.plane.bombSpacing + EPS) + 1;
  const caida = FALL_STEPS * DT * cfg.plane.speed;
  const plane = {
    id: ++world.nextId,
    side,
    owner,
    value,
    x,
    y,
    px: x,
    py: y,
    vx: dir * cfg.plane.speed,
    vy: 0,
    z: cfg.plane.altitude,
    launchStep: world.step,
    bombsLeft: total,
    bombsTotal: total,
    /** Índice de la próxima bomba y x de suelta de la primera (su impacto cae sobre el frente propio). */
    nextDrop: 0,
    dropX0: frente - dir * caida,
  };
  world.planes.push(plane);
  world.lastLaunch[side] = world.step;
  world.emit({ type: 'planeLaunch', id: plane.id, side });
  return { ok: true, plane };
}

/** Paso 10: avance, suelta de la alfombra y salida de cada avión. */
export function stepPlanes(world) {
  const { cfg, field } = world;
  const caida = FALL_STEPS * DT * cfg.plane.speed;
  let w = 0;
  for (let i = 0; i < world.planes.length; i++) {
    const p = world.planes[i];
    const dir = field.sides[p.side].dir;
    p.x += p.vx * DT;
    while (p.nextDrop < p.bombsTotal) {
      const dropX = p.dropX0 + dir * cfg.plane.bombSpacing * p.nextDrop;
      if ((p.x - dropX) * dir < -EPS) break;
      p.nextDrop++;
      p.bombsLeft--;
      world.bombs.push({
        id: ++world.nextId,
        side: p.side,
        owner: p.owner,
        x0: p.x,
        y0: p.y,
        tx: dropX + dir * caida,
        ty: p.y,
        dropStep: world.step,
        impactStep: world.step + FALL_STEPS,
      });
      world.emit({ type: 'bombDrop', x: p.x, y: p.y, side: p.side });
    }
    const out = dir > 0 ? field.w + cfg.plane.margin : -cfg.plane.margin;
    if ((p.x - out) * dir >= 0) {
      retire(world, p.value); // el avión salió ileso: su valor pasa a retirado y no da XP
      p.value = 0;
      world.emit({ type: 'planeOut', id: p.id, side: p.side });
      continue; // sale del mapa y se quita
    }
    world.planes[w++] = p;
  }
  world.planes.length = w;
}

/** Posición de una bomba en el paso `step` (función pura del estado): de donde se soltó al punto de impacto. */
export function bombPosition(bomb, step) {
  const t = Math.min(1, Math.max(0, (step - bomb.dropStep) / (bomb.impactStep - bomb.dropStep)));
  return { x: bomb.x0 + (bomb.tx - bomb.x0) * t, y: bomb.y0 + (bomb.ty - bomb.y0) * t };
}

/** Altura de una bomba en el paso `step` (función pura del estado): nace a `dropZ` y cae con la gravedad. */
export function bombZ(cfg, bomb, step) {
  const t = Math.max(0, step - bomb.dropStep) * DT;
  return Math.max(0, cfg.plane.dropZ - 0.5 * cfg.plane.gravity * t * t);
}
