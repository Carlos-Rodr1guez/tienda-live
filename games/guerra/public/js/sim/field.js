// Geometría del campo (diseño §7.1, CB-15, CB-3). Todo sale de las medidas del prototipo v3 aprobado por el
// dueño; los tests y el sim leen el descriptor, nunca constantes sueltas. Desde v2.6 cada lado tiene UNA puerta de
// salida con cinco ranuras (D30); no hay corredores, calles, puestos, sectores ni zona de defensa. Solo aritmética
// exacta.

import { clampNumber } from '@tienda/kit/sim/config.js';

const FRONT = 90; // v2.8: distancia de la CARA del hangar al borde del mundo (era 108, el frente de la muralla)
const HANGAR_X0 = 14; // el hangar ocupa de x 14 a la cara (76 px de fondo): el cuartel de antes, agrandado
const EXIT = 124; // salida de las unidades (`SPX` del v3)
const TURRET_INSET = 100; // x de las torretas medida desde su borde
const TURRET_Y = [242, 448, 655]; // altura de cada torreta (`TURY` del v3)
const GROUND = [138, 758];

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
 * Desplazamientos (en y) de las ranuras de la puerta para un tipo de espaciado `spacing`: los múltiplos `door.slots`
 * del paso `d = máx(slotMin, slotStep × spacing)` (soldado 9, jeep 10, tanque 14, pesado 19). Sigue siendo UNA puerta.
 * @param {{slots:number[], slotMin:number, slotStep:number}} door
 * @param {number} spacing
 * @returns {number[]}
 */
export function doorOffsets(door, spacing) {
  const d = Math.max(door.slotMin, door.slotStep * spacing);
  return door.slots.map((k) => k * d);
}

/** Zona de no cruce al salir (× el espaciado del par): un amigo a menos de CRUCE_X en x y CRUCE_Y en y tapa la ranura. */
export const CRUCE_X = 0.7;
export const CRUCE_Y = 1.2;

/**
 * Umbral de la puerta: ¿está (x, y) donde un amigo de espaciado `ownSpacing` todavía taparía alguna ranura de CUALQUIER
 * tipo? Mismo criterio que `ranuraLibre` (queue.js), con el tipo más grande (`maxSpacing`) como el que sale:
 *  · par = (ownSpacing + maxSpacing) / 2;
 *  · en x, tapa por distancia libre (`freeFactor × par`) o por cruce (`CRUCE_X × par`): semiancho máx(freeFactor, CRUCE_X) × par;
 *  · en y, las ranuras llegan a máx(|slots|) × d(maxSpacing) del centro de la puerta (±38 con los valores por defecto) y
 *    a eso se suma el mayor alcance vertical, máx(freeFactor, CRUCE_Y) × par.
 * Es un rectángulo (cota superior del círculo de libre y de la caja de cruce): fuera de él ningún amigo puede tapar.
 * @param {{x:number, y:number, slots:number[], slotMin:number, slotStep:number, freeFactor:number}} door
 * @param {1|-1} dir
 */
export function inDoorZone(door, dir, ownSpacing, maxSpacing, x, y) {
  const par = (ownSpacing + maxSpacing) / 2;
  const ex = Math.max(door.freeFactor, CRUCE_X) * par;
  let mult = 0;
  for (const k of door.slots) mult = Math.max(mult, Math.abs(k));
  const ey = mult * Math.max(door.slotMin, door.slotStep * maxSpacing) + Math.max(door.freeFactor, CRUCE_Y) * par;
  const dx = (x - door.x) * dir;
  return dx <= ex && dx >= -ex && y - door.y <= ey && door.y - y <= ey;
}

/**
 * Zona de asalto (v2.7): ¿está la altura `y` en el tramo central del frente enemigo, a `halfY` px de la puerta? Solo ahí
 * se ataca la base y se toma de blanco la torreta central; las torretas de arriba y de abajo quedan fuera.
 * @param {{y:number}} door puerta del lado ATACADO (su y es la del centro de la base)
 * @param {number} halfY
 * @param {number} y
 */
export const inAssaultZone = (door, halfY, y) => y - door.y <= halfY && door.y - y <= halfY;

/**
 * ¿Toca el círculo (tx, ty, radio) el rectángulo del hangar? Distancia del centro al punto más cercano del rectángulo:
 * una esquina cuenta por distancia, no por caja. Se usa el de `<=`: un golpe a exactamente `radio` lo toca.
 * @param {{x0:number, x1:number, y0:number, y1:number}} h
 */
export function circleHitsHangar(h, tx, ty, radius) {
  const dx = Math.max(h.x0 - tx, 0, tx - h.x1);
  const dy = Math.max(h.y0 - ty, 0, ty - h.y1);
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * ¿Está la unidad en (x, y) a `range` de la cara del hangar y en su franja de y? Solo desde ahí se le dispara: se ataca el
 * hangar, no una línea, y quien llega por otra altura sigue hasta el centro.
 * @param {{y0:number, y1:number, faceX:number}} h
 */
export const canAttackHangar = (h, x, y, range) => Math.abs(h.faceX - x) <= range && y >= h.y0 && y <= h.y1;

/**
 * Descriptor del mapa. Congelado: lo leen el sim, la vista y las pruebas.
 * @param {{world:{w:number,h:number}, movement:{door:{y:number, slots:number[], slotMin:number, slotStep:number, freeFactor:number}, assault:{halfY:number}}}} cfg
 */
export function createField(cfg) {
  const w = clampNumber(cfg.world.w, 1, 100000, 1440);
  const h = clampNumber(cfg.world.h, 1, 100000, 810);
  const frontR = w - FRONT;
  const { y: doorY, slots, slotMin, slotStep, freeFactor } = cfg.movement.door;
  const halfY = cfg.movement.assault.halfY;

  const side = (n) => {
    const dir = sideDir(/** @type {0|1} */ (n));
    const frontX = n === 0 ? FRONT : frontR;
    const exitX = n === 0 ? EXIT : w - EXIT;
    // Hangar (v2.8): el objetivo final de cada bando, sin muralla. Su alto es el de la zona de asalto (puerta.y ± halfY) y
    // su cara frontal es el frente: tope duro de las unidades y punto de impacto de lo que se le dispara.
    const hangar = {
      x0: n === 0 ? HANGAR_X0 : w - FRONT,
      x1: n === 0 ? FRONT : w - HANGAR_X0,
      y0: doorY - halfY,
      y1: doorY + halfY,
      faceX: frontX,
    };
    return {
      side: n === 0 ? 'left' : 'right',
      dir,
      frontX,
      hangar,
      exitX,
      door: { x: exitX, y: doorY, slots: [...slots], slotMin, slotStep, freeFactor },
      turrets: TURRET_Y.map((y) => ({ x: n === 0 ? TURRET_INSET : w - TURRET_INSET, y })),
      art: n === 0 ? 'base-fortin' : 'base-ciudadela',
      box: n === 0 ? [0, 112, 110, 669] : [w - 110, 112, 110, 669],
    };
  };

  return deepFreeze({
    aspect: '16:9',
    w,
    h,
    ground: [...GROUND],
    midX: (FRONT + frontR) / 2,
    sides: [side(0), side(1)],
  });
}
