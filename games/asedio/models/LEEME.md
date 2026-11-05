# Modelos

Estos .glb son los que usa el juego. Puedes reemplazar cualquiera por el tuyo con el mismo nombre:

| Archivo | Qué es |
|---|---|
| `dron.glb` / `dron_inv.glb` | Dron (por unirse al chat) |
| `caza.glb` / `caza_inv.glb` | Caza (rosa y regalos de 1 a 9 monedas) |
| `bombardero.glb` / `bombardero_inv.glb` | Bombardero (10 a 99 monedas) |
| `coloso.glb` | Robot gigante (100 a 999 monedas) |
| `acorazado.glb` / `acorazado_inv.glb` | Nave capital (1000 monedas o más) |
| `comandante.glb` | Tu nave |
| `base.glb` | La base que defiendes |
| `escenario.glb` | Colonia sobre la plataforma lateral, junto a la base |

- Sin sufijo es la versión azul (Defensores); `_inv` es la roja (Invasores). Si falta la `_inv`, el juego tiñe la azul.
- El juego escala y centra cada modelo. Orientación, escala y tinte se ajustan en `config.json`, en `"game"` → `"models"`.
- Si borras un archivo, esa unidad usa su modelo hecho por código.

Origen y licencias: ver `CREDITOS.md` en la carpeta principal.
