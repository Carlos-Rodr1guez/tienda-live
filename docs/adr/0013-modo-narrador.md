# ADR-013: Modo narrador

- **Estado:** Aceptada
- **Fecha:** 2026-11-06
- **Se decide en:** Batalla de países

Aceptada: el dueño cerró la pregunta Q8 el 2026-11-06.

## Contexto

En TikTok LIVE tiene que haber una persona presente: las pautas dejan afuera el contenido sin nadie. El streamer de Batalla de países no juega ni manda tropas. Narra y dirige la presentación, y los espectadores solo ven la pantalla del streamer, así que no pueden mover la cámara.

## Opciones

- **A. El streamer también comanda.** Mezcla narrar con jugar y le da poder sobre el resultado.
- **B. El chat vota la táctica.** Da participación, pero los votos se convierten en un recurso que se compra o se organiza.
- **C. Un comandante automático con reglas fijas y un narrador con controles neutrales.** Las tropas se dirigen solas y la persona se ocupa del show.
- **D. Modo desatendido** que reinicia todo solo. Choca con la regla de presencia.

## Decisión

**C**:

- El narrador tiene 7 comandos neutrales para el resultado (empezar partido, empezar ronda, pausar y similares). `newLive` existe solo en el selector de países.
- La cámara 2D es del narrador primero (mover, acercar, minimapa, "ver todo"). Tras 7 s sin su input entra la cámara automática, que se puede alternar, muestra su estado y queda apagada por defecto con movimiento reducido. No hay director ni cinemáticas.
- Las rondas solo arrancan con el narrador. Nada reinicia solo.
- La guardia de presencia está siempre activa, con marco activo.
- El comandante automático es parte de las reglas: ni el narrador ni el chat tienen control táctico. Su sesgo (`bias`) lo fijan solo la config y los tests.

## Consecuencias

- El resultado de un partido no depende de lo que haga el narrador, lo que protege contra acusaciones de arreglo.
- Si el narrador se va, la guardia pausa la partida en lugar de seguir sola.
- No hay votos del chat: la participación pasa por regalos, unirse y reforzar.
- Las teclas del narrador y la cámara se documentan en el README del juego.
