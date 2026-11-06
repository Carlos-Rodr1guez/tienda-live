// Repetición y bucle de paso fijo (diseño D14). El log guarda `{step, kind: 'evt' | 'cmd', payload}` en memoria
// (anillo de 20 000, nunca a disco); `replayLog` lo repite sobre un mundo nuevo. `advance` es la parte pura del
// bucle del navegador: el estado de reglas depende solo de cuántos pasos se dieron, no de los cuadros.

import { createRegistry } from '@tienda/kit/sim/registry.js';
import { DT } from './defaults.js';
import { createMatch } from './match.js';
import { applyEvent, createWorld, stepWorld } from './world.js';

/** Máximo de pasos simulados por cuadro (si no, la pantalla se congela en lugar de ir lenta). */
export const MAX_STEPS_PER_FRAME = 3;

/**
 * Acumulador del bucle: suma el tiempo del cuadro (con tope de 0,1 s) y devuelve cuántos pasos dar.
 * Al llegar al máximo de pasos del cuadro, el resto se descarta salvo un paso.
 * @param {number} acc acumulador en segundos
 * @param {number} frameDt tiempo del cuadro en segundos
 * @param {number} [maxSteps]
 * @returns {{steps: number, acc: number}}
 */
export function advance(acc, frameDt, maxSteps = MAX_STEPS_PER_FRAME) {
  acc += Math.min(frameDt, 0.1);
  let steps = 0;
  while (acc >= DT && steps < maxSteps) {
    steps++;
    acc -= DT;
  }
  if (steps === maxSteps) acc = Math.min(acc, DT);
  return { steps, acc };
}

/**
 * Registro de eventos y comandos en un anillo de tamaño fijo.
 * @param {number} [capacity]
 */
export function createRecorder(capacity = 20000) {
  const ring = new Array(capacity);
  let count = 0;
  return {
    record(step, kind, payload) {
      ring[count % capacity] = { step, kind, payload };
      count++;
    },
    get length() {
      return Math.min(count, capacity);
    },
    /** Las entradas en orden de llegada (las más viejas se pierden al pasar la capacidad). */
    entries() {
      const n = Math.min(count, capacity);
      const out = [];
      for (let i = count - n; i < count; i++) out.push(ring[i % capacity]);
      return out;
    },
  };
}

/**
 * Repite un log sobre un mundo nuevo: en cada paso aplica primero las entradas de ese paso (en el orden del log)
 * y después da el paso.
 * @param {{step:number, kind:string, payload:any}[]} log
 * @param {{steps: number, game?: object, onStep?: (w:any)=>void}} o
 */
export function replayLog(log, { steps, game = {}, onStep }) {
  const w = createWorld(game);
  let i = 0;
  for (let s = 0; s < steps; s++) {
    while (i < log.length && log[i].step <= s) {
      applyEvent(w, log[i].payload);
      i++;
    }
    stepWorld(w);
    if (onStep) onStep(w);
  }
  return w;
}

/**
 * Repite un log de PARTIDO sobre un partido nuevo con su registro: en cada tick del log aplica primero las entradas de
 * ese tick (comandos del narrador y eventos de la audiencia, en el orden del log) y después da el paso. El tick es el
 * reloj del log (`match.tick`): sigue corriendo en la pausa y en las pantallas, mientras el reloj de juego se detiene.
 * @param {{step:number, kind:string, payload:any}[]} log
 * @param {{steps: number, paises: readonly any[], game?: object, onStep?: (m:any)=>void}} o
 */
export function replayMatch(log, { steps, paises, game = {}, onStep }) {
  const registry = createRegistry({ teams: [paises[0], paises[1]] });
  const m = createMatch({ paises, game, registry });
  let i = 0;
  for (let s = 0; s < steps; s++) {
    while (i < log.length && log[i].step <= s) {
      m.command(log[i].payload);
      i++;
    }
    m.step();
    if (onStep) onStep(m);
  }
  return m;
}
