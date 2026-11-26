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

- **`tiers`**: cuánto poder da un regalo según sus monedas. Por defecto hay nueve tramos, de 1 moneda (soldado) a 3000 monedas o más (el héroe Hombre lobo); la tabla completa está en «Tabla de regalos y tipos de unidad». Un combo ×5 de aviones son 5 aviones, que salen de a uno. Cada tramo tiene `minCoins`, `unit`, `coinsPerUnit` y `maxPerGift`. Las unidades válidas (en `tiers` y en `giftOverrides`) son `soldado`, `francotirador`, `jeep`, `blindado`, `tanque`, `lanzacohetes`, `avion`, `pesado` y `lobo`; un override con otra unidad se ignora y F2 lo avisa.
- **Overrides por regalo** (`giftOverrides`): "Rosa = 2 tanques" se escribe `{ "Rose": { "unit": "tanque", "count": 2 } }`. La clave es el nombre real del regalo en TikTok (`"Rose"`) o su id (`"id:5655"`).
- **Topes**: `maxPerEvent` y `eventCaps` limitan cuántas unidades da UN evento. Lo que se recorta no se pierde: su valor queda en las unidades que sí salen, y el feed lo dice ("máx. por regalo"). En el tráfico automático del simulador F1 (niveles medio y alto) el regalo de avión pesa 0,2, el de 300 monedas 0,6, Galaxy 0,4 (`autoWeight` en `simulator.gifts`): salen menos, pero siguen en su botón manual. El regalo de 3000 monedas (el Hombre lobo) lleva `auto: false`: **el tráfico automático nunca lo manda, en ningún nivel (tampoco en «máximo»)**; el lobo solo sale si alguien lo dona (el botón manual de 3000 monedas o un regalo real de 3000 monedas o más). Cualquier regalo de `simulator.gifts` puede llevar `auto: false`, y el regalo grande del tráfico automático pasa a ser el siguiente más caro (Galaxy). El panel F1 trae un botón por tramo, de 1 a 3000 monedas; los de 10, 300 y 3000 monedas tienen nombres neutros porque no hay un regalo con ese precio confirmado.
- **Tope por lado**: 200 por lado como máximo en el campo (`limits.maxAlivePerSide`, se recorta a [40, 300]). Los presupuestos de rendimiento (8 ms por cuadro) están medidos para 200 por lado.
- **Presencia** (`presence.minutes`): si pasan de 2 a 10 min sin que toques nada, el partido se pausa solo; 5 por defecto y no hay forma de apagarlo.
- **Escalera de rangos** (XP de LIVE): Recluta 0, Soldado 1, Cabo 25, Sargento 75, Teniente 200, Capitán 500, Mayor 1200, Coronel 3000 y General 7500. Los banners salen desde Sargento.
- **Movimiento reducido** (`graphics.reducedMotion`): `"auto"` sigue al sistema, `true` lo fuerza y `false` lo ignora. La tecla `R` lo alterna en pleno LIVE.
- **Cámara**: `view.idleSeconds` (7 s sin tocar la cámara antes de que tome el control la automática), `view.auto.maxK` y `view.auto.minHalf` (qué tan cerca llega la cámara automática; revísalos tras tu primer LIVE).

## Tabla de regalos y tipos de unidad

Cada tramo se decide por las monedas de **un solo regalo** (un combo ×N repite el regalo N veces). Cuanto más caro el tramo, más fuerte la unidad, y el poder es proporcional a lo que se paga.

| Monedas de un regalo | Unidad              | Monedas por unidad | Máx. por regalo |
| -------------------- | ------------------- | ------------------ | --------------- |
| 1 a 4                | soldado             | 0,2 (5 por moneda) | 20              |
| 5 a 9                | francotirador       | 5                  | 1               |
| 10 a 29              | jeep                | 10                 | 2               |
| 30 a 99              | blindado            | 30                 | 3               |
| 100 a 299            | tanque              | 100                | 2               |
| 300 a 499            | lanzacohetes        | 300                | 1               |
| 500 a 999            | avión (bombardeo)   | 500                | 1               |
| 1000 a 2999          | pesado              | 1000               | 2               |
| 3000 monedas o más   | Hombre lobo (héroe) | 3000               | 1               |

Un regalo único nunca se recorta: el valor pagado siempre queda en las unidades que salen. Una rosa (1 moneda) da **5 soldados** (4 monedas, 20) y cada soldado vale 0,2 monedas: la suma de valor de un regalo sigue siendo igual a lo que pagó (monedas, XP, MVP y ranking). La unidad gratis al unirse por comentario sigue siendo 1 soldado. Si pasa de los topes del evento (`maxPerEvent` 100 y `eventCaps`: soldado 100, francotirador 10, jeep 8, blindado 6, tanque 6, lanzacohetes 3, avión 5, pesado 3, lobo 2) el feed avisa "máx. por regalo" y el valor se reparte en las que sí salen. Las unidades sobrantes dentro de un tramo (por ejemplo 299 monedas = 2 tanques) suman XP y valor, pero no más poder.

