// Textos de la cámara (español neutro). Un módulo de textos propio hasta que el lote 6 los mueva a `ui/strings.js`
// (diseño D24), igual que `MOTION_NOTICE` en `render/motion.js`.

export const CAMERA_TEXT = Object.freeze({
  /** Estado visible en batalla: la automática maneja, o el narrador manda. */
  auto: 'CÁMARA AUTO',
  manual: 'CÁMARA MANUAL',
  /** Botones. */
  viewAll: 'Ver todo',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  /** Avisos de la tecla A (y de R, que también apaga la automática). */
  autoOn: 'Cámara automática: activada',
  autoOff: 'Cámara automática: desactivada',
});
