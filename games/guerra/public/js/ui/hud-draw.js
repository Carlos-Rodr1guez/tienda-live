// Dibujo del HUD (CB-17, diseño §10.1): los dos paneles de equipo, los rieles, el centro, el feed, el banner, el marco
// del narrador y los avisos de conexión. Solo dibuja lo que dice el modelo (`ui/hud.js`, `ui/banners.js`); medidas en px
// virtuales por la escala entera `u`. Sin identidad por color solo: cada equipo lleva chip con el nombre, punto con
// forma (círculo / rombo) y su conteo en campo. Los números van en celdas fijas (no bailan) y los nombres recortados.

import { drawUiIcon } from '../render/icons.js';
import { freeY } from './placement.js';
import { S } from './strings.js';
import { COLORS, TYPE } from './theme.js';

const V = (u, n) => Math.round(n * u);
const cap99 = (n) => (n > 99 ? '99+' : String(Math.max(0, Math.trunc(Number(n)) || 0)));

/** Un panel de equipo (150×34 virtuales): chip, % de la base, barra, puntos de ronda y unidades en campo. */
function teamPanel(P, r, p, shown, icons) {
  const u = P.u;
  const ctx = P.ctx;
  P.panel(r);
  P.rect({ x: r.x, y: r.y, w: u, h: r.h }, p.color);
  const chip = { x: r.x + V(u, 3), y: r.y + V(u, 2), w: V(u, 78), h: V(u, 10) };
  P.rect(chip, p.color);
  P.text(p.name, chip.x + V(u, 2), chip.y + chip.h / 2, { color: COLORS.ink, maxW: chip.w - V(u, 4) });
  P.num(p.pctText, r.x + r.w - V(u, 3), r.y + V(u, 7), { align: 'right' });
  // barra de la base sobre su placa opaca; el relleno se anima con scaleX (200 ms, ease-out) o salta con movimiento reducido
  const bar = { x: r.x + V(u, 3), y: r.y + V(u, 14), w: V(u, 144), h: V(u, 4) };
  P.rect(bar, COLORS.track);
  P.rect({ x: bar.x, y: bar.y, w: Math.round(bar.w * shown), h: bar.h }, p.color);
  const cy = r.y + V(u, 26);
  p.dots.forEach((d, i) => P.dot(r.x + V(u, 6 + i * 7), cy, V(u, 5), d.shape, d.filled, p.color));
  const espejo = p.side === 1;
  // ícono, cifra (ancho máximo de 14 px virtuales: "99+" cabe) y rótulo, cada uno en su hueco: la cifra nunca pisa el rótulo
  const grupo = (id, x, alto, numX, labelX, labelW, count, label) => {
    drawUiIcon(ctx, icons.bank, icons.team[p.side], id, r.x + V(u, x), cy - V(u, alto), u, espejo);
    P.num(cap99(count), r.x + V(u, numX), cy, { color: COLORS.text, maxW: V(u, 14) });
    P.text(label, r.x + V(u, labelX), cy, { color: COLORS.muted, maxW: V(u, labelW) });
  };
  grupo('arrow', 22, 4, 33, 48, 70, p.inField, S.hud.inField);
  P.touch();
}

/** Un riel (57×96): cómo unirse, miembros, likes y energía. */
function rail(P, r, rl) {
  const u = P.u;
  const ancho = r.w - V(u, 6);
  P.panel(r);
  P.text(rl.joinPrefix, r.x + V(u, 3), r.y + V(u, 6), { color: COLORS.muted, maxW: ancho });
  const chip = { x: r.x + V(u, 3), y: r.y + V(u, 12), w: ancho, h: V(u, 9) };
  P.rect(chip, rl.color);
  P.text(rl.joinName, chip.x + V(u, 2), chip.y + chip.h / 2, { color: COLORS.ink, maxW: chip.w - V(u, 4) });
  P.text(S.hud.members(rl.members), r.x + V(u, 3), r.y + V(u, 29), { color: COLORS.muted, maxW: ancho });
  const barra = (label, y, frac) => {
    P.text(label, r.x + V(u, 3), r.y + V(u, y), { color: COLORS.muted, maxW: ancho });
    const b = { x: r.x + V(u, 3), y: r.y + V(u, y + 4), w: ancho, h: V(u, 3) };
    P.rect(b, COLORS.track);
    P.rect({ x: b.x, y: b.y, w: Math.round(b.w * frac), h: b.h }, rl.color);
  };
  barra(S.hud.likes, 42, rl.likes);
  barra(S.hud.energy, 58, rl.energy);
}

