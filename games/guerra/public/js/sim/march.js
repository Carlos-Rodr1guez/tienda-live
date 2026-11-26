// Marcha individual (v2.6, D29, CB-21, CB-22). Sin grupos, anclas, calles ni roles: cada unidad es un estado
// (`phase`, `yg`, `seek`, `tgt`).
//
//  · `leg`: sale de la puerta y va a (puerta.x + dir·legX, yg): se abre en abanico hacia su camino (v2.7: uno de tres,
//    arriba, medio o abajo, por el número de salida; ver units.js `targetLane`).
//  · `march`: marcha recto por su camino y, en el último `converge.fraction` del ancho antes de su punto de parada, se cierra
//    hacia el CENTRO de la base enemiga (puerta.y + su desvío reescalado a la zona de asalto) hasta quedar a «alcance − 3» del frente. Solo ahí se ataca la base.
//  · `seek`: el blanco de VISIÓN (radio por tipo, escaneo escalonado cada `scanEvery` pasos, pegajoso). Si hay uno,
//    la unidad va hacia él hasta «alcance − 3»; si lo pierde o muere, retoma su destino.
//  · `tgt`: el blanco por ALCANCE (combat.js, cada paso). Si hay, la unidad se detiene a disparar, SALVO mientras siga
//    en el umbral de su propia puerta (field.js `inDoorZone`): ahí sigue su camino (`leg`) hasta salir y recién fuera se
//    frena. Así, en una base sitiada, los que salen a pelear no tapan las ranuras. Mientras sale dispara igual:
//    `fireAll` (combat.js) no depende de la velocidad, solo de `tgt`, la cadencia y de que mire al blanco.
//
// Dos pasadas por paso para que el resultado no dependa del orden de las unidades: primero se calcula la velocidad
// deseada de todas (con la separación de spacing.js, que lee las posiciones del inicio del paso) y después se integra.
// Sin azar: solo + − × ÷ y sqrt.

import { DT } from './defaults.js';
import { targetX } from './combat.js';
import { inDoorZone } from './field.js';
import { separation } from './spacing.js';
import { arriveVelocity, limitDelta, updateFacing } from './steer.js';

const enemyAlive = (o) => o.alive;

/** Suelta el blanco de visión si murió o quedó a más de `stickyKeep × visión`. Devuelve si lo soltó. */
function checkSeek(u, keep) {
  const s = u.seek;
  if (s === null) return false;
  if (!s.alive) {
    u.seek = null;
    return true;
  }
  const dx = s.x - u.x;
  const dy = s.y - u.y;
  const lim = keep * u.stats.vision;
  if (dx * dx + dy * dy > lim * lim) {
    u.seek = null;
    return true;
  }
  return false;
}

/** Busca el enemigo más cercano a la vista y lo toma si no tenía blanco o si está a ≤ `stickySwitch ×` el actual. */
function acquire(world, u, m) {
  const cand = world.grids[1 - u.side].nearest(u.x, u.y, u.stats.vision, enemyAlive);
  if (cand === null || cand === u.seek) return;
  if (u.seek === null) {
    u.seek = cand;
    return;
  }
  const cx = cand.x - u.x;
  const cy = cand.y - u.y;
  const sx = u.seek.x - u.x;
  const sy = u.seek.y - u.y;
  const k = m.stickySwitch;
  if (cx * cx + cy * cy <= k * k * (sx * sx + sy * sy)) u.seek = cand;
}

/**
 * Visión escalonada: cada unidad escanea cuando `(paso + id) % scanEvery === 0`. Conserva su blanco de visión
 * (pegajoso) y solo lo cambia por uno a ≤ `stickySwitch ×` la distancia al actual. Evita el zigzag.
 */
export function scanVision(world) {
  const m = world.cfg.movement;
  const step = world.step;
  for (const u of world.units) {
    if (!u.alive || (step + u.id) % m.scanEvery !== 0) continue;
    checkSeek(u, m.stickyKeep);
    acquire(world, u, m);
  }
}

/** Velocidad deseada de `u` en `u.dvx/dvy` (sin separación), con `vmax` como velocidad máxima. */
function desired(world, u, vmax, clearing, avanza) {
  const { field } = world;
  const m = world.cfg.movement;
  const st = u.stats;
  const dir = field.sides[u.side].dir;
  if (u.tgt !== null && !clearing && !avanza) {
    u.dvx = 0;
    u.dvy = 0;
    return;
  }
  if (u.seek !== null && !clearing && !avanza) {
    const dx = u.seek.x - u.x;
    const dy = u.seek.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= st.halt) {
      u.dvx = 0;
      u.dvy = 0;
      return;
    }
    const k = (d - st.halt) / d;
    const v = arriveVelocity(dx * k, dy * k, vmax, m.arrive);
    u.dvx = v.x;
    u.dvy = v.y;
    return;
  }
  if (u.phase === 'leg') {
    const tx = field.sides[u.side].door.x + dir * m.spread.legX;
    const dx = tx - u.x;
    if (dx * dir > 0) {
      const dy = u.yg - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      // rumbo constante hacia el punto de reparto: sin rampa de llegada, la unidad no frena al pasar
      u.dvx = (dx / d) * vmax;
      u.dvy = (dy / d) * vmax;
      return;
    }
    u.phase = 'march';
  }
  marchVelocity(field, m, u, dir, vmax);
}

/**
 * ¿Tiene que seguir avanzando aunque ya vea la base? Sí mientras no llegue a «alcance − 3» del frente: antes se frenaba
 * al primer contacto (a `alcance`) y quienes llegaban detrás atravesaban a los parados. Se probó una profundidad
 * distinta por unidad (varias filas) y empeoraba el solape de la zona, así que todos se plantan a la misma distancia.
 */
