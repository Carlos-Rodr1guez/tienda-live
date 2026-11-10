# Batalla de países

Un juego para TikTok LIVE: dos países se enfrentan y los regalos, los likes y las uniones del público invocan sus tropas. Tú (el narrador) conduces la transmisión con el teclado; el público no vota nada. Corre en tu PC con Node y Chrome, y LIVE Studio captura la ventana.

## Instalar y correr

```sh
npm install
npm run start:batalla -- tu_usuario
```

Abre `http://localhost:3100` en Chrome. El puerto es el 3100; cámbialo con `"port"` en `config.json` o con la variable `PORT`: en Git Bash o Linux, `PORT=4000 npm run start:batalla`; en PowerShell, `$env:PORT=4000; npm run start:batalla`. Los comandos `npm run start:batalla` y `npm install` se corren en la raíz del repositorio; `node tools/check-seed.mjs` se corre dentro de la carpeta del juego, la que trae `config.json` y `tools/`. Sin usuario de TikTok el juego arranca igual: sirve para probar con el simulador (abajo).

La página abre el **selector de países**. Elige un país en cada lista con las flechas (`Tab` pasa de una lista a la otra) o con el puntero y pulsa `Enter`: pasas a la sala, donde el público se une comentando `1` o `2` (o el nombre del país). `Enter` otra vez empieza el partido, que es al mejor de tres rondas.

Parámetros de la dirección para desarrollo: `?pair=PE-MX` solo preselecciona el par (tú confirmas con `Enter`), `?f2` abre el panel de rendimiento, `?rapido=4` da 4 pasos del sim por cuadro en vez de 1 (solo acorta la espera, no cambia ninguna regla), `?carga` pone 400 unidades para probar el tope, `?golden` corre el partido de referencia y compara su hash, y `?demo` fuerza el modo demo aunque haya servidor.

## Probar con el simulador (F1)

Pulsa `F1` y se abre el panel **Simulador de público**: envía los mismos eventos que llegarían de la transmisión (uniones, regalos, likes, seguir, compartir, tráfico automático). Pasan por el mismo camino que los de TikTok, así que sirve para ensayar el LIVE completo sin conectarte. Escribir en el campo de nombre del panel no dispara ningún atajo. Con servidor, el panel manda por `POST /api/simulate`; en modo demo (sin servidor) llega al juego sin pasar por la red.

## Configuración (`config.json`, dentro de `"game"`)

Todo tiene un valor por defecto; solo escribes lo que quieres cambiar.

- **`tiers`**: cuánto poder da un regalo según sus monedas. Por defecto: 1 moneda da un soldado, 10 a 99 dan jeeps (una cada 10), 100 a 499 dan un tanque por cada 100, 500 a 999 lanzan un bombardeo y desde 1000 sale una unidad pesada. Cada tramo tiene `minCoins`, `unit`, `coinsPerUnit` y `maxPerGift`. Las unidades válidas (en `tiers` y en `giftOverrides`) son `soldado`, `jeep`, `tanque`, `avion` y `pesado`; un override con otra unidad se ignora y F2 lo avisa.
- **Overrides por regalo** (`giftOverrides`): "Rosa = 2 tanques" se escribe `{ "Rose": { "unit": "tanque", "count": 2 } }`. La clave es el nombre real del regalo en TikTok (`"Rose"`) o su id (`"id:5655"`).
- **Topes**: `maxPerEvent` y `eventCaps` limitan cuántas unidades da UN evento. Lo que se recorta no se pierde: su valor queda en las unidades que sí salen, y el feed lo dice ("máx. por regalo").
- **Tope por lado**: 200 por lado como máximo en el campo (`limits.maxAlivePerSide`, se recorta a [40, 300]). Los presupuestos de rendimiento (8 ms por cuadro) están medidos para 200 por lado.
- **Presencia** (`presence.minutes`): si pasan de 2 a 10 min sin que toques nada, el partido se pausa solo; 5 por defecto y no hay forma de apagarlo.
- **Escalera de rangos** (XP de LIVE): Recluta 0, Soldado 1, Cabo 25, Sargento 75, Teniente 200, Capitán 500, Mayor 1200, Coronel 3000 y General 7500. Los banners salen desde Sargento.
- **Movimiento reducido** (`graphics.reducedMotion`): `"auto"` sigue al sistema, `true` lo fuerza y `false` lo ignora. La tecla `R` lo alterna en pleno LIVE.
- **Cámara**: `view.idleSeconds` (7 s sin tocar la cámara antes de que tome el control la automática), `view.auto.maxK` y `view.auto.minHalf` (qué tan cerca llega la cámara automática; revísalos tras tu primer LIVE).

