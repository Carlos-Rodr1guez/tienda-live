// Limitador de destellos (diseño D21 punto 13; CB-20). Puro y siempre activo, con o sin movimiento reducido.
//
// Un destello es el núcleo blanco de una explosión o el "pop" de una torreta. Su área en pantalla es
// `π·(r_núcleo·s)²`, con `s` la escala MOSTRADA: la misma explosión es chica en k = 1 y grande en k = 6.
//   - Es "grande" si supera `largeArea` (1 %) del área de la vista.
//   - En una ventana deslizante de 1 s hay como máximo 3 destellos grandes; el exceso se degrada (el llamador lo
//     convierte en humo y escombro, sin núcleo).
//   - Ningún núcleo cubre más del 5 % de la vista, y la suma de los núcleos de un cuadro tampoco: no existe un velo
//     blanco de pantalla completa.

export const FLASH_DEFAULTS = Object.freeze({ maxLargePerSecond: 3, largeArea: 0.01, frameArea: 0.05 });

/** Ventana deslizante, en segundos del reloj de vista. */
export const FLASH_WINDOW = 1;

const entre = (v, lo, hi, porDefecto) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : porDefecto;

/**
 * Recorta la config de `fx.flash`: los espectadores no pueden excluirse, así que la config nunca sube los límites.
 * @param {{maxLargePerSecond?: number, largeArea?: number, frameArea?: number} | undefined} cfg
 */
export function resolveFlash(cfg) {
  const c = cfg ?? {};
  return {
    maxLargePerSecond: Math.floor(
      entre(c.maxLargePerSecond, 0, FLASH_DEFAULTS.maxLargePerSecond, FLASH_DEFAULTS.maxLargePerSecond),
    ),
    largeArea: entre(c.largeArea, 0.002, 0.05, FLASH_DEFAULTS.largeArea),
    frameArea: entre(c.frameArea, 0.005, FLASH_DEFAULTS.frameArea, FLASH_DEFAULTS.frameArea),
  };
}

/** @param {{maxLargePerSecond?: number, largeArea?: number, frameArea?: number}} [cfg] */
export function createFlashLimiter(cfg) {
  const c = resolveFlash(cfg);
  // los últimos destellos grandes concedidos (a lo sumo 3): se sobrescribe el más viejo
  const concedidos = [-Infinity, -Infinity, -Infinity];
  let cursor = 0;
  let viewArea = 1920 * 1080;
  let s = 1;
  let cuadro = 0;

  const area = (r) => Math.PI * (r * s) * (r * s);

  const L = {
    config: c,
    /** Tamaño del canvas y escala mostrada de este cuadro. */
    setView(W, H, escala) {
      viewArea = W * H;
      s = escala;
    },
    /** Área en pantalla (px²) de un núcleo de radio `r` en px de mundo. */
    areaOf: area,
    /** ¿Es grande? Se mide en pantalla, después del zoom. */
    isLarge(r) {
      return area(r) > c.largeArea * viewArea;
    },
    /**
     * Decisión al nacer una explosión: ¿puede llevar núcleo blanco? Los grandes cuentan en la ventana de 1 s.
     * @param {number} r radio del núcleo en px de mundo
     * @param {number} now reloj de vista, en segundos
     */
    admit(r, now) {
      const a = area(r);
      if (a > c.frameArea * viewArea) return false; // pantalla completa, nunca
      if (a <= c.largeArea * viewArea) return true;
      let dentro = 0;
      for (const t of concedidos) if (t > now - FLASH_WINDOW) dentro++;
      if (dentro >= c.maxLargePerSecond) return false;
      concedidos[cursor] = now;
      cursor = (cursor + 1) % concedidos.length;
      return true;
    },
    /** Destellos grandes concedidos en el último segundo (F2). */
    recent(now) {
      let n = 0;
      for (const t of concedidos) if (t > now - FLASH_WINDOW) n++;
      return n;
    },
    beginFrame() {
      cuadro = 0;
    },
    /** Presupuesto de un cuadro: la suma de núcleos dibujados nunca pasa de `frameArea` de la vista. */
    take(r) {
      const a = area(r);
      if (cuadro + a > c.frameArea * viewArea + 1e-6) return false;
      cuadro += a;
      return true;
    },
    /** Suma de áreas de núcleo concedidas en este cuadro (px²). */
    frameArea() {
      return cuadro;
    },
    /** Partido o ronda nueva: se olvida la ventana. */
    reset() {
      concedidos.fill(-Infinity);
      cursor = 0;
      cuadro = 0;
    },
  };
  return L;
}
