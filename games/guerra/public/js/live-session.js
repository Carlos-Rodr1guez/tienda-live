// Sesión de la transmisión en memoria (lote 5e; KIT-28, diseño D27). Une el registro del kit, el partido y el cliente de
// la copia (`@tienda/kit/client/session.js`, que solo usa `fetch`):
//   - al cargar, ANTES del primer evento, pide la copia al servidor local y la restaura: primero el progreso del partido
//     (`importProgress`, que fija el par y por tanto los equipos del registro) y después el registro (`importLive`, que
//     vuelve a sanear los nombres, recalcula los rangos y restaura los ocultos);
//   - mientras corre, detecta los cambios que van en la copia SIN temporizadores en el sim: el registro lleva un contador
//     de versión (puro, `registry.version()`) y el progreso del partido se compara campo a campo, una vez por cuadro;
//   - envía como mucho una vez por segundo con el reloj de vista (el que llega a `frame`) y un último intento en `pagehide`;
//   - `newLive` aceptado por el sim vacía la copia del servidor (DELETE).
// No usa reloj propio, ni temporizadores periódicos, ni almacenamiento del navegador: nada de nombres o rangos queda en
// el disco del perfil (NM-11). Los textos de F2 viven en `ui/strings.js` (`S.session`).

import { createSessionClient } from '@tienda/kit/client/session.js';
import { exportProgress, importProgress } from './sim/match.js';
import { S } from './ui/strings.js';

/** Las líneas de F2 cuando el servidor dice que no tiene sesión (no se arma nada ni se hace ningún pedido). */
export const sessionOffLines = () => [
  { key: 'session.status', label: S.session.statusLabel, value: S.session.off },
  { key: 'session.leftOut', label: S.session.leftOutLabel, value: '0' },
];

const igualesProgreso = (a, b) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.pair[0] === b.pair[0] &&
    a.pair[1] === b.pair[1] &&
    a.started === b.started &&
    a.wins[0] === b.wins[0] &&
    a.wins[1] === b.wins[1]);

/**
 * @param {{
 *   registry: ReturnType<typeof import('@tienda/kit/sim/registry.js').createRegistry>, match: any, fetch: typeof fetch,
 *   addEventListener?: (type: string, fn: () => void) => void, maxBytes?: number,
 *   setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout
 * }} o
 */
export function createLiveSession({
  registry,
  match,
  fetch,
  addEventListener,
  maxBytes,
  clockMs,
  setTimeout,
  clearTimeout,
}) {
  let versionVista = registry.version();
  let progresoVisto = exportProgress(match);
  /** Lo que pasó al cargar, para F2. */
  let info = { status: 'none', users: 0, dropped: 0, state: null };

  /** La copia completa: el registro más el progreso del partido, con el reloj de juego del momento. */
  const snapshot = () => ({ ...registry.exportLive(match.world.time), match: exportProgress(match) });

  /** Compara con lo último visto y levanta la marca de sucia. Barato: un entero y cuatro campos. */
  function detectar() {
    const v = registry.version();
    const p = exportProgress(match);
    if (v !== versionVista || !igualesProgreso(p, progresoVisto)) {
      versionVista = v;
      progresoVisto = p;
      client.markDirty();
    }
  }

  const client = createSessionClient({
    fetch,
    snapshot,
    // antes de que la página se vaya se mira si quedó algo sin detectar: el cuadro siguiente ya no va a llegar
    addEventListener: (type, fn) => addEventListener?.(type, type === 'pagehide' ? () => (detectar(), fn()) : fn),
    maxBytes,
    clockMs,
    setTimeout,
    clearTimeout,
  });

  // "Nuevo en vivo" (NM-2): si el sim lo acepta, el registro ya se reinició. Se vacía la copia del servidor y se anota la
  // versión nueva para que el reinicio no se vuelva a enviar como un cambio.
  const comando = match.command;
  match.command = (p) => {
    const r = comando(p);
    if (r?.ok === true && p?.type === 'newLive') {
      versionVista = registry.version();
      progresoVisto = exportProgress(match);
      client.clear();
    }
    return r;
  };

  return {
    client,

    /**
     * Pide la copia y la restaura. Llamar una sola vez, antes del primer evento y de elegir un par.
     * @returns {Promise<{status: string, users: number, dropped: number, state: string | null}>}
     */
    async restore() {
      const res = await client.load();
      info = { status: res.status, users: 0, dropped: 0, state: null };
      if (res.status === 'restored') {
        try {
          // el progreso primero: fija el par y con él los equipos del registro
          const prog = importProgress(match, res.copy.match);
          const reg = registry.importLive(res.copy);
          info = {
            status: 'restored',
            users: reg.users,
            dropped: reg.dropped,
            state: prog.ok ? prog.state : 'selector',
          };
        } catch {
          info = { status: 'invalid', users: 0, dropped: 0, state: null };
        }
      }
      // lo restaurado ya está en el servidor: no es un cambio
      versionVista = registry.version();
      progresoVisto = exportProgress(match);
      return info;
    },

    /** Una vez por cuadro, con el reloj de vista en segundos. Devuelve la promesa del PUT, o null si no envió. */
    frame(nowSeconds) {
      detectar();
      return client.tick(nowSeconds);
    },

    snapshot,

    /** Las dos líneas de F2: el estado de la sesión y cuántos usuarios quedaron fuera de la copia. */
    f2() {
      const s = client.state;
      let cargada;
      if (s.blocked)
        cargada = S.session.blocked; // la copia buena existe y la página ya arrancó de cero: no se pisa
      else if (s.gate === 'pending') cargada = `${S.session.failed} · ${S.session.retrying}`;
      else if (info.status === 'restored') cargada = S.session.restored(info.users, info.state, info.dropped);
      else if (info.status === 'failed')
        cargada = S.session.empty; // un reintento tardío dio 204 o un nuevo en vivo la vació
      else cargada = S.session[info.status] ?? S.session.none;
      const sinGuardar = s.stopped || s.gate !== 'open';
      const base = sinGuardar ? '' : S.session.saving[s.dirty && s.saving !== 'error' ? 'pending' : s.saving];
      const guardado = base && s.interval > 1 ? `${base} · ${S.session.every(s.interval)}` : base;
      const fuera = `${s.dropped}${s.droppedHidden > 0 ? S.session.hiddenLeftOut(s.droppedHidden) : ''}`;
      return [
        {
          key: 'session.status',
          label: S.session.statusLabel,
          value: guardado ? `${cargada} · ${guardado}` : cargada,
        },
        { key: 'session.leftOut', label: S.session.leftOutLabel, value: fuera },
      ];
    },
  };
}
