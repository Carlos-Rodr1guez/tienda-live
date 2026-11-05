// @ts-check
// Metadatos de SEO y de vista previa al compartir (Open Graph y Twitter). Todo con URLs absolutas armadas con el
// origen del sitio (SITE_URL): las redes no resuelven rutas relativas.

/** Tamaño de la imagen de vista previa. */
export const OG_IMAGE_SIZE = Object.freeze({ width: 1200, height: 630 });

/**
 * Ruta de la imagen de vista previa por defecto. El archivo (1200x630, una captura real de ASEDIO) llega con la
 * portada: hasta entonces no existe, y no se crea una imagen de relleno. Una página puede pasar otra en `ogImage`.
 */
export const OG_IMAGE_PATH = '/og/sitio.png';

/** Valor válido de og:locale para español (la especificación pide "es_ES neutro"). */
export const OG_LOCALE = 'es_ES';

/**
 * Convierte una ruta en URL absoluta con el origen del sitio. Una URL ya absoluta se deja como está.
 * @param {string} site  origen del sitio (http o https); si trae ruta, se ignora
 * @param {string} ruta  empieza con "/" o es una URL http(s) completa
 * @returns {string}
 */
export function absoluteUrl(site, ruta) {
  /** @type {URL} */
  let base;
  try {
    base = new URL(site);
  } catch {
    throw new Error(`el sitio no es una URL válida: ${site}`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error(`el sitio tiene que ser http o https: ${site}`);
  }
  if (/^https?:\/\//i.test(ruta)) return ruta;
  if (!ruta.startsWith('/')) throw new Error(`la ruta tiene que empezar con barra: ${ruta}`);
  return `${base.origin}${ruta}`;
}

/**
 * @typedef {object} EntradaSeo
 * @property {string} site
 * @property {string} path
 * @property {string} titulo
 * @property {string} descripcion
 * @property {string} nombreSitio
 * @property {string} imagen  ruta o URL de la imagen 1200x630
 * @property {boolean} [noindex]
 */

/**
 * Arma los metadatos de una página.
 * @param {EntradaSeo} entrada
 * @returns {{
 *   canonical: string,
 *   robots: 'noindex' | null,
 *   openGraph: { property: string, content: string }[],
 *   twitter: { name: string, content: string }[],
 * }}
 */
export function buildSeo({ site, path, titulo, descripcion, nombreSitio, imagen, noindex = false }) {
  for (const [campo, valor] of Object.entries({ titulo, descripcion, nombreSitio, imagen })) {
    if (typeof valor !== 'string' || valor.trim() === '') throw new Error(`falta ${campo} para los metadatos de SEO`);
  }
  const canonical = absoluteUrl(site, path);
  const imagenAbsoluta = absoluteUrl(site, imagen);
  return {
    canonical,
    robots: noindex ? 'noindex' : null,
    openGraph: [
      { property: 'og:title', content: titulo },
      { property: 'og:description', content: descripcion },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: canonical },
      { property: 'og:image', content: imagenAbsoluta },
      { property: 'og:image:width', content: String(OG_IMAGE_SIZE.width) },
      { property: 'og:image:height', content: String(OG_IMAGE_SIZE.height) },
      { property: 'og:site_name', content: nombreSitio },
      { property: 'og:locale', content: OG_LOCALE },
    ],
    twitter: [
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: titulo },
      { name: 'twitter:description', content: descripcion },
      { name: 'twitter:image', content: imagenAbsoluta },
    ],
  };
}
