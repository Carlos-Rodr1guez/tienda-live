// Política de movimiento reducido (CB-20, NM-3 `R`). Un solo lugar decide qué se apaga; el resto del render y, más
// adelante, la cámara automática (5c) y los banners (6) solo leen `politica`.
//
//   graphics.reducedMotion: 'auto'  sigue la preferencia del sistema (`prefers-reduced-motion`)
//                           true    lo fuerza
//                           false   lo apaga e IGNORA la preferencia del sistema
//   `R` alterna el estado efectivo en pleno LIVE (y otra `R` lo vuelve a poner).
//
// Con movimiento reducido: sin temblor, sin cámara lenta, sin núcleos blancos ni parpadeo, humo quieto, la cámara
// automática apagada por defecto y los banners sin deslizar. Los límites de destellos (flash.js) rigen siempre.

import { ConfigError } from '@tienda/kit/sim/config.js';

export const MOTION_MEDIA = '(prefers-reduced-motion: reduce)';

/**
 * Valida y completa `config.game.graphics`.
 * @param {{reducedMotion?: unknown, shake?: unknown, slowMotion?: unknown} | undefined} g
 */
export function resolveGraphics(g) {
  const c = g ?? {};
  const rm = c.reducedMotion ?? 'auto';
  if (rm !== 'auto' && rm !== true && rm !== false) {
    throw new ConfigError('graphics.reducedMotion solo acepta "auto", true o false');
  }
  const shake = typeof c.shake === 'number' && Number.isFinite(c.shake) ? Math.min(1, Math.max(0, c.shake)) : 0.5;
  return { reducedMotion: rm, shake, slowMotion: c.slowMotion !== false };
}

/**
 * @param {{graphics?: object, systemReduced?: boolean}} [o] `systemReduced`: lo que dice `prefers-reduced-motion`
 */
export function createMotion({ graphics, systemReduced = false } = {}) {
  const cfg = resolveGraphics(graphics);
  let system = Boolean(systemReduced);
  /** Lo que dejó `R`: null mientras nadie la haya pulsado. */
  let manual = /** @type {boolean | null} */ (null);

  const politica = {
    reduced: false,
    shake: 0,
    slowMotion: true,
    whiteCores: true,
    flicker: true,
    stillSmoke: false,
    autoCamera: true,
    bannerSlide: true,
  };
  function recompute() {
    const base = cfg.reducedMotion === 'auto' ? system : cfg.reducedMotion;
    const reduced = manual ?? base;
    politica.reduced = reduced;
    politica.shake = reduced ? 0 : cfg.shake;
    politica.slowMotion = !reduced && cfg.slowMotion;
    politica.whiteCores = !reduced;
    politica.flicker = !reduced;
    politica.stillSmoke = reduced;
    politica.autoCamera = !reduced;
    politica.bannerSlide = !reduced;
  }
  recompute();

  return {
    cfg,
    /** Objeto único y vivo: se actualiza al cambiar, así leerlo por cuadro no reserva nada. */
    politica,
    get reduced() {
      return politica.reduced;
    },
    /** La preferencia del sistema cambió en pleno LIVE. */
    setSystem(v) {
      system = Boolean(v);
      recompute();
    },
    /** `R`: alterna el estado efectivo. Devuelve el estado nuevo. */
    toggle() {
      manual = !politica.reduced;
      recompute();
      return politica.reduced;
    },
  };
}
