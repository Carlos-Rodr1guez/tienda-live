// Cliente de la copia de sesión del LIVE (KIT-28, diseño D27). Solo usa `fetch`: la lógica pura de la copia está en el
// registro (`exportLive` / `importLive`) y la forma de un usuario en `sim/session-shape.js`. Todo llega inyectado para
// poder probarlo sin red ni reloj: `fetch`, la función que arma la copia (`snapshot`), `addEventListener` (para
// `pagehide`) y los temporizadores de la carga.
//
// Reglas (todas con prueba):
//   - Al cargar hace un GET antes del primer evento, con tope de tiempo (AbortController, 3 s). Si da 404, 403 o 405
//     (sesión apagada o prohibida) deja de enviar para siempre.
//   - NINGÚN PUT hasta que un GET responda 200 o 204: si el GET falla (red, tope de tiempo, 5xx u otro estado) el juego
//     arranca vacío pero la copia buena del servidor no se pisa. El GET se reintenta con espera creciente (1, 2, 4 y 8 s,
//     después cada 10 s) manejada por `tick` con el reloj de vista. Un reintento con 204 habilita los PUT; uno con 200
//     significa que la copia existe pero la página ya arrancó de cero: no se aplica a mitad de juego y los PUT quedan
//     bloqueados hasta un "nuevo en vivo" (`clear()`).
//   - La copia se marca sucia y se envía como mucho una vez por segundo, con el reloj de vista que le pasa quien llama
//     (`tick(segundos)`). Un PUT que falla deja la copia sucia y se reintenta en el siguiente segundo: sin tormentas.
//   - Nunca hay dos pedidos a la vez; `clear()` (nuevo en vivo) espera al que esté en vuelo y puede salir aunque la carga
//     haya fallado: la intención es descartar.
//   - `maxBytes` y los 64 KB de `keepalive` se miden en bytes UTF-8, nunca con la longitud del texto (KB = 1024).
//   - Antes de enviar se filtra con el MISMO validador que usa el servidor: un usuario inválido no viaja (cuenta como fuera
//     de la copia) y nunca deja el respaldo en 400 permanente. Después, si pasa `maxBytes`, se corta: primero todos los
//     ocultos y el flag, después los usuarios por XP de mayor a menor (desempate por clave) hasta el límite.
//   - El corte no serializa a cada usuario: los bytes exactos de cada uno se calculan a mano y solo el resultado final se
//     serializa y se codifica una vez.

import {
  isSessionKey,
  isSessionUser,
  jsonStringBytes,
  readSessionUser,
  sessionUserBytes,
} from '../sim/session-shape.js';

export const SESSION_URL = '/api/session';
export const SESSION_DEFAULTS = Object.freeze({
  maxBytes: 1024 * 1024,
  keepaliveBytes: 64 * 1024,
  loadTimeoutMs: 3000,
  minIntervalSeconds: 1,
  maxUsers: 20000,
});
/** Espera, en segundos, antes de cada reintento del GET de carga; pasados estos, cada `RETRY_LATER` segundos. */
export const LOAD_RETRY_SECONDS = Object.freeze([1, 2, 4, 8]);
export const LOAD_RETRY_LATER = 10;

/** Trabajo de armar la copia que no vale la pena espaciar, y tope del intervalo adaptable. */
const ADAPT_FREE_MS = 8;
const ADAPT_MAX_SECONDS = 5;

const ENCODER = new TextEncoder();
const bytesOf = (s) => ENCODER.encode(s).length;
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });
/** Respuestas que significan "esta sesión no existe para ti": se deja de enviar. */
const OFF = new Set([403, 404, 405]);

/**
 * Filtra con el validador del servidor y corta la copia al límite de bytes. No cambia la copia recibida.
 * @param {{users?: any[], hidden?: string[]} & Record<string, any>} copy
 * @param {number} maxBytes
 * @param {{maxUsers?: number}} [o]
 * @returns {{copy: object, body: string, bytes: number, dropped: number, droppedHidden: number}}
 *   `dropped` / `droppedHidden`: usuarios y ocultos que no viajan (inválidos o cortados)
 */
