# ASEDIO LIVE

Juego interactivo para TikTok LIVE. El público elige bando y con sus regalos invoca naves y robots: una rosa trae un caza y una Galaxia trae un acorazado gigante. Tú juegas como el **Comandante** y defiendes tu base en vivo.

## Cómo se juega

- **Comentar `1`** te une a los **Defensores** y **comentar `2`** a los **Invasores**. También sirven palabras como `defender`, `defensores`, `azul`, `atacar`, `invasores` o `rojo`, aunque estén en medio de una frase ("quiero defender"). Unirse es gratis y trae un Dron.
- **Regalos** (por valor en monedas):

  | Monedas del regalo | Unidad | Ejemplo |
  |---|---|---|
  | 1 a 9 | Caza, una nave ligera (1 por moneda) | Rosa |
  | 10 a 99 | Bombardero (1 cada 10 monedas) | Rosquilla |
  | 100 a 999 | Coloso, un robot gigante | Corazón con las manos |
  | 1000 o más | Acorazado, una nave capital que baja del cielo | Galaxia |

- **Regalos grandes:** cuando alguien invoca un Coloso o un Acorazado, la cámara se acerca a la unidad y aparece su nombre en grande. Con el Acorazado la toma es más larga, con franjas de cine.
- **Tu nombre en tus naves:** todas las naves que llegan por un regalo llevan el nombre de quien lo mandó, todo el tiempo. Si dos nombres se enciman, uno se oculta hasta que las naves se separan, salvo el de la nave más fuerte de cada donante, que sube para no taparse. Las naves gratis (unirse, likes, seguir o compartir) muestran el nombre solo unos segundos. `N` oculta todos los nombres.
- **Likes:** cada 300 likes llegan 3 cazas. **Seguir** trae 2 y **compartir** trae 3.
- **Energía por comentarios:** una vez que eliges bando, cada comentario carga la barra ⚡ de tu equipo (cuenta como mucho uno cada 3 segundos por persona). Con 15 comentarios cae un **bombardeo de equipo**: 3 impactos azules o rojos sobre los grupos enemigos más densos. Si los Invasores no tienen a quién apuntar, el bombardeo cae sobre la base. El banner muestra quién completó la barra.
- **Rondas de 4 minutos.** Si la base aguanta, ganan los Defensores; si cae, ganan los Invasores. Siempre hay oleadas automáticas de enemigos, así que hay acción aunque nadie regale.
- **Tú (el streamer):** `W A S D` mueve al Comandante, **clic** o **Espacio** lanza un bombardeo donde apuntas y **Shift** da un impulso.

## Requisitos

- Node.js 20 o superior y Google Chrome.
- Una cuenta de TikTok con LIVE habilitado (1000 seguidores; mayor de 18 años para recibir regalos).

## Instalación y uso

Todos los comandos se corren desde la raíz del repositorio, no desde esta carpeta.

```bash
npm install
```

En `games/asedio/config.json`, cambia `"tiktokUsername"` por tu usuario, sin `@`. Luego:

```bash
npm start
```

Abre **http://localhost:3000** en Chrome y pulsa **JUGAR**. Cuando inicies tu LIVE, el juego se conecta solo; el indicador de arriba a la izquierda pasa a `EN VIVO`.

## Transmitir

- **TikTok LIVE Studio:** usa el modo vertical y agrega una fuente de **Captura de ventana** con la ventana de Chrome del juego. Ajusta el tamaño de la ventana para que el juego llene la captura.
- **OBS** (si tienes clave de transmisión): usa un lienzo de 1080×1920 y una fuente de Captura de ventana.
- Atajos: `F3` muestra las zonas que tapa la interfaz de TikTok, `C` muestra u oculta el marco de la cámara, `H` oculta el HUD, `N` oculta los nombres y `M` silencia el sonido.
- **Tu cámara:** el juego dibuja un marco «EN VIVO · COMANDANTE» abajo a la derecha, en una zona que TikTok no tapa. Pulsa `F3` y el marco muestra la posición y el tamaño exactos para el lienzo de 1080×1920 de LIVE Studio. Pon ahí tu fuente de cámara, recórtala a formato vertical 3:4 y, si puedes, activa la eliminación de fondo. Se ajusta en `config.json` con `"camera": { "enabled": true, "size": 1 }`: `size` lo agranda o lo achica.
- **Juega y habla durante el directo.** TikTok restringe los LIVE automáticos donde el creador no participa (AFK). Por eso el juego está pensado para que tú controles al Comandante.

## Probar sin TikTok

- `F1` abre el **simulador de público**, con regalos, comentarios, likes y tráfico automático.
- **http://localhost:3000/?demo** abre el juego sin conectarse a nada.
- `npm test` corre las pruebas de las reglas del juego y del servidor.
- `npm run build:demo` genera `games/asedio/dist/asedio-demo.html`, una demo de un solo archivo.

## Modelos 3D