/** El panel central: reloj, ronda y el ESTADO de la cámara (el botón es del DOM y dice otra cosa). */
function center(P, L, c) {
  const u = P.u;
  const r = L.center;
  P.panel(r);
  P.num(c.clock, r.x + V(u, 4), r.y + V(u, 9), { size: TYPE.heading });
  P.text(c.round, r.x + r.w - V(u, 4), r.y + V(u, 9), { align: 'right', color: COLORS.muted, maxW: V(u, 80) });
  P.text(c.status, L.status.x + L.status.w / 2, L.status.y + L.status.h / 2, {
    align: 'center',
    color: c.autoOn ? COLORS.focus : COLORS.muted,
    maxW: L.status.w,
  });
}

/**
 * Banda superior, rieles y centro.
 * @param {{bars: number[], icons: {bank: any, team: number[]}}} st `bars`: fracción mostrada de cada base (0–1)
 */
export function drawHud(P, L, hud, st) {
  if (!hud?.visible) return;
  teamPanel(P, L.panelL, hud.panels[0], st.bars[0], st.icons);
  teamPanel(P, L.panelR, hud.panels[1], st.bars[1], st.icons);
  // en las pantallas de resultados el título ocupa el lugar del centro y las tarjetas el de los rieles (10.2)
  if (st.results) return;
  center(P, L, hud.center);
  rail(P, L.railL, hud.rails[0]);
  rail(P, L.railR, hud.rails[1]);
  hud.rails.forEach((rl, side) => queuedPill(P, L, side, rl.queued));
}

/** Lugar de la pastilla "+{n} en cola" (C21): debajo del riel de su país, con el mismo ancho y 2 px virtuales de separación. */
export function queuedRect(L, side) {
  const r = side === 0 ? L.railL : L.railR;
  return { x: r.x, y: r.y + r.h + 2 * L.u, w: r.w, h: 10 * L.u };
}

/** Pastilla de panel con las tropas en cola de un país; solo con n > 0. El texto se centra y se recorta por ancho medido. */
function queuedPill(P, L, side, n) {
  if (!(n > 0)) return;
  const r = queuedRect(L, side);
  P.panel(r);
  P.text(S.hud.queued(n), r.x + r.w / 2, r.y + r.h / 2, { align: 'center', maxW: r.w - V(P.u, 4) });
}

/**
 * Rectángulo del chip de conexión (D5, D12): abajo a la izquierda y ANCLADO al feed, a 4 px virtuales encima de él (a 480×270,
 * y 210–220; el feed empieza en 224). No depende de una altura fija: sigue al feed en cualquier tamaño de lienzo.
 */
export function chipRect(P, L, text) {
  const u = P.u;
  const w = Math.min(L.top.w - V(u, 8), P.width('body', TYPE.body, text) + V(u, 10));
  return { x: V(u, 3), y: L.feed.y - V(u, 4) - V(u, 10), w, h: V(u, 10) };
}

/** Medidas del aviso largo de conexión a un ancho dado: los renglones (hasta 5, sin recortar) y el alto. */
export function alertBox(P, text, w) {
  const u = P.u;
  // hasta 5 renglones: el aviso nunca se corta (D4)
  const lines = P.wrap(text, w - V(u, 10), 5);
  return { lines, w, h: V(u, 6 + lines.length * 9) };
}

/**
 * Chip de conexión (en su lugar fijo), aviso largo de conexión (ya colocado por `ui/draw.js` en un lugar libre: `alert.rect` y
 * `alert.lines`) y "Sin tropas en el campo" (bajo el aviso, o bajo la banda superior si no hay).
 */
