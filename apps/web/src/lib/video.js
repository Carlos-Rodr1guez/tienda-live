// @ts-check
// Mide la primera reproducción del video ("video_play", una vez por vista de página). Si el sitio todavía no tiene
// video no hay elemento y esto no hace nada. Medir nunca puede romper ni frenar la reproducción.

/**
 * Ruta de los subtítulos de un video: el .vtt con el mismo nombre. El componente comprueba al construir que existe.
 * @param {string} video  `/videos/<nombre>.mp4|webm`
 * @returns {string}
 */
export function vttPath(video) {
  const m = /^(\/videos\/[a-z0-9-]+)\.(?:mp4|webm)$/.exec(video);
  if (!m) throw new Error(`la ruta del video no es válida: ${video}`);
  return `${m[1]}.vtt`;
}

/**
 * @param {{ addEventListener: (tipo: 'play', f: () => void, opciones: { once: true }) => void } | null | undefined} video
 * @param {(nombre: 'video_play') => unknown} track
 */
export function watchVideoPlay(video, track) {
  if (!video) return;
  video.addEventListener(
    'play',
    () => {
      try {
        track('video_play');
      } catch {
        // silencioso a propósito
      }
    },
    { once: true },
  );
}
