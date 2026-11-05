// Configuración de Astro. La web es estática: la sirve el mismo Worker que atiende /v1 (ADR-003).
import { defineConfig } from 'astro/config';
import securityHeaders from './integrations/security-headers.js';

export default defineConfig({
  // Origen público del sitio. Sin SITE_URL se usa el origen local de la API (modo preview).
  site: process.env.SITE_URL || 'http://localhost:8790',
  // Escribe dist/_headers con la política de cabeceras de contracts al terminar la construcción.
  integrations: [securityHeaders()],
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
