// Modelos de vista de las pantallas (CB-17, KIT-24, KIT-25, NM-1, NM-9; diseño §10.2): el selector, la sala, el fin de
// ronda, el fin de partido, la pausa y el error. PUROS: leen el partido y el registro y devuelven datos con el mismo
// texto y los mismos valores con y sin movimiento (CB-20). Ninguna pantalla depende del reloj: diez minutos sin acción
// la dejan igual (NM-1), y cada una trae su acción de avance (`advance`) para teclado y puntero. Los nombres ya vienen
// enmascarados por el registro (`displayName`: "anónimo" si está oculto o con `N`); el dibujo los recorta por ancho.

import { DEFAULT_LADDER } from '@tienda/kit/sim/ranks.js';
import { topUsers } from '@tienda/kit/sim/podium.js';
import { describePair } from '../sim/matchup.js';
import { S } from './strings.js';

/** Cuántos miembros de cada equipo muestra la sala. */
export const LOBBY_MEMBERS = 6;
/** Filas del podio por país. */
export const PODIUM_ROWS = 3;

const rankLabel = (ladder, i) => ladder[Math.min(Math.max(0, Math.trunc(i) || 0), ladder.length - 1)].label;

/**
 * Selector de pares: dos listas, vista previa y "Elegir el par". Cuatro estados: cargando (`paises` null), vacío, error y normal.
 * @param {{paises: readonly any[] | null, left?: string | null, right?: string | null, focus?: string | null,
 *   error?: string | null}} i
 */
export function matchupModel({ paises, left = null, right = null, focus = null, focusCol, error = null }) {
  const sinLista = {
    kind: 'matchup',
    title: S.matchup.title,
    columns: [],
    preview: null,
    start: { text: S.matchup.start, disabled: true, hint: S.matchup.needTwo },
  };
  if (error) return { ...sinLista, state: 'error', message: S.errors.data(error), exit: S.errors.dataExit };
  if (paises === null || paises === undefined) return { ...sinLista, state: 'loading', message: S.matchup.loading };
  if (paises.length === 0) return { ...sinLista, state: 'empty', message: S.matchup.empty };
  // el foco de teclado se ve en UNA lista (`focusCol`: 0 izquierda, 1 derecha); sin `focusCol` (como en 6a) en las dos
  const lista = (id, col) =>
    paises.map((p) => ({
      id: p.id,
      name: p.name,
      selected: p.id === id,
      focused: p.id === focus && (focusCol === undefined || focusCol === col),
    }));
  const par = left && right ? describePair(paises, left, right) : { ok: false };
  const preview = par.ok
    ? {
        text: S.matchup.preview(par.teams[0].name, par.teams[1].name),
        teams: par.teams.map((t) => ({
          name: t.name,
          color: t.color,
          chip: t.chip,
          pennant: t.pennant,
          silhouette: t.art === 'base-ciudadela' ? S.matchup.citadel : S.matchup.fort,
        })),
      }
    : null;
  return {
    kind: 'matchup',
    state: 'normal',
    title: S.matchup.title,
    columns: [
      { title: S.matchup.left, rows: lista(left, 0) },
      { title: S.matchup.right, rows: lista(right, 1) },
    ],
    preview,
    start: {
      text: S.matchup.start,
      disabled: preview === null,
      // sin pista aparte: el botón ya dice la acción; solo queda el aviso de que faltan países
      hint: preview === null ? S.matchup.needTwo : null,
    },
  };
}

/** Los `n` mejores del equipo por XP de partido y luego clave, sin ordenar a todos (O(usuarios · n)). */
function primeros(registry, team, n) {
  const top = [];
  let total = 0;
  for (const u of registry.users()) {
    if (u.team !== team) continue;
    total++;
    const item = { key: u.key, xp: u.xp.match };
    let i = top.length;
    while (i > 0 && (top[i - 1].xp < item.xp || (top[i - 1].xp === item.xp && top[i - 1].key > item.key))) i--;
    if (i < n) {
      top.splice(i, 0, item);
      if (top.length > n) top.pop();
    }
  }
  return { total, names: top.map((t) => registry.displayName(t.key)) };
}

