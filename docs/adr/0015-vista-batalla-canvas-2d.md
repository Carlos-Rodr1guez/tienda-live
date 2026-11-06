# ADR-015: Vista de Batalla: 16:9, pixel art oblicua y Canvas 2D

- **Estado:** Propuesta
- **Fecha:** 2026-11-06
- **Se decide en:** Gate 0 de Batalla de países

Pasa a Aceptada cuando el Gate 0 (la prueba de la vista en el teléfono) dé PASA.

## Contexto

El dueño aprobó el prototipo v2 (pixel art oblicuo, mapa grande, cámara propia) y la enmienda v4 (mundo de 1440×810 y muchas tropas). El prototipo v3 corrió 400 unidades con 1,5 a 4 ms de render.

## Opciones

- **A. Three.js con cámara inclinada.** Reusa lo de ASEDIO, pero el 3D inclinado se lee peor en el teléfono y pesa más.
- **B. Canvas 2D con sprites horneados.** Control total del pixel art, sin dependencias.
- **C. Una biblioteca WebGL 2D.** Rinde bien con muchas unidades, pero suma una dependencia y su licencia.

## Decisión propuesta

**B**, más precisamente Canvas 2D con sprites dibujados en código (Q5 (a)):

- Un búfer LOW del mundo reservado una sola vez.
- Escala entera en reposo; fraccional en k = 1 y en el reposo de la cámara automática bajo 1,9. En 4K se acepta el vecino fraccional.
- Modo por la escala mostrada: suave bajo 1 y "sharp bilinear" entre 1 y 1,9.
- Pasada en píxeles de dispositivo, sprites horneados, LOD con histéresis, pools y limitador de destellos.
- Fuentes OFL vendorizadas.

Batalla no depende de `three`.

## Consecuencias

- El render 3D de ASEDIO no se reusa y ASEDIO conserva `three`.
- El Gate 0 revisa la vista en el teléfono antes del slice de render. Si falla, se cambia el layout (letterbox con el HUD en las bandas) y esta ADR sigue Propuesta.
- La grilla, los pools y el LOD estable sostienen el tope de 200 unidades por lado.
- El rendimiento se mide con F2 en la PC del dueño.
