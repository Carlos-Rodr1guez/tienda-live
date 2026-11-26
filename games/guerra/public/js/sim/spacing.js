// Separación entre amigos (v2.6, D-R8). Las unidades no se bloquean: se pueden atravesar. Pero guardan una distancia
// blanda por tipo (`movement.spacing`; el par mezcla usa el promedio) y, cuando se pisan, se empujan hacia afuera.
// REGLA DURA: el empuje nunca frena. Se descompone contra el rumbo deseado: la parte que apunta hacia atrás se
// descarta (`adelante = max(0, empuje · rumbo)`) y el resto es lateral, recortado a `sepMaxLateral · vmax`. El que
// dispara solo se desliza hasta `sepMaxFiring · vmax` y solo mientras siga a ≤ alcance − 2 de su blanco (así el
// empuje nunca lo saca de alcance). Los enemigos no se separan (`enemySpacing` 0): el combate los frena por alcance.
//
// Sin azar y sin estado propio: las posiciones son las del INICIO del paso (`px`, `py`) y las sumas siguen el orden
// de la grilla (ordenación por conteo estable), así el resultado no depende del orden en que se procesan las
// unidades. Solo + − × ÷ y sqrt.

/** Resultado de la última llamada a `separation`: `{x, y}`. Se pisa en la llamada siguiente. */
export const SEP = { x: 0, y: 0 };

let cur = null;
let accX = 0;
let accY = 0;
let gain = 0;

function visit(p) {
  if (p === cur || !p.alive) return;
  const dx = cur.px - p.px;
  const dy = cur.py - p.py;
  const sp = (cur.stats.spacing + p.stats.spacing) / 2;
  const d2 = dx * dx + dy * dy;
  if (d2 >= sp * sp) return;
  if (d2 < 1e-12) {
    // encimadas: el desempate es el id, así dos unidades idénticas se abren hacia lados opuestos
    accY += cur.id > p.id ? gain * sp : -gain * sp;
    return;
  }
  const d = Math.sqrt(d2);
  const k = (gain * (sp - d)) / d;
  accX += dx * k;
  accY += dy * k;
}

/** El mayor espaciado de la config: el radio de consulta de la grilla. */
export function maxSpacing(cfg) {
  let m = 0;
  for (const k of Object.keys(cfg.movement.spacing)) m = Math.max(m, cfg.movement.spacing[k]);
  return m;
}

/**
 * Empuje de separación de `u` (velocidad que se suma a la deseada), como `SEP`.
 * @param {any} world
 * @param {any} u
 * @param {number} hx rumbo deseado (vector unitario)
 * @param {number} hy
 * @param {boolean} firing la unidad tiene blanco por alcance: solo se desliza un poco
 */
export function separation(world, u, hx, hy, firing) {
  const m = world.cfg.movement;
  SEP.x = 0;
  SEP.y = 0;
  cur = u;
  accX = 0;
  accY = 0;
  gain = m.sepGain;
  const reach = (u.stats.spacing + world.maxSpacing) / 2;
  world.grids[u.side].forEachInRadius(u.px, u.py, reach, visit);
  cur = null;
  if (accX === 0 && accY === 0) return SEP;
  if (firing) {
    // quien dispara no tiene rumbo que proteger (su velocidad deseada es 0): se desliza en cualquier dirección,
    // como mucho `sepMaxFiring · vmax` en total (la comprobación de «alcance − 2» la hace quien llama)
    const am = Math.sqrt(accX * accX + accY * accY);
    const cf = m.sepMaxFiring * u.stats.speed;
    const k = am > cf ? cf / am : 1;
    SEP.x = accX * k;
    SEP.y = accY * k;
    return SEP;
  }
  // descomposición contra el rumbo: nunca frena (adelante ≥ 0); el resto es lateral
  const dot = accX * hx + accY * hy;
  const fwd = dot > 0 ? dot : 0;
  let lx = accX - dot * hx;
  let ly = accY - dot * hy;
  const vmax = u.stats.speed;
  const cap = m.sepMaxLateral * vmax;
  const lm = Math.sqrt(lx * lx + ly * ly);
  if (lm > cap) {
    lx = (lx * cap) / lm;
    ly = (ly * cap) / lm;
  }
  const f = fwd > cap ? cap : fwd;
  SEP.x = hx * f + lx;
  SEP.y = hy * f + ly;
  return SEP;
}