/** Sala: "{A} vs {B}", cómo unirse y los miembros de cada equipo (vacía: "Nadie se unió todavía"). */
export function lobbyModel({ match, registry }) {
  const [a, b] = match.pair.teams;
  const teams = match.pair.teams.map((t, side) => {
    const r = registry ? primeros(registry, side + 1, LOBBY_MEMBERS) : { total: 0, names: [] };
    return {
      name: t.name,
      color: t.color,
      count: r.total,
      members: r.names,
      more: Math.max(0, r.total - r.names.length),
    };
  });
  return {
    kind: 'lobby',
    versus: S.lobby.versus(a.name, b.name),
    join: S.lobby.join(a.name, b.name),
    empty: teams.every((t) => t.count === 0) ? S.lobby.empty : null,
    teams,
    start: S.lobby.start,
  };
}

/**
 * Quién ganó la ronda que acaba de terminar EN ESTA PÁGINA: el último resultado. Tras recargar no hay resultado (la ronda
 * se cortó) y no se inventa uno. `decideRound` nunca deja empate (el último desempate es el equipo izquierdo), así que
 * no hay texto de empate.
 */
function ganadorDeRonda(match) {
  const last = match.results?.at(-1);
  return last && (last.winner === 0 || last.winner === 1) ? last.winner : null;
}

/**
 * Fin de ronda: ganador, tarjeta MVP por país (se omite si es null) y el aviso para seguir. Ordena a los usuarios UNA vez
 * (el orden por XP, monedas, valor, `firstXpAt` y clave de `rankUsers`) y toma el primero de cada equipo. Sin resultado
 * de ronda en esta página (recarga) no hay título ni tarjetas: solo el aviso.
 */
export function roundEndModel({ match, registry, ladder = DEFAULT_LADDER }) {
  const g = ganadorDeRonda(match);
  const teams = match.pair.teams;
  const mvps = [];
  if (registry && g !== null) {
    teams.forEach((t, side) => {
      // el mejor de cada equipo en UNA pasada por los usuarios (no se ordena a todos)
      const [m] = topUsers(registry, 'round', 1, { team: side + 1 });
      if (m)
        mvps.push({
          team: side,
          color: t.color,
          title: S.roundEnd.mvp(t.name),
          name: m.name,
          rank: rankLabel(ladder, m.rank),
          xp: S.roundEnd.xp(m.xp),
        });
    });
  }
  return {
    kind: 'roundEnd',
    title: g === null ? null : S.roundEnd.win(teams[g].name),
    winner: g,
    mvps,
    next: S.roundEnd.next,
  };
}

/** Fin de partido: ganador, MVP del partido y el podio de cada país, con UNA sola ordenación de los usuarios. */
export function matchEndModel({ match, registry, ladder = DEFAULT_LADDER }) {
  const teams = match.pair.teams;
  const best = registry ? (topUsers(registry, 'match', 1)[0] ?? null) : null;
  const entry = (e) => ({ key: e.key, name: e.name, rank: rankLabel(ladder, e.rank), xp: S.matchEnd.xp(e.xp) });
  const columns = teams.map((t, side) => {
    const rows = registry ? topUsers(registry, 'match', PODIUM_ROWS, { team: side + 1 }) : [];
    return {
      title: S.matchEnd.best(t.name),
      color: t.color,
      rows: rows.map((e) => ({ ...entry(e), highlight: best !== null && e.key === best.key })),
      empty: rows.length === 0 ? S.matchEnd.empty : null,
    };
  });
  return {
    kind: 'matchEnd',
    title: S.matchEnd.win(teams[match.winner === 1 ? 1 : 0].name),
    winner: match.winner,
    mvp: best ? { title: S.matchEnd.mvp, ...entry(best), team: best.team === null ? null : best.team - 1 } : null,
    columns,
    back: S.matchEnd.back,
  };
}

/** Pausa (NM-9): el texto exacto, solo mientras hay pausa. */
export function pauseModel(match) {
  return match.pause === null ? { visible: false, text: S.pause } : { visible: true, text: S.pause };
}

