// Corrida del hash dorado en el navegador (CB-13 [M]): repite el log versionado de `data/golden.js` sobre un partido
// nuevo, con el mismo orden que `replayMatch` (en cada tick, primero las entradas de ese tick y después el paso), pero
// por partes, para que la página siga viva. Al terminar, `hash()` debe dar el valor versionado: el mismo en Node y
// en Chrome. F2 con `?golden` lo muestra.

import { createRegistry } from '@tienda/kit/sim/registry.js';
import { hashMatch } from './sim/hash.js';
import { createMatch } from './sim/match.js';

/**
 * @param {{log: {step: number, kind: string, payload: any}[], steps: number, paises: readonly any[], game?: object,
 *   onStep?: (m: any) => void}} o `onStep` se llama después de cada paso (la vista vacía ahí la bandeja de eventos)
 */
export function createGoldenRun({ log, steps, paises, game = {}, onStep }) {
  const registry = createRegistry({ teams: [paises[0], paises[1]] });
  const match = createMatch({ paises, game, registry });
  let i = 0;
  let tick = 0;
  return {
    match,
    get tick() {
      return tick;
    },
    steps,
    get done() {
      return tick >= steps;
    },
    /** Da hasta `n` ticks y devuelve cuántos dio. */
    advance(n) {
      let dados = 0;
      while (dados < n && tick < steps) {
        while (i < log.length && log[i].step <= tick) match.command(log[i++].payload);
        match.step();
        onStep?.(match);
        tick++;
        dados++;
      }
      return dados;
    },
    hash: () => hashMatch(match),
  };
}
