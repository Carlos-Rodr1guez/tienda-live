// Pincel de la interfaz: lo que comparten el HUD, las pantallas y los banners al dibujar en el lienzo principal. Todo en
// px VIRTUALES por la escala entera `u` (nada se escala con el zoom, NM-6), con la pila de fuentes de `ui/theme.js`, el
// texto siempre recortado por ancho medido (caché por valor: lo que solo cambia con eventos no se re-mide) y los nombres
// limpios de caracteres bidi y de ancho cero. No guarda estado de juego; solo `ctx`, `u` y la fuente puesta.

import { cleanText, clearWidths, createTextFitter, drawTabular } from './text.js';
import { COLORS, fontCss, PANEL_ALPHA, rgba, TYPE } from './theme.js';

const PANEL_FILL = rgba(COLORS.ink, PANEL_ALPHA);
const NO_LIMIT = 1e9;

export function createPainter() {
  /** @type {any} */
  let ctx = null;
  let u = 1;
  let cur = '';
  const fitter = createTextFitter({
    measure: (font, t) => {
      if (cur !== font) {
        ctx.font = font;
        cur = font;
      }
      return Number(ctx.measureText(t)?.width) || 0;
    },
  });
  /** @type {Map<string, string[]>} */
  const wraps = new Map();

  /** D14: zonas (rectángulos) en que no se dibuja nada: las piezas de la pantalla que cortan un panel abierto. */
  /** @type {{x: number, y: number, w: number, h: number}[]} */
  let ocultas = [];
  const enOculta = (x, y) => ocultas.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const tocaOculta = (r) =>
    ocultas.some((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);

  const P = {
    fitter,
    /** Fija las zonas sin dibujo (o `[]` para dibujar todo). */
    ocultar(rects) {
      ocultas = rects;
    },
    get ctx() {
      return ctx;
    },
    get u() {
      return u;
    },
    /** Empieza un cuadro de interfaz: estado conocido del lienzo (otro código pudo cambiarlo). */
    begin(c, scale) {
      ctx = c;
      u = Math.max(1, scale);
      cur = '';
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.direction = 'ltr';
    },
    /** La fuente de la pila en `px` virtuales. Devuelve el valor de `ctx.font`. */
    setFont(kind, px = TYPE.body) {
      const f = fontCss(kind, px * u);
      if (f !== cur) {
        ctx.font = f;
        cur = f;
      }
      return f;
    },
    /** Tras `ctx.restore()` o código ajeno la fuente puesta ya no es la que creemos: se vuelve a fijar. */
    touch() {
      cur = '';
    },
    /** Los anchos medidos cambian (llegó una fuente o cambió el tamaño). */
    invalidate() {
      fitter.clear();
      wraps.clear();
      clearWidths();
    },
    rect(r, color, alpha = 1) {
      if (ocultas.length && tocaOculta(r)) return;
      if (alpha !== 1) ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (alpha !== 1) ctx.globalAlpha = 1;
    },
    /** Panel translúcido del HUD (INK al 78 %). */
    panel(r) {
      if (ocultas.length && tocaOculta(r)) return;
      ctx.fillStyle = PANEL_FILL;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    },
    /**
     * Un texto de una línea, limpio y recortado por ancho medido.
     * @param {unknown} str
     * @param {{kind?: string, size?: number, color?: string, align?: 'left'|'right'|'center', maxW?: number}} [o]
     * @returns {{text: string, width: number, cut: boolean}}
     */
    text(str, x, y, o = {}) {
      if (ocultas.length && enOculta(x, y)) return { text: '', width: 0, cut: false };
      const font = P.setFont(o.kind ?? 'body', o.size ?? TYPE.body);
      const r = fitter.fit(font, str, o.maxW ?? NO_LIMIT);
      ctx.fillStyle = o.color ?? COLORS.text;
      ctx.textAlign = o.align ?? 'left';
      ctx.fillText(r.text, x, y);
      return r;
    },
    /** Cifras tabulares (reloj, porcentajes, XP): cada dígito en su celda. */
    num(str, x, y, o = {}) {
      if (ocultas.length && enOculta(x, y)) return;
      const font = P.setFont(o.kind ?? 'body', o.size ?? TYPE.body);
      ctx.fillStyle = o.color ?? COLORS.text;
      // con ancho máximo: si las cifras en celdas no caben, se recorta como cualquier texto (nunca pisa al vecino)
      if (o.maxW !== undefined && fitter.fit(font, str, NO_LIMIT).width > o.maxW) {
        ctx.textAlign = o.align ?? 'left';
        ctx.fillText(fitter.fit(font, str, o.maxW).text, x, y);
        return;
      }
      drawTabular(ctx, str, x, y, o.align ?? 'left', font);
    },
    /** Ancho en px de dispositivo de un texto con la fuente dada (con la caché del recortador). */
    width(kind, size, str) {
      const font = P.setFont(kind, size);
      return fitter.fit(font, str, NO_LIMIT).width;
    },
    /**
     * Parte un texto en renglones por palabras (como mucho `maxLines`; el último se recorta con "…"). Cacheado por valor.
     * @returns {string[]}
     */
    wrap(str, maxW, maxLines, o = {}) {
      const font = P.setFont(o.kind ?? 'body', o.size ?? TYPE.body);
      const text = cleanText(str);
      const key = `${font}\u0000${maxW}\u0000${maxLines}\u0000${text}`;
      const hit = wraps.get(key);
      if (hit !== undefined) return hit;
      const words = text.split(' ').filter(Boolean);
      const lines = [];
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const cand = line === '' ? words[i] : `${line} ${words[i]}`;
        if (line !== '' && fitter.fit(font, cand, NO_LIMIT).width > maxW) {
          lines.push(line);
          line = words[i];
        } else line = cand;
      }
      if (line !== '') lines.push(line);
      // lo que no entra se junta en el último renglón, que se recorta con "…"
      const out =
        lines.length > maxLines
          ? [...lines.slice(0, maxLines - 1), fitter.fit(font, lines.slice(maxLines - 1).join(' '), maxW).text]
          : lines.map((l) => fitter.fit(font, l, maxW).text);
      if (wraps.size > 256) wraps.clear();
      wraps.set(key, out);
      return out;
    },
    /**
     * Un punto de equipo: círculo (izquierdo) o rombo (derecho), relleno con un aro INK (así se mide contra INK y no contra
     * el mundo que se ve detrás del panel translúcido) o, vacío, solo el contorno.
     */
    dot(cx, cy, size, shape, filled, color) {
      if (ocultas.length && enOculta(cx, cy)) return;
      const r = size / 2;
      ctx.beginPath();
      if (shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
      else {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
      }
      if (filled) {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(1, u);
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
      } else {
        ctx.lineWidth = Math.max(1, u);
        ctx.strokeStyle = COLORS.muted;
        ctx.stroke();
      }
    },
    /** Contorno de `u` px (o `grosor` virtuales) por dentro del rectángulo. */
    outline(r, color, grosor = 1) {
      if (ocultas.length && tocaOculta(r)) return;
      const g = Math.max(1, Math.round(grosor * u));
      ctx.fillStyle = color;
      ctx.fillRect(r.x, r.y, r.w, g);
      ctx.fillRect(r.x, r.y + r.h - g, r.w, g);
      ctx.fillRect(r.x, r.y, g, r.h);
      ctx.fillRect(r.x + r.w - g, r.y, g, r.h);
    },
  };
  return P;
}
