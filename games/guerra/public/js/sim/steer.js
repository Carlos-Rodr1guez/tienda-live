// Steering puro del movimiento limpio (D15, CB-22): aproximación, límite de aceleración y orientación con
// histéresis. Sin estado propio ni asignaciones: los resultados salen por un objeto reutilizado (`OUT`), que quien
// llama lee enseguida. Solo + − × ÷, sqrt, min, max, abs y sign.

/** Resultado de la última llamada: `{x, y}`. Se pisa en la llamada siguiente. */
export const OUT = { x: 0, y: 0 };

/**
 * Velocidad deseada para ir al punto a (dx, dy) de distancia: `dirección × min(vmax, arrive·distancia)`.
 * @param {number} dx
 * @param {number} dy
 * @param {number} vmax
 * @param {number} arrive ganancia de llegada (1/s)
 */
export function arriveVelocity(dx, dy, vmax, arrive) {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) {
    OUT.x = 0;
    OUT.y = 0;
    return OUT;
  }
  const s = Math.min(vmax, arrive * d) / d;
  OUT.x = dx * s;
  OUT.y = dy * s;
  return OUT;
}

/**
 * Mueve la velocidad (vx, vy) hacia la deseada (wx, wy) cambiando a lo sumo `maxDelta` en módulo.
 * @returns {{x:number,y:number}} la velocidad nueva
 */
export function limitDelta(vx, vy, wx, wy, maxDelta) {
  const ax = wx - vx;
  const ay = wy - vy;
  const m = Math.sqrt(ax * ax + ay * ay);
  if (m <= maxDelta || m < 1e-12) {
    OUT.x = wx;
    OUT.y = wy;
  } else {
    const k = maxDelta / m;
    OUT.x = vx + ax * k;
    OUT.y = vy + ay * k;
  }
  return OUT;
}

/** Recorta (x, y) a un módulo máximo. */
export function clampMagnitude(x, y, max) {
  const m = Math.sqrt(x * x + y * y);
  if (m <= max || m < 1e-12) {
    OUT.x = x;
    OUT.y = y;
  } else {
    const k = max / m;
    OUT.x = x * k;
    OUT.y = y * k;
  }
  return OUT;
}

/**
 * Orientación de una unidad (2 lados). Con blanco: hacia él si `|dx| ≥ 2`. Sin blanco: hacia donde va si
 * `|vx| ≥ 0,2·vmax`. Si no, se conserva. Gira solo si la deseada difiere `holdSteps` pasos seguidos (0,3 s).
 * @param {{dir:number, faceSteps:number, vx:number}} u
 * @param {number|null} targetDx x del blanco menos x de la unidad, o null sin blanco
 * @param {number} vmax
 * @param {number} holdSteps
 */
export function updateFacing(u, targetDx, vmax, holdSteps) {
  let want = u.dir;
  if (targetDx !== null) {
    if (Math.abs(targetDx) >= 2) want = Math.sign(targetDx);
  } else if (Math.abs(u.vx) >= 0.2 * vmax) {
    want = Math.sign(u.vx);
  }
  if (want !== u.dir) {
    u.faceSteps++;
    if (u.faceSteps >= holdSteps) {
      u.dir = want;
      u.faceSteps = 0;
    }
  } else {
    u.faceSteps = 0;
  }
}

/** ¿Mira hacia su blanco? Con `|dx| < 2` no hay lado que mirar. */
export function isFacing(dir, targetDx) {
  return Math.abs(targetDx) < 2 || Math.sign(targetDx) === dir;
}

/**
 * Distancia en x entre el ancla y un blanco corrido `dy` de la calle para que la fila de atrás quede a
 * `alcance − 3` (D15): `sqrt((alcance − 3)² − dy²) − fondo`. Devuelve -1 si `|dy| ≥ alcance − 3` (ese blanco no es
 * objetivo desde esa calle).
 */
export function firingDistance(range, fondo, dy) {
  const r = range - 3;
  const a = Math.abs(dy);
  if (a >= r) return -1;
  return Math.sqrt(r * r - a * a) - fondo;
}
