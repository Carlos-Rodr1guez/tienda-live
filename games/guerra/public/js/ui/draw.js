// Interfaz del juego sobre el lienzo (lote 6a): une los modelos (`hud.js`, `screens.js`, `banners.js`) con su dibujo
// (`hud-draw.js`, `screens-draw.js`) en el orden de D21 punto 6: velo de la pausa, HUD, avisos de conexión, feed,
// pantalla, banner, texto de la pausa y marco del narrador. Es la etapa `ui` de F2.
//
// Solo guarda estado de PRESENTACIÓN: la fracción mostrada de las barras de base y la opacidad del velo (200 ms con
// ease-out, o un salto con movimiento reducido) y desde cuándo está la pantalla actual. Nada vuelve al sim.

import { advanceRect, cardRects, drawPauseText, drawScreen, drawVeil, listHit } from './screens-draw.js';
import { drawOverlays } from './overlays-draw.js';
import { drawBanner, drawFeed, drawFrame, drawHud, drawNotices, drawToasts } from './hud-draw.js';
import { freeY, overlaps } from './placement.js';
import { overlayRects } from './overlays-draw.js';
import { alertBox, bannerRect, bannerSlot, chipRect, queuedRect } from './hud-draw.js';
import { layoutFor } from './layout.js';
import { createPainter } from './paint.js';
import { COLORS } from './theme.js';

/** Duración de las barras de la base y del velo de la pausa (§10.3): 200 ms, ease-out. */
const DUR = 0.2;
const easeOut = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3;

/**
 * Una transición de 200 ms con ease-out entre lo que se mostraba y el objetivo. Al cambiar el objetivo parte del valor
 * mostrado; la primera vez (sin valor previo) y con movimiento reducido salta al objetivo.
 */
function tween(t, target, now, reduced) {
  if (t.to === null || reduced) {
    t.from = target;
    t.to = target;
    t.shown = target;
    t.start = now;
    return target;
  }
  if (target !== t.to) {
    t.from = t.shown;
    t.to = target;
    t.start = now;
  }
  t.shown = t.from + (t.to - t.from) * easeOut((now - t.start) / DUR);
  return t.shown;
}
const nuevo = () => ({ from: 0, to: /** @type {number | null} */ (null), shown: 0, start: 0 });

/**
 * @param {{iconBank: any, iconTeam: number[]}} o `iconTeam`: índices horneados por equipo del banco de íconos (el mismo
 *   que usa el mundo); se llena al elegir el par
 */
