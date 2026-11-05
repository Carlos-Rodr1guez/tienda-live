# Tienda LIVE (nombre provisorio)

Monorepo de los juegos interactivos para TikTok LIVE y de la página que los vende. El nombre definitivo llega con la marca; mientras tanto, el paquete raíz se llama `tienda-live`.

## Qué hay adentro

| Carpeta              | Qué guarda                                                                    | Llega en |
| -------------------- | ----------------------------------------------------------------------------- | -------- |
| `games/asedio`       | ASEDIO LIVE, el primer juego (categoría Acción)                               | Ya está  |
| `games/*`            | Los próximos juegos, por ejemplo Acuario (Relax) y Carrera (Público)          | H5       |
| `apps/web`           | La vitrina estática (Astro): portada, ficha de ASEDIO, lista de espera, legal | Ya está  |
| `apps/api`           | El Worker de Cloudflare: lista de espera, contadores del embudo y la web      | Ya está  |
| `apps/*`             | La app de escritorio                                                          | H2       |
| `packages/contracts` | Enumeraciones, validadores, textos en español y cabeceras, compartidos        | Ya está  |
| `packages/*`         | Código compartido: conexión con TikTok, kit de juego y licencias              | H2       |
| `scripts/`           | Lanzador de desarrollo, compuerta de licencias y pruebas de la configuración  | Ya está  |
| `docs/`              | Plan de producto y decisiones de arquitectura                                 | Ya está  |

Cada app tiene su README: [apps/web](apps/web/README.md) (cómo agregar un juego, textos, imágenes, CSP, pruebas de dist y lista de comprobación del dueño) y [apps/api](apps/api/README.md) (rutas, datos y runbooks).

## Requisitos

Node.js 22.23.4 o superior (lo exige Astro 7); la CI usa la versión de `.nvmrc`. npm ya trae workspaces desde la versión 7.

## Uso

Todo se corre desde la raíz del repositorio:

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

- `npm install` instala las dependencias de todos los paquetes en un solo `node_modules`, en la raíz.
- `npm start` levanta ASEDIO LIVE. Lo que va después de `--` le llega al juego: `npm start -- --user=tu_usuario`.
- `npm test` corre las pruebas de cada paquete que las tenga y las de `scripts/`.
- `npm run check` corre lo mismo que la CI: lint, formato, tipos, pruebas y licencias.
- `npm run format` acomoda el formato de todo con Prettier.
- `npm run build:demo` genera la demo de ASEDIO en un solo archivo.

Para un script de un paquete en particular se usa `-w` con el nombre del paquete, por ejemplo `npm test -w asedio-live`.

### La vitrina y su API

| Comando              | Qué hace                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`        | Web (puerto 4400) y API (puerto 8790) a la vez, con las líneas prefijadas `[web]` y `[api]`; Ctrl+C frena las dos |
| `npm run dev:web`    | Solo la web en el puerto 4400; `/v1` se redirige a la API                                                         |
| `npm run dev:api`    | Solo el Worker en el puerto 8790 (inspector 9290), con la base D1 local                                           |
| `npm run preview`    | Construye la web y la sirve con el Worker en `http://localhost:8790`: es la topología de producción               |
| `npm run db:migrate` | Aplica las migraciones a la base D1 **local**                                                                     |
| `npm run embudo`     | Informe del embudo sobre la base local (altas, intereses, eventos de los últimos 14 días; sin correos)            |
| `npm run check`      | Lint, formato, tipos, pruebas y licencias. No construye nada                                                      |

`npm run preview` pasa por `scripts/preview.mjs`: pone `SITE_URL=http://localhost:8790` y la clave pública de **prueba** de Turnstile (`1x00000000000000000000AA`) y luego construye la web y la sirve. Las pone él porque la construcción de la web las exige explícitas y se detiene si faltan; así no escribes nada a mano y funciona igual en cmd, PowerShell y bash.