/** Pantalla de error: qué falló y cómo salir. @param {{kind?: string, detail?: unknown}} [e] */
export function errorModel(e) {
  const config = e?.kind === 'config';
  return {
    kind: 'error',
    title: S.errors.title,
    detail: config ? S.errors.config(e?.detail) : S.errors.data(e?.detail),
    exit: config ? S.errors.configExit : S.errors.dataExit,
  };
}

/**
 * La pantalla que toca según el estado del partido, con su acción de avance (teclado `Enter` y puntero). Las pantallas
 * de la batalla (`intro`, `battle`) no llevan tarjeta: `kind: null`.
 * @param {any} match
 * @param {{registry: any | null, paises: readonly any[] | null, selection?: {left?: string | null, right?: string | null,
 *   focus?: string | null}, error?: {kind?: string, detail?: unknown} | null, ladder?: any}} ctx
 */
export function screenFor(match, ctx) {
  const pantalla = construir(match, ctx);
  // en pausa (NM-9) Enter y el botón de avance no hacen nada y el botón no se muestra: P reanuda
  return match.pause !== null && pantalla.advance !== null ? { ...pantalla, advance: null } : pantalla;
}

function construir(match, ctx) {
  const { registry, paises, selection = {}, error = null, ladder } = ctx;
  if (error) return { kind: 'error', model: errorModel(error), advance: null };
  switch (match.state) {
    case 'matchup': {
      const model = matchupModel({ paises, ...selection });
      return {
        kind: 'matchup',
        model,
        advance: { key: 'Enter', text: S.matchup.start, disabled: model.start.disabled },
      };
    }
    case 'lobby':
      return {
        kind: 'lobby',
        model: lobbyModel({ match, registry }),
        advance: { key: 'Enter', text: S.lobby.start, disabled: false },
      };
    case 'roundEnd':
      return { kind: 'roundEnd', model: roundEndModel({ match, registry, ladder }), advance: null };
    case 'waitingNextRound':
      return {
        kind: 'roundEnd',
        model: roundEndModel({ match, registry, ladder }),
        advance: { key: 'Enter', text: S.roundEnd.next, disabled: false },
      };
    case 'matchEnd':
      return {
        kind: 'matchEnd',
        model: matchEndModel({ match, registry, ladder }),
        advance: { key: 'Enter', text: S.matchEnd.back, disabled: false },
      };
    default:
      return { kind: null, model: null, advance: null };
  }
}

/**
 * Caché de la pantalla. Las de resultados (`roundEnd`, `waitingNextRound`, `matchEnd`) son una FOTO: se arman al entrar al
 * estado (o al cambiar la ronda, las victorias, el resultado o la pausa) y no con cada regalo; lo que cambia de lo que
 * muestran (ocultar a un donante, `N`) se avisa con `invalidate()` (6b). La sala y el selector sí cambian con
 * `registry.version()` (uniones) y con la elección.
 */
export function createScreenCache() {
  let clave = '';
  let vista = /** @type {any} */ (null);
  const RESULTADOS = new Set(['roundEnd', 'waitingNextRound', 'matchEnd']);
  return {
    get(match, ctx) {
      const pair = match.pair ? `${match.pair.teams[0].id}${match.pair.teams[1].id}` : '';
      const resultados = RESULTADOS.has(match.state);
      const k = [
        match.state,
        match.round,
        match.wins[0],
        match.wins[1],
        match.winner,
        match.results?.length ?? 0,
        match.pause,
        pair,
        resultados ? '' : (ctx.registry?.version() ?? 0),
        ctx.selection?.left,
        ctx.selection?.right,
        ctx.selection?.focus,
        ctx.selection?.focusCol,
        ctx.error?.detail ?? '',
      ].join('|');
      if (k !== clave) {
        clave = k;
        vista = screenFor(match, ctx);
      }
      return vista;
    },
    /** Algo que la foto muestra cambió (un donante oculto, `N`): se arma de nuevo en el próximo cuadro. */
    invalidate() {
      clave = '';
    },
  };
}
