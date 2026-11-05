# @tienda/web

La vitrina de la tienda: una web **estática** hecha con Astro 7 (portada con el formulario de lista de espera, ficha de ASEDIO, `/confirmar` y las páginas legales). No hay servidor propio: el Worker de [`@tienda/api`](../api/README.md) sirve el `dist/` y atiende solo `/v1/*`.

Todo el texto visible está en español neutro, de tú.

## Cómo se corre

Desde la raíz del repositorio (ver el [README de la raíz](../../README.md)):

| Comando                               | Qué hace                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev:web`                     | Astro en el puerto 4400; `/v1` se redirige a la API (puerto 8790)     |
| `npm run typecheck -w @tienda/web`    | `astro check` con TypeScript 6 (ADR-009)                              |
| `npm test -w @tienda/web`             | Pruebas unitarias (`test/unit`), sin construir nada                   |
| `npm run build -w @tienda/web`        | Construye `dist/` (también escribe `dist/_headers`)                   |
| `npm run test:dist -w @tienda/web`    | Pruebas sobre el HTML ya construido (`test/dist`); exigen el `dist/`  |
| `npm run check:schema -w @tienda/web` | Comprueba que el esquema rechaza contenido inválido y nombra el campo |

## Cómo agregar un juego

Un juego es **un archivo Markdown** en `src/content/juegos/<slug>.md`. El nombre del archivo es el identificador (minúsculas, números y guiones) y, si el juego tiene ficha, también su dirección: `/juegos/<slug>`.

Los campos del encabezado los define `src/content/schema.js`. El esquema es **estricto**: un campo desconocido, o una categoría o un rol fuera de la lista, rompe la construcción y el error nombra el archivo y el campo.

| Campo         | Obligatorio  | Qué lleva                                                                                  |
| ------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `nombre`      | Sí           | Hasta 60 caracteres                                                                        |
| `resumen`     | Sí           | Hasta 160 caracteres                                                                       |
| `categoria`   | Sí           | `accion`, `publico`, `relax` o `metas`                                                     |
| `rolStreamer` | Sí           | `juega`, `conduce` o `acompana`                                                            |
| `idealPara`   | Sí           | De 1 a 4 tipos de LIVE sin repetir: `gaming`, `charla`, `musica`, `estudio`                |
| `estado`      | Sí           | `concepto`, `prototipo`, `beta` o `venta`                                                  |
| `poster`      | Según estado | Ruta relativa a `src/assets`: `juegos/<juego>/<archivo>.png`, `.jpg` o `.webp`             |
| `video`       | No           | `/videos/<nombre>.mp4` o `.webm`, desde `public/`. Sin video, la portada muestra el póster |
| `mecanicas`   | Según estado | Hasta 8 frases de hasta 140 caracteres                                                     |
| `regalos`     | No           | Hasta 8 pares `monedas` (`5`, `10-99` o `1000+`) y `efecto`                                |
| `requisitos`  | No           | Hasta 8 frases de hasta 120 caracteres                                                     |
| `orden`       | No           | Entero de 0 a 999; ordena el catálogo (por defecto 999)                                    |

Las listas de categorías, roles, tipos y estados salen de `packages/contracts/src/enums.js`, el único lugar donde se definen. Agregar un valor ahí lo cambia en todas partes; si además lo usa la base de datos, hace falta una migración nueva en `apps/api/migrations` (la prueba del esquema falla si olvidas la migración).

### Concepto o ficha

- **`estado: concepto`**: es una idea. Pide solo los campos básicos, **no tiene página** ni enlace, y aparece en la portada como una tarjeta "Próximamente" sin enlace. Si el nombre aún no es definitivo, dilo en el cuerpo del archivo ("El nombre es provisional").
- **Cualquier otro estado** (`prototipo`, `beta`, `venta`): tiene página propia `/juegos/<slug>`. El esquema exige al menos una mecánica y un póster.

No existen `/juegos` ni `/categorias` como índices: la portada es la única vitrina.

### Póster

- Va en `src/assets/juegos/<juego>/` (nunca en `public/`), en vertical 9:16. Astro lo optimiza al construir y genera AVIF, WebP y un respaldo JPEG.
- Si el archivo que nombra `poster` no existe, la construcción falla (`src/lib/images.js`).
- Sin `video`, el póster lleva la etiqueta "Video próximamente" y ningún control de reproducción. Con `video` aparece el reproductor con controles.
- El texto alternativo del póster de ASEDIO está en el diccionario (`inicio.videoPosterAlt`) y describe la escena. Una ficha nueva necesitará el suyo (hoy es un pendiente conocido, ver abajo).

### Reglas del texto

El cuerpo y los campos del juego pasan por las reglas de redacción de `packages/contracts/src/copy-rules.js`, con pruebas en `test/unit/entries.test.js`:

- Nada de voseo ("tenés", "podés", "vos"...): se escribe de tú.
- Nada que presione a regalar ("regala para...", "gana regalando").
- Nada de azar ni de premios: ruleta, sorteo, premio, suerte. Los regalos solo activan efectos del juego.

## Textos de la interfaz

Los textos de las páginas, los errores y el correo **no se escriben dentro de los componentes**: viven en `packages/contracts/src/i18n/es.js`, organizados por secciones (`sitio`, `inicio`, `juego`, `formulario`, `confirmar`, `pie`, `legal`, `pagina404`, `respuestas`, `correo`...). Así la web y la API leen la misma fuente.

- Los textos con datos usan marcadores (`{marca}`, `{enlace}`) que se rellenan con `fmt`, que **falla si falta un parámetro**.
- El nombre de la marca sale de `packages/contracts/src/brand.js`. Una prueba falla si el nombre aparece escrito a mano en el código.
- Cada valor de cada enumeración tiene su etiqueta en el diccionario; una prueba lo comprueba.
- Las pruebas de `packages/contracts` aplican las reglas de redacción del apartado anterior a todo el diccionario.

## Imágenes y licencias

- Las imágenes del sitio son propias. No se usan imágenes de terceros ni de bancos de imágenes sin licencia clara.
- El arte de las categorías son SVG propios (`src/lib/category-art.js`), sin banderas ni marcas de terceros.
- La tipografía es Oxanium (SIL OFL 1.1), instalada desde el paquete `@fontsource-variable/oxanium` y servida desde el propio sitio. Su licencia está en `public/licencias/oxanium-OFL.txt` y el pie la enlaza.
- La imagen para redes (`public/og/sitio.jpg`) mide 1200x630 y pesa menos de 300 KB; una prueba lo comprueba leyendo el JPEG.
- El optimizador de imágenes (`sharp`, con libvips, LGPL-3.0-or-later) corre solo al construir, sin modificar, y no viaja en el sitio. `npm run licenses` lo acepta con esa razón escrita.

## Reglas de la política de seguridad (CSP)

La política (`packages/contracts/src/security-headers.js`) no tiene `unsafe-inline` para scripts ni para estilos. Por eso, en todo lo que escribas:

1. **Nada de `style="..."`** en el HTML. Los estilos van en hojas de estilo (Astro las emite como archivos, con `inlineStylesheets: 'never'`). Para valores que cambian, usa clases o variables CSS definidas en una hoja.
2. **Nada de scripts en línea** (`is:inline`, `onclick=...`, `<script>` con código a mano en el HTML final). Todo el JavaScript va en módulos que Astro empaqueta como archivos.
3. **Nada de `data:`**: ni imágenes, ni fuentes, ni SVG incrustados. Las estrellas del fondo son un archivo (`src/styles/estrellas.svg`), no una URL `data:`.
4. **Nada de colores, radios, sombras ni curvas escritos fuera de `src/styles/tokens.css`.** Los componentes usan los tokens (una prueba de código fuente lo comprueba).
5. Nada de fuentes ni scripts de terceros, salvo Turnstile en la portada y el beacon de Cloudflare cuando existe su token.

El archivo `dist/_headers` lo escribe la integración `integrations/security-headers.js` al terminar la construcción.

## Cómo funcionan las pruebas de dist en la CI

Hay dos familias de pruebas, y no se mezclan:

- **`test/unit`** corre en cualquier máquina y no construye nada. Prueba la lógica pura (esquema, catálogo, SEO, modelos del formulario y de `/confirmar`, reglas de las hojas de estilo, contraste de los tokens...). Es lo que corre `npm test`.
- **`test/dist`** prueba el **HTML ya construido** de `apps/web/dist/`, analizado con `parse5`. Solo corre en la CI (job `pruebas`, en Ubuntu y en Windows) o cuando alguien construye a propósito. Comprueba, entre otras cosas: idioma `es`, un solo `h1`, texto alternativo, controles con etiqueta, enlace para saltar al contenido, ningún `style=`, ningún script o estilo en línea, ninguna fuente o CDN externos, el aviso de no afiliación en todas las páginas, que no existan `/juegos`, `/categorias` ni `/como-funciona` como índices, que un concepto no tenga página ni enlace, el sitemap y `robots.txt`, las cabeceras de `_headers` y que el JavaScript propio de la portada pese 20 KB comprimido o menos.

El job `pruebas` de `.github/workflows/ci.yml` hace, en orden: `npm ci`, `npm test`, `typecheck`, `build`, `test:dist` y `check:schema`. La construcción de la CI usa:

- `SITE_URL=http://localhost:8790`: las pruebas de dist esperan ese origen para las URL absolutas (canónica, Open Graph, sitemap).
- `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`: la clave pública de **prueba** de Turnstile.
- Sin `TIENDA_DEV_STATE`: el estado de Astro y Wrangler va a la carpeta por defecto de `scripts/run.mjs` (`<repo>/../.dev-state/tienda-live`), que en el runner queda fuera del checkout. El `env` de un job no puede usar el contexto `runner` (por ejemplo `runner.temp`): GitHub rechaza el workflow entero y no corre ningún job. Una prueba de `scripts/root-config.test.mjs` lo impide.
- Sin `PUBLIC_CF_BEACON_TOKEN`: la construcción de la CI no lleva analítica.

