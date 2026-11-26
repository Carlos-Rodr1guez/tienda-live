// @ts-check
// Tabla de rutas por camino exacto: sin comodines, sin barra final y sin mayúsculas.

/**
 * @template {{ path: string }} R
 * @param {readonly R[]} rutas
 */
export function createRouter(rutas) {
  /** @type {Map<string, R>} */
  const porCamino = new Map();
  for (const ruta of rutas) {
    if (porCamino.has(ruta.path)) throw new Error(`la ruta ${ruta.path} está repetida`);
    porCamino.set(ruta.path, ruta);
  }
  return {
    /**
     * @param {string} camino
     * @returns {R | null}
     */
    match: (camino) => porCamino.get(camino) ?? null,
  };
}