export function drawNotices(P, L, hud, alert = null) {
  const u = P.u;
  const W = L.top.w;
  let y = L.field.y + V(u, 2);
  const puesto = { chip: null, alert: null, noTroops: null };
  if (hud.chip) {
    const r = chipRect(P, L, hud.chip.text);
    puesto.chip = r;
    P.rect(r, COLORS.chipBg);
    if (hud.chip.kind === 'warn') P.outline(r, COLORS.chipWarn);
    P.text(hud.chip.text, r.x + r.w / 2, r.y + r.h / 2, { align: 'center', maxW: r.w - V(u, 4) });
  }
  // el aviso largo ya viene colocado (`alert.rect`, `alert.lines`): solo se dibuja donde hay lugar y nunca se corta (D10)
  if (alert) {
    const r = alert.rect;
    puesto.alert = r;
    P.rect(r, COLORS.errorBg);
    P.outline(r, COLORS.chipWarn);
    alert.lines.forEach((l, i) =>
      P.text(l, r.x + V(u, 5), r.y + V(u, 7 + i * 9), { color: COLORS.errorText, maxW: r.w - V(u, 10) }),
    );
    y = r.y + r.h + V(u, 2);
  }
  if (hud.noTroops) {
    const w = Math.min(W - V(u, 8), P.width('body', TYPE.body, hud.noTroops) + V(u, 10));
    const r = { x: Math.round((W - w) / 2), y, w, h: V(u, 10) };
    puesto.noTroops = r;
    P.panel(r);
    P.text(hud.noTroops, r.x + r.w / 2, r.y + r.h / 2, { align: 'center', color: COLORS.muted, maxW: r.w - V(u, 4) });
  }
  return puesto;
}

/** Feed de la banda inferior: las últimas líneas, nunca texto del chat. `teamColors`: color por equipo (1..N). */
export function drawFeed(P, L, feed, teamColors) {
  const u = P.u;
  const r = L.feed;
  P.panel(r);
  if (feed.length === 0) {
    P.text(S.feed.empty, r.x + V(u, 4), r.y + r.h - V(u, 5.5), { color: COLORS.muted, maxW: r.w - V(u, 8) });
    return;
  }
  const n = Math.min(feed.length, 4);
  for (let i = 0; i < n; i++) {
    const f = feed[feed.length - n + i];
    const y = r.y + r.h - V(u, (n - i) * 11 - 5.5);
    const team = f.team === 1 || f.team === 2 ? f.team : 0;
    P.dot(
      r.x + V(u, 5),
      y,
      V(u, 4),
      team === 2 ? 'diamond' : 'circle',
      true,
      team ? teamColors[team - 1] : COLORS.muted,
    );
    P.text(f.text, r.x + V(u, 11), y, { maxW: r.w - V(u, 14) });
  }
}

/** Marco "EN VIVO · NARRADOR": solo el borde y su rótulo; adentro va la cámara del streamer y no se dibuja nada. */
export function drawFrame(P, L) {
  if (!L.frame) return;
  const u = P.u;
  const f = L.frame;
  // el borde se mide sobre la cámara del streamer, que puede ser blanca o negra: `COLORS.frame` da ≥ 3:1 con las dos
  P.outline(f, COLORS.frame);
  const tag = { x: f.x + V(u, 1), y: f.y + V(u, 1), w: f.w - V(u, 2), h: V(u, 9) };
  P.panel(tag);
  P.text(S.frame, tag.x + tag.w / 2, tag.y + tag.h / 2, {
    align: 'center',
    color: COLORS.muted,
    maxW: tag.w - V(u, 4),
  });
}

/**
 * Hueco del banner (D15): el primer lugar libre desde y 56 virtuales bajo la banda superior, que no pisa nada; `null` si no hay
 * (el banner espera, como con un panel abierto). `margen`: el desplazamiento de la entrada (solo en la batalla).
 */
export function bannerSlot(P, L, obstacles, margen) {
  const u = P.u;
  // el hueco es del tamaño MÁXIMO del banner y no depende de que haya uno a la vista (así no oscila, D15)
  const w = Math.min(V(u, 260), L.top.w - V(u, 16)) + V(u, 14);
  const x = Math.round((L.top.w - w) / 2);
  const y = freeY({ x, w, h: V(u, 14) + margen }, obstacles, L.field.y + V(u, 56), L.bottom.y + L.bottom.h);
  return y === null ? null : { x, y, w, h: V(u, 14), margen };
}

