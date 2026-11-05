# Plan: de ASEDIO LIVE a una tienda de minijuegos para TikTok LIVE

Borrador del 4 de noviembre de 2026. Los precios y las reglas de terceros salen de páginas de proveedores y de comparativas: confirmalos antes de decidir.

## La idea en una línea

**La página crece con los juegos.** Primero una vidriera con lista de espera, para medir el interés; el cobro llega recién con el lanzamiento comercial. No se pasa de etapa sin cumplir su **puerta** (el criterio para avanzar).

El orden detallado, con los hitos H0 a H6, las tareas técnicas, la arquitectura y las categorías del catálogo, está en el [roadmap técnico](https://claude.ai/artifact/JAe31yRkPVuViziz6Ybku6). Este documento queda como el análisis de fondo. Así se corresponden:

| Este plan         | Roadmap                                                          |
| ----------------- | ---------------------------------------------------------------- |
| Fase 0: validar   | H0 y H1; los streamers de prueba pasan a la beta de H3           |
| Fase 1: cimientos | H2 núcleo sin AGPL                                               |
| Fase 2: producto  | H3 beta cerrada y H4 lanzamiento comercial                       |
| Fase 3: catálogo  | H5 catálogo                                                      |
| Fase 4: tienda    | Repartida: la vidriera en H1, el cobro en H4 y el catálogo en H5 |

## Punto de partida

- ASEDIO LIVE funciona en directos reales: puente con TikTok, bandos por comentarios, energía, likes, nombres de donantes, simulador y 26 pruebas automáticas.
- Corre en la PC del streamer: Node + Chrome, y LIVE Studio captura la ventana.
- `server/tiktok.js` y `server/normalize.js` ya funcionan como un enchufe: el juego recibe eventos `{ type, userId, nickname, avatar, text, giftName, coins, count }` y no sabe de dónde vienen. Ese contrato es el activo más valioso para todo lo que sigue.

## Bloqueantes: resolver antes de cobrar un peso

### 1. La licencia de `tiktok-live-connector` es AGPL-3.0

Verificado en `node_modules/tiktok-live-connector/package.json` (`"license": "AGPL-3.0-only"`) y en su archivo `LICENSE`. La versión 1.x era MIT; la 2.x, que es la que usás, es AGPL.

- **Qué implica:** si distribuís un programa que la incluye, en general tenés que entregar el código fuente completo de tu juego bajo la misma licencia. La AGPL además alcanza al software ofrecido como servicio por internet. Vender ASEDIO como programa cerrado con esa librería adentro choca con eso.
- **Lo que no implica:** usarla en tus propios directos, sin distribuirla, no te obliga a nada.
- **El propio README de la librería** dice que es un proyecto de ingeniería inversa, no apto para producción, y recomienda la API WebSocket de Euler.
- Hoy `package.json` dice `"license": "MIT"` para el juego. Con esa dependencia no cierra.

**Salidas:**

| Opción                                  | Cómo                                                                                                                       | A favor                                                                               | En contra                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| **A. Cambiar de cliente (recomendada)** | `@eulerstream/euler-websocket-sdk` (MIT) contra la WebSocket administrada de Euler, o `tiktok-live-api` de tik.tools (MIT) | Producto cerrado posible; el proveedor mantiene la conexión cuando TikTok cambia algo | Servicio pago; dependés del proveedor  |
| B. Publicar el juego como AGPL          | Código abierto; vendés hosting, soporte o recursos                                                                         | Sin costo de licencia                                                                 | Cualquiera puede copiarlo y revenderlo |
| C. Licencia comercial                   | Preguntarles a los autores (isaackogan y Euler Stream) si la ofrecen                                                       | Mantenés el código actual                                                             | No sé si existe esa opción             |

No soy abogado: confirmá la decisión final con uno.

### 2. Términos de TikTok

No pude confirmar el texto actual sobre ingeniería inversa: TOS Tracker marca esa sección como eliminada el 31/01/2026 y no muestra con qué la reemplazaron. Antes de vender:

- consultá con un abogado;
- agregá en la tienda y en el juego un aviso de "No afiliado a TikTok ni a ByteDance";
- no uses el logo de TikTok ni la palabra "TikTok" en el nombre de tu marca. Decí "para TikTok LIVE" como descripción y revisá las pautas de marca de TikTok.

## Fase 0: validar (2 a 4 semanas de directos)

**Objetivo:** saber si el juego trae regalos y si otros streamers lo quieren.

1. **Resumen del directo:** que el juego guarde un archivo por sesión con duración, espectadores que participaron, comentarios, likes, regalos, monedas por bando, bombardeos de energía y rondas ganadas. Sin números, la validación es una sensación.
2. Hacé 8 a 10 directos propios con ASEDIO y compará las monedas por hora con tus directos sin juego.
3. Conseguí **5 a 10 streamers de prueba** hispanohablantes. Dáselo gratis a cambio de opiniones y de su resumen del directo.
4. Grabá clips de los mejores momentos (acorazados, bombardeos, remontadas): son tu marketing de la fase 4.

**Puerta para avanzar:**

- tus directos con juego rinden más que sin juego;
- al menos 3 streamers de prueba lo siguen usando después de 2 semanas sin que se lo pidas;
- al menos 1 pregunta cuánto cuesta.

**Costo:** $0. El plan gratis de Euler alcanza para estos pocos usuarios.

## Fase 1: cimientos (el núcleo que comparten todos los juegos)

Va antes del producto porque el cambio de librería es obligatorio, y conviene hacerlo una sola vez y bien.

1. **Puerto de plataformas.** Convertir el puente en una interfaz: `connect(usuario)`, `disconnect()`, `onEvent(evento)`, `status()`. Cada fuente es un adaptador:
   - Euler WebSocket (MIT): el de producción;
   - tik.tools: el de respaldo si Euler falla;
   - simulador: ya existe;
   - más adelante YouTube y Twitch, que tienen API oficial. Sumarlas reparte el riesgo de depender de una sola plataforma.
2. **Sacar `tiktok-live-connector` del producto.** Puede quedar solo como herramienta tuya de desarrollo.
3. **Kit compartido.** Separar lo genérico de lo propio de ASEDIO:

```
core/          puerto de plataformas, contrato de eventos, licencias
kit/           bandos y palabras, energía, likes, nombres, feed, banners, ranking, simulador
games/asedio/  lo propio de ASEDIO: unidades, combate, escena 3D
launcher/      ventana, configuración y actualizaciones
```

**Puerta para avanzar:** ASEDIO funciona igual que hoy con el adaptador de Euler y sin `tiktok-live-connector`, y todas las pruebas pasan.

**Costo:** el plan de la WebSocket de Euler. Su SDK la describe como servicio pago; verificá el precio en eulerstream.com.

## Fase 2: ASEDIO como producto

1. **Configuración en pantalla:** usuario de TikTok, clave de licencia, calidad gráfica y marco de cámara, sin tocar `config.json`. El servidor guarda los cambios y se reconecta sin reiniciar.
2. **Empaquetado:**

|                 | Electron (recomendado)                                         | Ejecutable único de Node (SEA) + navegador |
| --------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Ventana         | Propia: LIVE Studio captura esa ventana y no hace falta Chrome | Sigue dependiendo de Chrome                |
| Actualizaciones | Automáticas (`electron-updater`)                               | Manuales                                   |
| Peso            | Unos 100 a 150 MB                                              | Liviano                                    |

3. **Licencias y cobro:** Lemon Squeezy u otra tienda que actúe como _merchant of record_ (cobra y paga los impuestos por vos) y genere claves con una API de activación. El juego valida la clave al iniciar y da unos días de margen sin internet. Verificá que la tienda pague a tu país.
4. **Conexión segura:** la WebSocket de Euler admite autenticación con JWT. Tu servidor (puede ser una función serverless) entrega un token a cada cliente con licencia válida, y así tu clave de Euler nunca sale de tu servidor. De paso es tu control contra la piratería: sin licencia, no hay conexión.
5. **Instalación en 15 minutos:** guía con video, escena lista para LIVE Studio y el marco de cámara que ya existe.
6. **Papeles:** términos de uso, política de privacidad (tratás nombres y avatares de espectadores) y el aviso de "no afiliado".
7. **Soporte:** un Discord o un grupo de WhatsApp.

**Puerta para avanzar:** 3 streamers de la fase 0 lo instalan solos en menos de 15 minutos y pagan.

## Fase 3: catálogo (segundo y tercer juego)

- Cada juego nuevo usa el kit, así que tendría que llevar mucho menos trabajo que ASEDIO.
- No todo tiene que ser un juego donde juega el streamer. El catálogo se ordena en cuatro categorías según quién mueve la acción:

| Categoría | Quién juega                                          | Rol del streamer                             | Ejemplos                                       |
| --------- | ---------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| Acción    | El streamer, con ayuda o estorbo del público         | Juega                                        | ASEDIO LIVE, jefe final                        |
| Público   | El chat: en equipos, por país o respondiendo         | Conduce                                      | Carrera por equipos, batalla de países, trivia |
| Relax     | Nadie gana: la escena cambia y crece con los regalos | Acompaña en cámara (charla, música, estudio) | Acuario, jardín, cielo de linternas            |
| Metas     | Todo el chat junto, hacia una meta con gran final    | Conduce                                      | Cohete del directo, torre del chat             |

- **En todas, el streamer está en el directo.** Puede no jugar, pero no se va: TikTok deja sin monetización el contenido de baja calidad, y las guías para streamers ponen como ejemplos una pantalla estática o una sala vacía. Las escenas relajantes son las más expuestas.
- **Nada de azar a cambio de regalos:** ni ruletas, ni sorteos, ni premios. TikTok trata como apuesta dar algo de valor por la chance de ganar un premio.
- Que el juego 2 y el 3 sean de categorías distintas (Relax y Público), para no competir con vos mismo y para medir cuál vende. El orden lo decide el interés por categoría de la lista de espera.
- Elegí con datos: el resumen del directo te dice qué juego trae más regalos y más participación.

**Puerta para avanzar:** al menos un cliente que pague por más de un juego.

## Fase 4: tienda

- **Página:** un video de 30 segundos de cada juego en un directo real, precios, prueba gratis y descarga.
- **Precio:** la competencia cobra suscripciones de unos $14 a $19 al mes (tiklivegames.io desde $13.99 y TikFinity Pro unos $19, según comparativas). Opciones:
  - suscripción mensual al catálogo, que da ingreso recurrente;
  - pago único por juego, más fácil de vender en Latinoamérica;
  - las dos.
    Considerá precios regionales.
- **Prueba gratis:** el demo con marca de agua, o unos días completos.
- **Canales de venta:**
  - tus propios directos (el juego se vende solo cuando la gente lo ve);
  - clips en TikTok;
  - comunidades de streamers;
  - **agencias de LIVE**: una agencia maneja muchos creadores, así que un solo acuerdo vale por muchas ventas.
- **Más adelante:** la versión de "una URL para LIVE Studio" en la nube, cuando haya volumen para pagar servidores.

## Costos a confirmar

| Concepto                      | Referencia                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| WebSocket de Euler            | Servicio pago; revisá su página de precios. Su SDK en GitHub lista el plan Business a $50/mes |
| Tienda (Lemon Squeezy u otra) | Comisión por venta; revisá su página                                                          |
| Dominio                       | Unos pocos dólares al año                                                                     |
| Página de la tienda           | Gratis en Cloudflare Pages, Netlify o Vercel                                                  |
| Firma de código para Windows  | Opcional; evita la alerta de SmartScreen pero cuesta cientos de dólares al año                |

## Riesgos y defensa

| Riesgo                                                                                    | Defensa                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TikTok cambia algo y se corta la conexión                                                 | Proveedor administrado que mantiene la conexión, un segundo proveedor de respaldo y otras plataformas                                                                                                   |
| TikTok restringe los LIVE desatendidos (AFK) o con pedidos de regalos                     | Cada categoría define el rol del streamer (juega, conduce o acompaña) y nada se vende para dejarlo corriendo solo. Guía de buenas prácticas para clientes. Las escenas relajantes son las más expuestas |
| Una mecánica se interpreta como apuesta                                                   | Sin ruletas, sorteos ni premios: el efecto de un regalo depende de su valor                                                                                                                             |
| Competencia gratis en escenas relajantes (Fishbowl de Meld Studio, Coin Jar de BetterTok) | Calidad 3D, escenas que persisten entre directos y nombres de donantes; venderlas en pack o en la suscripción                                                                                           |
| Piratería                                                                                 | La conexión solo funciona con licencia válida (token desde tu servidor)                                                                                                                                 |
| Competencia con catálogos grandes                                                         | Nicho hispanohablante, calidad 3D y soporte en español                                                                                                                                                  |
| Dependencia de Euler                                                                      | Adaptador de tik.tools listo como respaldo                                                                                                                                                              |

## Decisiones que tenés que tomar

1. **AGPL:** ¿cambiás a la WebSocket de Euler (recomendado), publicás el código o pedís licencia comercial?
2. **Formato:** ¿descargable con Electron primero (recomendado) o servicio en la nube?
3. **Cobro:** ¿suscripción, pago único o los dos?
4. **Mercado:** ¿solo hispanohablante al principio?
5. **Tiempo:** ¿cuántas horas por semana le podés dedicar? Eso define los plazos de las fases 1 a 4.
6. **Marca:** el nombre de la tienda, sin usar "TikTok".
7. **Categorías:** ¿qué va como juego 2, Relax (Acuario) o Público (Carrera por equipos)? Lo decide el interés por categoría de la lista de espera.

## Próximo paso concreto

Fase 0, tarea 1: el **resumen del directo**. Es poco código, no depende de ninguna decisión de arriba y te da los números para todo lo demás.
