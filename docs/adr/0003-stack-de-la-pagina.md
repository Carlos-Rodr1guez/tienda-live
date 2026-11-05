# ADR-003: Stack de la página: Astro en Cloudflare

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H0

## Contexto

La página arranca como vidriera con lista de espera (H1) y crece con el catálogo: cada juego suma una ficha, un video y su categoría. Después suma cuenta, licencias y cobro (H3 y H4).

La opera una sola persona. Importa más no mantener servidores que tener la máxima flexibilidad.

## Opciones

| Opción                                                                            | A favor                                                                                | En contra                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Astro, sitio estático con colecciones de contenido, en Cloudflare Pages y Workers | Rápida y con buen SEO. Cada juego es un archivo con su ficha. Plan gratis para empezar | Lo dinámico va aparte, en Workers                            |
| Next.js en Vercel                                                                 | Todo en un solo framework                                                              | Más pesado para una vidriera, y el costo sube con el tráfico |
| WordPress o un constructor visual                                                 | Rápido de armar                                                                        | Difícil de versionar y de integrar con las licencias y la CI |

## Decisión propuesta

| Capa                    | Elección                                                        | Plan B           |
| ----------------------- | --------------------------------------------------------------- | ---------------- |
| Página                  | Astro, estática, con una colección de contenido para los juegos | Next.js          |
| Hosting                 | Cloudflare Pages y Workers                                      | Netlify o Vercel |
| API y base de datos     | Cloudflare Workers con D1 (SQLite)                              | Supabase         |
| Archivos e instaladores | Cloudflare R2                                                   | GitHub Releases  |
| Antibots en formularios | Cloudflare Turnstile                                            | hCaptcha         |

## Consecuencias

- Casi todo queda en un solo proveedor. Se mitiga con tecnología estándar: SQLite se exporta, R2 es compatible con S3 y un sitio de Astro se publica en cualquier hosting estático.
- La página vive en `apps/`, dentro de este monorepo, y usa la misma CI.
- Cada juego declara su ficha en el frontmatter (nombre, categoría, video y requisitos). Sumar un juego no toca el código de la página.
