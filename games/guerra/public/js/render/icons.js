// Íconos del HUD (diseño D22): la flecha (id `arrow`) se dibuja por código, sin
// ningún archivo ráster, y se hornean una vez por color de equipo. Desde v2.6 no hay roles ni grupos: el HUD usa la
// flecha junto al conteo «en campo» (el ícono de defensa y los íconos del mundo se retiraron).
//
// La geometría y los conteos son puros: sin DOM, sin reloj y sin lienzo propio (el horneado recibe la fábrica de
// lienzos inyectada). Solo LEE el estado del sim.

import { PALETA } from '../data/paleta.js';
import { tint } from './sprites.js';

const INK = PALETA.ink;
/** El borde claro del ícono es el color del equipo aclarado en esta fracción (D22). */
export const ICON_TINT = 0.45;

/**
 * Las filas del prototipo v3 aprobado. `o` es el contorno INK, `h` el borde claro (el color del equipo aclarado 45 %),
 * `T` el relleno del color del equipo y `.` está vacío. El 10×8 INCLUYE el contorno.
 */
const FORMAS = {
  // flecha de 10×8 que apunta al este (hacia el enemigo del equipo izquierdo); el equipo derecho la espeja
  arrow: [
    '.....oo...',
    '.....oTo..',
    'oooooohTo.',
    'ohhhhhhTTo',
    'oTTTTTTTTo',
    'ooooooTTo.',
    '.....oTo..',
    '.....oo...',
  ],
};

/** Los íconos: ancho, alto y las filas (`o`, `h`, `T` y `.`). */
export const ICONS = Object.freeze(
  Object.fromEntries(
    Object.entries(FORMAS).map(([id, rows]) => [
      id,
      Object.freeze({ id, w: rows[0].length, h: rows.length, rows: Object.freeze([...rows]) }),
    ]),
  ),
);

// ---------------------------------------------------------------------------------------------------------------
// horneado

/**
 * Hornea los íconos por color de equipo: normal y espejado de cada uno, en DOS capas del tamaño del ícono (10×8, con el
 * contorno dentro): `line` con el contorno INK y el borde claro, y `fill` con el relleno del color del equipo.
 * El horneado cuenta una vez por color y nunca por cuadro.
 * @param {{createCanvas: (w: number, h: number) => any}} o
 */
export function createIconBank({ createCanvas }) {
  /** @type {Record<string, any>[]} */
  const teams = [];
  const byColor = new Map();
  let bakeCount = 0;

  function pintar(id, hex, espejo) {
    const ic = ICONS[id];
    const capa = (colores) => {
      const c = createCanvas(ic.w, ic.h);
      const g = c.getContext('2d');
      for (const [letra, color] of colores) {
        g.fillStyle = color;
        for (let y = 0; y < ic.h; y++)
          for (let x = 0; x < ic.w; x++) if (ic.rows[y][x] === letra) g.fillRect(espejo ? ic.w - 1 - x : x, y, 1, 1);
      }
      return c;
    };
    return {
      line: capa([
        ['o', INK],
        ['h', tint(hex, ICON_TINT)],
      ]),
      fill: capa([['T', hex]]),
    };
  }

  return {
    get bakeCount() {
      return bakeCount;
    },
    /** Hornea (una vez por color) y devuelve el índice del equipo. @param {string} hex */
    bake(hex) {
      const prev = byColor.get(hex);
      if (prev !== undefined) return prev;
      const t = {};
      for (const id of Object.keys(ICONS)) t[id] = [pintar(id, hex, false), pintar(id, hex, true)];
      teams.push(t);
      byColor.set(hex, teams.length - 1);
      bakeCount++;
      return teams.length - 1;
    },
    /** Las dos capas horneadas de un ícono, `{line, fill}`; `espejo` lo hace mirar al oeste. */
    layers(team, id, espejo) {
      return teams[team][id][espejo ? 1 : 0];
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// HUD (espacio de UI) y conteos

/** El rectángulo de un ícono del HUD: tamaño fijo por la escala entera `u`, nunca por el zoom. */
export function uiIconRect(id, x, y, u) {
  return { x, y, w: ICONS[id].w * u, h: ICONS[id].h * u };
}

/**
 * Dibuja un ícono en espacio de UI: `(x, y)` es su esquina. Son las dos capas, líneas y relleno, opacas.
 * @param {any} ctx @param {ReturnType<typeof createIconBank>} bank @param {number} team índice de `bank.bake`
 * @param {string} id @param {number} x @param {number} y @param {number} u escala entera de la interfaz
 * @param {boolean} [espejo]
 */
export function drawUiIcon(ctx, bank, team, id, x, y, u, espejo = false) {
  const ic = ICONS[id];
  const { line, fill } = bank.layers(team, id, espejo);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(line, x, y, ic.w * u, ic.h * u);
  ctx.drawImage(fill, x, y, ic.w * u, ic.h * u);
}

/**
 * Unidades en el campo por lado, para el HUD (CB-17): se cuentan de `world.units` (el sim ya no tiene grupos).
 * @param {any} world
 * @returns {number[]} izquierdo, derecho
 */
export function inFieldCounts(world) {
  const out = [0, 0];
  for (const u of world?.units ?? []) if (u.alive) out[u.side]++;
  return out;
}
