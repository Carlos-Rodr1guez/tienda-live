// Dibujo de las pantallas (CB-17, diseño §10.2): el selector, la sala, el fin de ronda, el fin de partido, el error y la
// pausa. Cada pantalla vive en tarjetas (`cardRects`) que nunca tocan el marco del narrador. Todo texto se recorta por
// ancho medido dentro de su tarjeta; los nombres vienen enmascarados del registro. Las entradas animan solo opacidad y
// transform (260 ms, escalonadas 80 ms) y con movimiento reducido solo la opacidad (§10.3).

import { S } from './strings.js';
import { COLORS, TYPE, VEIL_ALPHA, rgba } from './theme.js';

const V = (u, n) => Math.round(n * u);
const VEIL_FILL = rgba(COLORS.ink, VEIL_ALPHA);
const easeOut = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3;

/** Rectángulos con nombre de cada pantalla, en px de dispositivo. Los usa el dibujo y la prueba del marco. */
function geometry(L, kind, model) {
  const u = L.u;
  const cx = Math.round(L.top.w / 2);
  const R = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  switch (kind) {
    case 'matchup':
      if (model.state !== 'normal') return { message: R(cx - V(u, 110), V(u, 60), V(u, 220), V(u, 56)) };
      return {
        title: R(cx - V(u, 100), V(u, 4), V(u, 200), V(u, 14)),
        listL: R(V(u, 3), V(u, 20), V(u, 140), V(u, 176)),
        listR: R(L.top.w - V(u, 143), V(u, 20), V(u, 140), V(u, 176)),
        preview: R(cx - V(u, 80), V(u, 20), V(u, 160), V(u, 120)),
        start: R(cx - V(u, 50), V(u, 146), V(u, 100), V(u, 14)),
        hint: R(cx - V(u, 130), V(u, 164), V(u, 260), V(u, 10)),
      };
    case 'lobby':
      return {
        title: R(cx - V(u, 150), V(u, 6), V(u, 300), V(u, 14)),
        join: R(cx - V(u, 150), V(u, 24), V(u, 300), V(u, 24)),
        colL: R(cx - V(u, 155), V(u, 54), V(u, 150), V(u, 110)),
        colR: R(cx + V(u, 5), V(u, 54), V(u, 150), V(u, 110)),
        hint: R(cx - V(u, 100), V(u, 170), V(u, 200), V(u, 12)),
      };
    case 'roundEnd':
      return {
        title: R(cx - V(u, 84), V(u, 8), V(u, 168), V(u, 28)),
        cardL: R(cx - V(u, 155), V(u, 40), V(u, 150), V(u, 60)),
        cardR: R(cx + V(u, 5), V(u, 40), V(u, 150), V(u, 60)),
        next: R(cx - V(u, 130), V(u, 110), V(u, 260), V(u, 14)),
      };
    case 'matchEnd': {
      const y0 = model.mvp ? 104 : 44;
      return {
        title: R(cx - V(u, 84), V(u, 8), V(u, 168), V(u, 28)),
        mvp: R(cx - V(u, 110), V(u, 44), V(u, 220), V(u, 52)),
        colL: R(cx - V(u, 205), V(u, y0), V(u, 200), V(u, 86)),
        colR: R(cx + V(u, 5), V(u, y0), V(u, 200), V(u, 86)),
        back: R(cx - V(u, 100), V(u, y0 + 90), V(u, 200), V(u, 12)),
      };
    }
    case 'error':
      return { card: R(cx - V(u, 150), V(u, 50), V(u, 300), V(u, 96)) };
    default:
      return {};
  }
}

/**
 * Las tarjetas de una pantalla (todas dentro del campo y fuera del marco del narrador).
 * @returns {{x: number, y: number, w: number, h: number}[]}
 */
export function cardRects(L, kind, model) {
  const g = geometry(L, kind, model);
  if (kind === 'matchEnd' && !model.mvp) delete g.mvp;
  if (kind === 'roundEnd') {
    if (!model.mvps.some((m) => m.team === 0)) delete g.cardL;
    if (!model.mvps.some((m) => m.team === 1)) delete g.cardR;
  }
  return Object.values(g);
}

