# ADR-003: Stack de la página: Astro en Cloudflare

- **Estado:** Aceptada
- **Fecha:** 2026-11-04
- **Se decide en:** H0

Aceptada al empezar el H1 (2026-11-05), con el hosting afinado: un solo Worker en lugar de Pages más un Worker aparte.

## Contexto

La página arranca como vidriera con lista de espera (H1) y crece con el catálogo: cada juego suma una ficha, un video y su categoría. Después suma cuenta, licencias y cobro (H3 y H4).

La opera una sola persona. Importa más no mantener servidores que tener la máxima flexibilidad.

## Opciones

| Opción                                                                            | A favor                                                                                | En contra                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Astro, sitio estático con colecciones de contenido, en Cloudflare Pages y Workers | Rápida y con buen SEO. Cada juego es un archivo con su ficha. Plan gratis para empezar | Lo dinámico va aparte, en Workers                            |
| Next.js en Vercel                                                                 | Todo en un solo framework                                                              | Más pesado para una vidriera, y el costo sube con el tráfico |
| WordPress o un constructor visual                                                 | Rápido de armar                                                                        | Difícil de versionar y de integrar con las licencias y la CI |

## Decisión

| Capa                    | Elección                                                                                                                 | Plan B           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Página                  | Astro, estática, con una colección de contenido para los juegos                                                          | Next.js          |
| Hosting                 | Un solo Worker de Cloudflare con assets estáticos: sirve `apps/web/dist` y la API en `/v1/*`, los dos en el mismo origen | Netlify o Vercel |
| API y base de datos     | El mismo Worker, con D1 (SQLite)                                                                                         | Supabase         |
| Archivos e instaladores | Cloudflare R2                                                                                                            | GitHub Releases  |
| Antibots en formularios | Cloudflare Turnstile                                                                                                     | hCaptcha         |

Se descartó Pages: con un Worker que sirve la web y la API desde el mismo origen no hace falta CORS, las páginas estáticas no consumen invocaciones del Worker y hay un solo lugar donde configurar cabeceras, dominio y secretos.

## Consecuencias

- Casi todo queda en un solo proveedor. Se mitiga con tecnología estándar: SQLite se exporta, R2 es compatible con S3 y un sitio de Astro se publica en cualquier hosting estático.
- La página vive en `apps/`, dentro de este monorepo, y usa la misma CI.
- Cada juego declara su ficha en el frontmatter (nombre, categoría, video y requisitos). Sumar un juego no toca el código de la página.
- `astro` va en las `dependencies` de `apps/web`, para que la compuerta de licencias y `npm audit --omit=dev` revisen también la cadena de construcción. Dos avisos de licencia se aceptan con su razón en la compuerta: lightningcss (MPL-2.0, el minificador de CSS de Vite) y sharp con libvips (LGPL-3.0-or-later, que optimiza las imágenes al construir). Los dos se usan sin modificar, solo corren al construir y no viajan en el sitio.
- La web y la API se publican juntas: primero se construye la web y después `wrangler deploy -c apps/api/wrangler.jsonc`. Se pueden separar más adelante sin cambiar código.
- `wrangler` es una dependencia de desarrollo. El Worker no tiene dependencias de terceros en tiempo de ejecución.
- El plan B no cambia.
