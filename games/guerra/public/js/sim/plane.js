// Avión y bombas (diseño D16, R3, CB-9). El avión no tiene HP: nadie le apunta, no choca ni dispara, y nunca daña a
// su equipo. Vuela a z 48 y cada bomba nace a z 44 y cae 14 pasos (0,481 s con gravedad 380). Posición y tiempo de
// caída son funciones puras del estado; sin azar (el blanco sale de la fuerza y del id).

import { DT } from './defaults.js';
import { retire } from './credit.js';
import { squadStrength } from './squads.js';

/** Pasos que tarda una bomba en caer desde z 44 con gravedad 380: sqrt(2·44/380)/DT ≈ 14,4, redondeado a 14. */
export const FALL_STEPS = 14;

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
 * Lanza un avión del lado `side`: entra por su borde a z 48 con `vx = ±120`. `value` es lo que pagó su dueño.
 * @returns {{ok:true, plane:any} | {ok:false, reason:string}}
 */
export function launchPlane(world, side, owner = null, value = 0) {
  const can = canLaunchPlane(world, side);
  if (!can.ok) return can;
  const { cfg, field } = world;
  const dir = field.sides[side].dir;
  const x = dir > 0 ? -cfg.plane.margin : field.w + cfg.plane.margin;
  const y = field.sides[0].gates[1];
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
    decided: false,
    bombsLeft: cfg.plane.bombs,
    targets: [],
  };
  world.planes.push(plane);
  world.lastLaunch[side] = world.step;
  world.emit({ type: 'planeLaunch', id: plane.id, side });
  return { ok: true, plane };
}

/** Blanco: el grupo enemigo salido de mayor fuerza en la mitad lejana; si no hay, el de mayor fuerza; si no, null. */
export function planeTargetSquad(world, p) {
  const dir = world.field.sides[p.side].dir;
  let best = null;
  let bestS = -1;
  let far = null;
  let farS = -1;
  for (const sq of world.squads) {
    if (sq.side === p.side || sq.members.length === 0 || sq.state === 'forming') continue;
    const s = squadStrength(sq);
    if (s > bestS) {
      best = sq;
      bestS = s;
    }
    if ((sq.anchor.x - world.field.midX) * dir > 0 && s > farS) {
      far = sq;
      farS = s;
    }
  }
  return far ?? best;
}

/** Decisión: hasta 5 puntos de impacto en el grupo (miembros por |y − y_avión| y por id) o en el frente enemigo. */
function decide(world, p) {
  const { cfg, field } = world;
  const dir = field.sides[p.side].dir;
  const n = cfg.plane.bombs;
  const pts = [];
  const sq = planeTargetSquad(world, p);
  if (sq !== null) {
    const order = sq.members.slice().sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y) || a.id - b.id);
    for (let i = 0; i < n && i < order.length; i++) pts.push({ x: order[i].x, y: order[i].y, member: order[i] });
    const extra = [16, -16, 32, -32];
    for (let i = 0; pts.length < n; i++) {
      const k = extra[i % extra.length];
      pts.push({ x: sq.anchor.x + k, y: sq.anchor.y, member: null });
    }
  } else {
    const fx = field.sides[1 - p.side].frontX;
    const ys = [-32, -16, 0, 16, 32];
    for (let i = 0; i < n; i++) pts.push({ x: fx, y: p.y + ys[i % ys.length], member: null });
  }
  const fall = FALL_STEPS * DT * cfg.plane.speed;
  for (const t of pts) {
    t.dropX = t.x - dir * fall;
    t.dropped = false;
  }
  // se sueltan en el orden en que el avión pasa por su punto de suelta
  pts.sort((a, b) => (a.dropX - b.dropX) * dir);
  p.targets = pts;
  p.decided = true;
  p.vy = 0;
}

/** Paso 10: rumbo, decisión, suelta y salida de cada avión. */
export function stepPlanes(world) {
  const { cfg, field } = world;
  const steerEvery = Math.round(cfg.plane.steerEvery / DT);
  let w = 0;
  for (let i = 0; i < world.planes.length; i++) {
    const p = world.planes[i];
    const dir = field.sides[p.side].dir;
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    const decisionX = field.midX - dir * cfg.plane.decisionOffset;
    if (!p.decided) {
      if ((p.x - decisionX) * dir >= 0) {
        decide(world, p);
      } else if ((world.step - p.launchStep) % steerEvery === 0) {
        const sq = planeTargetSquad(world, p);
        const ty = sq !== null ? sq.anchor.y : field.sides[0].gates[1];
        const v = (ty - p.y) / cfg.plane.steerEvery;
        p.vy = Math.max(-cfg.plane.steerSpeed, Math.min(cfg.plane.steerSpeed, v));
      }
    }
    if (p.decided) {
      for (const t of p.targets) {
        if (t.dropped || (p.x - t.dropX) * dir < 0) continue;
        t.dropped = true;
        p.bombsLeft--;
        const tx = t.member !== null && t.member.alive ? t.member.x : t.x;
        const ty = t.member !== null && t.member.alive ? t.member.y : t.y;
        world.bombs.push({
          id: ++world.nextId,
          side: p.side,
          owner: p.owner,
          x0: p.x,
          y0: p.y,
          tx,
          ty,
          dropStep: world.step,
          impactStep: world.step + FALL_STEPS,
        });
        world.emit({ type: 'bombDrop', x: p.x, y: p.y, side: p.side });
      }
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