/** Opacidad y desplazamiento de un elemento que entra: 260 ms (280 ms en el final), escalonado, ease-out. */
export function entrance(age, i, reduced, { dur = 0.26, step = 0.08 } = {}) {
  const p = easeOut((age - i * step) / (reduced ? 0.15 : dur));
  return { a: p, dy: reduced ? 0 : (1 - p) * 8 };
}

/** Una tarjeta con su acento de color de equipo, que entra con `e`. */
function card(P, r, color, e, dibujar) {
  const u = P.u;
  const ctx = P.ctx;
  ctx.save();
  ctx.globalAlpha = e.a;
  const rr = { ...r, y: r.y + V(u, e.dy) };
  P.panel(rr);
  if (color) P.rect({ x: rr.x, y: rr.y, w: V(u, 2), h: rr.h }, color);
  dibujar(rr);
  ctx.restore();
  P.touch();
}

/** Relleno, hueco entre la tecla y la acción, y alto del botón de avance, en px virtuales. */
const ADV_PAD = 4;
const ADV_GAP = 3;
const ADV_H = 14;
/** El botón nunca pasa de este ancho (260 virtuales): con una acción larguísima el texto se recorta. */
const ADV_MAX = 260;

/**
 * El área donde va centrado el botón de avance de cada pantalla (las mismas de 6a). El botón es UN solo componente en el
 * selector, la sala, la espera entre rondas y el final: la tecla "Enter" con su rótulo y la acción, a la medida de su
 * contenido y centrado en esta área.
 */
function advanceAnchor(L, kind, model) {
  const g = geometry(L, kind, model);
  if (kind === 'matchup') return model.state === 'normal' ? g.start : null;
  if (kind === 'lobby') return g.hint;
  if (kind === 'roundEnd') return g.next;
  if (kind === 'matchEnd') return g.back;
  return null;
}

/**
 * El rectángulo del botón de avance: medido con la fuente con que se dibuja, centrado en su área. El dibujo y el clic del
 * puntero usan este mismo rectángulo. Solo existe si la pantalla trae acción de avance (no la trae con pausa ni con error).
 */
export function advanceBox(P, L, screen) {
  if (!screen?.advance || !P.ctx) return null;
  const anchor = advanceAnchor(L, screen.kind, screen.model);
  if (!anchor) return null;
  const u = L.u;
  const key = P.width('body', TYPE.body, S.keys.enter);
  const text = P.width('body', TYPE.body, screen.advance.text);
  const w = Math.min(V(u, ADV_MAX), Math.ceil(V(u, 2 * ADV_PAD + ADV_GAP) + key + text));
  const h = V(u, ADV_H);
  return {
    x: Math.round(anchor.x + anchor.w / 2 - w / 2),
    y: Math.round(anchor.y + anchor.h / 2 - h / 2),
    w,
    h,
  };
}

/** Botón de avance (teclado y puntero): la tecla "Enter" en su recuadro y la acción, a la medida de su contenido. */
function boton(P, r, advance) {
  const u = P.u;
  const off = advance.disabled === true;
  P.rect(r, off ? COLORS.track : COLORS.focus);
  const keyW = P.width('body', TYPE.body, S.keys.enter);
  // la tecla va en un recuadro propio: se lee como una tecla y no como parte de la frase
  const cap = { x: r.x + V(u, ADV_PAD - 1), y: r.y + V(u, 2), w: keyW + V(u, 2), h: r.h - V(u, 4) };
  P.rect(cap, COLORS.ink);
  P.text(S.keys.enter, cap.x + V(u, 1), r.y + r.h / 2, {
    color: off ? COLORS.disabled : COLORS.focus,
    maxW: keyW + V(u, 1),
  });
  const x = cap.x + cap.w + V(u, ADV_GAP - 1);
  P.text(advance.text, x, r.y + r.h / 2, {
    color: off ? COLORS.disabled : COLORS.ink,
    maxW: r.x + r.w - V(u, ADV_PAD - 1) - x,
  });
}

