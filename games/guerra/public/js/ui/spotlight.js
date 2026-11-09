// Seguir a un donante (S y Shift+S, D25): la cámara sigue a su unidad viva de más valor. Los candidatos son los donantes del
// top del partido (por XP) que tienen una unidad viva; cada `S` pasa al siguiente y da la vuelta. El punto que se sigue se
// lee en cada cuadro (sin reservar memoria): si el donante ya no tiene unidades vivas devuelve `null` y el controlador de la
// cámara suelta el seguimiento solo, sin contarlo como una entrada del narrador.

import { topUsers } from '@tienda/kit/sim/podium.js';

/**
 * @param {{registry: any, units: () => ArrayLike<any>, camera: {follow: (g: () => {x: number, y: number} | null) => void,
 *   stopFollow: () => void}}} o
 */
export function createSpotlight({ registry, units, camera }) {
  let current = /** @type {string | null} */ (null);
  const punto = { x: 0, y: 0 };

  /** La unidad viva de más valor del donante (empate por id menor), o `null`. */
  function unidadDe(key) {
    const list = units();
    let mejor = null;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.owner !== key || !u.alive) continue;
      if (mejor === null || u.unitValue > mejor.unitValue || (u.unitValue === mejor.unitValue && u.id < mejor.id))
        mejor = u;
    }
    return mejor;
  }
  const seguir = (key) => () => {
    const u = unidadDe(key);
    if (u === null) {
      // el seguido se fue: la cámara lo suelta sola y el foco de las etiquetas también
      if (current === key) current = null;
      return null;
    }
    punto.x = u.x;
    punto.y = u.y;
    return punto;
  };

  return {
    /** La clave del donante que se sigue, o `null`. */
    get key() {
      return current;
    },
    /** El siguiente donante del top con una unidad viva. Devuelve su clave o `null` si no hay ninguno. */
    next() {
      const vivos = new Set();
      const list = units();
      for (let i = 0; i < list.length; i++)
        if (list[i].alive && typeof list[i].owner === 'string') vivos.add(list[i].owner);
      // los donantes con una unidad viva, por XP, en una sola pasada (no se ordena a todos los usuarios)
      const candidatos = topUsers(registry, 'match', Math.max(1, vivos.size), { filter: (u) => vivos.has(u.key) }).map(
        (e) => e.key,
      );
      if (candidatos.length === 0) {
        current = null;
        return null;
      }
      current = candidatos[(candidatos.indexOf(current ?? '') + 1) % candidatos.length];
      camera.follow(seguir(current));
      return current;
    },
    /** Clic en la etiqueta de un donante: la cámara lo sigue (si ya no tiene unidades vivas, se suelta sola). */
    follow(key) {
      current = String(key);
      camera.follow(seguir(current));
    },
    stop() {
      current = null;
      camera.stopFollow();
    },
  };
}
