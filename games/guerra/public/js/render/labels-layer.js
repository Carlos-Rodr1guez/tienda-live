// Dibujo de las etiquetas de donantes (CB-16, diseño D22 y §10.3). Va en pantalla, DESPUÉS de las capas del mundo y antes
// del HUD, minimapa, banners y marco (D21 punto 6). Une la parte pura (`labels.js`: selección, texto, colocación) con el
// lienzo:
//   - el texto es del lienzo (`fillText`), nunca HTML, y se mide UNA vez por (donante, rango, nombre, N, fuente);
//   - la pastilla va sobre la misma posición interpolada y proyectada que el sprite (si no, temblaría respecto de él);
//   - tamaño fijo en px virtuales por la escala entera de la interfaz `u`: no crece con el zoom (NM-6);
//   - las etiquetas que entran o salen hacen un fundido de opacidad de 120 ms (§10.3), también con movimiento reducido;
//   - el ranking de donantes se refresca a 5 Hz del reloj de vista; la selección y la colocación corren cada cuadro.
// Solo LEE el sim y el registro del kit (get, rankOf, displayName): nunca `registry.drain()` ni escribe en nada.

import { PALETA } from '../data/paleta.js';
import {
  createLayoutScratch,
  createRanking,
  createSelectorScratch,
  fitText,
  labelText,
  layoutLabels,
  resolveLabels,
  selectLabels,
} from './labels.js';
import { BAND_TOP } from '../ui/layout.js';
import { S } from '../ui/strings.js';
import { FONTS } from '../ui/theme.js';
import { projectAxis } from './project.js';

const INK = PALETA.ink;

/** Duración del fundido de las etiquetas (§10.3). */
export const LABEL_FADE_SECONDS = 0.12;

/** Fuente de las etiquetas: la pila del diseño (`ui/theme.js`), 7 px virtuales. */
export const LABEL_FONT = Object.freeze({ size: 7, weight: FONTS.body.weight, family: FONTS.body.family });

// medidas de la pastilla, en px virtuales (se multiplican por la escala entera de la interfaz)
const PAD_X = 2;
const SHAPE = 4;
const GAP = 2;
const HEIGHT = 10;
/** Espacio entre la cabeza del sprite y el borde inferior de la pastilla. */
const GAP_ABOVE = 2;
const CHROME = 2 * PAD_X + SHAPE + GAP;

/**
 * @param {{
 *   registry: {get: Function, rankOf: Function, displayName: Function} | null,
 *   teamHex: [string, string] | string[], spriteAy: Record<string, number>, marksSize: Record<string, number[]>,
 *   cfg?: Partial<import('./labels.js').LABEL_DEFAULTS>
 * }} o `registry` es null con `?golden`: sin donantes no hay etiquetas
 */