function matchup(P, L, m, st) {
  const u = P.u;
  const g = geometry(L, 'matchup', m);
  if (m.state !== 'normal') {
    P.panel(g.message);
    const c = m.state === 'error' ? COLORS.errorText : COLORS.text;
    if (m.state === 'error') P.rect(g.message, COLORS.errorBg);
    const lineas = P.wrap(m.message, g.message.w - V(u, 10), 3);
    lineas.forEach((l, i) =>
      P.text(l, g.message.x + V(u, 5), g.message.y + V(u, 8 + i * 9), { color: c, maxW: g.message.w - V(u, 10) }),
    );
    if (m.exit)
      P.text(m.exit, g.message.x + V(u, 5), g.message.y + g.message.h - V(u, 7), {
        color: COLORS.text,
        maxW: g.message.w - V(u, 10),
      });
    return;
  }
  P.panel(g.title);
  P.text(m.title, g.title.x + g.title.w / 2, g.title.y + g.title.h / 2, {
    kind: 'display',
    size: TYPE.heading,
    align: 'center',
    maxW: g.title.w - V(u, 6),
  });
  [g.listL, g.listR].forEach((r, ci) => {
    const col = m.columns[ci];
    P.panel(r);
    P.text(col.title, r.x + V(u, 3), r.y + V(u, 6), { color: COLORS.muted, maxW: r.w - V(u, 6) });
    const fila = rowHeight(L, col.rows.length);
    col.rows.forEach((row, i) => {
      const rr = { x: r.x + V(u, 2), y: r.y + V(u, 12) + i * fila, w: r.w - V(u, 4), h: fila };
      const hover = st.hover && st.hover.col === ci && st.hover.id === row.id;
      if (row.selected) P.rect(rr, COLORS.selected);
      else if (hover) P.rect(rr, COLORS.hover);
      if (row.focused) P.outline(rr, COLORS.focus);
      P.text(row.name, rr.x + V(u, 2), rr.y + rr.h / 2, { maxW: rr.w - V(u, 4) });
    });
  });
  P.panel(g.preview);
  if (m.preview) {
    P.text(m.preview.text, g.preview.x + g.preview.w / 2, g.preview.y + V(u, 8), {
      align: 'center',
      maxW: g.preview.w - V(u, 8),
    });
    m.preview.teams.forEach((t, i) => {
      const y = g.preview.y + V(u, 20 + i * 48);
      const chip = { x: g.preview.x + V(u, 6), y, w: g.preview.w - V(u, 12), h: V(u, 12) };
      P.rect(chip, t.chip.bg);
      P.text(t.chip.text, chip.x + V(u, 3), chip.y + chip.h / 2, { color: t.chip.fg, maxW: chip.w - V(u, 6) });
      P.text(t.silhouette, chip.x, y + V(u, 20), { color: COLORS.muted, maxW: chip.w - V(u, 24) });
      // banderín liso del color del equipo (asta y triángulo), sin ningún símbolo nacional
      const ctx = P.ctx;
      const px = chip.x + chip.w - V(u, 16);
      P.rect({ x: px, y: y + V(u, 16), w: V(u, 1), h: V(u, 22) }, COLORS.muted);
      ctx.fillStyle = t.pennant.fill;
      ctx.beginPath();
      ctx.moveTo(px + V(u, 1), y + V(u, 16));
      ctx.lineTo(px + V(u, 13), y + V(u, 21));
      ctx.lineTo(px + V(u, 1), y + V(u, 26));
      ctx.closePath();
      ctx.fill();
    });
  }
  const caja = advanceBox(P, L, { kind: 'matchup', model: m, advance: { text: m.start.text } });
  if (caja) boton(P, caja, { text: m.start.text, disabled: m.start.disabled });
  if (m.start.hint) {
    P.text(m.start.hint, g.hint.x + g.hint.w / 2, g.hint.y + g.hint.h / 2, {
      align: 'center',
      color: COLORS.muted,
      maxW: g.hint.w,
    });
  }
}

