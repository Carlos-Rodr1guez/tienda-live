# ADR-008: Categorías del catálogo y orden de los juegos 2 y 3

- **Estado:** Aceptada
- **Fecha:** 2026-11-04
- **Se decide en:** H1 las categorías, H4 el orden

Aceptada al empezar el H1 (2026-11-05). Las cuatro categorías quedan fijas; el orden de los juegos 2 y 3 se decide en el H4.

## Contexto

No todos los streamers quieren jugar mientras transmiten. Algunos prefieren que juegue el chat, y otros quieren una escena tranquila que cambie con los regalos. Un catálogo solo de juegos donde juega el streamer deja afuera a esos perfiles.

Dos reglas de TikTok valen para cualquier categoría:

- **Participar no es lo mismo que estar presente.** El streamer puede no jugar, pero tiene que estar en cámara y hablar. Las pautas de monetización de LIVE dejan afuera el contenido de baja calidad, como imágenes fijas, salas vacías, videos en bucle o directos sin nadie (AFK).
- **Nada de azar a cambio de regalos.** Pagar por la chance de ganar algo de valor puede leerse como juego de azar. El efecto de un regalo depende de su valor, nunca de la suerte: nada de ruletas, sorteos ni premios.

## Opciones

| Opción                                               | A favor                                                                              | En contra                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Solo juegos de acción, como ASEDIO                   | Simple                                                                               | Deja afuera a quien no quiere jugar            |
| Categorías por género (estrategia, carreras, puzzle) | Es como se ordenan las tiendas de videojuegos                                        | No le dice al streamer cuánto tiene que hacer  |
| Categorías según quién mueve la acción               | Responde la primera pregunta del streamer: ¿juego yo, juega mi chat o solo acompaño? | Una categoría nueva para explicar en la página |

## Decisión

Cuatro categorías, según quién mueve la acción:

| Categoría | Quién juega                                  | Qué hace el streamer | Ejemplos                                                      |
| --------- | -------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| Acción    | El streamer                                  | Juega                | ASEDIO, Esquivar, Jefe final                                  |
| Público   | El chat                                      | Conduce              | Carrera por equipos, Batalla de países, Trivia, Tira y afloja |
| Relax     | Nadie gana: la escena cambia con los regalos | Acompaña en cámara   | Acuario, Jardín, Cielo de linternas, Cabaña con lluvia        |
| Metas     | Todo el chat, hacia un gran final            | Conduce              | Cohete del directo, Torre del chat, Mural                     |

Los juegos 2 y 3 son de categorías distintas a la de ASEDIO: Acuario (Relax) y Carrera (Público). Cuál sale primero lo decide el interés por categoría de la lista de espera. Metas llega en el H6.

## Consecuencias

- La lista de espera pregunta cada cuánto hace LIVE la persona (`waitlist.live_frequency`), el tipo de directo y las categorías de interés, de 1 a 4 (`waitlist.stream_type` y `waitlist.interests`).
- `@tienda/contracts` define las categorías una sola vez (`CATEGORIES`) y de ahí las toman la web, la API y el esquema del catálogo.
- El esquema del catálogo rechaza un juego sin `categoria` o sin `rolStreamer`, y la construcción falla nombrando el archivo y el campo.
- Cada producto tiene su categoría (`products.category`), y la ficha de cada juego la declara.
- Los módulos del kit de juego son opcionales: un juego de Relax no carga el módulo de bandos.
- Relax es la categoría con más riesgo frente a las reglas de TikTok, y además compite con opciones gratis como Fishbowl y Coin Jar. Necesita que la presencia del streamer se vea bien y una diferencia clara.
