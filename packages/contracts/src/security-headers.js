// @ts-check
// Política de cabeceras de seguridad: única fuente para el archivo `_headers` de la web (que escribe la integración
// de Astro al construir) y para las respuestas del Worker en /v1/*.
//
// Sin hashes ni 'unsafe-inline': por eso la web no puede traer scripts ni estilos en línea ni `style=` (lo comprueba
// una prueba sobre dist). Cloudflare documenta que `_headers` no se aplica a las respuestas que genera el código del
// Worker, así que /v1/* pone sus propias cabeceras con API_RESPONSE_HEADERS.

const TURNSTILE = 'https://challenges.cloudflare.com';
const BEACON_SCRIPT = 'https://static.cloudflareinsights.com';
const BEACON_CONNECT = 'https://cloudflareinsights.com';

/** Límites de Cloudflare para `_headers`. */
export const HEADERS_FILE_LIMITS = Object.freeze({ maxRules: 100, maxLineLength: 2000 });

/**
 * CSP de todas las páginas. Turnstile (script e iframe) solo se carga cuando se abre el formulario; el beacon de
 * Web Analytics, solo si hay token al construir.
 * @param {{ beacon?: boolean }} [opciones]
 */
export function buildCsp({ beacon = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self' ${TURNSTILE}${beacon ? ` ${BEACON_SCRIPT}` : ''}`,
    `frame-src ${TURNSTILE}`,
    `connect-src 'self'${beacon ? ` ${BEACON_CONNECT}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Segunda CSP de /confirmar: sin Turnstile ni marcos ni formularios. Se aplican las dos y manda la más estricta.
 */
export function buildConfirmCsp() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * @typedef {{ path: string, headers: [string, string][] }} HeaderRule
 */

/**
 * La tabla de reglas de `_headers`, en orden.
 * @param {{ beacon?: boolean }} [opciones]
 * @returns {HeaderRule[]}
 */
export function buildHeaderRules({ beacon = false } = {}) {
  return [
    {
      path: '/*',
      headers: [
        ['Content-Security-Policy', buildCsp({ beacon })],
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', 'strict-origin-when-cross-origin'],
        ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
        ['X-Frame-Options', 'DENY'],
        ['Cross-Origin-Opener-Policy', 'same-origin'],
        ['Strict-Transport-Security', 'max-age=31536000'],
      ],
    },
    {
      // Cloudflare une con coma las cabeceras repetidas: quedan las dos CSP y, en Referrer-Policy, gana el último
      // valor válido (no-referrer). La página lo respalda con <meta name="referrer">.
      path: '/confirmar',
      headers: [
        ['Content-Security-Policy', buildConfirmCsp()],
        ['Referrer-Policy', 'no-referrer'],
        ['X-Robots-Tag', 'noindex'],
      ],
    },
    {
      path: '/_astro/*',
      headers: [['Cache-Control', 'public, max-age=31536000, immutable']],
    },
  ];
}

/**
 * Comprueba los límites de Cloudflare sobre el texto de un `_headers`. Lanza si no se cumplen.
 * @param {string} texto
 */
export function assertHeadersFileLimits(texto) {
  const lineas = texto.split('\n');
  const reglas = lineas.filter((l) => l !== '' && !l.startsWith(' ')).length;
  if (reglas > HEADERS_FILE_LIMITS.maxRules) {
    throw new Error(`_headers tiene ${reglas} reglas y el máximo es ${HEADERS_FILE_LIMITS.maxRules}`);
  }
  for (const linea of lineas) {
    if (linea.length > HEADERS_FILE_LIMITS.maxLineLength) {
      throw new Error(
        `_headers tiene una línea de ${linea.length} caracteres y el máximo es ${HEADERS_FILE_LIMITS.maxLineLength}`,
      );
    }
  }
}

/**
 * El contenido del archivo `_headers`.
 * @param {{ beacon?: boolean }} [opciones]
 * @returns {string}
 */
export function buildHeadersFile({ beacon = false } = {}) {
  const texto = buildHeaderRules({ beacon })
    .map(({ path, headers }) => [path, ...headers.map(([nombre, valor]) => `  ${nombre}: ${valor}`)].join('\n'))
    .join('\n');
  const archivo = `${texto}\n`;
  assertHeadersFileLimits(archivo);
  return archivo;
}

/**
 * Cabeceras de toda respuesta de /v1/*. `Content-Type` lo pone quien arma la respuesta, porque un 204 no lo lleva.
 * Sin Set-Cookie y sin CORS: todo es del mismo origen.
 */
export const API_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
});
