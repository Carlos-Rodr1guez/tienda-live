---
# Prototipo: es el único juego con ficha propia (/juegos/asedio). Mecánicas, regalos y requisitos salen del README y de
# la configuración por defecto de games/asedio (defaults.js); no se inventa nada. Aún no hay un clip: sin `video`, la
# portada muestra el póster con "Video próximamente".
nombre: ASEDIO LIVE
resumen: Tu público elige bando y con sus regalos invoca naves y robots. Tú juegas como el Comandante y defiendes tu base en vivo.
categoria: accion
rolStreamer: juega
idealPara:
  - gaming
estado: prototipo
poster: juegos/asedio/poster.png
mecanicas:
  - Tu público comenta 1 para unirse a los Defensores o 2 para unirse a los Invasores. Unirse es gratis.
  - Los regalos traen naves según su valor en monedas. Cada nave lleva el nombre de quien la mandó.
  - Cada 300 likes llegan 3 cazas. Seguir trae 2 y compartir trae 3.
  - Con 15 comentarios de un equipo cae un bombardeo sobre los enemigos más concentrados.
  - Cada ronda dura 4 minutos. Si la base aguanta ganan los Defensores; si cae, ganan los Invasores.
  - Hay oleadas automáticas de enemigos, así que hay acción aunque nadie regale.
  - Tú juegas como el Comandante, en cámara. Te mueves con W A S D y lanzas bombardeos con clic o Espacio.
regalos:
  - monedas: 1-9
    efecto: Caza, una nave ligera por moneda.
  - monedas: 10-99
    efecto: Bombardero, uno cada 10 monedas.
  - monedas: 100-999
    efecto: Coloso, un robot gigante.
  - monedas: 1000+
    efecto: Acorazado, una nave capital que baja del cielo.
requisitos:
  - Una computadora con Node.js 20 o superior y Google Chrome.
  - Una cuenta de TikTok con LIVE habilitado. TikTok pide 1000 seguidores y ser mayor de 18 años para recibir regalos.
orden: 1
---

ASEDIO LIVE es un juego de dos bandos: tu público elige Defensores o Invasores y tú defiendes la base como Comandante.

El juego está pensado para que juegues y hables durante el directo. No está hecho para correr solo.
