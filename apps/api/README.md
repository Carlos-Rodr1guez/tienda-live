# @tienda/api

Un solo Worker de Cloudflare que hace dos cosas: sirve la web estática (`apps/web/dist`) y corre código únicamente para `/v1/*` (lista de espera con doble confirmación y contadores del embudo). Es JavaScript con JSDoc y `// @ts-check`, con arquitectura hexagonal: `createApp(ports, { routes, jobs })` recibe la base, Turnstile, el correo, el reloj, el azar y el registro como puertos, y `src/index.js` solo los conecta con el Worker real.

## Rutas

Todas son `POST` con `Content-Type: application/json` (se admite `; charset=utf-8`). Cualquier otro método da `405` con `Allow: POST` y cuerpo vacío. Una ruta desconocida da `404`, salvo con la configuración inválida: en producción, con `SITE_URL` mal puesto, **todo** pedido a `/v1` (ruta desconocida o método equivocado incluidos) da `503` antes de mirar nada más. Las rutas de `/v1` no tienen CORS: la web y la API comparten origen.

| Ruta                        | Cuerpo máximo | Éxito                    |
| --------------------------- | ------------- | ------------------------ |
| `POST /v1/waitlist`         | 4096 bytes    | `202` (siempre el mismo) |
| `POST /v1/waitlist/confirm` | 512 bytes     | `200`                    |
| `POST /v1/events`           | 256 bytes     | `204` sin cuerpo         |

Los topes cuentan los bytes realmente leídos, no solo `Content-Length`.

### `POST /v1/waitlist`

```json
{
  "email": "ana@example.com",
  "live_frequency": "semanal",
  "stream_type": "gaming",
  "interests": ["accion", "metas"],
  "tiktok_user": "ana.live",
  "followers_range": "100-999",
  "country": "AR",
  "consent": true,
  "consent_version": "v1",
  "turnstile_token": "<token del widget>"
}
```

Los campos opcionales son `tiktok_user`, `followers_range` y `country`. Los valores permitidos, los límites y los mensajes salen de `@tienda/contracts` (un solo origen para la web, la API y la base). Una clave de más es un error.

Orden de las comprobaciones: configuración (paso 0), ruta, método, origen, tipo de contenido, tamaño, JSON, campos (todos los errores a la vez), Turnstile, disponibilidad del correo y, por último, la escritura. Una fila solo se escribe si pasó todo lo anterior.

La respuesta de éxito es **idéntica byte a byte** (estado, cabeceras y cuerpo) para un correo nuevo, uno pendiente, uno cuyo reenvío se frenó y uno ya confirmado, y el correo sale después de responder (`ctx.waitUntil`). Eso tapa la diferencia obvia, pero no la oculta del todo: cada camino hace una cantidad distinta de trabajo en D1 (una lectura y una escritura, solo la lectura, o un insert), así que una sonda estadística paciente podría distinguirlos midiendo tiempos. Cada sondeo necesita un token de Turnstile nuevo, lo que lo encarece; es un riesgo aceptado en el H1, no una garantía.

Si la persona vuelve a anotarse mientras está pendiente y dentro de sus 7 días, **no se cambia nada de lo que guardamos** (perfil, consentimiento y `created_at` quedan como estaban). Solo, si el límite de reenvíos lo permite, se rota el token y se manda un enlace nuevo, que vence a las 48 horas o al cumplirse los 7 días desde el alta, lo que ocurra antes (el correo dice lo que le queda de verdad: "48 horas", "N horas", "1 hora" o "menos de una hora"). Si el límite lo frena, no se escribe nada. Un pendiente que ya pasó sus 7 días y que la purga todavía no borró se trata como un alta nueva. Dos pedidos simultáneos del mismo pendiente producen un solo correo (la escritura compara lo que leyó).

### `POST /v1/waitlist/confirm`

```json
{ "token": "<43 caracteres base64url>" }
```

Confirma el correo con una sola sentencia SQL: comprueba, consume y sella a la vez. Un token mal formado, desconocido, usado o vencido da el mismo `400 enlace_invalido`. Es `POST` a propósito: un `GET` (un antivirus que abre los enlaces del correo, por ejemplo) no confirma nada.

El enlace del correo es `<SITE_URL>/confirmar#t=<token>`. El token va en el fragmento, que el navegador no manda al servidor, ni a los registros, ni en el `Referer`.

### `POST /v1/events`

```json
{ "name": "form_open" }
```