El juego ya trae modelos 3D gratuitos con licencia CC0 (naves de Quaternius, robot de Quaternius y base de KayKit) en la carpeta `models/`. Ver [CREDITOS.md](CREDITOS.md).

Para cambiar uno por otro modelo (por ejemplo, uno que consigas con Blender MCP, Hugging Face o Sketchfab):

1. Exporta el modelo como **.glb** (en Blender: *Archivo → Exportar → glTF 2.0*, formato binario).
2. Ponlo en `models/` con el nombre de la unidad: `dron`, `caza`, `bombardero`, `coloso`, `acorazado` o `comandante`. La base y el decorado son `base.glb` y `escenario.glb`.
3. Para que cada bando tenga su versión, nombra la roja con `_inv` (por ejemplo `caza_inv.glb`). Sin ella, el juego tiñe el modelo con el color del equipo.
4. Recarga la página.

El tamaño y la posición se ajustan solos. Si un modelo queda mirando hacia atrás, cambia `rotateY` de esa unidad en `config.json`, dentro de `"game"` → `"models"` (0, 90, 180 o 270). `scale` lo agranda y `tint` mezcla el color del equipo (de 0 a 1). Los materiales cuyo nombre empieza con `Exhaust` brillan como fuego de motor. Si el .glb trae animaciones de caminar, quieto y atacar, se reproducen solas.

- Si borras un .glb, esa unidad vuelve a su modelo hecho por código.
- Usa modelos livianos: puede haber más de 200 naves a la vez.
- Revisa la licencia: CC0, o CC-BY dando crédito al autor. Nunca uses modelos NC (no comercial), porque el directo se monetiza.

## Personalizar

Todo está en `config.json`, dentro de `"game"`:

- `round.seconds` y `round.baseHp`: duración de la ronda y vida de la base.
- `teams.defaultTeam`: a qué bando va quien regala sin haber comentado (`balance`, `defensores` o `invasores`).
- `tiers`: cuántas monedas hacen falta para cada unidad.
- `giftOverrides`: asigna un regalo concreto a una unidad. Usa el nombre tal como llega de TikTok, por ejemplo `{ "Rose": { "unit": "bombardero", "count": 1 } }`.
- `likes`, `follow`, `share` y `joinSpawn`: recompensas gratuitas.
- `energy`: la energía por comentarios. `perCharge` es cuántos comentarios llenan la barra (bájalo si tu chat es tranquilo), `userCooldown` son los segundos entre comentarios que cuentan de una misma persona y `enabled: false` la apaga.
- `cpu.enabled`: activa o desactiva las oleadas automáticas.
- `limits.maxUnitsPerTeam`: bájalo si tu PC se pone lenta.
- `graphics.bloom`: el brillo de motores, láseres y explosiones. Ponlo en `false` si la PC no da abasto (o abre el juego con `?bloom=0`).
- `graphics.pixelRatio`: la resolución interna del 3D. `0` es automático; `1.5` o `2` suaviza más los bordes en una pantalla 1080p, pero exige más a la placa de video (pruébalo antes con `?pr=2`).
- `graphics.shake`: el temblor de cámara en las explosiones (`1` normal, `0` sin temblor). El temblor mueve toda la imagen y en el celular de los espectadores se ve pixelado; bájalo a `0.3` o `0` si el directo se ve con cuadraditos.
- `graphics.cinematics`: la cámara que se acerca a los regalos grandes. `false` la apaga (o `?cine=0`).
- `audio.volume`, `audio.music` y `audio.musicVolume`: volumen general y música de fondo. Si pones tu propia música en el directo, usa `"music": false`.

## Problemas comunes

- **`ESPERANDO LIVE`**: tu directo aún no empezó. El juego reintenta solo.
- **Error de límite de firmas:** espera unos minutos o pon una `signApiKey` de eulerstream.com en `config.json`.
- **Puerto ocupado:** cambia `"port"` en `config.json`.
- La conexión usa `tiktok-live-connector`, una librería no oficial, porque TikTok no ofrece una API pública para LIVE. Si TikTok cambia algo y deja de conectar, actualízala desde la raíz con `npm update tiktok-live-connector -w asedio-live`.

## Estructura

```
server/            servidor local y conexión con TikTok LIVE
public/js/sim/     reglas del juego (unidades, combate, rondas, regalos)
public/js/render/  escena 3D con Three.js, efectos y nombres
public/js/ui/      HUD y simulador de público
models/            modelos .glb (naves, robot, base y decorado)
public/sounds/     efectos y música (.mp3)
config.json        tu usuario y los ajustes del juego
test/              pruebas automáticas
```

## Sonido

Los efectos y la música están en `public/sounds/` (CC0). Puedes reemplazar cualquiera por tu propio `.mp3` con el mismo nombre. Si falta un archivo, el juego usa un efecto sintetizado en su lugar. `M` silencia todo.

## Créditos

Modelos 3D de Quaternius y Kay Lousberg, sonidos de Kenney y música de yd, todo con licencia CC0. Detalle en [CREDITOS.md](CREDITOS.md).