| Unidad        | Vida   | Daño por segundo | Alcance (px)         | Salpicadura | Notas                                                                 |
| ------------- | ------ | ---------------- | -------------------- | ----------- | --------------------------------------------------------------------- |
| soldado       | 36     | 6                | 63                   | no          |                                                                       |
| francotirador | 108    | 30               | 170                  | no          | un disparo de 75 cada 2,5 s con trazador largo y fino; lento y frágil |
| jeep          | 360    | 60               | 81                   | no          |                                                                       |
| blindado      | 1620   | 144              | 90                   | no          | ametralladora pesada, ruedas                                          |
| tanque        | 3000   | 750              | 99                   | 12,8        |                                                                       |
| lanzacohetes  | 5400   | 1800             | 190                  | 26          | cohetes con estela cada 2,5 s; muy frágil para su costo               |
| pesado        | 36 000 | 3000             | 117                  | 19,2        |                                                                       |
| Hombre lobo   | 57 600 | 16 200           | 24 (cuerpo a cuerpo) | 22          | rápido; el zarpazo golpea en área                                     |

**Vida reducida (v2.9)**: las peleas duraban demasiado, así que la vida de todas las unidades de tierra bajó a × 0,6 de la anterior y la del tanque y el Hombre lobo a × 0,4 (`hpScale` de cada tipo en `game.units`); el daño por segundo no cambió, ni las torretas, la base y el avión. Vida anterior → nueva: soldado 60 → 36, francotirador 180 → 108, jeep 600 → 360, blindado 2700 → 1620, tanque 7500 → 3000, lanzacohetes 9000 → 5400, pesado 60 000 → 36 000, lobo 144 000 → 57 600.

La visión de cada tipo debe ser al menos 1,3 veces su alcance (200 px el soldado, 230 el francotirador, 240 el jeep, el blindado, el tanque y el lobo, 260 el pesado y 280 el lanzacohetes), y la separación entre amigos va de 9 px (soldado) a 38 (pesado), con 12 el francotirador, 24 el blindado, 28 el lobo y 32 el lanzacohetes. Todo se cambia en `game.units` y `game.movement` de `config.json`; la config valida la visión y la regla de poder (vida = 60 × monedas × `bonoHP` × `hpScale`, daño por segundo = 6 × monedas × `bonoDPS`).

### El héroe: Hombre lobo

El lobo cuesta 3000 monedas y es el único tipo con tope por lado: **como máximo un lobo vivo (o en cola) por lado** (`limits.maxWolvesPerTeam`). Si llega otro con uno vivo, se convierte en **pesados del mismo valor** (3000 monedas = 3 pesados) y el sim lo avisa con el evento `loboConverted` (lado, dueño, lobos, pesados y valor); el feed dice "el lobo ya está en campo". Al aparecer sale el cartel grande con el nombre del donante ("X invocó al Hombre lobo"), el mismo de los regalos grandes.

### Balance de los tipos nuevos

Se midió con duelos de **igual valor en monedas**: cada lado reparte su valor en 10 tandas (el mismo ritmo de donación), 240 s, bases inmortales. La tabla es el valor que le queda a cada lado (el nuevo contra el rival):

| Nuevo         | Soldados            | Jeeps                       | Tanques         | Pesados         |
| ------------- | ------------------- | --------------------------- | --------------- | --------------- |
| francotirador | 70 % contra 0 %     | 86 % contra 0 %             | 0 % contra 15 % | 71 % contra 0 % |
| blindado      | 92 % contra 0 %     | 47 % contra 0 %             | 0 % contra 83 % | 0 % contra 86 % |
| lanzacohetes  | 49 % contra 1 %     | 71 % contra 0 %             | 42 % contra 0 % | 0 % contra 25 % |
| Hombre lobo   | no se puede igualar | 0 % contra 26 % (300 jeeps) | 17 % contra 0 % | 39 % contra 0 % |

La regla es una escalera: cada tipo gana a lo de abajo y pierde con lo de arriba, y ninguno gana a todo. El francotirador se rebajó de 120 de vida y 60 de daño (ganaba incluso a tanques) a 180 y 30. Una prueba (`balance-tipos.test.js`) deja fijada esta escalera.

**Con la vida reducida (v2.9) la escalera cambia en cuatro cruces** (la tabla de arriba es la medida con la vida anterior): el francotirador ahora gana a los tanques (76 % contra 0 %), el lanzacohetes gana a los pesados (40 % contra 0 %), el lobo pierde con 30 tanques (0 % contra 40 %) y contra pesados los dos caen. La causa: bajar la vida acorta las peleas pero el tiempo de acercarse no cambia, así que lo que pega desde lejos gana peso; y el zarpazo del lobo ya mataba a un tanque de un golpe, así que su vida baja sin que mate más rápido. No se ajustó ningún valor para forzar la escalera: la prueba fija lo medido.

