// Fuentes y colores de la interfaz (diseño D21 punto 15, §10.1, D26). Un solo lugar: el dibujo de todo el HUD, las
// pantallas, los banners, las etiquetas y F2 piden aquí la fuente y los colores; ningún otro archivo escribe una pila
// de fuentes ni un color de texto suelto. Solo datos y funciones puras.
//
// Fuentes: Pixelify Sans 600 para el texto y Silkscreen 700 para los títulos y rótulos en mayúsculas, con respaldo
// `system-ui, sans-serif`. Los archivos se traen en la tarea 6.9 (lote 6b): hasta entonces se ve el respaldo, y
// los anchos se miden con la misma fuente con que se dibuja (`fontCss`).

import { PALETA } from '../data/paleta.js';

/** Pilas de fuentes. `mono` es solo para el panel de rendimiento F2 (cifras que no bailan). */
export const FONTS = Object.freeze({
  body: Object.freeze({ weight: 600, family: '"Pixelify Sans", system-ui, sans-serif' }),
  display: Object.freeze({ weight: 700, family: '"Silkscreen", system-ui, sans-serif' }),
  mono: Object.freeze({ weight: 400, family: 'ui-monospace, Consolas, monospace' }),
});

/** Valor de `ctx.font` para una fuente de la pila y un tamaño en px de dispositivo. */
export function fontCss(kind, px) {
  const f = FONTS[kind] ?? FONTS.body;
  return `${f.weight} ${Math.max(1, Math.round(px))}px ${f.family}`;
}

/** Tamaños de texto en px VIRTUALES (se multiplican por la escala entera de la interfaz `u`). */
export const TYPE = Object.freeze({ small: 7, body: 7, banner: 8, heading: 10, title: 14 });

/** Colores de la interfaz. El texto secundario se tiñe del azul del panel, nunca un gris neutro. */
export const COLORS = Object.freeze({
  ink: PALETA.ink,
  /** Texto principal y secundario sobre el panel. */
  text: '#F4F7FF',
  muted: '#A9B5DC',
  /** Texto de un elemento deshabilitado: apagado pero legible (≥ 3:1 aunque WCAG lo exima). */
  disabled: '#8E9AC4',
  /** Foco de teclado, enlace de estado y cámara automática. */
  focus: '#5BC8F5',
  /** Realce al pasar el puntero (solo puntero fino) y fila elegida. */
  hover: '#26324F',
  selected: '#1B2A4A',
  /** Vacío de las barras: una placa OPACA, para que el relleno siempre se mida contra ella y no contra el mundo. */
  track: '#0E1320',
  /** Resalte del MVP: texto INK sobre oro. */
  mvp: '#F5C518',
  /** Borde del marco del narrador: se mide sobre blanco y sobre negro, porque adentro va la cámara del streamer. */
  frame: '#7A86AE',
  /** Banner y chips de aviso. */
  banner: '#1B2A4A',
  /** Error: título y fondo. */
  errorText: '#FFB4B4',
  errorBg: '#3A1216',
  /** Chip de conexión. */
  chipBg: '#1B2A4A',
  chipWarn: '#F5C518',
  /** Superposición de zonas seguras (F3): trazo y relleno suave, solo para el narrador. */
  safeZone: '#FFB454',
});

/** Opacidad del panel del HUD (INK al 78 %) y del velo de la pausa. */
export const PANEL_ALPHA = 0.78;
export const VEIL_ALPHA = 0.86;

