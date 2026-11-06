// Selector de pares y descriptores de equipo (CB-1, CB-2, CB-3). Todos los pares de la lista se pueden jugar:
// no hay nada que prohíba un par. Puro: recibe la lista de países, no importa los datos.

import { pickColors } from './colors.js';
import { PALETA } from '../data/paleta.js';

/** Silueta de la base de cada lado: dos artes distintos, no un mismo arte en espejo (CB-3). */
const ART = Object.freeze({ left: 'base-fortin', right: 'base-ciudadela' });

/**
 * Países que se pueden elegir como segundo, una vez elegido `firstId`: todos los demás, en el orden de la lista.
 * @template {{id:string}} P
 * @param {readonly P[]} paises
 * @param {string} firstId
 * @returns {P[]} vacío si `firstId` no existe
 */
export function secondChoices(paises, firstId) {
  return paises.some((c) => c.id === firstId) ? paises.filter((c) => c.id !== firstId) : [];
}

/**
 * Valida el par y arma los descriptores de equipo: el primer país va a la izquierda y el segundo a la derecha.
 * Cada equipo lleva su nombre, UN color, su silueta, el chip con el nombre y un banderín liso del mismo color.
 * Los colores no dependen de qué país va a la izquierda (CB-3).
 * @param {readonly {id:string, iso:string, name:string, colors:readonly string[]}[]} paises
 * @param {string} idLeft
 * @param {string} idRight
 * @param {{pairColors?: Record<string, string[]>}} [opts]
 * @returns {{ok: true, teams: object[]} | {ok: false, error: string}}
 */
export function describePair(paises, idLeft, idRight, { pairColors } = {}) {
  const left = paises.find((c) => c.id === idLeft);
  const right = paises.find((c) => c.id === idRight);
  if (!left || !right) return { ok: false, error: `país desconocido: "${left ? idRight : idLeft}"` };
  if (left.id === right.id) return { ok: false, error: 'los dos países son el mismo' };
  const { colors } = pickColors(left, right, { pairColors });
  const team = (pais, side) => {
    const colorId = colors[pais.id];
    const color = PALETA.colors.find((c) => c.id === colorId).hex;
    return {
      id: pais.id,
      iso: pais.iso,
      name: pais.name,
      side,
      colorId,
      color,
      art: ART[side],
      chip: { text: pais.name, bg: color, fg: PALETA.ink },
      pennant: { fill: color },
    };
  };
  return { ok: true, teams: [team(left, 'left'), team(right, 'right')] };
}