/** El rectángulo que ocupa un banner en su hueco (centrado, con su ancho real y su desplazamiento `dy` solo en la batalla). */
export function bannerRect(P, L, b, slot) {
  if (!b || !(b.alpha > 0) || !slot) return null;
  const u = P.u;
  const maxW = Math.min(V(u, 260), L.top.w - V(u, 16));
  const w = Math.min(maxW, P.width('body', TYPE.banner, b.text)) + V(u, 14);
  return { x: Math.round((L.top.w - w) / 2), y: slot.y + V(u, b.dy), w, h: slot.h };
}

/** Banner de ascenso, regalo grande o avión (`ui/banners.js`): solo opacidad y transform, dibujado en su hueco. */
export function drawBanner(P, L, b, teamColors, slot) {
  const r = bannerRect(P, L, b, slot);
  if (!r) return null;
  const u = P.u;
  const ctx = P.ctx;
  ctx.save();
  ctx.globalAlpha = b.alpha;
  if (b.scale !== 1) {
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(b.scale, b.scale);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }
  P.rect(r, COLORS.banner);
  P.rect({ x: r.x, y: r.y, w: V(u, 3), h: r.h }, b.team === 1 || b.team === 2 ? teamColors[b.team - 1] : COLORS.focus);
  P.text(b.text, r.x + V(u, 8), r.y + r.h / 2, { size: TYPE.banner, maxW: r.w - V(u, 12) });
  ctx.restore();
  P.touch();
  return r;
}

/**
 * Avisos breves de las teclas (D11): un bloque apilado en el primer lugar libre de la pantalla (`obstacles`: paneles abiertos,
 * tarjetas, listas, chip, aviso largo, rieles, feed, marco), nunca encima de nada. Nunca se recortan (hasta 4 renglones). Con
 * poco lugar se muestran los más nuevos que entren; si no entra ninguno, no se dibuja (el aviso ya cumplió su efecto).
 * `y0`: desde dónde buscar (en la batalla, bajo el banner).
 */
export function drawToasts(P, L, notices, obstacles = [], y0 = L.field.y) {
  if (!notices || notices.length === 0) return [];
  const u = P.u;
  const W = L.top.w;
  const w = Math.min(W - V(u, 8), V(u, 260));
  // lugares donde probar: centrado y, si no hay, a la derecha del feed (entre él y el marco del narrador)
  const derecha = L.feed.x + L.feed.w + V(u, 2);
  const anchoDer = (L.frame ? L.frame.x : W) - V(u, 2) - derecha;
  const columnas = [{ x: Math.round((W - w) / 2), w }];
  if (anchoDer >= V(u, 120)) columnas.push({ x: derecha, w: Math.min(w, anchoDer) });
  const yMax = L.bottom.y + L.bottom.h;
  const gap = V(u, 2);
  for (let n = Math.min(3, notices.length); n >= 1; n--) {
    for (const col of columnas) {
      const lista = notices.slice(-n).map((text) => {
        const lines = P.wrap(text, col.w - V(u, 6), 4);
        return { lines, h: V(u, 3 + lines.length * 9) };
      });
      const alto = lista.reduce((a, t) => a + t.h, 0) + gap * (n - 1);
      const y = freeY({ x: col.x, w: col.w, h: alto }, obstacles, y0, yMax);
      if (y === null) continue;
      return apilar(P, lista, col, y, gap);
    }
  }
  return [];
}

function apilar(P, lista, col, y, gap) {
  const u = P.u;
  const puestos = [];
  let cy = y;
  for (const t of lista) {
    const r = { x: col.x, y: cy, w: col.w, h: t.h };
    puestos.push(r);
    P.panel(r);
    t.lines.forEach((l, i) =>
      P.text(l, r.x + r.w / 2, r.y + V(u, 7.5 + i * 9), { align: 'center', maxW: r.w - V(u, 6) }),
    );
    cy += t.h + gap;
  }
  return puestos;
}