function lobby(P, L, m, st, advance) {
  const u = P.u;
  const g = geometry(L, 'lobby', m);
  P.panel(g.title);
  P.text(m.versus, g.title.x + g.title.w / 2, g.title.y + g.title.h / 2, {
    kind: 'display',
    size: TYPE.heading,
    align: 'center',
    maxW: g.title.w - V(u, 6),
  });
  P.panel(g.join);
  P.wrap(m.join, g.join.w - V(u, 8), 2).forEach((l, i) =>
    P.text(l, g.join.x + g.join.w / 2, g.join.y + V(u, 7 + i * 9), { align: 'center', maxW: g.join.w - V(u, 8) }),
  );
  [g.colL, g.colR].forEach((r, ci) => {
    const t = m.teams[ci];
    // las dos columnas entran juntas: los nombres de los dos equipos van siempre a la misma altura
    const e = entrance(st.age, 0, st.reduced);
    card(P, r, t.color, e, (rr) => {
      const chip = { x: rr.x + V(u, 6), y: rr.y + V(u, 4), w: rr.w - V(u, 12), h: V(u, 10) };
      P.rect(chip, t.color);
      P.text(t.name, chip.x + V(u, 2), chip.y + chip.h / 2, { color: COLORS.ink, maxW: chip.w - V(u, 4) });
      P.text(S.lobby.members(t.count), rr.x + V(u, 6), rr.y + V(u, 20), { color: COLORS.muted, maxW: rr.w - V(u, 12) });
      t.members.forEach((name, i) => P.text(name, rr.x + V(u, 6), rr.y + V(u, 30 + i * 9), { maxW: rr.w - V(u, 12) }));
      if (t.more > 0)
        P.text(S.lobby.more(t.more), rr.x + V(u, 6), rr.y + V(u, 30 + t.members.length * 9), {
          color: COLORS.muted,
          maxW: rr.w - V(u, 12),
        });
    });
  });
  if (m.empty) {
    // sala vacía: cada columna lo dice dentro de su tarjeta
    for (const r of [g.colL, g.colR])
      P.text(m.empty, r.x + r.w / 2, r.y + r.h - V(u, 8), {
        align: 'center',
        color: COLORS.muted,
        maxW: r.w - V(u, 12),
      });
  }
  if (advance) boton(P, advanceBox(P, L, { kind: 'lobby', model: m, advance }), advance);
}

/** El título de una pantalla de resultados: hasta dos renglones centrados, a `size` px virtuales, dentro de su tarjeta. */
function titulo(P, rr, texto, size) {
  const u = P.u;
  const lineas = P.wrap(texto, rr.w - V(u, 6), 2, { kind: 'display', size });
  lineas.forEach((l, i) => {
    const y = lineas.length === 1 ? rr.y + rr.h / 2 : rr.y + V(u, size) * (i + 0.5) + (rr.h - V(u, size) * 2) / 2;
    P.text(l, rr.x + rr.w / 2, y, { kind: 'display', size, align: 'center', maxW: rr.w - V(u, 6) });
  });
}

function roundEnd(P, L, m, st, advance) {
  const u = P.u;
  const g = geometry(L, 'roundEnd', m);
  const e0 = entrance(st.age, 0, st.reduced);
  // sin resultado de ronda en esta página (recarga) no hay título: solo el aviso
  if (m.title) card(P, g.title, null, e0, (rr) => titulo(P, rr, m.title, TYPE.heading));
  m.mvps.forEach((v, i) => {
    const r = v.team === 0 ? g.cardL : g.cardR;
    card(P, r, v.color, entrance(st.age, i + 1, st.reduced), (rr) => {
      P.text(v.title, rr.x + V(u, 6), rr.y + V(u, 9), { color: COLORS.muted, maxW: rr.w - V(u, 12) });
      P.text(v.name, rr.x + V(u, 6), rr.y + V(u, 24), { size: TYPE.heading, maxW: rr.w - V(u, 12) });
      P.text(v.rank, rr.x + V(u, 6), rr.y + V(u, 42), { color: COLORS.muted, maxW: V(u, 70) });
      P.num(v.xp, rr.x + rr.w - V(u, 6), rr.y + V(u, 42), { align: 'right' });
    });
  });
  if (advance) boton(P, advanceBox(P, L, { kind: 'roundEnd', model: m, advance }), advance);
}

