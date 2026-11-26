// Sin `// @ts-check`: usa módulos de Node y la web no tiene @types/node (no se suman dependencias), igual que los scripts.
// Integración de Astro: al terminar la construcción escribe `dist/_headers` con la política de cabeceras de
// contracts (única fuente). Cloudflare lo aplica a las páginas estáticas; las respuestas de /v1/* ponen las suyas
// desde el código del Worker. `buildHeadersFile` ya comprueba los límites de Cloudflare (100 reglas, 2000 caracteres).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildHeadersFile } from '@tienda/contracts/security-headers';
import { readEnv } from './env.js';

/**
 * @param {{ beacon?: boolean, escribir?: (ruta: string, texto: string) => Promise<unknown>, root?: string }} [opciones]
 *   `beacon`: si no se indica, lo decide PUBLIC_CF_BEACON_TOKEN al construir, leído del entorno Y del `.env` (la misma
 *   fuente que `import.meta.env` en el navegador; si no, la página enciende el beacon y el CSP lo bloquea).
 *   `escribir` y `root` (carpeta del proyecto, por defecto la que informa Astro): se inyectan en las pruebas.
 * @returns {import('astro').AstroIntegration}
 */
export default function securityHeaders({ beacon, escribir = writeFile, root } = {}) {
  let raiz = root ?? process.cwd();
  return {
    name: 'cabeceras-de-seguridad',
    hooks: {
      'astro:config:setup': ({ config }) => {
        if (root === undefined) raiz = fileURLToPath(config.root);
      },
      'astro:build:done': async ({ dir }) => {
        const conBeacon = beacon ?? Boolean(readEnv({ mode: 'production', root: raiz }).PUBLIC_CF_BEACON_TOKEN);
        await escribir(fileURLToPath(new URL('_headers', dir)), buildHeadersFile({ beacon: conBeacon }));
      },
    },
  };
}
