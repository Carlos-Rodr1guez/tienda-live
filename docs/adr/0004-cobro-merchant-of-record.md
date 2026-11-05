# ADR-004: Cobro con un merchant of record

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H0 la cuenta, H4 la integración

## Contexto

Vender software a clientes de muchos países obliga a cobrar y pagar el IVA, o el impuesto que corresponda, en cada uno. Un vendedor individual no puede hacerlo por su cuenta.

Un merchant of record (MoR) es quien le vende legalmente al cliente final: cobra, paga esos impuestos y después le paga al vendedor. No todos los MoR le pagan a todos los países, y abrir la cuenta lleva una verificación que puede tardar.

## Opciones

| Opción                             | A favor                                                       | En contra                                                                                         |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Un MoR, por ejemplo Polar o Paddle | Impuestos resueltos. Checkout, recibos y reembolsos incluidos | Comisión más alta que la de un procesador común. Hay que confirmar que pague al país del vendedor |
| Lemon Squeezy                      | MoR con API de licencias                                      | Está en transición a Stripe Managed Payments                                                      |
| Stripe directo                     | Comisión más baja                                             | No es MoR: los impuestos quedan a cargo del vendedor. No está disponible en todos los países      |
| Una tienda de juegos, como itch.io | Visibilidad                                                   | Sin control del checkout ni de las licencias. La marca queda en segundo plano                     |

## Decisión propuesta

Un MoR que le pague al país del vendedor. La cuenta se abre en el H0, porque la verificación tarda, y la integración llega en el H4.

## Consecuencias

- Las licencias no dependen del proveedor (ADR-005). Si hay que cambiar de MoR, las licencias que ya se emitieron siguen valiendo.
- Cada webhook del proveedor se verifica por su firma y se procesa una sola vez: la tabla `webhook_events` guarda el `event_id` como único.
- El precio final para el cliente incluye los impuestos de su país.