function matchEnd(P, L, m, st, advance) {
  const u = P.u;
  const g = geometry(L, 'matchEnd', m);
  const reduced = st.reduced;
  const opt = { dur: 0.28, step: 0.06 };
  card(P, g.title, null, entrance(st.age, 0, reduced, opt), (rr) => titulo(P, rr, m.title, TYPE.heading));
  if (m.mvp) {
    card(
      P,
      g.mvp,
      m.mvp.team === 0 || m.mvp.team === 1 ? st.teamColors[m.mvp.team] : COLORS.mvp,
      entrance(st.age, 1, reduced, opt),
      (rr) => {
        P.text(m.mvp.title, rr.x + V(u, 6), rr.y + V(u, 9), { color: COLORS.muted, maxW: rr.w - V(u, 12) });
        P.text(m.mvp.name, rr.x + V(u, 6), rr.y + V(u, 26), { size: TYPE.heading, maxW: rr.w - V(u, 12) });
        P.text(m.mvp.rank, rr.x + V(u, 6), rr.y + V(u, 42), { color: COLORS.muted, maxW: V(u, 90) });
        P.num(m.mvp.xp, rr.x + rr.w - V(u, 6), rr.y + V(u, 42), { align: 'right' });
      },
    );
  }
  [g.colL, g.colR].forEach((r, ci) => {
    const col = m.columns[ci];
    card(P, r, col.color, entrance(st.age, ci + 2, reduced, opt), (rr) => {
      const chip = { x: rr.x + V(u, 6), y: rr.y + V(u, 4), w: rr.w - V(u, 12), h: V(u, 10) };
      P.rect(chip, col.color);
      P.dot(chip.x + V(u, 5), chip.y + chip.h / 2, V(u, 5), ci === 0 ? 'circle' : 'diamond', true, COLORS.ink);
      P.text(col.title, chip.x + V(u, 10), chip.y + chip.h / 2, { color: COLORS.ink, maxW: chip.w - V(u, 12) });
      if (col.empty)
        P.text(col.empty, rr.x + rr.w / 2, rr.y + V(u, 44), {
          align: 'center',
          color: COLORS.muted,
          maxW: rr.w - V(u, 12),
        });
      col.rows.forEach((row, i) => {
        const fila = { x: rr.x + V(u, 4), y: rr.y + V(u, 20 + i * 20), w: rr.w - V(u, 8), h: V(u, 18) };
        const ink = row.highlight ? COLORS.ink : COLORS.text;
        if (row.highlight) P.rect(fila, COLORS.mvp);
        P.text(row.name, fila.x + V(u, 3), fila.y + V(u, 5), { color: ink, maxW: fila.w - V(u, 6) });
        P.text(row.rank, fila.x + V(u, 3), fila.y + V(u, 13), {
          color: row.highlight ? COLORS.ink : COLORS.muted,
          maxW: V(u, 80),
        });
        P.num(row.xp, fila.x + fila.w - V(u, 3), fila.y + V(u, 13), { align: 'right', color: ink });
      });
    });
  });
  if (advance) boton(P, advanceBox(P, L, { kind: 'matchEnd', model: m, advance }), advance);
}

function error(P, L, m) {
  const u = P.u;
  const g = geometry(L, 'error', m);
  P.rect(g.card, COLORS.errorBg);
  P.outline(g.card, COLORS.chipWarn);
  P.text(m.title, g.card.x + V(u, 6), g.card.y + V(u, 9), {
    kind: 'display',
    size: TYPE.heading,
    color: COLORS.errorText,
    maxW: g.card.w - V(u, 12),
  });
  P.wrap(m.detail, g.card.w - V(u, 12), 3).forEach((l, i) =>
    P.text(l, g.card.x + V(u, 6), g.card.y + V(u, 24 + i * 9), { color: COLORS.errorText, maxW: g.card.w - V(u, 12) }),
  );
  P.wrap(m.exit, g.card.w - V(u, 12), 2).forEach((l, i) =>
    P.text(l, g.card.x + V(u, 6), g.card.y + V(u, 58 + i * 9), { color: COLORS.text, maxW: g.card.w - V(u, 12) }),
  );
}

