# ADR-007: Mercado inicial: streamers hispanohablantes

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H0

## Contexto

ASEDIO ya está en español, y el producto, la documentación y el soporte nacen en ese idioma. Los primeros streamers de prueba salen de directos en español. Validar en un mercado a la vez es más barato que hacerlo en varios.

## Opciones

| Opción                         | A favor                                                                               | En contra                                             |
| ------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Hispanohablantes primero       | Comunicación y soporte en el idioma propio, y acceso directo a los primeros streamers | Mercado más chico, con menor poder de compra promedio |
| Inglés primero                 | Mercado más grande                                                                    | Más competencia, y soporte en un segundo idioma       |
| Varios idiomas desde el inicio | Más alcance                                                                           | Multiplica el trabajo antes de validar                |

## Decisión propuesta

Streamers hispanohablantes de Latinoamérica y España primero. Portugués e inglés llegan en el H6.

## Consecuencias

- El producto usa español neutro, sin regionalismos fuertes.
- Los textos de la interfaz se separan del código desde el principio. Así, sumar un idioma es traducir, no reescribir.
- El proveedor de cobro (ADR-004) tiene que aceptar los medios de pago de la región.
