// Qué hace cada acción del mapa de teclas (D25, NM-3). Recibe las dependencias por argumento (el partido, la cámara, el
// reloj…) y no toca el DOM ni el reloj de pared: `now` llega inyectado en ms. Todo lo que cambia es presentación (NM-2)
// salvo los comandos del partido, que solo salen cuando no hay un error de config ni la corrida del hash dorado.

import { createDouble } from './keys.js';
import { S } from './strings.js';

/** Cuánto duran el marcador y el top 3, y la ventana de las dos pulsaciones de Esc y de Shift+N (en ms). */
export const OVERLAY_MS = 6000;
export const CONFIRM_MS = 2000;

/**
 * @param {{
 *   now: () => number, match: any, camera: any, rig: any, advance: () => void,
 *   avisar: (texto: string, familia?: string, ms?: number) => void,
 *   motion: {toggle: () => boolean}, moderation: any, spotlight: any,
 *   view: {help: boolean, safe: boolean, f2: boolean, frame: boolean, scoreboardUntil: number, top3Until: number},
 *   onNewLive?: () => void, onMatchEnded?: () => void, sim: {toggle: () => void} | null, audio: {toggleMute: () => boolean} | null,
 *   blocked: () => boolean, golden?: boolean
 * }} d `blocked`: con un error de config o con `?golden` los comandos del partido no se envían
 */
export function createShortcuts(d) {
  const esc = createDouble(CONFIRM_MS);
  const nuevo = createDouble(CONFIRM_MS);
  const zoom = () => d.camera.cfg?.keyZoom ?? 1.25;
  const alternar = (campo) => {
    d.view[campo] = d.view[campo] > d.now() ? 0 : d.now() + OVERLAY_MS;
  };

  return {
    /**
     * @param {string} id acción de `ui/keys.js`
     * @param {{repeat?: boolean}} [e]
     * @returns {boolean} si la acción existe
     */
    run(id, e = {}) {
      switch (id) {
        case 'advance':
          if (!d.blocked()) d.advance();
          return true;
        case 'pause':
          if (!d.blocked()) d.match.command({ type: d.match.pause === 'manual' ? 'resume' : 'pause', by: 'manual' });
          return true;
        case 'endMatch':
          if (d.blocked() || d.match.state === 'matchup') return true;
          // la confirmación dura lo que su ventana (2 s) y el aviso de "terminado" la reemplaza
          if (esc.press(d.now()) === 'first') d.avisar(S.keys.endConfirm, 'esc', CONFIRM_MS);
          else if (d.match.command({ type: 'endMatch' }).ok) {
            d.avisar(S.keys.ended, 'esc');
            d.onMatchEnded?.();
          }
          return true;
        case 'newLive':
          if (d.blocked()) return true;
          if (d.match.state !== 'matchup') d.avisar(S.newLive.blocked, 'live');
          else if (nuevo.press(d.now()) === 'first') d.avisar(S.newLive.confirm, 'live', CONFIRM_MS);
          else if (d.match.command({ type: 'newLive', confirmed: true }).ok) {
            d.avisar(S.newLive.done, 'live');
            d.onNewLive?.();
          }
          return true;
        case 'scoreboard':
          alternar('scoreboardUntil');
          if (d.view.scoreboardUntil > 0) d.view.help = false; // la ayuda es exclusiva con G y T (D3)
          return true;
        case 'top3':
          alternar('top3Until');
          if (d.view.top3Until > 0) d.view.help = false;
          return true;
        case 'help':
          d.view.help = !d.view.help;
          if (d.view.help) {
            d.view.scoreboardUntil = 0;
            d.view.top3Until = 0;
          }
          return true;
        case 'safe':
          d.view.safe = !d.view.safe;
          return true;
        case 'perf':
          d.view.f2 = !d.view.f2;
          return true;
        case 'frame':
          d.view.frame = !d.view.frame;
          return true;
        case 'followNext':
          if (d.spotlight.next() === null) d.avisar(S.spotlight.none, 'follow');
          return true;
        case 'followStop':
          d.spotlight.stop();
          d.avisar(S.spotlight.stopped, 'follow');
          return true;
        case 'autoCam':
          d.avisar(d.camera.toggleAuto().notice, 'auto');
          return true;
        case 'viewAll':
          d.camera.viewAll();
          return true;
        case 'base1':
          d.camera.focusBase(0);
          return true;
        case 'base2':
          d.camera.focusBase(1);
          return true;
        case 'hottest':
          d.rig.hottest(d.match.world);
          return true;
        case 'zoomIn':
          d.camera.input('factor', { f: zoom() });
          return true;
        case 'zoomOut':
          d.camera.input('factor', { f: 1 / zoom() });
          return true;
        case 'reduced':
          if (!e.repeat) d.avisar(d.motion.toggle() ? S.motion.on : S.motion.off, 'motion');
          return true;
        case 'names':
          d.avisar(d.moderation.toggleNames() ? S.moderation.namesHidden : S.moderation.namesShown, 'names');
          return true;
        case 'undo':
          d.avisar(d.moderation.undo() === 'undone' ? S.moderation.undone : S.moderation.nothingToUndo, 'undo');
          return true;
        case 'mute':
          d.avisar(d.audio?.toggleMute() ? S.audio.off : S.audio.on, 'sound');
          return true;
        case 'sim':
          d.sim?.toggle();
          return true;
        default:
          return false;
      }
    },
  };
}