`npm run preview` construye la web: es cosa del dueño y de la CI, no de las herramientas automáticas. Qué comprobar en esa vista previa: la lista del [README de la web](apps/web/README.md#lista-de-comprobación-del-dueño).

### Estado de las herramientas, fuera de C:

Astro y Wrangler guardan configuración, registros y temporales por su cuenta, y por defecto lo hacen en la carpeta del usuario (`%APPDATA%`, `~/.wrangler`), que en este equipo está en C:. Para que **nada** de eso toque C:, todos los scripts de desarrollo pasan por `scripts/run.mjs`, que redirige ese estado a una carpeta aparte:

- Por defecto: `D:\TIKTOK\asedio-live\.dev-state\tienda-live` (la carpeta `.dev-state`, hermana del repositorio, y fuera de git).
- Para cambiarla: la variable `TIENDA_DEV_STATE` con la ruta que quieras. La CI no la define: usa la carpeta por defecto, que en el runner queda fuera del checkout.
- El lanzador también apaga la telemetría de Astro y Wrangler y no define nunca variables con credenciales de Cloudflare.
- Esa carpeta se puede borrar en cualquier momento; se vuelve a crear sola. Si ves que aparecen `%APPDATA%\astro` o `%APPDATA%\xdg.config\.wrangler`, alguien corrió Astro o Wrangler sin pasar por el lanzador.

### Variables locales (`.dev.vars`)

El Worker lee sus variables de `apps/api/.dev.vars`, que git ignora. `npm run dev:api` (y `npm run dev`) lo crea copiando [`apps/api/.dev.vars.example`](apps/api/.dev.vars.example) si no existe. Para cambiar algo, edita `.dev.vars`; el ejemplo es el único que se versiona.

| Variable               | En local                               | Para qué                                           |
| ---------------------- | -------------------------------------- | -------------------------------------------------- |
| `ENVIRONMENT`          | `development`                          | Activa el correo de consola y los orígenes locales |
| `SITE_URL`             | `http://localhost:4400`                | Origen permitido y base de los enlaces del correo  |
| `TURNSTILE_SECRET_KEY` | La clave secreta de **prueba** (abajo) | Verifica el widget de Turnstile                    |

`npm run preview` pasa `--var SITE_URL:http://localhost:8790` para que el enlace de confirmación apunte al Worker; si en tu versión de Wrangler eso no gana a `.dev.vars`, ver la comprobación M9.

### Claves de prueba de Turnstile

Cloudflare publica claves de prueba que **siempre aprueban** y que solo sirven en local. No son secretos:

- Clave pública (del sitio, `PUBLIC_TURNSTILE_SITE_KEY`): `1x00000000000000000000AA`. Con `npm run dev` la web usa esta si no defines ninguna; `npm run preview` la pone sola. Una construcción de producción no tiene respaldo: sin la variable se detiene.
- Clave secreta (`TURNSTILE_SECRET_KEY` en `.dev.vars`): `1x0000000000000000000000000000000AA`.

En producción la API rechaza la clave pública de prueba. Las claves reales se cargan solo con `wrangler secret put` y en la construcción de la web; nunca van al repositorio (ver la lista de despliegue en [apps/api/README.md](apps/api/README.md)).

Cómo se juega y cómo se transmite: [games/asedio/README.md](games/asedio/README.md).

## Convenciones

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) en español: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`.
- **Versiones:** semver, cada paquete con la suya.
- **Ramas:** `main` siempre funciona. Los cambios entran por pull request con la CI en verde.
- **Calidad:** ESLint encuentra errores y Prettier decide el formato. TypeScript revisa los `.ts` y los `.js` que empiezan con `// @ts-check`.
- **Licencias:** nada AGPL, GPL o SSPL en las dependencias de producción; `npm run licenses` lo controla en cada push. La única excepción es `tiktok-live-connector`, que se reemplaza en el H2.
- **Secretos:** nunca en el repositorio. Van en un `.env`, que git ignora.
- **git blame:** el commit que solo formateó el código está en `.git-blame-ignore-revs`. Para que tu git lo saltee: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Plan

- [Plan de producto](docs/plan-producto.md)
- [Decisiones de arquitectura (ADR)](docs/adr/README.md)