**Muertes al salir de la puerta.** Los francotiradores y los lanzacohetes plantados cerca de la base enemiga alcanzan la puerta. Se midió qué parte de las unidades que salen muere en los primeros 2 s: 0 % en el simétrico de 200 contra 200 (con o sin los tipos nuevos) y, en el asedio asimétrico (cinco atacantes por defensor), 9,7 % sin los tipos nuevos y 10,8 % con ellos. Se decidió **no agregar protección de salida**: probada la invulnerabilidad de 1,5 s (`movement.spawnShield`) solo baja ese 10,8 % a 10,0 %, porque la zona sigue siendo un tiro al blanco apenas termina, y cambiaría todos los combates. Si en un LIVE el asedio resulta demasiado cruel con los defensores, ese es el ajuste.

## Cómo se despliega el ejército

Cada unidad se mueve y decide **por su cuenta**: no hay grupos ni quien las mande. El público solo invoca tropas; lo demás lo resuelve el juego, sin votos del público y sin botones de voto.

- **Puerta única**: todas las unidades de un lado salen por **una sola puerta** de su base, en orden de llegada y con el tope de 200 por lado. Cada salida usa una de 5 ranuras pegadas a la puerta, más separadas cuanto más grande es la unidad (hasta ±38 px para el pesado), y siempre una libre. Los soldados salen a 8 por segundo; los tanques y los pesados, más despacio, porque cada uno espera a que el anterior se aleje. La puerta nunca se tapa: aunque haya enemigos al alcance, la unidad primero sale de la zona de la puerta (disparando si puede) y recién fuera se frena a disparar, y nadie espera más de 1 segundo en la puerta (pasado ese plazo sale por la ranura con más holgura).
- **Abanico y tres caminos**: las oleadas se reparten en **tres caminos** (arriba, medio y abajo) y cada salida toma el siguiente en rotación, sin azar. Al salir de la puerta la unidad se abre en **abanico** durante sus primeros 300 px hasta su camino y marcha por él con unos ±40 px de dispersión, así que no es una fila india. Cerca de la base enemiga (en el último cuarto del ancho del mapa) los tres caminos se cierran hacia un mismo punto.
- **Visión**: cada unidad ve a su alrededor (de 200 a 280 px según el tipo, mucho más que su alcance de disparo). Si ve a un enemigo, **va hacia él**, se detiene a su alcance, dispara y, cuando cae, retoma su camino.
- **Todas van a la base enemiga, a un solo punto**: no hay unidades de defensa. Cada una avanza hacia la **base enemiga** y pelea con lo que encuentra, en este orden: unidades, torretas y base. La base ya no tiene muralla: es un **hangar** (un rectángulo de 76 × 200 px pegado al borde, con dos portones en su cara) y ese es el objetivo final. Solo se ataca por **el centro de la base**: allí convergen todas, a la altura de la torreta central, y forman un frente de asalto de unos 200 px de ancho, justo el alto del hangar; la cara del hangar es el frente y nadie pasa de ella. Las torretas de arriba y de abajo no son blanco de nadie y esas zonas quedan libres, aunque siguen disparando a quien les entre en rango. El daño de área (bombas, obuses) solo daña el hangar si el impacto cae dentro de su rectángulo (o a menos de su radio): una bomba que pasa por arriba o por abajo no le hace nada. El hangar se ve más dañado según pierde vida (grietas, techo hundido, ruinas) y echa chispas y humo en la cara. El alcance de las unidades es 1,5 veces el de la versión anterior (soldado 63 px, jeep 81, tanque 99 y pesado 117; las torretas, 105) y la visión debe ser al menos 1,3 veces el alcance (la config lo valida). La unidad pesada tiene un tercio menos de vida (60 000). La defensa son las 3 torretas y las tropas recién salidas.
- **Separación sin bloqueo**: las unidades del mismo lado se mantienen a una distancia mínima según su tipo (el soldado la menor, el pesado la mayor), pero la separación nunca las frena: solo las desvía hacia los lados. Por eso no se traban en el camino ni en la puerta.
- **Bombardero en línea recta y de una sola pasada**: el avión cruza el campo a velocidad constante y en **línea recta**, por la franja con más fuerza enemiga, y suelta una **alfombra de bombas**, una cada 40 px (34 por pasada) desde que pasa sobre el frente propio hasta el borde enemigo. Es **una sola pasada**: al salir del campo desaparece, sin dar la vuelta ni repetir. Cada bomba hace 300 de daño en un radio de 38,4 px (v2.9: ×1,6 el anterior de 24) y su explosión se dibuja de ese tamaño: bola de fuego, anillo de onda expansiva que crece hasta el radio y humo y escombros que quedan un poco más. Nunca daña a los tuyos, y los soportes del avión se van vaciando a medida que suelta.
- **Un regalo = una intervención**: cada unidad de un regalo de avión es UN avión con UNA pasada. Hay como máximo **1 avión por lado en el aire**, con al menos 8 s entre dos lanzamientos del mismo lado, y la cola de aviones admite 5 (`limits.maxPlanesPerTeam`, `limits.planeGapSeconds` y `limits.maxQueuedPlanes`). Si llega un avión con la cola llena no se pierde: su valor sale como **tanques del mismo valor** (500 monedas = 5 tanques) y el feed del sim lo avisa con el evento `planeConverted`.
- **HUD «en campo»**: el panel de cada equipo muestra cuántas unidades suyas hay en el campo en ese momento.

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