/** Un color `#RRGGBB` como `rgba(r,g,b,a)`. */
export function rgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  const v = Number.parseInt(h.length === 6 ? h : '000000', 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

/**
 * Pares texto/fondo y gráfico/fondo de la matriz de estados del HUD y las pantallas (diseño §10.2). `bg` es un color
 * o `{over, alpha}`: ese color al `alpha` sobre el peor fondo posible. Los paneles son TRANSLÚCIDOS (el mundo se ve
 * detrás) y se miden contra BLANCO PURO, el peor caso (el núcleo de una explosión): si pasa ahí, pasa sobre cualquier
 * terreno. Mínimos: 4,5:1 el texto normal; 3:1 el texto grande y los gráficos (`kind`).
 * `teams` expande el par a cada color de la paleta de equipos.
 */
export const WORST_BACKDROP = '#FFFFFF';
export const STATE_MATRIX = Object.freeze([
  { id: 'hud.text', state: 'normal', kind: 'text', fg: COLORS.text, bg: { over: COLORS.ink, alpha: PANEL_ALPHA } },
  { id: 'hud.muted', state: 'normal', kind: 'text', fg: COLORS.muted, bg: { over: COLORS.ink, alpha: PANEL_ALPHA } },
  {
    id: 'hud.disabled',
    state: 'deshabilitado',
    kind: 'graphic',
    fg: COLORS.disabled,
    bg: { over: COLORS.ink, alpha: PANEL_ALPHA },
  },
  { id: 'hud.chip', state: 'normal', kind: 'text', fg: COLORS.ink, bg: 'team' },
  { id: 'hud.baseBarFill', state: 'normal', kind: 'graphic', fg: 'team', bg: COLORS.track },
  {
    id: 'hud.dotEmpty',
    state: 'vacío',
    kind: 'graphic',
    fg: COLORS.muted,
    bg: { over: COLORS.ink, alpha: PANEL_ALPHA },
  },
  {
    id: 'hud.statusAuto',
    state: 'normal',
    kind: 'text',
    fg: COLORS.focus,
    bg: { over: COLORS.ink, alpha: PANEL_ALPHA },
  },
  {
    id: 'hud.focus',
    state: 'foco de teclado',
    kind: 'graphic',
    fg: COLORS.focus,
    bg: { over: COLORS.ink, alpha: PANEL_ALPHA },
  },
  { id: 'hud.hover', state: 'hover (puntero fino)', kind: 'text', fg: COLORS.text, bg: COLORS.hover },
  { id: 'hud.hoverMuted', state: 'hover (puntero fino)', kind: 'text', fg: COLORS.muted, bg: COLORS.hover },
  { id: 'hud.selected', state: 'elegido', kind: 'text', fg: COLORS.text, bg: COLORS.selected },
  { id: 'hud.selectedMuted', state: 'elegido', kind: 'text', fg: COLORS.muted, bg: COLORS.selected },
  { id: 'screen.button', state: 'normal', kind: 'text', fg: COLORS.ink, bg: COLORS.focus },
  { id: 'screen.buttonOff', state: 'deshabilitado', kind: 'graphic', fg: COLORS.disabled, bg: COLORS.track },
  { id: 'screen.mvp', state: 'normal', kind: 'text', fg: COLORS.ink, bg: COLORS.mvp },
  { id: 'screen.pause', state: 'pausa', kind: 'text', fg: COLORS.text, bg: { over: COLORS.ink, alpha: VEIL_ALPHA } },
  { id: 'screen.error', state: 'error', kind: 'text', fg: COLORS.errorText, bg: COLORS.errorBg },
  { id: 'screen.errorMuted', state: 'error', kind: 'text', fg: COLORS.text, bg: COLORS.errorBg },
  { id: 'chip.connection', state: 'cargando', kind: 'text', fg: COLORS.text, bg: COLORS.chipBg },
  { id: 'chip.warn', state: 'error', kind: 'graphic', fg: COLORS.chipWarn, bg: COLORS.chipBg },
  { id: 'banner.text', state: 'normal', kind: 'text', fg: COLORS.text, bg: COLORS.banner },
  { id: 'banner.team', state: 'normal', kind: 'graphic', fg: 'team', bg: COLORS.banner },
  { id: 'hud.teamDot', state: 'normal', kind: 'graphic', fg: 'team', bg: COLORS.ink },
  {
    id: 'feed.dotMuted',
    state: 'vacío',
    kind: 'graphic',
    fg: COLORS.muted,
    bg: { over: COLORS.ink, alpha: PANEL_ALPHA },
  },
  { id: 'chip.warnOutline', state: 'error', kind: 'graphic', fg: COLORS.chipWarn, bg: COLORS.errorBg },
  { id: 'frame.onWhite', state: 'normal', kind: 'graphic', fg: COLORS.frame, bg: '#FFFFFF' },
  { id: 'frame.onBlack', state: 'normal', kind: 'graphic', fg: COLORS.frame, bg: '#000000' },
  { id: 'rail.text', state: 'vacío', kind: 'text', fg: COLORS.muted, bg: { over: COLORS.ink, alpha: PANEL_ALPHA } },
]);

/** Los colores de equipo de la paleta (D26). */
export const TEAM_COLORS = Object.freeze(PALETA.colors.map((c) => c.hex));
