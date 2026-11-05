// Sin `// @ts-check`: usa módulos de Node y la web no tiene @types/node (no se suman dependencias), igual que los scripts.
// Integración de Astro: al terminar la construcción escribe `dist/_headers` con la política de cabeceras de
// contracts (única fuente). Cloudflare lo aplica a las páginas estáticas; las respuestas de /v1/* ponen las suyas
// desde el código del Worker. `buildHeadersFile` ya comprueba los límites de Cloudflare (100 reglas, 2000 caracteres).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildHeadersFile } from '@tienda/contracts/security-headers';

/**
 * @param {{ beacon?: boolean, escribir?: (ruta: string, texto: string) => Promise<unknown> }} [opciones]
 *   `beacon`: si no se indica, lo decide PUBLIC_CF_BEACON_TOKEN al construir. `escribir`: se inyecta en las pruebas.
 * @returns {import('astro').AstroIntegration}
 */
export default function securityHeaders({ beacon, escribir = writeFile } = {}) {
  return {
    name: 'cabeceras-de-seguridad',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const conBeacon = beacon ?? Boolean(process.env.PUBLIC_CF_BEACON_TOKEN);
        await escribir(fileURLToPath(new URL('_headers', dir)), buildHeadersFile({ beacon: conBeacon }));
      },
    },
  };
}
