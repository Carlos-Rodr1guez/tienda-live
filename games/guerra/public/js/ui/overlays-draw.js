// Dibujo de las superposiciones del narrador (G marcador, T top 3, H ayuda y F3 zonas seguras). Cada panel va en una región
// propia que nunca toca el marco "EN VIVO · NARRADOR" (388–476 × 196–266 virtuales). El marcador y el top 3 no se pisan entre
// sí, y la ayuda H es exclusiva con los dos (`ui/shortcuts.js`: abrir una cierra las otras, D3). Todo texto se
// recorta por ancho medido; los colores salen del tema. Los cambios por tecla son instantáneos (§10.3): sin animación.

import { safeZones } from './safe-zones.js';
import { S } from './strings.js';
import { COLORS, TYPE } from './theme.js';

const V = (u, n) => Math.round(n * u);

/** Regiones (px de dispositivo) de cada superposición, centradas arriba del campo y por encima del marco del narrador. */
function regions(L) {
  const u = L.u;
  const cx = Math.round(L.top.w / 2);
  const R = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  return {
    scoreboard: R(cx - V(u, 110), V(u, 46), V(u, 220), V(u, 74)),
    top3: R(cx - V(u, 100), V(u, 124), V(u, 200), V(u, 62)),
    help: R(cx - V(u, 165), V(u, 44), V(u, 330), V(u, 150)),
  };
}

/**
 * Los rectángulos de las superposiciones que se muestran (para la prueba del marco).
 * @param {any} L
 * @param {{scoreboard?: any, top3?: any, help?: any}} ov
 */
export function overlayRects(L, ov) {
  const g = regions(L);
  return ['scoreboard', 'top3', 'help'].filter((k) => ov?.[k]).map((k) => g[k]);
}

function scoreboard(P, L, m, teamColors) {
  const u = P.u;
  const r = regions(L).scoreboard;
  P.panel(r);
  P.text(m.title, r.x + r.w / 2, r.y + V(u, 8), {
    kind: 'display',
    size: TYPE.heading,
    align: 'center',
    maxW: r.w - V(u, 8),
  });
  P.text(m.round, r.x + r.w - V(u, 6), r.y + V(u, 8), { color: COLORS.muted, align: 'right', maxW: V(u, 60) });
  m.teams.forEach((t, i) => {
    const y = r.y + V(u, 20 + i * 14);
    const chip = { x: r.x + V(u, 6), y, w: V(u, 96), h: V(u, 11) };
    P.rect(chip, t.color ?? teamColors[i]);
    P.text(t.name, chip.x + V(u, 2), chip.y + chip.h / 2, { color: COLORS.ink, maxW: chip.w - V(u, 4) });
    P.num(S.hud.percent(t.pct), r.x + V(u, 126), chip.y + chip.h / 2, { align: 'right' });
    for (let k = 0; k < Math.max(0, Math.min(3, t.wins)); k++)
      P.dot(
        r.x + V(u, 138 + k * 8),
        chip.y + chip.h / 2,
        V(u, 5),
        i === 0 ? 'circle' : 'diamond',
        true,
        t.color ?? teamColors[i],
      );
  });
  if (m.leader) {
    const y = r.y + V(u, 56);
    P.text(m.leader.label, r.x + V(u, 6), y, { color: COLORS.muted, maxW: V(u, 60) });
    P.text(m.leader.name, r.x + V(u, 66), y, { maxW: V(u, 96) });
    P.num(m.leader.xp, r.x + r.w - V(u, 6), y, { align: 'right' });
  }
}

function top3(P, L, m, teamColors) {
  const u = P.u;
  const r = regions(L).top3;
  P.panel(r);
  P.text(m.title, r.x + r.w / 2, r.y + V(u, 8), {
    kind: 'display',
    size: TYPE.heading,
    align: 'center',
    maxW: r.w - V(u, 8),
  });
  if (m.empty) {
    P.text(m.empty, r.x + r.w / 2, r.y + V(u, 34), { color: COLORS.muted, align: 'center', maxW: r.w - V(u, 12) });
    return;
  }
  m.rows.forEach((row, i) => {
    const y = r.y + V(u, 22 + i * 12);
    P.dot(r.x + V(u, 8), y, V(u, 5), row.team === 1 ? 'diamond' : 'circle', true, teamColors[row.team === 1 ? 1 : 0]);
    P.text(row.name, r.x + V(u, 15), y, { maxW: V(u, 92) });
    P.text(row.rank, r.x + V(u, 110), y, { color: COLORS.muted, maxW: V(u, 44) });
    P.num(row.xp, r.x + r.w - V(u, 6), y, { align: 'right' });
  });
}

function help(P, L, m) {
  const u = P.u;
  const r = regions(L).help;
  P.panel(r);
  P.text(m.title, r.x + r.w / 2, r.y + V(u, 8), {
    kind: 'display',
    size: TYPE.heading,
    align: 'center',
    maxW: r.w - V(u, 8),
  });
  const mitad = Math.ceil(m.lines.length / 2);
  m.lines.forEach((line, i) => {
    const col = i < mitad ? 0 : 1;
    const x = r.x + V(u, 6 + col * 162);
    const y = r.y + V(u, 20 + (i % mitad) * 9);
    P.text(line.keys, x, y, { color: COLORS.focus, maxW: V(u, 50) });
    P.text(line.text, x + V(u, 52), y, { maxW: V(u, 108) });
  });
}

/** F3: las franjas no seguras, semitransparentes (provisorias hasta medir con el segundo teléfono). */
function safe(P, L) {
  const ctx = P.ctx;
  const W = L.top.w;
  const H = L.bottom.y + L.bottom.h;
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = COLORS.safeZone;
  for (const z of safeZones(W, H)) ctx.fillRect(z.x, z.y, z.w, z.h);
  ctx.globalAlpha = 1;
  P.text(S.safeZones.label, Math.round(W / 2), Math.round(H * 0.5), { align: 'center', color: COLORS.safeZone });
}

/**
 * @param {any} P pincel
 * @param {any} L regiones de `layoutFor`
 * @param {{scoreboard?: any, top3?: any, help?: any, safe?: boolean} | null} ov
 * @param {string[]} teamColors
 */
export function drawOverlays(P, L, ov, teamColors) {
  if (!ov) return;
  if (ov.safe) safe(P, L);
  if (ov.top3) top3(P, L, ov.top3, teamColors);
  if (ov.scoreboard) scoreboard(P, L, ov.scoreboard, teamColors);
  if (ov.help) help(P, L, ov.help);
}
