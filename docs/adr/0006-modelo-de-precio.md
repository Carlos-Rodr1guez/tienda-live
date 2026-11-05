# ADR-006: Modelo de precio

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H4, con los datos de la beta

## Contexto

Cada cliente conectado tiene un costo que se repite todos los meses: el servicio de conexión al LIVE (ADR-001) y la infraestructura. Además, los juegos necesitan actualizaciones cada vez que TikTok cambia algo. Si se cobra una sola vez, ese pago tiene que cubrir esos costos durante toda la vida del cliente.

## Opciones

| Opción                                                                                  | A favor                                                                | En contra                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| Suscripción al catálogo                                                                 | El ingreso acompaña al costo recurrente, y cada juego nuevo suma valor | Más difícil de vender a quien recién empieza |
| Pago único por juego                                                                    | Es lo que el streamer espera cuando "compra un juego"                  | El costo de conexión sigue después del pago  |
| Las dos: pago único con un año de actualizaciones y conexión, o suscripción al catálogo | Cubre los dos perfiles                                                 | Más difícil de explicar y de implementar     |

## Decisión propuesta

No decidir todavía. En la beta (H3) se mide cuánto se usan los juegos, cuántos directos por semana hace cada streamer y cuánto pagaría. Con esos datos se elige en el H4.

## Consecuencias

- El modelo de datos ya soporta los dos caminos: `entitlements` guarda `source` y `expires_at`.
- La página muestra precios recién en el H4. Antes, solo hay lista de espera.
