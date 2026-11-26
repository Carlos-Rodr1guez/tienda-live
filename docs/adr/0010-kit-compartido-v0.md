# ADR-010: Kit compartido v0 (`packages/kit`)

- **Estado:** Propuesta
- **Fecha:** 2026-11-06
- **Se decide en:** Batalla de países; H2 al migrar ASEDIO

## Contexto

Batalla de países es el segundo juego que necesita el mismo servidor que ASEDIO: el puente con TikTok LIVE, la normalización de eventos, el servidor estático y el simulador de audiencia. Es el segundo consumidor, así que ya se puede ver qué es genérico y qué no.

## Opciones

- **A. Copiar el servidor de ASEDIO** a la carpeta del juego nuevo. Es rápido, pero cada arreglo del puente hay que hacerlo dos veces y las copias se separan.
- **B. Kit v0 mínimo (`packages/kit`).** Se mueve a un paquete solo lo que ASEDIO ya demostró genérico: servidor, puente, contrato de eventos y unos pocos módulos puros. Cuesta un movimiento de archivos controlado.
- **C. Un `core` completo** con motor, render y reglas compartidas. Promete reuso, pero se diseñaría con un solo ejemplo real y con abstracciones que nadie pidió.

## Decisión propuesta

**B.** El paquete `@tienda/kit` vive en `packages/kit`:

- El exports map, con extensión `.js`, es la API. Lo que no está en el mapa no se importa desde afuera.
- Los módulos de navegador se sirven bajo `/kit/sim/` y `/kit/client/`. `src/server` nunca se monta.
- Vale la regla de dos: algo entra al kit cuando lo usan dos juegos, no antes.
- ASEDIO migra a consumir el kit en H2; en este cambio solo se mueve su servidor y su comportamiento queda idéntico.
- La conexión con TikTok sigue en el kit con el conector actual. ADR-001 no cambia: se usa en los LIVE del propio dueño.

## Consecuencias

- Hay un paquete más que mantener, pero el servidor deja de estar duplicado.
- Mover el servidor de ASEDIO es un solo commit y se revierte de una vez.
- Los 27 tests de ASEDIO se conservan con los mismos nombres como prueba de que nada cambió.
- Si el segundo juego no se hace, el kit queda como un servidor con otro nombre: poco daño y fácil de deshacer.
