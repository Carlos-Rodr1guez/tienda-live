# Decisiones de arquitectura (ADR)

Cada decisión que cuesta revertir queda escrita acá: qué problema había, qué opciones se miraron, qué se eligió y qué trae. Así, dentro de un año, se entiende por qué el proyecto es como es.

## Estados

- **Propuesta:** hay una recomendación, pero falta la decisión del dueño del proyecto.
- **Aceptada:** se decidió y se aplica.
- **Reemplazada por ADR-NNN:** una decisión nueva la dejó sin efecto.
- **Descartada:** se analizó y no se adoptó.

Una ADR aceptada no se reescribe: si la decisión cambia, se escribe una nueva que la reemplaza.

## Índice

| ADR                                                    | Decisión                                               | Estado    | Se decide en                           |
| ------------------------------------------------------ | ------------------------------------------------------ | --------- | -------------------------------------- |
| [001](0001-conexion-tiktok-sin-agpl.md)                | Conexión con TikTok LIVE sin AGPL                      | Propuesta | H0, con un abogado                     |
| [002](0002-distribucion-electron.md)                   | Distribución como app de escritorio                    | Propuesta | H0                                     |
| [003](0003-stack-de-la-pagina.md)                      | Stack de la página                                     | Aceptada  | H0                                     |
| [004](0004-cobro-merchant-of-record.md)                | Proveedor de cobro                                     | Propuesta | H0 la cuenta, H4 la integración        |
| [005](0005-licencias-ed25519.md)                       | Sistema de licencias                                   | Propuesta | H2                                     |
| [006](0006-modelo-de-precio.md)                        | Modelo de precio                                       | Propuesta | H4, con los datos de la beta           |
| [007](0007-mercado-inicial.md)                         | Mercado inicial                                        | Propuesta | H0                                     |
| [008](0008-categorias-del-catalogo.md)                 | Categorías del catálogo y orden de los juegos 2 y 3    | Aceptada  | H1 las categorías, H4 el orden         |
| [009](0009-typescript-7-raiz-y-6-web.md)               | TypeScript 7 en la raíz y 6 solo en apps/web           | Aceptada  | H1                                     |
| [010](0010-kit-compartido-v0.md)                       | Kit compartido v0 (`packages/kit`)                     | Propuesta | Batalla de países; H2 al migrar ASEDIO |
| [011](0011-paises-simbolos-y-contenido.md)             | Juegos con países: símbolos nacionales y contenido     | Aceptada  | Batalla de países                      |
| [012](0012-nombres-de-espectadores.md)                 | Nombres de espectadores en pantalla                    | Propuesta | Batalla de países                      |
| [013](0013-modo-narrador.md)                           | Modo narrador                                          | Aceptada  | Batalla de países                      |
| [014](0014-orden-publico-batalla-antes-que-carrera.md) | Orden del Público: Batalla de países antes que Carrera | Aceptada  | Batalla de países                      |
| [015](0015-vista-batalla-canvas-2d.md)                 | Vista de Batalla: 16:9, pixel art oblicua y Canvas 2D  | Propuesta | Gate 0 de Batalla de países            |

## Plantilla

```markdown
# ADR-NNN: Título corto

- **Estado:** Propuesta
- **Fecha:** AAAA-MM-DD
- **Se decide en:** hito

## Contexto

Qué problema hay y qué lo condiciona.

## Opciones

Cada alternativa, con lo bueno y lo malo.

## Decisión propuesta

Qué se recomienda y por qué. Cuando se acepta, el título pasa a "Decisión".

## Consecuencias

Qué cambia, qué cuesta y qué queda pendiente.
```
