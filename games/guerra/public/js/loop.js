// Bucle de paso fijo del navegador (diseño D14): acumula el tiempo del cuadro y da pasos de 30 Hz con `advance`,
// como máximo 3 por cuadro (si no, la pantalla se congela en vez de ir lenta). `alpha` es lo que falta del paso
// siguiente, en [0, 1): la vista lo usa para interpolar entre el paso previo y el actual.

import { DT } from './sim/defaults.js';
import { advance } from './sim/replay.js';

/** @param {{step: () => void}} o `step` da un paso del partido (un tick) */
export function createLoop({ step }) {
  let acc = 0;
  return {
    /** @param {number} dt segundos del cuadro */
    frame(dt) {
      const r = advance(acc, dt);
      acc = r.acc;
      for (let i = 0; i < r.steps; i++) step();
      return { steps: r.steps, alpha: acc / DT };
    },
    get alpha() {
      return acc / DT;
    },
    /** Vacía el acumulador (al cambiar de pantalla o reanudar). */
    reset() {
      acc = 0;
    },
  };
}
