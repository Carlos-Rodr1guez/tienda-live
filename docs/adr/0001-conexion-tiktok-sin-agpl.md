# ADR-001: Conexión con TikTok LIVE sin AGPL

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H0, con un abogado

## Contexto

ASEDIO se conecta al LIVE con `tiktok-live-connector` 2.5.0, que tiene licencia AGPL-3.0-only. También es AGPL `tiktok-live-proto`, que llega con él. La versión 1.2.3 del conector era MIT; el cambio de licencia llegó con la 2.x.

La AGPL es copyleft fuerte: quien distribuye un programa que la incluye tiene que entregar el código fuente de toda la obra bajo la misma licencia. Eso no cierra con vender juegos de código cerrado. Además, el README del propio conector dice que no está pensado para producción y recomienda la API de WebSocket de Euler Stream.

TikTok no ofrece una API pública para leer un LIVE. Cualquier opción depende de un tercero que siga los cambios de TikTok.

## Opciones

| Opción                                                         | Licencia      | A favor                                                                                                                  | En contra                                                                            |
| -------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Euler Stream, WebSocket con `@eulerstream/euler-websocket-sdk` | MIT (el SDK)  | Servicio administrado que mantiene la firma cuando TikTok cambia. Autenticación con JWT, que se puede emitir por cliente | Servicio pago. Hay que medir la latencia y los límites del plan                      |
| tik.tools con `tiktok-live-api`                                | MIT           | La misma idea con otro proveedor                                                                                         | Sin probar todavía en este proyecto                                                  |
| Seguir con `tiktok-live-connector` 2.x                         | AGPL-3.0-only | Ya funciona                                                                                                              | Obliga a abrir el código de lo que se vende                                          |
| Fork de la 1.2.3                                               | MIT           | Sin costo de servicio                                                                                                    | Quedó atrás del protocolo actual de TikTok; mantenerla es trabajo de todos los meses |
| Pedirle al autor una licencia comercial                        | A negociar    | Ningún cambio de código                                                                                                  | Depende de un tercero y no resuelve el aviso de "no apto para producción"            |

## Decisión propuesta

Pasar a Euler Stream con su SDK MIT, con tik.tools como respaldo. El servidor de licencias (ADR-005) le entrega a cada cliente con licencia válida un JWT de corta duración para conectarse. Así la clave de Euler nunca viaja dentro de la app, y la conexión misma frena la piratería.

Antes de aceptarla:

1. **Spike de 2 a 3 días:** conectar con el SDK, medir la latencia y confirmar cómo se emite un JWT por cliente y qué límites tiene el plan. Si el JWT por cliente no es viable, el plan B es retransmitir la conexión desde un Worker con Durable Objects.
2. **Consulta con un abogado** sobre la AGPL y los términos de TikTok. Este documento no es asesoramiento legal.

## Consecuencias

- La conexión queda detrás de una interfaz propia, con un adaptador por proveedor (H2). Cambiar de proveedor no toca los juegos.
- Hay un costo recurrente por cliente conectado, que el modelo de precio (ADR-006) tiene que cubrir.
- Hasta el reemplazo, `scripts/check-licenses.mjs` deja pasar `tiktok-live-connector` y `tiktok-live-proto` como excepción temporal.
- El `package.json` de `asedio-live` declara MIT, algo que no cierra mientras dependa de una librería AGPL. Se resuelve con el reemplazo; hasta entonces, el juego no se vende ni se reparte a terceros.
