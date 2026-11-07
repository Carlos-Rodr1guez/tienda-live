// Proyección de un punto del mundo a la pantalla, igual que la del dibujo de unidades (diseño D21 punto 2). Las
// etiquetas y los obstáculos de los íconos viven en pantalla, pero tienen que caer EXACTAMENTE donde cae el sprite:
// si usaran otro redondeo temblarían respecto de él.
//
//  - pasada de dispositivo (s entera >= 2): la entidad va en `round(x·s) − ox`;
//  - LOW: la entidad va en un px de mundo entero y la copia a pantalla la multiplica por `s`: `round(x)·s − ox`.

/**
 * Un eje (x o y) de un punto del mundo, en px de dispositivo.
 * @param {number} w px de mundo (ya interpolado)
 * @param {{s: number, device: boolean}} v
 * @param {number} o origen de la cámara en px de dispositivo (`ox` u `oy`)
 */
export function projectAxis(w, v, o) {
  return v.device ? Math.round(w * v.s) - o : Math.round(w) * v.s - o;
}

/** La vista de un cuadro, como la dejó el render en sus estadísticas (`s`, `ox`, `oy`, `devicePass`). */
export function viewOf(stats, out = { s: 1, ox: 0, oy: 0, device: false }) {
  out.s = stats.s;
  out.ox = stats.ox;
  out.oy = stats.oy;
  out.device = stats.devicePass;
  return out;
}
