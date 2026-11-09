// Colocación de lo que aparece encima del juego sin pisar nada (D10, D11, D12): el aviso largo de conexión, los avisos de
// teclas y las cajas de las etiquetas. Cada pieza se coloca en el primer lugar libre de una lista de obstáculos (los
// rectángulos del HUD y de la pantalla actual), así que por construcción no pisa ninguno. Puro: solo geometría en px.

/** ¿Se cruzan dos rectángulos? Los bordes que se tocan no cuentan. */
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * El primer `y` (de `y0` a `y1 - h`, de a 1 px) en que un rectángulo `{x, w, h}` no cruza ningún obstáculo; `null` si no hay.
 * @param {{x: number, w: number, h: number}} r
 * @param {{x: number, y: number, w: number, h: number}[]} obstacles
 * @param {number} y0
 * @param {number} y1
 */
export function freeY(r, obstacles, y0, y1) {
  const probe = { x: r.x, y: 0, w: r.w, h: r.h };
  for (let y = Math.ceil(y0); y + r.h <= y1; y++) {
    probe.y = y;
    let libre = true;
    for (let i = 0; i < obstacles.length; i++) {
      if (overlaps(probe, obstacles[i])) {
        // salta al borde inferior del obstáculo: no hace falta probar cada px de su alto
        y = Math.max(y, Math.ceil(obstacles[i].y + obstacles[i].h) - 1);
        libre = false;
        break;
      }
    }
    if (libre) return y;
  }
  return null;
}
