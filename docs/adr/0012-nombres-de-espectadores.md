# ADR-012: Nombres de espectadores en pantalla

- **Estado:** Propuesta
- **Fecha:** 2026-11-06
- **Se decide en:** Batalla de países

## Contexto

Las unidades llevan el nombre de quien las regaló y la pantalla muestra rangos y un podio. Esos nombres los escribe cualquiera: pueden traer caracteres de control, emoji en cadena, insultos disfrazados con números o datos personales. Y son datos de personas que no firmaron nada.

## Opciones

- **A. Mostrar el nombre tal cual.** Simple, pero un nombre malo queda en la transmisión.
- **B. Sanear y enmascarar.** Se limpia el nombre al entrar, una lista de términos vetados lo reemplaza por "anónimo", y el narrador puede ocultar a alguien al vuelo.
- **C. No mostrar nombres.** Seguro, pero se pierde el atractivo del juego.
- **D. Guardar a los usuarios en disco** para que los rangos duren entre transmisiones. Se descarta por privacidad.

## Decisión propuesta

**B**:

- El nombre se sanea al entrar: sin caracteres de control ni de dirección, con límite de grafemas y sustitutos bien formados. Si queda vacío, es "anónimo".
- La lista de términos vetados compara con pliegue leet ("B4dW0rd" cae). La semilla la escribe el dueño.
- Ocultar: `Alt+clic` sobre un nombre y la tecla `N` para todos. Un oculto muestra "anónimo" y conserva su XP y su rango.
- Los rangos duran un LIVE.
- Los nombres se dibujan solo como texto en el canvas, nunca como HTML.
- Los avatares solo aparecen en momentos grandes.
- Nada se escribe en disco, nunca. La única copia fuera de la página es la que guarda la RAM del servidor local para sobrevivir a una recarga (KIT-28). Guardar en disco más adelante exige otra ADR y un aviso de privacidad.

## Consecuencias

- Un nombre ofensivo que no esté en la lista puede aparecer hasta que el narrador lo oculte.
- Reiniciar el servidor o empezar un LIVE nuevo borra rangos y ocultos.
- Si la lista de nombres vetados está vacía, el sistema funciona pero no enmascara nada hasta que el dueño entregue la semilla.
- No hay nada que borrar a pedido de un usuario, porque no hay nada guardado.