Los nombres válidos son `video_play` y `form_open`. Suma 1 al contador del día UTC y del evento; el contador se satura en 100000 por día y evento y la API sigue respondiendo `204`.

### Errores

Cuerpo: `{ "ok": false, "error": "<código>", "campos": { ... }, "mensaje": "<texto en español>" }`. `campos` solo aparece en `campos_invalidos`.

| Estado | `error`                | Cuándo                                                                                    |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `campos_invalidos`     | Algún campo no cumple; `campos` trae `{ campo: código }` con todos a la vez               |
| 400    | `solicitud_invalida`   | JSON roto, no es un objeto, clave de más o versión de consentimiento que no es la vigente |
| 400    | `enlace_invalido`      | Token de confirmación mal formado, desconocido, usado o vencido                           |
| 413    | `demasiado_grande`     | El cuerpo pasa el tope de la ruta                                                         |
| 415    | `solicitud_invalida`   | El tipo de contenido no es `application/json`                                             |
| 403    | `verificacion_fallida` | Falta el token de Turnstile, o Cloudflare lo rechazó                                      |
| 403    | `origen_no_permitido`  | `Origin` ausente o fuera de la lista, o `Sec-Fetch-Site` distinto de `same-origin`        |
| 503    | `no_disponible`        | Turnstile no responde o su secreto no sirve, no hay proveedor de correo, o `SITE_URL` mal |
| 404    | `no_encontrado`        | Ruta desconocida                                                                          |
| 500    | `error_interno`        | Cualquier fallo inesperado; el registro guarda solo la ruta y el nombre del error         |

Códigos por campo en `campos`: `requerido`, `formato`, `largo`, `opcion`, `cantidad`, `repetido`, `consentimiento`.

### Cabeceras de toda respuesta de `/v1`

`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-origin` y `Strict-Transport-Security: max-age=31536000` (el mismo valor que las páginas: `_headers` no se aplica a lo que genera el Worker), más `Content-Type: application/json; charset=utf-8` cuando hay cuerpo. Nunca llevan cookies. Las cabeceras de las páginas estáticas (`_headers`) vienen de `@tienda/contracts`, no de este paquete.

## Modelo de datos (D1)

Las migraciones están en `migrations/` y solo avanzan: para deshacer algo se escribe una migración nueva.

**`waitlist`**: una fila por persona. Guarda correo normalizado (único), `live_frequency`, `stream_type`, `interests` (JSON, ordenados como `CATEGORIES`), `tiktok_user`, `followers_range`, `country`, `consent_version`, `consent_at`, `created_at`, `updated_at`, `confirmed_at`, el **hash** SHA-256 del token y su vencimiento, y `recent_sends` (hasta 5 instantes de envío, para el límite de reenvíos). Todos los límites están repetidos en `CHECK`, y una prueba compara las listas de enums con las de contracts.

No existen columnas de IP, agente de usuario ni huella. El token en claro solo existe en el correo y en el navegador de la persona: la base guarda únicamente su SHA-256.

**`funnel_daily`**: `(day, event, count)`. Sin nada de quien hizo el pedido.

### Retención

- Pendientes sin confirmar: se borran a los 7 días del alta (purga diaria). Volver a anotarse **no** reinicia esa ventana ni cambia lo guardado; un pendiente que ya la pasó y sigue ahí cuenta como alta nueva.
- Confirmados: se quedan hasta que la persona pida su borrado (ver el runbook).
- `funnel_daily`: no tiene datos personales y se conserva.

### Límite de reenvíos

Para un correo pendiente, un token y un correo nuevos solo salen si el último envío fue hace 10 minutos o más y hubo menos de 5 envíos en las últimas 24 horas. En cualquier otro caso la respuesta es el mismo `202`, sin correo y sin token nuevo. Cada token nuevo invalida al anterior. El token vale 48 horas (nunca más allá de los 7 días del alta) y sirve una sola vez. El reenvío es un compare-and-swap sobre `recent_sends`: solo el pedido que cambia la fila manda el correo.

## Entorno

