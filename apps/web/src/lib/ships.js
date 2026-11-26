// @ts-check
// Las cuatro siluetas de nave de la dirección A, sobre un lienzo de 48x48. Las usan el arte de las categorías y, en
// la portada, la escalera de regalos (caza, bombardero, coloso y acorazado, de menos a más monedas).
// Código puro: devuelve texto de SVG, sin <use> ni estilos en línea.

/** @typedef {'caza' | 'bombardero' | 'coloso' | 'acorazado'} NombreNave */

/** Trazados y regla de relleno de cada nave. */
export const SHIPS = Object.freeze({
  caza: Object.freeze({ d: 'M24 4 34 42 24 34 14 42Z', evenodd: false }),
  bombardero: Object.freeze({ d: 'M24 6 28 18 45 30 45 39 28 34 24 43 20 34 3 39 3 30 20 18Z', evenodd: false }),
  coloso: Object.freeze({ d: 'M15 4H33L37 14 45 20V38L37 45H11L3 38V20L11 14ZM19 20V32H29V20Z', evenodd: true }),
  acorazado: Object.freeze({
    d: 'M24 2 30 9V15L38 21V41L32 46H16L10 41V21L18 15V9ZM21 24V38H27V24Z',
    evenodd: true,
  }),
});

/** Nombres de las naves, de la más chica a la más grande. */
export const SHIP_NAMES = /** @type {NombreNave[]} */ (Object.freeze(['caza', 'bombardero', 'coloso', 'acorazado']));

/**
 * Número sin ceros de más, con hasta tres decimales.
 * @param {unknown} n
 */
function num(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`se esperaba un número y llegó ${String(n)}`);
  return String(Number(n.toFixed(3)));
}

/**
 * El atributo transform que lleva una nave de su lienzo de 48x48 a (x, y) con el tamaño dado. Con ángulo, la nave
 * gira sobre su propio centro.
 * @param {number} x
 * @param {number} y
 * @param {number} tamano  lado del cuadrado donde queda la nave
 * @param {number} [angulo]  grados
 * @returns {string}
 */
export function shipTransform(x, y, tamano, angulo = 0) {
  const mover = `translate(${num(x)} ${num(y)}) scale(${num(tamano / 48)})`;
  if (angulo === 0) return mover;
  const centro = tamano / 2;
  return `rotate(${num(angulo)} ${num(x + centro)} ${num(y + centro)}) ${mover}`;
}

/**
 * El <path> de una nave, con la clase de color que le toca (se pinta desde la hoja de estilos).
 * @param {string} nombre
 * @param {{ x: number, y: number, tamano: number, clase: string, angulo?: number }} opciones
 * @returns {string}
 */
export function shipPath(nombre, { x, y, tamano, clase, angulo = 0 }) {
  const nave = /** @type {Record<string, { d: string, evenodd: boolean }>} */ (SHIPS)[nombre];
  if (!nave) throw new Error(`no existe la nave "${nombre}"`);
  if (!(tamano > 0)) throw new Error(`el tamaño de la nave tiene que ser mayor que cero y llegó ${String(tamano)}`);
  const regla = nave.evenodd ? ' fill-rule="evenodd"' : '';
  return `<path class="${clase}" transform="${shipTransform(x, y, tamano, angulo)}"${regla} d="${nave.d}"/>`;
}
