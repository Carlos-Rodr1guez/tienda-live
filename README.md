# Tienda LIVE (nombre provisorio)

Monorepo de los juegos interactivos para TikTok LIVE y de la página que los vende. El nombre definitivo llega con la marca; mientras tanto, el paquete raíz se llama `tienda-live`.

## Qué hay adentro

| Carpeta        | Qué guarda                                                           | Llega en |
| -------------- | -------------------------------------------------------------------- | -------- |
| `games/asedio` | ASEDIO LIVE, el primer juego (categoría Acción)                      | Ya está  |
| `games/*`      | Los próximos juegos, por ejemplo Acuario (Relax) y Carrera (Público) | H5       |
| `apps/*`       | La página de la tienda y la app de escritorio                        | H1 y H2  |
| `packages/*`   | Código compartido: conexión con TikTok, kit de juego y licencias     | H2       |
| `docs/`        | Plan de producto y decisiones de arquitectura                        | Ya está  |

## Requisitos

Node.js 20 o superior; la CI usa la versión de `.nvmrc`. npm ya trae workspaces desde la versión 7.

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
