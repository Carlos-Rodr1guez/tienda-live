# ADR-005: Licencias propias con tokens Ed25519

- **Estado:** Propuesta
- **Fecha:** 2026-11-04
- **Se decide en:** H2

## Contexto

La app tiene que saber qué juegos abre cada cliente, y seguir funcionando si el directo arranca con internet inestable. Además, la conexión al LIVE necesita un JWT por cliente (ADR-001), que solo debería recibir quien tiene una licencia válida.

## Opciones

| Opción                                                                                    | A favor                                                                                                   | En contra                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Propias: el servidor firma un token con Ed25519 y la app lo verifica con la clave pública | No dependen del proveedor de cobro. Se verifican sin conexión. El mismo servidor emite el JWT de conexión | Hay que cuidar la clave privada y planear cómo rotarla          |
| La API de licencias del proveedor de cobro                                                | Nada que construir                                                                                        | Ata las licencias al proveedor: cambiar de MoR rompe las claves |
| Un servicio de licencias, como Keygen                                                     | Completo                                                                                                  | Otro costo mensual y otro proveedor                             |
| Sin licencias                                                                             | Simple                                                                                                    | Cualquiera copia el instalador                                  |

## Decisión propuesta

Licencias propias. Al activar, el servidor (en Workers) registra el dispositivo y devuelve un token firmado con Ed25519. El token dice qué licencia es, qué juegos abre, para qué dispositivo y cuándo vence. La app lo verifica con la clave pública que trae adentro y lo renueva en segundo plano.

- Hasta 2 dispositivos por licencia.
- Unos días de margen sin conexión antes de pedir que se renueve.
- La clave de licencia se guarda solo como hash.

## Consecuencias

- La clave privada vive como secreto de Workers, nunca en el repositorio. Cada token lleva el id de la clave (`kid`), para poder rotarla sin cortar a nadie.
- Una licencia revocada sigue andando hasta que vence su token. Por eso los tokens duran días, no meses.
- Ninguna protección del lado del cliente es inviolable. El freno real es que la conexión al LIVE pasa por el JWT que emite el servidor.