## Cómo se despliega el ejército

Las unidades no van sueltas: se juntan en el **punto de reunión** de su lado, forman **escuadras** (grupos) y salen en bloque. Cada grupo tiene un rol, **DEFENSA** (escudo) o **ATAQUE** (flecha); el HUD cuenta cuántos grupos de cada rol ya salieron. Quien reparte los roles y manda a los grupos es el **comandante**, una regla del juego, sin votos del público y sin botones de voto. El público solo invoca tropas; el comandante decide a dónde van.

## Atajos del narrador

| Tecla                      | Qué hace                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Enter`                    | Continuar: elegir el par, empezar, siguiente ronda o volver al selector                               |
| `P`                        | Pausa y reanudar                                                                                      |
| `Esc` ×2                   | Terminar el partido (sin podio)                                                                       |
| `G` / `T`                  | Marcador grande / top 3 del partido (6 s o hasta pulsar otra vez)                                     |
| `S` / `Shift+S`            | Seguir al siguiente donante del top / dejar de seguir                                                 |
| `A`                        | Cámara automática sí o no                                                                             |
| `V`                        | Ver todo el mapa                                                                                      |
| `1` / `2`                  | Ver la base izquierda / derecha                                                                       |
| `Espacio`                  | Ir a la pelea más caliente                                                                            |
| Flechas, `+`, `-`          | Mover, acercar y alejar la cámara                                                                     |
| `C`                        | Marco "EN VIVO · NARRADOR" sí o no                                                                    |
| `R`                        | Movimiento reducido sí o no (también apaga la cámara automática; `A` la vuelve a prender)             |
| `H`                        | Ayuda de atajos en pantalla                                                                           |
| `N`                        | Ocultar todos los nombres (`N` otra vez los muestra)                                                  |
| `Alt`+clic en una etiqueta | Ocultar a ese donante                                                                                 |
| `Alt+Z`                    | Deshacer el último ocultamiento (sin mostrar el nombre)                                               |
| `Shift+N` ×2               | **Nuevo en vivo**: reinicia rangos, XP y nombres ocultos. Solo en el selector; dos pulsaciones en 2 s |
| `F1` / `F2` / `F3`         | Simulador / rendimiento / zonas seguras                                                               |
| `M`                        | Sonido sí o no                                                                                        |

`Shift+N` y `N` son teclas distintas: con Bloq Mayús, `N` sigue ocultando nombres. Si el foco está en un campo de texto (el del simulador), ningún atajo actúa.

### Controles de la cámara

Con el puntero: **arrastre** para mover, **rueda** para acercar (con Ctrl más fino), **pellizco** y **doble toque** en pantallas táctiles, y el **minimapa** (visible cuando acercas) para saltar a otro lugar. Con teclado: flechas, `+` y `-`. Con botones: **Ver todo**, **Acercar**, **Alejar** y la **cámara automática**, que sigue la acción sola cuando llevas 7 s sin tocar la cámara. Cualquier gesto tuyo la deja en manual.

## Escena en LIVE Studio

Usa una escena **16:9** (horizontal) con una fuente de **Captura de ventana** apuntando a la ventana de Chrome del juego. El marco "EN VIVO · NARRADOR" marca dónde va la cámara del narrador. Pulsa `F3` para ver las zonas seguras provisorias. Antes del primer LIVE pruébalo con un **segundo teléfono** (el Gate 0 de la entrega): mira la transmisión desde él y comprueba que la interfaz de TikTok no tape el marcador ni el marco. El prototipo se probó a 1920 px de ancho; con ventanas más chicas la cámara automática reposa en otros niveles.

## Buenas prácticas durante el LIVE

- Tiene que haber **una persona presente**: el juego se pausa solo si nadie toca nada y es a propósito.
- La ventana del juego debe **recibir entrada**: haz clic en ella antes de empezar. Los atajos solo funcionan con la ventana enfocada; los atajos globales fuera del navegador llegan con la versión Electron (H2).
- Narra sin nacionalismo: cada país tiene su color y su fortín, ninguno es "el bueno". Celebra a los donantes por el nombre que se ve, no por su bando; evita burlas sobre un país.
- **Sin presión por regalos**: no pidas regalos una y otra vez, no apeles a la culpa o a la lástima y no prometas nada a cambio de un regalo, un like o un seguidor. Las Normas de monetización de LIVE de TikTok pueden dejar sin monetización a un LIVE que lo hace.
- **Narra la partida**: esas normas también apuntan a los LIVE que solo presentan dos posturas opuestas y piden regalos para cada una. Lo que separa a este juego de eso es tu narración: las jugadas, los giros y por qué va ganando quien gana.
- **Nombra a todos**: celebra también a quien se une gratis comentando `1` o `2` y a quien manda likes, además de a quien regala.
- **Seguir y compartir**: el juego da un jeep por seguir y tres soldados por compartir; deja que el juego lo muestre solo, sin venderlo como trato ("sígueme y te doy un jeep").
- Los nombres se limpian y se enmascaran en el registro: nunca se muestra el texto de un comentario, solo el nombre saneado de quien se une o regala.

## Lista previa al LIVE

- [ ] Leíste las páginas oficiales vigentes de TikTok: Normas de la comunidad, Normas de las funciones LIVE, Normas de monetización de LIVE, Términos del servicio y Política de artículos virtuales (busca la versión actual en el Centro de ayuda; las direcciones cambian).
- [ ] Ensayaste con el simulador (`F1`) un partido completo.
- [ ] Revisaste la escena 16:9 y el marco con un segundo teléfono.
- [ ] Revisaste la semilla de 40 a 80 términos vetados y `node tools/check-seed.mjs` la aprueba (entregable del dueño, abajo).
- [ ] `config.json` tiene tu usuario y los regalos que quieres usar.

## Términos vetados para nombres

El dueño de la lista de términos vetados eres tú (el dueño del juego). Vive en `public/js/data/nombres-vetados.js` y trae una semilla de **40 a 80 términos vetados**. Sigue siendo un **entregable del dueño**: la apruebas antes del primer LIVE y la revisas en cada versión con `node tools/check-seed.mjs` (no forma parte de `npm test`).

La lista tiene dos modos:

- `contains`: el término vetado aparece dentro del nombre. Todo se compara plegado (sin tildes ni mayúsculas, con las sustituciones de cifras y símbolos, sin separadores y con las repeticiones reducidas a una letra).
- `token`: el nombre, o una de sus palabras, es exactamente el término. Es el modo para las palabras cortas o ambiguas.

Un término de `contains` que se pliega a menos de 4 caracteres veta nombres inocentes ("kkk" se pliega a "k"): `check-seed` falla con "usa el modo token". Las palabras de `allow` cubren un tramo vetado y tienen que contener el término que cubren: con `contains: ["mala"]` y `allow: ["malabares"]`, "malabares" pasa y "malaonda" se veta. `check-seed` también falla si un término se repite una vez plegado o si algo de la lista no es un texto.

## Qué se guarda y qué no

Recargar la página en pleno LIVE restaura los rangos y los nombres ocultos desde la memoria del servidor local; el juego vuelve al selector, a la sala o a la espera de la ronda. La copia vive solo en la RAM del servidor: si vas a reiniciar el servidor o usas **Nuevo en vivo**, todo arranca limpio. Nada de esto va a disco ni al navegador, y al cerrar o recargar la pestaña el navegador te pide confirmación mientras haya usuarios en memoria.

## Requisitos de la plataforma

Chrome reciente. El recorte de nombres por letras visibles usa `Intl.Segmenter` y es un requisito de la plataforma: sin él el juego no puede mostrar nombres con emoji sin cortarlos a la mitad.

## Por qué no hay banderas

Los países se distinguen por su nombre, su color, la silueta de su fortín y un banderín liso. No se dibujan banderas, escudos ni himnos: las leyes de símbolos nacionales de México y de Perú restringen su uso comercial, y el juego se monetiza con regalos.

## Créditos

Las fuentes y los recursos de terceros están en `CREDITOS.md`.