function avanzaHaciaBase(world, u) {
  if (u.tgtKind !== 'base') return false;
  const en = world.field.sides[1 - u.side];
  const dir = world.field.sides[u.side].dir;
  return (en.frontX - dir * u.stats.halt - u.x) * dir > 0.5;
}

/**
 * Fase `march`: velocidad deseada por el camino y el embudo final. La altura de la ruta es `yg` hasta que quedan
 * `converge.fraction × ancho` px de x para el punto de parada y de ahí baja (o sube) en línea recta hasta el centro de la
 * base enemiga (`puerta.y + yoff`). Se apunta `lookahead` px más adelante sobre esa ruta, así no queda a la zaga; la
 * rampa de llegada usa la distancia al punto final.
 */
function marchVelocity(field, m, u, dir, vmax) {
  const en = field.sides[1 - u.side];
  const tx = en.frontX - dir * u.stats.halt;
  const hw = m.lanes.halfWidth;
  const yf = en.door.y + (hw > 0 ? (u.yoff / hw) * m.assault.halfY * m.assault.spread : 0);
  const largo = m.converge.fraction * field.w;
  let xa = u.x + dir * m.converge.lookahead;
  if ((tx - xa) * dir < 0) xa = tx;
  const r = (tx - xa) * dir;
  const ya = r >= largo ? u.yg : u.yg + (yf - u.yg) * (1 - r / largo);
  const ex = xa - u.x;
  const ey = ya - u.y;
  const n = Math.sqrt(ex * ex + ey * ey);
  const fx = tx - u.x;
  const fy = yf - u.y;
  const f = Math.sqrt(fx * fx + fy * fy);
  if (n < 1e-9 || f < 1e-9) {
    u.dvx = 0;
    u.dvy = 0;
    return;
  }
  const s = Math.min(vmax, m.arrive * f) / n;
  u.dvx = ex * s;
  u.dvy = ey * s;
}

/** ¿Sigue la unidad a ≤ alcance − 2 de su blanco por alcance? (solo entonces la separación puede moverla) */
function inReach(u) {
  const lim = u.stats.range - 2;
  if (u.tgtKind === 'base') return Math.abs(u.tgt.frontX - u.x) <= lim;
  const dx = u.tgt.x - u.x;
  const dy = u.tgt.y - u.y;
  return dx * dx + dy * dy <= lim * lim;
}

/** Paso 13 (§7.2): visión, velocidad deseada con separación, aceleración acotada, suelo y orientación. */
export function stepMarch(world) {
  const { cfg, field, units } = world;
  const m = cfg.movement;
  const hold = Math.round(m.faceHoldSeconds / DT);
  const [g0, g1] = field.ground;
  const cap = m.jeepMarchCap;
  scanVision(world);
  // pasada 1: todos deciden con las posiciones del inicio del paso
  for (const u of units) {
    if (!u.alive) continue;
    if (u.pinned) {
      u.dvx = u.dvy = u.wx = u.wy = 0;
      continue;
    }
    // un blanco que se perdió o murió se reemplaza en el mismo paso, sin esperar el turno de escaneo
    if (checkSeek(u, m.stickyKeep)) acquire(world, u, m);
    let vmax = u.stats.speed;
    if (cap !== null && u.kind === 'jeep') vmax = Math.min(vmax, cap * world.stats.soldado.speed);
    // en el umbral de su puerta no frena por su blanco (ni se desvía a su blanco de visión): primero sale
    const sd = field.sides[u.side];
    const clearing = u.tgt !== null && inDoorZone(sd.door, sd.dir, u.stats.spacing, world.maxSpacing, u.x, u.y);
    const avanza = !clearing && avanzaHaciaBase(world, u);
    desired(world, u, vmax, clearing, avanza);
    let hx = u.dvx;
    let hy = u.dvy;
    const mag = Math.sqrt(hx * hx + hy * hy);
    if (mag > 1e-9) {
      hx /= mag;
      hy /= mag;
    } else {
      hx = field.sides[u.side].dir;
      hy = 0;
    }
    const stop = u.tgt !== null && !clearing && !avanza;
    if (stop && !inReach(u)) {
      u.wx = u.dvx;
      u.wy = u.dvy;
      continue;
    }
    const s = separation(world, u, hx, hy, stop);
    u.wx = u.dvx + s.x;
    u.wy = u.dvy + s.y;
  }
  // pasada 2: integración
  for (const u of units) {
    if (!u.alive) continue;
    const vmax = u.stats.speed;
    if (u.pinned) {
      // andamiaje de pruebas: la unidad no se mueve, pero sí mira a su blanco
      u.vx = 0;
      u.vy = 0;
      updateFacing(u, u.tgt === null ? null : targetX(u) - u.x, vmax, hold);
      continue;
    }
    const v = limitDelta(u.vx, u.vy, u.wx, u.wy, m.accel * vmax * DT);
    u.vx = v.x;
    u.vy = v.y;
    u.x += u.vx * DT;
    u.y += u.vy * DT;
    if (u.y < g0) {
      u.y = g0;
      u.vy = 0;
    } else if (u.y > g1) {
      u.y = g1;
      u.vy = 0;
    }
    // ninguna pasada de largo (v2.7): la cara del hangar enemigo es un tope duro (v2.8: ya no hay muralla, el tope es la cara
    // del hangar). Con la zona de asalto llena, el empuje de quienes llegan detrás podía sacar a los que disparan más allá
    const dir = field.sides[u.side].dir;
    const tope = field.sides[1 - u.side].hangar.faceX;
    if ((u.x - tope) * dir > 0) {
      u.x = tope;
      if (u.vx * dir > 0) u.vx = 0;
    }
    updateFacing(u, u.tgt === null ? null : targetX(u) - u.x, vmax, hold);
  }
}
