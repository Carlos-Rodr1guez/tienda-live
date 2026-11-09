// Modelos de las superposiciones del narrador (G marcador, T top 3 y H ayuda). Puros: leen el partido y el registro y
// devuelven datos. Los nombres salen SIEMPRE del registro (`displayName` vía el podio del kit): con `N` o con un donante
// oculto dicen "anónimo" (NM-11). El texto del chat nunca llega aquí.

import { DEFAULT_LADDER } from '@tienda/kit/sim/ranks.js';
import { topUsers } from '@tienda/kit/sim/podium.js';
import { helpLines } from './keys.js';
import { S } from './strings.js';

const rankLabel = (ladder, i) => ladder[Math.min(Math.max(0, Math.trunc(i) || 0), ladder.length - 1)].label;
const pct = (b) => {
  const max = Number(b?.maxHp);
  const hp = Number(b?.hp);
  return max > 0 && !Number.isNaN(hp) ? Math.min(100, Math.max(0, Math.ceil((100 * Math.min(hp, max)) / max))) : 0;
};
const fila = (ladder, e) => ({
  name: e.name,
  rank: rankLabel(ladder, e.rank),
  xp: S.matchEnd.xp(e.xp),
  team: e.team === null ? null : e.team - 1,
});

/** Marcador grande (G): los dos países con su % de base y sus rondas ganadas, la ronda y quien va primero. */
export function scoreboardModel({ match, registry, ladder = DEFAULT_LADDER, top }) {
  const w = match.world;
  const total = 2 * (w?.cfg?.round?.winsToMatch ?? 2) - 1;
  // `top`: los mejores del partido, ya calculados (G y T comparten una sola pasada por refresco)
  const best = (top ?? (registry ? topUsers(registry, 'match', 1) : []))[0] ?? null;
  return {
    title: S.overlays.scoreboard,
    teams: match.pair.teams.map((t, side) => ({
      name: t.name,
      color: t.color,
      wins: match.wins[side],
      pct: pct(w?.bases?.[side]),
    })),
    round: S.hud.round(match.round, total),
    leader: best ? { label: S.overlays.leader, ...fila(ladder, best) } : null,
  };
}

/** Top 3 parcial del partido (T): hasta tres filas por XP de partido, con los nombres enmascarados. */
export function top3Model({ registry, ladder = DEFAULT_LADDER, top }) {
  const rows = (top ?? (registry ? topUsers(registry, 'match', 3) : [])).slice(0, 3).map((e) => fila(ladder, e));
  return { title: S.overlays.top3, rows, empty: rows.length === 0 ? S.matchEnd.empty : null };
}

/** Ayuda de atajos (H), armada desde el mapa de teclas. */
export function helpModel() {
  return { title: S.help.title, lines: helpLines() };
}