export function fitCopy(copy, maxBytes, { maxUsers = SESSION_DEFAULTS.maxUsers } = {}) {
  const rawUsers = Array.isArray(copy.users) ? copy.users : [];
  const rawHidden = Array.isArray(copy.hidden) ? copy.hidden : [];

  // 1) lo que el servidor rechazaría no viaja
  // (`isSessionUser` no copia nada: solo los usuarios que viajan se copian, al final, en orden canónico)
  const users = [];
  for (const raw of rawUsers) if (isSessionUser(raw)) users.push(raw);
  const hidden = rawHidden.filter(isSessionKey);
  let dropped = rawUsers.length - users.length;
  let droppedHidden = rawHidden.length - hidden.length;

  // 2) bytes exactos, sin serializar: el esqueleto (v, clock, flag, partido) una vez y cada elemento por cuenta
  const skeleton = bytesOf(JSON.stringify({ ...copy, users: [], hidden: [] }));
  const userBytes = users.map(sessionUserBytes);
  const hiddenBytes = hidden.map(jsonStringBytes);
  const commas = (n) => (n > 1 ? n - 1 : 0);
  let total = skeleton + commas(users.length) + commas(hidden.length);
  for (const b of userBytes) total += b;
  for (const b of hiddenBytes) total += b;

  let keptUsers = users;
  let keptHidden = hidden;
  if (users.length > maxUsers || total > maxBytes) {
    // 3) no entra: primero todos los ocultos que quepan, luego los usuarios por XP de mayor a menor, hasta el límite
    let acumulado = skeleton;
    let lleno = false;
    keptHidden = [];
    for (let i = 0; i < hidden.length; i++) {
      const add = hiddenBytes[i] + (keptHidden.length ? 1 : 0);
      if (lleno || acumulado + add > maxBytes) {
        lleno = true;
        droppedHidden++;
        continue;
      }
      acumulado += add;
      keptHidden.push(hidden[i]);
    }
    // por XP de mayor a menor; el desempate por clave (orden de unidades UTF-16, estable) no depende del orden de entrada
    const xp = users.map((u) => u.xp.live);
    const orden = users
      .map((u, i) => i)
      .sort(
        (a, b) => xp[b] - xp[a] || (users[a].key < users[b].key ? -1 : users[a].key > users[b].key ? 1 : 0) || a - b,
      );
    keptUsers = [];
    for (const i of orden) {
      const add = userBytes[i] + (keptUsers.length ? 1 : 0);
      if (lleno || keptUsers.length >= maxUsers || acumulado + add > maxBytes) {
        lleno = true;
        dropped++;
        continue;
      }
      acumulado += add;
      keptUsers.push(users[i]);
    }
  }

  // 4) un solo JSON.stringify y una sola codificación, del resultado final
  keptUsers = keptUsers.map(readSessionUser);
  const out = { ...copy, users: keptUsers, hidden: keptHidden };
  let body = JSON.stringify(out);
  let bytes = bytesOf(body);
  // red de seguridad: la cuenta de arriba es exacta, pero si algún día no lo fuera, nunca se pasa del límite
  while (bytes > maxBytes && keptUsers.length > 0) {
    keptUsers = keptUsers.slice(0, -1);
    out.users = keptUsers;
    dropped++;
    body = JSON.stringify(out);
    bytes = bytesOf(body);
  }
  return { copy: out, body, bytes, dropped, droppedHidden };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {{
 *   fetch: typeof fetch, snapshot: () => any, addEventListener?: (type: string, fn: () => void) => void,
 *   setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout,
 *   url?: string, maxBytes?: number, keepaliveBytes?: number, loadTimeoutMs?: number,
 *   minIntervalSeconds?: number, maxUsers?: number
 * }} o `snapshot` arma la copia (con el campo `match`); solo se llama cuando hay algo que enviar
 */
export function createSessionClient(o) {
  const doFetch = o.fetch;
  const url = o.url ?? SESSION_URL;
  const maxBytes = Number.isFinite(o.maxBytes) && o.maxBytes > 0 ? Math.floor(o.maxBytes) : SESSION_DEFAULTS.maxBytes;
  const keepaliveBytes = o.keepaliveBytes ?? SESSION_DEFAULTS.keepaliveBytes;
  const loadTimeoutMs = o.loadTimeoutMs ?? SESSION_DEFAULTS.loadTimeoutMs;
  const interval = o.minIntervalSeconds ?? SESSION_DEFAULTS.minIntervalSeconds;
  const maxUsers = o.maxUsers ?? SESSION_DEFAULTS.maxUsers;
  // Reloj en milisegundos solo para medir lo que cuesta armar la copia (el que manda es la página; sin él no se adapta nada)
  const clockMs = o.clockMs ?? (() => 0);
  const setTimer = o.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = o.clearTimeout ?? ((id) => globalThis.clearTimeout(id));

  const st = {
    load: 'none',
    ready: false,
    /** `pending`: ningún GET respondió 200 o 204 todavía; `open`: se puede enviar; `blocked`: hay una copia sin cargar; `off`. */
    gate: 'pending',
    stopped: false,
    dirty: false,
    saving: 'idle',
    dropped: 0,
    droppedHidden: 0,
    pendingDelete: false,
    retries: 0,
    retryAt: /** @type {number | null} */ (null),
  };
  /** Segundos que espera el próximo PUT: el mínimo, o más si armar la última copia fue caro (D27: "como mucho uno por segundo"). */
  let intervalNow = interval;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let lastNow = 0;
  let busy = 0;
  let tail = Promise.resolve();

  /** Un pedido por vez, en orden. Si no hay ninguno en vuelo arranca en el acto (el `fetch` sale en esta misma llamada). */
  function queue(fn) {
    const prev = busy === 0 ? null : tail;
    busy++;
    const p = (prev ? prev.then(fn) : fn()).catch(() => {}).finally(() => busy--);
    tail = p;
    return p;
  }

  const apagar = () => {
    st.stopped = true;
    st.gate = 'off';
  };

  /** Estado tras la respuesta de un PUT o un DELETE. @returns {boolean} true si salió bien */
  function resultado(res) {
    if (res && res.ok) return true;
    if (res && OFF.has(res.status)) apagar();
    return false;
  }

  /** Un GET de la copia, con tope de tiempo. No lanza: `{status, copy?, reason?}`. */
  async function pedirCopia() {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      ctl.abort();
    }, loadTimeoutMs);
    try {
      const res = await doFetch(url, { signal: ctl.signal });
      if (res.status === 204) return { status: 'empty' };
      if (OFF.has(res.status)) return { status: 'off', reason: String(res.status) };
      if (res.status === 200) {
        let copy;
        try {
          copy = await res.json();
        } catch {
          copy = undefined;
        }
        return isObject(copy) && copy.v === 1 && Array.isArray(copy.users)
          ? { status: 'restored', copy }
          : { status: 'invalid' };
      }
      return { status: 'failed', reason: String(res.status) };
    } catch {
      return { status: 'failed', reason: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimer(timer);
    }
  }

  /** Un segundo (el mínimo) hasta 8 ms de trabajo, un segundo más por cada 8 ms siguientes, con tope de 5 s. */
  const adaptive = (ms) =>
    Number.isFinite(ms) && ms > ADAPT_FREE_MS
      ? Math.min(ADAPT_MAX_SECONDS, Math.max(interval, Math.ceil(ms / ADAPT_FREE_MS)))
      : interval;

  const esperaDe = (n) => (n < LOAD_RETRY_SECONDS.length ? LOAD_RETRY_SECONDS[n] : LOAD_RETRY_LATER);

  /** Un reintento del GET de carga (con el juego ya en marcha). Nunca aplica la copia: solo decide si se puede enviar. */
  async function reintentarCarga(now) {
    lastAttempt = now;
    const r = await pedirCopia();
    if (r.status === 'off') apagar();
    else if (r.status === 'empty' || r.status === 'invalid')
      st.gate = 'open'; // no hay nada que perder
    else if (r.status === 'restored')
      st.gate = 'blocked'; // la copia buena existe: no se pisa
    else {
      st.retries++;
      st.retryAt = now + esperaDe(st.retries);
    }
    if (r.status !== 'failed') st.load = st.load === 'failed' ? 'failed' : r.status;
  }

  async function doPut(now) {
    lastAttempt = now;
    try {
      const t0 = clockMs();
      const fit = fitCopy(o.snapshot(), maxBytes, { maxUsers });
      intervalNow = adaptive(clockMs() - t0);
      st.dropped = fit.dropped;
      st.droppedHidden = fit.droppedHidden;
      st.dirty = false; // un cambio mientras vuela este pedido lo vuelve a marcar
      const res = await doFetch(url, { method: 'PUT', headers: JSON_HEADERS, body: fit.body });
      if (resultado(res)) st.saving = 'ok';
      else {
        st.saving = 'error';
        st.dirty = true;
      }
    } catch {
      st.saving = 'error';
      st.dirty = true;
    }
  }

  async function doDelete(now) {
    lastAttempt = now;
    try {
      const res = await doFetch(url, { method: 'DELETE' });
      if (resultado(res)) {
        st.pendingDelete = false;
        if (st.gate === 'pending' || st.gate === 'blocked') st.gate = 'open'; // descartar la copia vieja habilita el guardado
      }
    } catch {
      // queda pendiente: se reintenta en el siguiente segundo
    }
  }

  const api = {
    /** Estado para F2 y para las pruebas. */
    state: {
      get load() {
        return st.load;
      },
      get gate() {
        return st.gate;
      },
      get blocked() {
        return st.gate === 'blocked';
      },
      get stopped() {
        return st.stopped;
      },
      get dirty() {
        return st.dirty;
      },
      get saving() {
        return st.saving;
      },
      get dropped() {
        return st.dropped;
      },
      get droppedHidden() {
        return st.droppedHidden;
      },
      get pendingDelete() {
        return st.pendingDelete;
      },
      /** Segundos que espera hoy el próximo PUT (1 salvo que armar la copia haya sido caro). */
      get interval() {
        return intervalNow;
      },
    },

    /**
     * GET antes del primer evento. No lanza: devuelve `{status, copy?, reason?}` con status `restored`, `empty`, `off`,
     * `failed` o `invalid`.
     */
    async load() {
      const result = await pedirCopia();
      if (result.status === 'off') apagar();
      else if (result.status !== 'failed') st.gate = 'open';
      st.load = result.status;
      st.ready = true;
      return result;
    },

    /** Hay algo nuevo que guardar. Barato: solo levanta una marca. */
    markDirty() {
      st.dirty = true;
    },

    /**
     * Se llama una vez por cuadro con el reloj de vista, en segundos. Reintenta la carga si hace falta, o envía si hay algo
     * sucio y pasó al menos un segundo desde el último intento. Devuelve la promesa del pedido, o null si no hizo nada.
     * @param {number} nowSeconds
     */
    tick(nowSeconds) {
      lastNow = nowSeconds;
      if (!st.ready || st.stopped || busy > 0) return null;
      if (st.pendingDelete && nowSeconds - lastAttempt >= interval) return queue(() => doDelete(nowSeconds));
      if (st.gate === 'pending') {
        // la espera se arma con el primer tick después del fallo
        if (st.retryAt === null) st.retryAt = nowSeconds + esperaDe(st.retries);
        return nowSeconds >= st.retryAt ? queue(() => reintentarCarga(nowSeconds)) : null;
      }
      if (nowSeconds - lastAttempt < intervalNow) return null;
      if (st.gate === 'open' && st.dirty && !st.pendingDelete) return queue(() => doPut(nowSeconds));
      return null;
    },

    /**
     * "Nuevo en vivo": vacía la copia del servidor. Espera al pedido en vuelo para no resucitar lo viejo. Sale también si
     * la carga falló o la copia quedó bloqueada: la intención es descartar. Si sale bien, se habilita el guardado.
     */
    clear() {
      if (!st.ready || st.stopped) return Promise.resolve();
      st.dirty = false;
      st.pendingDelete = true;
      return queue(() => doDelete(lastNow));
    },

    /** `pagehide`: un último PUT con keepalive, solo si se puede enviar, está sucia y pesa ≤ 64 KB. Sin esperar la respuesta. */
    flush() {
      if (!st.ready || st.stopped) return;
      try {
        if (st.pendingDelete) {
          doFetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
          return;
        }
        if (st.gate !== 'open' || !st.dirty) return;
        const fit = fitCopy(o.snapshot(), maxBytes, { maxUsers });
        if (fit.bytes > keepaliveBytes) return;
        doFetch(url, { method: 'PUT', headers: JSON_HEADERS, body: fit.body, keepalive: true }).catch(() => {});
      } catch {
        // la página se está yendo: no hay nada más que hacer
      }
    },

    /** Espera a que terminen los pedidos en vuelo (para las pruebas). */
    settle: () => tail,
  };

  o.addEventListener?.('pagehide', () => api.flush());
  return api;
}