export function createLabelLayer({ registry, teamHex, spriteAy, marksSize, cfg }) {
  const conf = resolveLabels(cfg);
  const ranking = createRanking({ xpOf: (key) => registry?.get(key)?.xp?.match ?? 0, refreshHz: conf.refreshHz });
  const selScratch = createSelectorScratch();
  const layScratch = createLayoutScratch();
  /** @type {Map<string, {rank: string, name: string, onlyRank: boolean, font: string, text: string, w: number}>} */
  const textos = new Map();
  /** @type {Map<string, {alpha: number, target: number, x: number, y: number, w: number, h: number, text: string, side: number}>} */
  const fades = new Map();
  const itemPool = /** @type {any[]} */ ([]);
  const items = /** @type {any[]} */ ([]);
  const porClave = /** @type {Map<string, any>} */ (new Map());
  const obstacles = /** @type {any[]} */ ([]);
  const view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const stats = { selected: 0, drawn: 0, dropped: 0, measures: 0, refreshes: 0, fading: 0 };
  let last = /** @type {number | null} */ (null);

  /** Texto recortado y su ancho, de la caché; solo mide si cambió algo de lo que lo determina. */
  function textoDe(ctx, key, u, font, onlyRank) {
    const rank = String(registry.rankOf(key)?.label ?? '');
    const name = String(registry.displayName(key) ?? S.anon);
    let t = textos.get(key);
    if (t && t.rank === rank && t.name === name && t.onlyRank === onlyRank && t.font === font) return t;
    const RANGO = rank.toLocaleUpperCase('es');
    const full = labelText({ rank, name, hidden: name === S.anon, onlyRank });
    const prefix = onlyRank ? RANGO : `${RANGO} `;
    const fit = fitText({
      prefix,
      name: full.slice(prefix.length),
      maxWidth: conf.maxWidth * u - CHROME * u,
      measure: (s) => Number(ctx.measureText(s)?.width) || 0,
    });
    stats.measures++;
    t ??= { rank, name, onlyRank, font, text: '', w: 0 };
    t.rank = rank;
    t.name = name;
    t.onlyRank = onlyRank;
    t.font = font;
    t.text = fit.text;
    t.w = Math.round(fit.width + CHROME * u);
    textos.set(key, t);
    return t;
  }

  function pastilla(ctx, f, u) {
    const { x, y, w, h } = f;
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = INK;
    ctx.fillRect(x - u, y - u, w + 2 * u, h + 2 * u);
    ctx.fillStyle = teamHex[f.side];
    ctx.fillRect(x, y, w, h);
    // una forma dentro de la pastilla: círculo para el equipo izquierdo y rombo para el derecho (CB-3, sin depender del color)
    ctx.fillStyle = INK;
    const r = (SHAPE * u) / 2;
    const cx = x + PAD_X * u + r;
    const cy = y + h / 2;
    ctx.beginPath();
    if (f.side === 0) ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(f.text, x + (PAD_X + SHAPE + GAP) * u, y + h / 2);
  }

  const layer = {
    /** Pastillas colocadas en el último cuadro (para el clic y el Alt+clic del lote 6: `hitLabel(layer.rects, {x, y})`). */
    rects: /** @type {{key: string, x: number, y: number, w: number, h: number}[]} */ ([]),
    /** Las pastillas que se VEN en el último cuadro, también las que se están apagando (120 ms): el clic y el Alt+clic responden en ellas. */
    hitRects: /** @type {{key: string, x: number, y: number, w: number, h: number}[]} */ ([]),
    stats,
    /** Vacía la caché de texto medido: llega una fuente (`document.fonts` avisa `loadingdone`) y los anchos cambian. */
    invalidate() {
      textos.clear();
    },
    /**
     * @param {any} ctx contexto del lienzo principal
     * @param {{
     *   W: number, H: number, u: number, units: ArrayLike<any>, k: number,
     *   screen: {s: number, ox: number, oy: number, device: boolean, marks: boolean, x0: number, y0: number},
     *   alpha: number, now: number, spotlight?: string | null, onlyRank?: boolean
     * }} f
     */
    draw(ctx, f) {
      if (!registry) {
        layer.rects = [];
        layer.hitRects.length = 0;
        stats.selected = stats.drawn = stats.dropped = stats.fading = 0;
        return;
      }
      const { W, H, u, screen } = f;
      const dt = last === null ? 0 : Math.max(0, f.now - last);
      last = f.now;
      ranking.update(f.now, f.units);
      stats.refreshes = ranking.refreshes;
      view.x0 = screen.x0;
      view.y0 = screen.y0;
      view.x1 = screen.x0 + W / screen.s;
      view.y1 = screen.y0 + H / screen.s;
      const sel = selectLabels(
        { units: f.units, k: f.k, view, alpha: f.alpha, spotlight: f.spotlight ?? null, ranking, cfg: conf },
        selScratch,
      );
      stats.selected = sel.length;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const font = `${LABEL_FONT.weight} ${LABEL_FONT.size * u}px ${LABEL_FONT.family}`;
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      items.length = 0;
      porClave.clear();
      for (let i = 0; i < sel.length; i++) {
        const e = sel[i];
        const t = textoDe(ctx, e.key, u, font, f.onlyRank === true);
        const sx = projectAxis(e.x, screen, screen.ox);
        const sy = projectAxis(e.y, screen, screen.oy);
        const marca = marksSize[e.kind];
        const cima = screen.marks && marca ? sy - (marca[1] + 1) * screen.s : sy - (spriteAy[e.kind] ?? 0) * screen.s;
        const it = itemPool[i] ?? (itemPool[i] = { key: '', cx: 0, bottom: 0, w: 0, h: 0, side: 0, text: '' });
        it.key = e.key;
        it.cx = sx;
        it.bottom = Math.round(cima - GAP_ABOVE * u);
        it.w = t.w;
        it.h = HEIGHT * u;
        it.side = e.side === 0 ? 0 : 1;
        it.text = t.text;
        items.push(it);
        porClave.set(e.key, it);
      }

      obstacles.length = 0;
      // lo que el HUD ocupa sobre el campo (rieles, banda inferior, marco, chip, aviso y paneles abiertos): ninguna caja lo cruza (B9)
      if (f.blockers) for (let i = 0; i < f.blockers.length; i++) obstacles.push(f.blockers[i]);

      const { rects, dropped } = layoutLabels(items, {
        W,
        H,
        bandTop: BAND_TOP * u,
        obstacles,
        gap: u,
        scratch: layScratch,
      });
      layer.rects = rects;
      stats.dropped = dropped;

      for (const fd of fades.values()) fd.target = 0;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const it = porClave.get(r.key);
        let fd = fades.get(r.key);
        if (fd === undefined) {
          fd = { alpha: 0, target: 1, x: 0, y: 0, w: 0, h: 0, text: '', side: 0 };
          fades.set(r.key, fd);
        }
        fd.target = 1;
        fd.x = r.x;
        fd.y = r.y;
        fd.w = r.w;
        fd.h = r.h;
        fd.text = it.text;
        fd.side = it.side;
      }

      let dibujadas = 0;
      let saliendo = 0;
      let visibles = 0;
      for (const [key, fd] of fades) {
        const paso = dt / LABEL_FADE_SECONDS;
        fd.alpha = fd.target === 1 ? Math.min(1, fd.alpha + paso) : Math.max(0, fd.alpha - paso);
        if (fd.target === 0 && fd.alpha <= 0) {
          fades.delete(key);
          continue;
        }
        if (fd.target === 0) saliendo++;
        if (fd.alpha <= 0) continue;
        if (fd.target === 1) dibujadas++;
        pastilla(ctx, fd, u);
        const hr = layer.hitRects[visibles] ?? (layer.hitRects[visibles] = { key: '', x: 0, y: 0, w: 0, h: 0 });
        hr.key = key;
        hr.x = fd.x;
        hr.y = fd.y;
        hr.w = fd.w;
        hr.h = fd.h;
        visibles++;
      }
      layer.hitRects.length = visibles;
      ctx.globalAlpha = 1;
      stats.drawn = dibujadas;
      stats.fading = saliendo;
      if (textos.size > 512) for (const key of textos.keys()) if (!fades.has(key)) textos.delete(key);
    },
  };
  return layer;
}
