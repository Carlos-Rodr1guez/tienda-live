# ADR-009: TypeScript 7 en la raíz, TypeScript 6 solo en apps/web, y JavaScript con JSDoc

- **Estado:** Aceptada
- **Fecha:** 2026-11-05
- **Se decide en:** H1

## Contexto

El monorepo usa TypeScript 7 (el compilador nativo) en la raíz. Con la web en Astro aparecen cuatro límites de las herramientas:

- La API de JavaScript de TypeScript 7 solo existe bajo `./unstable`, y las herramientas que la necesitan todavía no la usan.
- `@astrojs/check` 0.9.12, que revisa los archivos `.astro`, declara TypeScript 5 o 6 como dependencia de pares.
- `typescript-eslint` pide una versión de TypeScript menor que 6.1.
- `eslint-plugin-astro` pide Node 24.16 o más, y la máquina de desarrollo tiene 24.11.1.

## Opciones

- **A. TypeScript 6 solo dentro de `apps/web`.** La raíz sigue en 7 y revisa la API y los contratos. `astro check` usa el 6 anidado.
- **B. No revisar los tipos de los `.astro`.** Quedan las pruebas unitarias, la construcción y las pruebas sobre `dist`. Un paquete menos, pero los errores de tipos en las páginas se descubren tarde.
- **C. Volver la raíz a TypeScript 6.** Una sola versión, pero se pierde la velocidad del compilador nativo y se ata todo el monorepo a la limitación de una herramienta.
- **D. Esperar.** Sin revisión de tipos en la web hasta que las herramientas se pongan al día.

## Decisión

**A.** La raíz usa TypeScript 7 y `apps/web` declara TypeScript 6 (`~6.0.3`) para `astro check`. La API y los contratos se escriben en JavaScript con JSDoc y `// @ts-check`, igual que `games/asedio`, y los archivos `.astro` son solo presentación: la lógica vive en módulos de JavaScript con pruebas.

Cómo se juntan las dos mitades:

- La `tsconfig.json` de la raíz excluye `apps/web`, y `apps/web/tsconfig.json` la revisa con TypeScript 6.
- `npm run typecheck` corre las dos revisiones y falla si falla cualquiera.
- `apps/web/tsconfig.json` apunta con `paths` a las fuentes de `@tienda/contracts`. Sin eso TypeScript 6 trata el paquete del monorepo como un módulo externo sin tipos y todo lo que se importa de ahí queda como `any` (aviso ts7016). `allowJs` y `maxNodeModuleJsDepth` no alcanzaron.

## Consecuencias

- Hay dos versiones de TypeScript en el repositorio.
- `astro check` corre `astro sync` antes de revisar los tipos.
- Dependabot ignora los saltos de versión mayor de `typescript`, para que el 6 de la web no se actualice solo al 7. Los saltos mayores de la raíz se hacen a mano.
- JSDoc es más verboso que los tipos de TypeScript.
- Las listas de valores de la base de datos (por ejemplo, la frecuencia de LIVE o el país) viven en restricciones `CHECK`, así que agregar un valor nuevo exige una migración que reconstruya la tabla. Una prueba de la API compara cada lista con la enumeración de `@tienda/contracts`, y agregar un valor solo en los contratos la rompe.

## Cuándo revisarla

- Cuando `@astrojs/check` o el servidor de lenguaje de Astro admitan TypeScript 7: se unifica todo en 7 y se quitan el TypeScript 6 anidado y la excepción de Dependabot.
- Cuando el Node local sea 24.16 o más: se suma `eslint-plugin-astro`.
- Cuando `typescript-eslint` admita TypeScript 7: se puede volver a pensar en escribir fuentes en TypeScript.
