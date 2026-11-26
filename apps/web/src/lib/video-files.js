// Comprobación de archivos del video al construir. Está aparte de video.js porque usa node:fs (el navegador no) y los
// componentes .astro no tienen tipos de Node: así el componente solo importa esta función.
/* global process -- solo corre al construir, en Node */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { vttPath } from './video.js';

/**
 * Los subtítulos de un video: devuelve su ruta pública, o falla si el .vtt no está en la carpeta public.
 * @param {string} video  `/videos/<nombre>.mp4|webm`
 * @param {string} [raizPublic]  carpeta public (por defecto la de apps/web, desde donde se construye)
 * @returns {string}
 */
export function subtitulosDe(video, raizPublic = join(process.cwd(), 'public')) {
  const vtt = vttPath(video);
  if (!existsSync(join(raizPublic, vtt))) {
    throw new Error(`falta el archivo de subtítulos public${vtt} del video ${video}`);
  }
  return vtt;
}
