// Primitivas de píxel para el arte dibujado en código: discos, elipses y líneas hechas de rectángulos enteros.
// `k` es la escala de destino (1 en LOW; `s` en la pasada de dispositivo): las filas se ensanchan, los puntos no se mueven.

/** Disco de radio `r` centrado en (cx, cy) en px de destino. */
export function disc(g, cx, cy, r, k = 1) {
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r + r * 0.8 - dy * dy));
    g.fillRect(cx - w * k, cy + dy * k, (w * 2 + 1) * k, k);
  }
}

/** Elipse de semiejes (rx, ry) centrada en (cx, cy). */
export function ell(g, cx, cy, rx, ry, k = 1) {
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    g.fillRect(cx - w * k, cy + dy * k, (w * 2 + 1) * k, k);
  }
}

/** Línea de Bresenham de píxeles de 1x1 (solo en el espacio del mundo: grietas y cañones del arte prerenderizado). */
export function line(g, x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let n = 0; n < 400; n++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) {
      e += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      e += dx;
      y0 += sy;
    }
  }
}
