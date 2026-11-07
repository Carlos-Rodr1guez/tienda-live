// Banderín de la base (diseño D21 punto 11; Q3 (a), CB-2). Un mástil con un banderín LISO de un solo color, el del
// equipo: sin patrón, sin franjas, sin emblema ni forma de bandera. Ondea con el tiempo de la vista (quieto con
// movimiento reducido). La geometría es la de `drawFlag` del prototipo v3: a 30 px del borde exterior y de y 388 a 434.

import { PALETA } from '../data/paleta.js';

const INK = PALETA.ink;
const MASTIL = '#9DA9BF';
const REMATE = '#FFD84A';
const BASE_Y = 434; // `HQY + 12`
const ALTO = 46;
const COLUMNAS = 12;

/**
 * Emite las piezas del banderín en px de mundo mediante `emit(parte, color, x, y, w, h)`. Partes: `mastil`, `remate`,
 * `borde` (línea de contorno) y `cuerpo` (el relleno: siempre `hex`).
 * @param {(part: string, color: string, x: number, y: number, w: number, h: number) => void} emit
 * @param {{hex: string, side: 0|1, worldW: number, time: number, ruined: boolean, reduced: boolean}} o
 */
export function pennant(emit, { hex, side, worldW, time, ruined, reduced }) {
  const px = side === 1 ? worldW - 30 : 30;
  if (ruined) {
    emit('mastil', INK, px - 1, BASE_Y - 12, 3, 12);
    emit('mastil', MASTIL, px, BASE_Y - 11, 1, 11);
    return;
  }
  const top = BASE_Y - ALTO;
  emit('mastil', INK, px - 1, top - 2, 3, BASE_Y - top + 2);
  emit('mastil', MASTIL, px, top, 1, BASE_Y - top);
  emit('remate', REMATE, px - 1, top - 3, 3, 2);
  const fx = side === 1 ? px - 24 : px + 1;
  for (let i = 0; i < COLUMNAS; i++) {
    const j = side === 1 ? COLUMNAS - 1 - i : i;
    const amp = j / (COLUMNAS - 1);
    const oy = reduced ? 0 : Math.round(Math.sin(time * 5 - j * 0.75 + side) * 2 * amp);
    const x = fx + i * 2;
    emit('borde', INK, x, top + oy, 2, 1);
    emit('borde', INK, x, top + 17 + oy, 2, 1);
    emit('cuerpo', hex, x, top + 1 + oy, 2, 16);
  }
}
