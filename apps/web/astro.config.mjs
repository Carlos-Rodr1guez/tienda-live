// Configuración de Astro. La web es estática: la sirve el mismo Worker que atiende /v1 (ADR-003).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { buildEnvGuard, readEnv, siteParaAstro } from './integrations/env.js';
import securityHeaders from './integrations/security-headers.js';

// Astro no vuelca el .env en process.env al cargar este archivo: se lee con la misma función que usa la construcción.
const env = readEnv({
  mode: process.env.NODE_ENV ?? 'development',
  root: fileURLToPath(new URL('.', import.meta.url)),
});

export default defineConfig({
  // Origen público del sitio. Solo en desarrollo se usa el origen local de la API; una construcción (`astro build`)
  // exige SITE_URL explícita y la guarda de entorno falla, nombrando la variable, si falta.
  // Un SITE_URL mal formado se cambia por el local antes de llegar a Astro; la guarda de la construcción lo rechaza
  // con su mensaje en español (ver siteParaAstro).
  site: siteParaAstro(env.SITE_URL),
  // La guarda va primero: si falta una variable de la construcción, nada más corre. Después, dist/_headers con la
  // política de cabeceras de contracts al terminar.
  integrations: [buildEnvGuard(), securityHeaders()],
  // /confirmar se sirve como confirmar.html sin redirigir, así el #t= del enlace no se pierde.
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Sin CSS ni recursos incrustados en el HTML: la política CSP no necesita hashes.
    inlineStylesheets: 'never',
  },
  server: { port: 4400 },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: {
      // Si el puerto está ocupado, falla en lugar de moverse a otro.
      strictPort: true,
      // En desarrollo el navegador ve un solo origen (4400): /v1 se reenvía a la API.
      proxy: { '/v1': 'http://localhost:8790' },
    },
  },
});