/**
 * Dibuja la pantalla que toca (`screenFor`). `st`: `age` (segundos desde que entró), `reduced`, `teamColors`, `hover`.
 */
export function drawScreen(P, L, screen, st) {
  if (!screen?.kind) return;
  // D14: con un panel abierto no se dibujan las piezas que lo cortan (las listas, las columnas, las tarjetas y el botón de avance)
  if (st.skip) {
    const piezas = cardRects(L, screen.kind, screen.model);
    const adv = advanceBox(P, L, screen);
    if (adv) piezas.push(adv);
    P.ocultar(piezas.filter((r) => st.skip(r)));
  }
  try {
    dibujarPantalla(P, L, screen, st);
  } finally {
    P.ocultar([]);
  }
}

function dibujarPantalla(P, L, screen, st) {
  switch (screen.kind) {
    case 'matchup':
      return matchup(P, L, screen.model, st);
    case 'lobby':
      return lobby(P, L, screen.model, st, screen.advance);
    case 'roundEnd':
      return roundEnd(P, L, screen.model, st, screen.advance);
    case 'matchEnd':
      return matchEnd(P, L, screen.model, st, screen.advance);
    case 'error':
      return error(P, L, screen.model);
    default:
  }
}

/** El rectángulo del botón de avance de la pantalla (para el clic del puntero), o null. */
export function advanceRect(L, screen, P) {
  return advanceBox(P, L, screen);
}

/**
 * La fila del selector bajo un punto (px de dispositivo): `{col, id}` (col 0 la lista izquierda, 1 la derecha) o `null`.
 * Usa la misma geometría que el dibujo (`geometry` y `rowHeight`).
 */
export function listHit(L, screen, x, y) {
  if (screen?.kind !== 'matchup' || screen.model.state !== 'normal') return null;
  const g = geometry(L, 'matchup', screen.model);
  const u = L.u;
  for (const [ci, r] of [g.listL, g.listR].entries()) {
    if (x < r.x || x >= r.x + r.w) continue;
    const rows = screen.model.columns[ci].rows;
    const fila = rowHeight(L, rows.length);
    const i = Math.floor((y - (r.y + V(u, 12))) / fila);
    if (y >= r.y + V(u, 12) && i >= 0 && i < rows.length) return { col: ci, id: rows[i].id };
  }
  return null;
}

/** Velo de la pausa (NM-9), 200 ms. Deja libre el marco del narrador: la cámara del streamer se ve entera. */
export function drawVeil(P, L, alpha) {
  if (!(alpha > 0)) return;
  const ctx = P.ctx;
  const W = L.top.w;
  const H = L.bottom.y + L.bottom.h;
  const f = L.frame;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = VEIL_FILL;
  if (f) {
    ctx.fillRect(0, 0, W, f.y);
    ctx.fillRect(0, f.y, f.x, H - f.y);
  } else ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

/** El texto exacto de la pausa, centrado en el campo, con la misma opacidad del velo. */
export function drawPauseText(P, L, pause, alpha) {
  if (!pause?.visible || !(alpha > 0)) return;
  const W = L.top.w;
  P.ctx.globalAlpha = alpha;
  P.text(pause.text, Math.round(W / 2), L.field.y + Math.round(L.field.h / 2), {
    kind: 'display',
    size: TYPE.heading,
    align: 'center',
    maxW: W - V(P.u, 16),
  });
  P.ctx.globalAlpha = 1;
}

/**
 * Alto en px de cada fila del selector para que `n` países entren en su lista (176 virtuales menos 12 de encabezado). Una
 * fila debe ser tan alta como el texto (7 virtuales): con más países de los que entran, las filas se pisarían, y la
 * prueba de `ui-fixes.test.js` falla para avisarlo.
 */
export function rowHeight(L, n) {
  return Math.floor((176 * L.u - 12 * L.u) / Math.max(1, n));
}
