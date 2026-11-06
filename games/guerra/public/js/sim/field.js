// Geometría del campo (diseño §7.1, CB-15, CB-3). Todo sale de las medidas del prototipo v3 aprobado por el
// dueño; los tests y el comandante leen el descriptor, nunca constantes sueltas. Solo aritmética exacta.

import { clampNumber } from '@tienda/kit/sim/config.js';

/** Calles de ataque de cada corredor: índice en `subLanes` (desplazamientos [0, -40, +40]). */
export const ATTACK_LANES = Object.freeze({ centro: 0, jeep: 1, bajo: 2 });

/** Distancia de la puerta de armado a la salida de la base, por tipo (`ASMX` del v3). */
const GATE_DX = Object.freeze({ soldado: 44, jeep: 58, tanque: 62, pesado: 66 });

const FRONT = 108; // distancia del frente de cada base al borde del mundo (`BASEF` del v3)
const EXIT = 124; // salida de las unidades (`SPX` del v3)
const TURRET_INSET = 100; // x de las torretas medida desde su borde
const CENTERS = [242, 448, 655]; // centro de cada corredor (`TURY` del v3)
const SUB_LANES = [0, -40, 40]; // `SUBY` del v3
const POST_LANES = { A: -80, B: 80 }; // `POSTDY` del v3
const GROUND = [138, 758];
const ZONE_RATIO = 0.3;

/**
 * @param {0|1} side lado 0 = izquierda, 1 = derecha
 * @returns {1|-1}
 */
export const sideDir = (side) => (side === 0 ? 1 : -1);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/**
 * Descriptor del mapa. Congelado: lo leen el sim, la vista y las pruebas.
 * @param {{world:{w:number,h:number}, commander:{postFirst:number,postGap:number,postRows:number}}} cfg
 */
export function createField(cfg) {
  const w = clampNumber(cfg.world.w, 1, 100000, 1440);
  const h = clampNumber(cfg.world.h, 1, 100000, 810);
  const frontR = w - FRONT;
  const zone = Math.round((frontR - FRONT) * ZONE_RATIO);
  const edges = [(CENTERS[0] + CENTERS[1]) / 2, (CENTERS[1] + CENTERS[2]) / 2];
  const { postFirst, postGap, postRows } = cfg.commander;

  const side = (n) => {
    const dir = sideDir(/** @type {0|1} */ (n));
    const frontX = n === 0 ? FRONT : frontR;
    const exitX = n === 0 ? EXIT : w - EXIT;
    const gateX = {};
    for (const k of Object.keys(GATE_DX)) gateX[k] = exitX + dir * GATE_DX[k];
    // índice 0 = el puesto más adelantado: `frontX ± (postFirst + postGap·j)` con j = filas - 1 - índice
    const postX = [];
    for (let i = 0; i < postRows; i++) postX.push(frontX + dir * (postFirst + postGap * (postRows - 1 - i)));
    const sectors = CENTERS.map((y) => ({
      y,
      posts: {
        A: postX.map((x) => ({ x, y: y + POST_LANES.A })),
        B: postX.map((x) => ({ x, y: y + POST_LANES.B })),
      },
    }));
    return {
      side: n === 0 ? 'left' : 'right',
      dir,
      frontX,
      exitX,
      gateX,
      gates: [...CENTERS],
      subLanes: [...SUB_LANES],
      postLanes: { ...POST_LANES },
      defenseZone: n === 0 ? [frontX, frontX + zone] : [frontX - zone, frontX],
      sectors,
      turrets: CENTERS.map((y) => ({ x: n === 0 ? TURRET_INSET : w - TURRET_INSET, y })),
      art: n === 0 ? 'base-fortin' : 'base-ciudadela',
      box: n === 0 ? [0, 112, 110, 669] : [w - 110, 112, 110, 669],
    };
  };

  return deepFreeze({
    aspect: '16:9',
    w,
    h,
    ground: [...GROUND],
    corridors: [
      [GROUND[0], edges[0]],
      [edges[0], edges[1]],
      [edges[1], GROUND[1]],
    ],
    midX: (FRONT + frontR) / 2,
    sides: [side(0), side(1)],
  });
}

/** Corredor (0 arriba, 1 medio, 2 abajo) de una altura. Fuera del suelo, el más cercano. */
export function corridorOf(field, y) {
  if (y < field.corridors[1][0]) return 0;
  if (y < field.corridors[2][0]) return 1;
  return 2;
}

/** Altura de una calle de ataque (`laneIdx` de `ATTACK_LANES`) en un corredor. */
export function laneY(field, corridor, laneIdx) {
  return field.sides[0].gates[corridor] + field.sides[0].subLanes[laneIdx];
}
