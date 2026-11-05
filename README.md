# Tienda LIVE (nombre provisorio)

Monorepo de los juegos interactivos para TikTok LIVE y de la página que los vende. El nombre definitivo llega con la marca; mientras tanto, el paquete raíz se llama `tienda-live`.

## Qué hay adentro

| Carpeta | Qué guarda | Llega en |
|---|---|---|
| `games/asedio` | ASEDIO LIVE, el primer juego (categoría Acción) | Ya está |
| `games/*` | Los próximos juegos, por ejemplo Acuario (Relax) y Carrera (Público) | H5 |
| `apps/*` | La página de la tienda y la app de escritorio | H1 y H2 |
| `packages/*` | Código compartido: conexión con TikTok, kit de juego y licencias | H2 |
| `docs/` | Plan de producto y decisiones de arquitectura | Ya está |

## Requisitos

Node.js 20 o superior. npm ya trae workspaces desde la versión 7.

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
- `npm test` corre las pruebas de cada paquete que las tenga.
- `npm run build:demo` genera la demo de ASEDIO en un solo archivo.

Para un script de un paquete en particular se usa `-w` con el nombre del paquete, por ejemplo `npm test -w asedio-live`.

Cómo se juega y cómo se transmite: [games/asedio/README.md](games/asedio/README.md).

## Convenciones

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) en español: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`.
- **Versiones:** semver, cada paquete con la suya.
- **Ramas:** `main` siempre funciona. Los cambios entran por pull request con la CI en verde.
- **Secretos:** nunca en el repositorio. Van en un `.env`, que git ignora.

## Plan

- [Plan de producto](docs/plan-producto.md)
