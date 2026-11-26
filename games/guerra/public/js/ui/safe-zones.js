// Zonas seguras de un LIVE horizontal 16:9 (NM-10, F3). Son rectángulos PROVISORIOS: las franjas donde TikTok suele poner su
// propia interfaz (cabecera, comentarios y regalos, laterales). F3 las muestra semitransparentes y se corrigen con el segundo
// teléfono (Gate 0). Puro: la geometría sale del tamaño del lienzo.

/** Márgenes como fracción del lienzo: arriba, abajo, izquierda y derecha. */
export const SAFE_INSETS = Object.freeze({ top: 0.08, bottom: 0.14, left: 0.04, right: 0.04 });

/**
 * Las franjas NO seguras (cuatro rectángulos que no se pisan) para un lienzo de `W × H`; lo que queda al medio es la zona
 * segura. Todas caen dentro del lienzo.
 * @returns {{id: string, x: number, y: number, w: number, h: number}[]}
 */
export function safeZones(W, H) {
  const top = Math.round(H * SAFE_INSETS.top);
  const bottom = Math.round(H * SAFE_INSETS.bottom);
  const left = Math.round(W * SAFE_INSETS.left);
  const right = Math.round(W * SAFE_INSETS.right);
  return [
    { id: 'top', x: 0, y: 0, w: W, h: top },
    { id: 'bottom', x: 0, y: H - bottom, w: W, h: bottom },
    { id: 'left', x: 0, y: top, w: left, h: H - top - bottom },
    { id: 'right', x: W - right, y: top, w: right, h: H - top - bottom },
  ];
}

/** El rectángulo seguro (lo que queda dentro de las franjas). */
export function safeArea(W, H) {
  const [t, b, l, r] = safeZones(W, H);
  return { x: l.w, y: t.h, w: W - l.w - r.w, h: H - t.h - b.h };
}