| Variable               | Dónde                               | Para qué                                                                                                                                                                                      |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`          | `vars` / `.dev.vars`                | Solo `development` activa el correo de consola y los orígenes locales. Cualquier otro valor es producción.                                                                                    |
| `SITE_URL`             | `vars` / `.dev.vars`                | Origen del sitio. Es el único origen permitido en producción y la base de los enlaces del correo. En producción debe ser https y no local.                                                    |
| `TURNSTILE_SECRET_KEY` | `.dev.vars` / `wrangler secret put` | Secreto de Turnstile. Vacío: la inscripción responde 503. En local sirve la clave de prueba de `.dev.vars.example`; en producción las tres claves de prueba de Cloudflare cuentan como vacío. |

En local, `npm run dev` crea `apps/api/.dev.vars` desde `.dev.vars.example` si falta (está ignorado por git). El estado local de D1 vive en `apps/api/.wrangler/state`; para empezar de cero se borra esa carpeta y se corre `npm run db:migrate`.

**En producción, un `SITE_URL` ausente, vacío, que no sea https o que apunte a localhost, 127.0.0.1 o [::1] detiene `/v1` a propósito:** todas las rutas responden `503 no_disponible` (el mismo cuerpo de siempre) y no se escribe ni se cuenta nada. Antes caía en `http://localhost:8790`, y eso apagaba la comprobación de hostname de Turnstile y ponía enlaces locales en los correos. Cómo darse cuenta (`node scripts/run.mjs wrangler tail`, o los registros de la plataforma si se activan): el Worker escribe una línea `{"nivel":"error","evento":"config.invalida","codigo":"site_url"}` por pedido (nunca el valor). La purga diaria **sigue corriendo**, porque no usa `SITE_URL`. En desarrollo no cambia nada: siguen los valores por defecto y los orígenes locales.

Si Cloudflare responde `success:false` con `missing-input-secret`, `invalid-input-secret`, `bad-request` o `internal-error`, el problema es nuestro: la persona recibe `503 no_disponible` (no un 403) y se registra una línea `{"nivel":"error","evento":"turnstile.config","codigo":"<nombres de los códigos>"}`, sin token, IP ni correo. Los demás códigos (`missing-input-response`, `invalid-input-response`, `timeout-or-duplicate` y los desconocidos) siguen dando `403 verificacion_fallida`.

Fuera de desarrollo todavía no hay proveedor de correo (queda fuera del H1): la inscripción responde `503 no_disponible` y no escribe nada. En desarrollo el enlace de confirmación se imprime en la consola de `wrangler dev`.

El Cron Trigger `17 3 * * *` (UTC) corre la purga de pendientes. La observabilidad de Workers está apagada a propósito: en el H1 no se guardan metadatos de los pedidos. El dueño puede activarla después de la revisión legal.

## Comandos

Desde la raíz del repositorio:

