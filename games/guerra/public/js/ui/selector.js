// Selector de países con teclado (10.2). Estado puro de lo que elige el narrador: la lista izquierda y la derecha, cuál tiene
// el foco y en qué país. Las flechas mueven el foco DENTRO de la lista activa y eligen ese país; `Tab` pasa de una lista a la
// otra (en el selector no hay mundo que panear, así que no choca con D25); `Home` y `End` saltan a los extremos. `Enter` lo
// resuelve `main.js` (es el botón de avance): aquí solo se sabe si hay un par válido.

/**
 * @param {{paises: readonly {id: string}[], left?: string | null, right?: string | null}} o
 */
export function createSelector({ paises, left = null, right = null }) {
  const existe = (id) => id !== null && paises.some((p) => p.id === id);
  /** `focus` es el país con el foco de teclado y `focusCol` la lista que lo tiene (0 izquierda, 1 derecha). */
  const sel = {
    left: existe(left) ? left : null,
    right: existe(right) ? right : null,
    focus: /** @type {string | null} */ (null),
    focusCol: 0,
  };
  sel.focus = sel.left ?? sel.right;
  if (sel.left === null && sel.right !== null) sel.focusCol = 1;
  const clave = (col) => (col === 0 ? 'left' : 'right');

  function pick(col, id) {
    if (!existe(id)) return;
    sel[clave(col)] = id;
    sel.focus = id;
    sel.focusCol = col;
  }
  function mover(delta, absoluto) {
    if (paises.length === 0) return;
    const actual = sel[clave(sel.focusCol)];
    const i = paises.findIndex((p) => p.id === actual);
    let n;
    if (absoluto !== undefined) n = absoluto;
    else if (i < 0) n = delta > 0 ? 0 : paises.length - 1;
    else n = Math.min(paises.length - 1, Math.max(0, i + delta));
    pick(sel.focusCol, paises[n].id);
  }

  return {
    sel,
    pick,
    /** @returns {boolean} si la tecla era del selector */
    key(e) {
      switch (e.key) {
        case 'ArrowDown':
          mover(1);
          return true;
        case 'ArrowUp':
          mover(-1);
          return true;
        case 'Home':
          mover(0, 0);
          return true;
        case 'End':
          mover(0, paises.length - 1);
          return true;
        case 'Tab': {
          sel.focusCol = sel.focusCol === 0 ? 1 : 0;
          // el foco va a lo que esa lista tenía elegido, o al primer país si no eligió nada; la elección no cambia
          sel.focus = sel[clave(sel.focusCol)] ?? paises[0]?.id ?? null;
          return true;
        }
        default:
          return false;
      }
    },
    /** El par elegido, o `null` si falta un país o son el mismo. */
    pair() {
      return sel.left !== null && sel.right !== null && sel.left !== sel.right ? { a: sel.left, b: sel.right } : null;
    },
  };
}