Las pruebas de dist leen la carpeta que indique `DIST_DIR` (por defecto `apps/web/dist`), así que se pueden probar contra HTML guardado sin construir.

`check:schema` ejecuta `astro sync` una vez por cada archivo inválido de `test/fixtures/juegos-invalidos/` y exige que falle nombrando el archivo y el campo.

## Lista de comprobación del dueño

Los agentes no construyen ni levantan la vista previa. Estas comprobaciones las hace el dueño, con la web construida y servida por el Worker:

```sh
npm run preview
```

Eso construye la web y abre todo en `http://localhost:8790` (con la base local y la clave de prueba de Turnstile). La consola del servidor imprime los enlaces de confirmación.

| N.º | Qué comprobar                | Cómo                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Alta de punta a punta        | Anótate con la clave de prueba de Turnstile, abre el enlace que sale en la consola, confirma y corre `npm run embudo`: tu alta debe figurar como confirmada.                                                                                                                                                                                                                                                                    |
| M2  | Teclado y lector de pantalla | Con solo el teclado y con NVDA: errores del formulario, enlace para saltar al contenido y foco.                                                                                                                                                                                                                                                                                                                                 |
| M3  | Pantallas pequeñas           | A 320 px y con 200 % de zoom no hay desplazamiento horizontal; con "reducir movimiento" activado no hay animaciones.                                                                                                                                                                                                                                                                                                            |
| M4  | Política de seguridad        | La consola del navegador no muestra violaciones de CSP, y `curl -I http://localhost:8790/` muestra las cabeceras de `_headers`. Ver la nota de Turnstile más abajo.                                                                                                                                                                                                                                                             |
| M5  | Lighthouse                   | En móvil, al menos 90 en las cuatro categorías; anota los valores.                                                                                                                                                                                                                                                                                                                                                              |
| M6  | Nada en C:                   | Después de correr todo, `%APPDATA%\xdg.config\.wrangler` y `%APPDATA%\astro` no existen o no cambiaron.                                                                                                                                                                                                                                                                                                                         |
| M7  | Video real                   | Cuando haya un clip: pon `video` en `asedio.md` y comprueba controles, subtítulos y que cuenta `video_play` una vez.                                                                                                                                                                                                                                                                                                            |
| M8  | Runbook de borrado           | Lee el runbook de `apps/api/README.md` y comprueba que se entiende y funciona sobre la base local.                                                                                                                                                                                                                                                                                                                              |
| M9  | Enlace de la consola         | Con `npm run preview`, anótate con la clave de prueba: el enlace que imprime el correo de consola debe empezar por `http://localhost:8790/confirmar#t=`. Si empieza por `:4400`, `--var SITE_URL` no gana a `.dev.vars` en esa versión de Wrangler: avisa y se agrega un entorno `preview` en `apps/api/wrangler.jsonc` (tarea condicional 8.5, que repite los `d1_databases`, `assets`, `triggers`, `vars` y `observability`). |
| M10 | Proxy de `npm run dev`       | Con `npm run dev` corriendo, `curl -i -X POST http://localhost:4400/v1/events -H "Origin: http://localhost:4400" -H "Content-Type: application/json" -d '{"name":"form_open"}'` debe dar `204`, y `npm run embudo` debe mostrar +1 hoy. Si no funciona, desarrolla con `npm run preview` (la topología de producción) y deja anotado aquí que `npm run dev` no sirve `/v1`; no hace falta otro arreglo de código.               |

### Nota de Turnstile y `style-src` (relacionada con M4)

Es posible que el widget de Turnstile en la portada necesite estilos en línea y la consola muestre una violación de `style-src`. Eso no se verificó (el widget no se pudo cargar en las pruebas de desarrollo). **Si aparece**, la salida documentada es agregar `'unsafe-inline'` **solo a `style-src`** en `packages/contracts/src/security-headers.js` (con su prueba) y anotarlo en `apps/api/README.md`. Relaja la política sin `unsafe-inline` del diseño, así que **necesita el visto bueno del dueño** antes de aplicarse.

## Pendientes conocidos

- Los textos legales (`src/content/legal`) son borradores sin revisión de un abogado; el correo de contacto figura como "pendiente".
- Una segunda ficha de juego necesita su propio texto alternativo de póster (hoy el de la ficha reutiliza el de ASEDIO).
- El póster muestra el HUD de ASEDIO cortado en "Bombardero" (un detalle del juego, fuera de este cambio): conviene recapturarlo.
- Las pruebas de dist, `_headers`, las rutas de las imágenes optimizadas y el presupuesto de 20 KB solo se ven con una construcción: la primera corrida de la CI es su prueba.