export function createUi({ iconBank, iconTeam }) {
  const P = createPainter();
  /** Los paneles abiertos del último cuadro (para el clic del botón de avance). */
  let abiertosAntes = /** @type {{x: number, y: number, w: number, h: number}[]} */ ([]);
  const placed = { chip: null, alert: null, toasts: [], bannerSlot: /** @type {any} */ (null) };
  /** Lo que ocupa el HUD sobre el campo en el último cuadro: las etiquetas de donantes lo esquivan (B9). */
  const obstacles = /** @type {{x: number, y: number, w: number, h: number}[]} */ ([]);
  const anim = { bars: [nuevo(), nuevo()], veil: nuevo(), kind: /** @type {string|null} */ (null), since: 0 };
  const icons = { bank: iconBank, team: iconTeam };

  return {
    painter: P,
    /** Dónde se dibujaron en el último cuadro el chip, el aviso largo y los avisos de teclas (px de dispositivo; para las pruebas). */
    placed,
    obstacles,
    /** Llegó una fuente o cambió algo que cambia los anchos: se vuelve a medir (textos, recortes y cifras). */
    invalidate() {
      P.invalidate();
    },
    /** Regiones para un tamaño (las mismas con que se dibuja). */
    layout: (W, H, frame = true) => layoutFor(W, H, { frame }),
    /** Rectángulo del botón de avance de la pantalla actual, para el clic del puntero (o null). Es el mismo con que se dibuja. */
    advanceRect: (W, H, screen, frame = true) => {
      const r = advanceRect(layoutFor(W, H, { frame }), screen, P);
      // un botón que no se dibujó (corta un panel abierto, D14) tampoco responde al clic
      return r && abiertosAntes.some((o) => overlaps(r, o)) ? null : r;
    },
    /** La fila del selector bajo un punto de px de dispositivo: `{col, id}` o null. */
    listHit: (W, H, screen, x, y, frame = true) => listHit(layoutFor(W, H, { frame }), screen, x, y),
    /**
     * Dibuja un cuadro de interfaz.
     * @param {any} ctx
     * @param {{
     *   W: number, H: number, now: number, dt: number, reduced: boolean, frame?: boolean,
     *   hud?: any, screen?: any, feed?: {text: string, team: number | null}[], banner?: any,
     *   pause?: {visible: boolean, text: string} | null, teamColors?: string[], hover?: any, notices?: string[],
     *   overlays?: {scoreboard?: any, top3?: any, help?: any, safe?: boolean} | null
     * }} f
     */
    draw(ctx, f) {
      const L = layoutFor(f.W, f.H, { frame: f.frame !== false });
      P.begin(ctx, L.u);
      const hud = f.hud ?? null;
      const teamColors =
        f.teamColors ?? (hud?.panels?.length ? hud.panels.map((p) => p.color) : [COLORS.muted, COLORS.muted]);
      const kind = f.screen?.kind ?? null;
      // en las pantallas de resultados el título ocupa el lugar del centro y las tarjetas el de los rieles (10.2)
      const resultados = kind === 'roundEnd' || kind === 'matchEnd';

      // el velo de la pausa va DEBAJO del HUD: el marcador se sigue leyendo
      // el velo dura 200 ms también con movimiento reducido (tabla 10.3: "Igual")
      const velo = tween(anim.veil, f.pause?.visible ? 1 : 0, f.now, false);
      drawVeil(P, L, velo);

      if (hud?.visible) {
        const bars = [0, 1].map((side) => tween(anim.bars[side], hud.panels[side].pct / 100, f.now, f.reduced));
        drawHud(P, L, hud, { bars, icons, results: resultados });
      }
      // todo lo que ocupa el campo, para colocar sin pisar (D10, D11): el chip, el aviso largo y los avisos de teclas
      const abiertos = f.overlays ? overlayRects(L, f.overlays) : [];
      abiertosAntes = abiertos;
      const obs = [];
      if (L.frame) obs.push(L.frame);
      if (hud?.visible && !resultados) {
        obs.push(L.railL, L.railR);
        // la pastilla de cola va debajo de cada riel: el aviso largo, el banner y los avisos de teclas la esquivan
        hud.rails.forEach((rl, side) => rl.queued > 0 && obs.push(queuedRect(L, side)));
      }
      if (f.feed && (hud?.visible || kind === 'lobby')) obs.push(L.feed);
      if (f.minimap) obs.push(L.minimap);
      if (kind) {
        for (const r of cardRects(L, kind, f.screen.model)) obs.push(r);
        const adv = advanceRect(L, f.screen, P);
        if (adv) obs.push(adv);
      }
      for (const r of abiertos) obs.push(r);
      const chip = hud?.chip ? chipRect(P, L, hud.chip.text) : null;
      if (chip) obs.push(chip);
      // aviso largo: en la batalla bajo la banda superior; en el selector y la sala en un lugar libre de la columna central;
      // nunca con H, G o T abiertas ni en los resultados
      let alert = null;
      if (hud?.alert && abiertos.length === 0 && !resultados) {
        const u = L.u;
        const centro = kind === 'matchup' || kind === 'lobby';
        const w = Math.min(Math.round((centro ? 184 : 300) * u), L.top.w - 8 * u);
        // centrado y, si no hay lugar, a la derecha del feed (entre él y el marco del narrador)
        const derecha = L.feed.x + L.feed.w + 2 * u;
        const anchoDer = (L.frame ? L.frame.x : L.top.w) - 2 * u - derecha;
        const columnas = [{ x: Math.round((L.top.w - w) / 2), w }];
        if (anchoDer >= w) columnas.push({ x: derecha, w });
        for (const col of columnas) {
          const caja = alertBox(P, hud.alert.text, col.w);
          const y = freeY({ x: col.x, w: col.w, h: caja.h }, obs, L.field.y + 2 * u, L.bottom.y + L.bottom.h);
          if (y !== null) {
            alert = { rect: { x: col.x, y, w: col.w, h: caja.h }, lines: caja.lines };
            break;
          }
        }
      }
      if (alert) obs.push(alert.rect);
      // hueco del banner (D15): después del aviso largo y antes de los avisos de teclas; fuera de la batalla no se desliza
      const margenBanner = kind === null ? 12 * L.u : 0;
      const slot = bannerSlot(P, L, obs, margenBanner);
      placed.bannerSlot = slot;
      const rectBanner = bannerRect(P, L, f.banner ?? null, slot);
      // el rectángulo reservado incluye el margen del desplazamiento (solo en la batalla)
      const reservaBanner = rectBanner && { x: rectBanner.x, y: slot.y, w: rectBanner.w, h: slot.h + margenBanner };
      if (reservaBanner) obs.push(reservaBanner);
      const puesto = hud ? drawNotices(P, L, hud, alert) : { chip: null, alert: null, noTroops: null };
      if (f.feed && (hud?.visible || kind === 'lobby')) drawFeed(P, L, f.feed, teamColors);

      if (kind !== anim.kind) {
        anim.kind = kind;
        anim.since = f.now;
      }
      if (kind) {
        // D14: con H, G o T abiertas no se dibujan las piezas de la pantalla que cortan el panel (las demás siguen)
        const skip = abiertos.length ? (r) => abiertos.some((o) => overlaps(r, o)) : null;
        drawScreen(P, L, f.screen, {
          age: f.now - anim.since,
          reduced: f.reduced,
          teamColors,
          hover: f.hover ?? null,
          skip,
        });
      }
      drawBanner(P, L, f.banner ?? null, teamColors, slot);
      drawOverlays(P, L, f.overlays ?? null, teamColors);
      const y0 = kind === 'matchup' || kind === 'lobby' || resultados ? L.field.y : L.field.y + 76 * L.u;
      const toasts = drawToasts(P, L, f.notices ?? null, obs, y0);
      placed.chip = puesto.chip;
      placed.alert = puesto.alert;
      placed.toasts = toasts;
      obstacles.length = 0;
      if (hud?.visible && !resultados) {
        obstacles.push(L.railL, L.railR);
        hud.rails.forEach((rl, side) => rl.queued > 0 && obstacles.push(queuedRect(L, side)));
      }
      obstacles.push(L.bottom);
      if (L.frame) obstacles.push(L.frame);
      if (chip) obstacles.push(chip);
      // las tarjetas de los resultados se dibujan encima del mundo: las etiquetas no pasan por debajo
      if (resultados) for (const r of cardRects(L, kind, f.screen.model)) obstacles.push(r);
      if (alert) obstacles.push(alert.rect);
      if (puesto.noTroops) obstacles.push(puesto.noTroops);
      for (const r of abiertos) obstacles.push(r);
      // lo que se dibuja encima del mundo y se transparenta: los avisos de teclas y el banner (del cuadro anterior)
      for (const r of toasts) obstacles.push(r);
      if (reservaBanner) obstacles.push(reservaBanner);
      drawPauseText(P, L, f.pause ?? null, velo);
      if (f.frame !== false) drawFrame(P, L);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    },
  };
}
