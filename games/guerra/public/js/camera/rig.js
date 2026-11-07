// Conjunto de la cámara: controlador + calor de eventos + momentos de regalo grande. Es lo que `main.js` conecta al
// bucle. Solo LEE el mundo: los eventos llegan por el ÚNICO `world.drain()` por cuadro (el que reparte la escena) y
// nunca hay un segundo vaciado, ni `registry.drain()`.

import { createHeat, createMoments, simViewOf } from './auto.js';
import { resolveMoments, resolveView } from './config.js';
import { createCameraController } from './controller.js';

/**
 * @param {{
 *   canvas: {w: number, h: number}, view?: object, graphics?: object, motion: {reduced: boolean}
 * }} o `motion`: la política de movimiento reducido (`render/motion.js`)
 */
const AUTO_STATES = new Set(['battle', 'roundEnd', 'waitingNextRound', 'matchEnd']);
/**
 * ¿Puede correr la cámara automática en este estado del partido? Sí en la batalla y después de ella (fin de ronda,
 * espera del narrador y fin de partido): el mundo de la ronda sigue a la vista detrás de las tarjetas y el foco de la
 * base caída llega justo al terminar la ronda. No en el selector, la sala ni el `intro` (que ya hace el `viewAll`
 * instantáneo). Las demás condiciones (encendida, sin seguimiento, inactividad) las pone el controlador.
 * @param {string | undefined} state `match.state`
 */
export const autoRuns = (state) => AUTO_STATES.has(/** @type {string} */ (state));

export function createCameraRig({ canvas, view, graphics, motion }) {
  const cfg = resolveView(view);
  const controller = createCameraController({ canvas, view: cfg, reducedMotion: motion.reduced });
  const heat = createHeat();
  const moments = createMoments({ heat, ...resolveMoments(graphics) });
  const sv = {};
  /** Avisos de la cámara pendientes de mostrar (p. ej. "Cámara automática: desactivada" al activar `R`). */
  let notices = [];

  return {
    controller,
    heat,
    moments,
    cfg,
    /**
     * Eventos de UN paso del sim (lo que devolvió `world.drain()`): alimentan el calor y, con un avión, el momento.
     * @param {any[]} events
     * @param {any} world solo lectura
     */
    consume(events, world) {
      heat.consume(events, world);
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type !== 'planeLaunch') continue;
        const p = world.planes.find((q) => q.id === e.id);
        // el inicio de un bombardeo: un punto adelante en la ruta del avión
        if (p)
          moments.push(
            { kind: 'plane', x: p.x + p.vx * 1.2, y: p.y - p.z / 2, owner: p.owner ?? null },
            { step: world.step, reduced: motion.reduced },
          );
      }
    },
    /**
     * Gancho del adaptador del público (lote 6): un regalo con `coins` monedas. Si llega al umbral es un momento de
     * regalo grande (el banner siempre, y calor si la cámara automática puede usarlo); si no, `null`.
     * @param {{coins: number, x: number, y: number, owner?: string | null}} g posición de la unidad que aparece
     * @param {number} step paso del sim
     */
    bigGift(g, step) {
      return moments.gift(g, { step, reduced: motion.reduced });
    },
    /**
     * Un cuadro: sigue el movimiento reducido y avanza el controlador. La automática solo corre con `active` (batalla).
     * @param {number} dt segundos de reloj de vista
     * @param {any} world
     * @param {boolean} active
     */
    update(dt, world, active) {
      const aviso = controller.syncReduced(motion.reduced);
      if (aviso) notices.push(aviso);
      controller.update(dt, active && world ? simViewOf(world, heat, sv) : null);
    },
    /** Espacio: la pelea más caliente en este momento, una vez. */
    hottest(world) {
      controller.hottest(simViewOf(world, heat, sv));
    },
    /** Cada ronda empieza con el mapa entero, sin calor ni momentos viejos. */
    newRound() {
      controller.newRound();
      heat.reset();
      moments.reset();
    },
    drainNotices() {
      const out = notices;
      notices = [];
      return out;
    },
  };
}
