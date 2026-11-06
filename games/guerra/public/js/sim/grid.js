// Grilla espacial (diseño D19, R1): celdas de 48 px, reconstruida en cada paso con una ordenación por conteo sin
// asignaciones nuevas (los arreglos se reservan una vez y solo crecen si hace falta). Las consultas recorren solo
// las celdas vecinas, así el costo por paso es lineal y no cuadrático.

/**
 * @param {{w:number, h:number, cell?:number, capacity?:number}} o
 */
export function createGrid({ w, h, cell = 48, capacity = 512 }) {
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  let cellOf = new Int32Array(capacity);
  const start = new Int32Array(gw * gh + 1);
  /** @type {any[]} */
  let sorted = new Array(capacity);
  let count = 0;

  const cx = (x) => {
    const c = Math.floor(x / cell);
    return c < 0 ? 0 : c >= gw ? gw - 1 : c;
  };
  const cy = (y) => {
    const c = Math.floor(y / cell);
    return c < 0 ? 0 : c >= gh ? gh - 1 : c;
  };

  const grid = {
    /** Cuántas distancias midieron las consultas (para la prueba de costo lineal). */
    distCalls: 0,

    /**
     * Reconstruye con los `n` primeros elementos de `items` (objetos con `x` e `y`).
     * @param {{x:number,y:number}[]} items
     * @param {number} n
     */
    rebuild(items, n) {
      if (n > cellOf.length) {
        cellOf = new Int32Array(n * 2);
        sorted = new Array(n * 2);
      }
      count = n;
      start.fill(0);
      for (let i = 0; i < n; i++) {
        const c = cy(items[i].y) * gw + cx(items[i].x);
        cellOf[i] = c;
        start[c + 1]++;
      }
      for (let c = 0; c < gw * gh; c++) start[c + 1] += start[c];
      // `start[c]` es el comienzo de la celda c; se usa como cursor y se restaura después
      for (let i = 0; i < n; i++) sorted[start[cellOf[i]]++] = items[i];
      for (let c = gw * gh; c > 0; c--) start[c] = start[c - 1];
      start[0] = 0;
    },

    /** Elementos con x e y dentro de la caja (bordes incluidos). */
    forEachInBox(x0, y0, x1, y1, fn) {
      if (count === 0) return;
      const ex = cx(x1);
      const ey = cy(y1);
      for (let j = cy(y0); j <= ey; j++) {
        for (let i = cx(x0); i <= ex; i++) {
          const c = j * gw + i;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const p = sorted[k];
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) fn(p);
          }
        }
      }
    },

    /** Elementos a distancia ≤ r de (x, y). */
    forEachInRadius(x, y, r, fn) {
      if (count === 0) return;
      const r2 = r * r;
      const ex = cx(x + r);
      const ey = cy(y + r);
      for (let j = cy(y - r); j <= ey; j++) {
        for (let i = cx(x - r); i <= ex; i++) {
          const c = j * gw + i;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const p = sorted[k];
            const dx = p.x - x;
            const dy = p.y - y;
            grid.distCalls++;
            if (dx * dx + dy * dy <= r2) fn(p);
          }
        }
      }
    },

    /**
     * El elemento más cercano a distancia ≤ r que pasa el filtro. Empate de distancia: el id menor.
     * @returns {any|null}
     */
    nearest(x, y, r, filter) {
      if (count === 0) return null;
      let best = null;
      let bd = r * r;
      const ex = cx(x + r);
      const ey = cy(y + r);
      for (let j = cy(y - r); j <= ey; j++) {
        for (let i = cx(x - r); i <= ex; i++) {
          const c = j * gw + i;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const p = sorted[k];
            const dx = p.x - x;
            const dy = p.y - y;
            const d = dx * dx + dy * dy;
            grid.distCalls++;
            if (d > bd || (d === bd && best !== null && p.id > best.id)) continue;
            if (filter && !filter(p)) continue;
            bd = d;
            best = p;
          }
        }
      }
      return best;
    },
  };
  return grid;
}