| Comando                       | Qué hace                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev:api`             | Worker local en el puerto 8790 (inspector 9290), con la base local            |
| `npm run db:migrate`          | Aplica las migraciones a la base **local**                                    |
| `npm run embudo`              | Informe del embudo H1 sobre la base local (sin correos)                       |
| `npm run test -w @tienda/api` | Pruebas de la API (node:test, con SQLite en memoria y las migraciones reales) |

Todo pasa por `scripts/run.mjs`, que redirige la configuración y los registros de Wrangler a la carpeta de estado en D: (ver el README de la raíz).

## Runbooks

### Borrar los datos de una persona (WL-14)

La persona escribe al correo de contacto del sitio (hoy figura como "pendiente" en `@tienda/contracts/brand`: hay que fijarlo antes de publicar). Para atender el pedido:

1. Confirma que el pedido llega desde ese mismo correo.
2. Corre, desde `apps/api`:

   ```sh
   npm run borrar -- ana@example.com            # base local (pruebas)
   npm run borrar -- ana@example.com --remote   # base real (solo el dueño, con credenciales de Cloudflare)
   ```

   El script normaliza el correo igual que al guardarlo, escapa las comillas, borra la fila (confirmada o no) e imprime solo cuántas filas borró. `1` significa que existía; `0`, que no había nada guardado.

3. Responde a la persona. No hay copias: la tabla es la única que guarda sus datos, y `funnel_daily` no tiene datos personales.

### Purga manual de pendientes

La purga corre sola cada día. Si hace falta adelantarla, con la misma sentencia que usa el Worker (cambia la fecha por la de hace 7 días):

```sh
node ../../scripts/run.mjs wrangler d1 execute DB --local --command "DELETE FROM waitlist WHERE confirmed_at IS NULL AND created_at < '2026-01-01T00:00:00.000Z'"
```

Con `--remote` en lugar de `--local` apunta a la base real (solo el dueño).

### Lista de despliegue (solo el dueño)

El despliegue no está automatizado y ningún agente lo corre. Todos los comandos de Wrangler pasan por el lanzador (`node scripts/run.mjs wrangler ...`, desde la raíz del repositorio): así el estado y el inicio de sesión quedan en `.dev-state` (en D:, nunca en C:), y `npm run embudo -- --remote` y `npm run borrar -- ... --remote` encuentran la misma sesión con la que desplegaste. Orden sugerido:

1. Iniciar sesión: `node scripts/run.mjs wrangler login`.
2. Crear la base: `node scripts/run.mjs wrangler d1 create tienda-live` y poner el `database_id` real en `wrangler.jsonc` (el que está es un marcador; el id real no debe versionarse).
3. Aplicar las migraciones a la base real: `node scripts/run.mjs wrangler d1 migrations apply DB --remote`.
4. Cargar el secreto: `node scripts/run.mjs wrangler secret put TURNSTILE_SECRET_KEY` con la clave **real** de Turnstile (las de prueba de Cloudflare se tratan como ausentes). La clave pública `PUBLIC_TURNSTILE_SITE_KEY` va al construir la web.
5. Fijar `SITE_URL` al origen público con `https` (por ejemplo con `--var SITE_URL:https://<dominio>` en el despliegue) y asociar el dominio al Worker. **La web debe servirse solo en el origen exacto de `SITE_URL`:** `/v1` acepta únicamente ese `Origin`, así que quien se anote desde otro host (el `www` si `SITE_URL` es el apex, o al revés) recibe `403 origen_no_permitido` y "Recarga la página" no lo arregla. Redirige el otro host al origen de `SITE_URL`. El `SITE_URL` vacío de `wrangler.jsonc` es a propósito: mientras no se fije, `/v1` responde 503. Un valor puesto solo en el panel lo pisa el siguiente `deploy`.
6. Construir la web y desplegar: `npm run build:web` y luego `node scripts/run.mjs wrangler deploy -c apps/api/wrangler.jsonc --var SITE_URL:https://<dominio>` (sin el `--var`, `SITE_URL` queda vacío y todo `/v1` responde `503`). La construcción de la web necesita `SITE_URL` y `PUBLIC_TURNSTILE_SITE_KEY` puestos de forma explícita; si falta alguno, se detiene.
7. Regla de límite de velocidad por IP (WAF o rate limiting de Cloudflare) sobre **todo `/v1/*`**, no solo `/v1/waitlist`: `/v1/events` y `/v1/waitlist/confirm` también escriben en la base. La API no ve ni guarda IPs, así que ese límite solo puede ponerse en Cloudflare, antes del Worker. Los contadores del embudo son de mejor esfuerzo: quien abusa a propósito (por ejemplo, desde varias IPs) todavía puede sesgarlos.
8. Analítica opcional: si se usa el beacon de Cloudflare Web Analytics, definir `PUBLIC_CF_BEACON_TOKEN` al construir la web y **desactivar la inyección automática** del beacon en el panel (el sitio lo incluye por su cuenta, y nunca en `/confirmar`).
9. Verificar las cabeceras con `curl -I https://<dominio>/` y `curl -I https://<dominio>/confirmar`: deben coincidir con `dist/_headers` (CSP, `Referrer-Policy: no-referrer` y `X-Robots-Tag: noindex` en `/confirmar`). Si `_headers` no se aplicara, el plan B del diseño es decorar las respuestas desde el Worker.
10. **Requisito antes de conectar un proveedor de correo real: un tope global de envíos por día** (una cuota diaria en el proveedor o en el Worker). **No está implementado en el H1.** El límite actual es por correo (10 minutos entre envíos y 5 en 24 horas), así que quien use muchas direcciones distintas podría agotar la cuota o la reputación del dominio de envío.
11. Antes de abrir la lista: proveedor de correo real (ver `src/adapters/mailer.js`), textos legales finales y correo de contacto.

## Estructura

```
src/index.js            conecta puertos reales y rutas (sin lógica)
src/app.js              createApp(ports, { routes, jobs })
src/http/               pipeline, router, lectura acotada del cuerpo, respuestas
src/waitlist/           inscripción, confirmación, tokens, límite de reenvíos, repositorio, purga, correo
src/events/             contadores del embudo
src/adapters/           reloj, azar, registro, Turnstile, correo
src/report/embudo.js    informe del embudo (SQL y formato)
scripts/                embudo, borrar, check-bundle (se corren con Node)
migrations/             esquema D1, solo hacia adelante
test/                   pruebas con node:test y un doble de D1 sobre node:sqlite
```
