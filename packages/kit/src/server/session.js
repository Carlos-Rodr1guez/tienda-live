// Copia de la sesión del LIVE en la memoria del proceso (KIT-28, diseño D27). Recargar la página no pierde rangos ni
// donantes ocultos: la página manda su estado al servidor local y lo pide al cargar.
//
// Reglas que cumple este archivo:
//   - Vive en una variable de este proceso. No importa nada que escriba a disco y no imprime nada, tampoco al fallar.
//   - Solo la máquina local: la dirección remota tiene que ser loopback y el encabezado Host tiene que ser localhost,
//     127.0.0.1 o [::1] (con o sin puerto), lo que frena un DNS rebinding. `X-Forwarded-For` nunca se mira.
//   - Acepta `application/json` y nada más (415). No agrega encabezados CORS: el 415 obliga a todo pedido de otro origen
//     a pasar por un preflight que nadie contesta.
//   - El límite `maxBytes` se mide en bytes UTF-8 (nunca con `string.length`; KB y MB son de 1024). La lectura se corta
//     apenas se pasa (413), sin acumular el resto.
//   - Valida forma y límites y copia campo por campo, solo los conocidos. No usa `Object.assign`, spread ni mezclas del
//     objeto recibido: un `__proto__`, `constructor` o `prototype` en el JSON no contamina nada. Con claves repetidas queda
//     la primera. El saneado de nombres y el rango desde la XP NO se hacen acá: son del registro (`importLive`).

import { SESSION_LIMITS, isSessionKey, readSessionUser } from '../sim/session-shape.js';

const DEFAULT_MAX_BYTES = 1024 * 1024;
const MIN_MAX_BYTES = 64 * 1024;
const MAX_MAX_BYTES = 4 * 1024 * 1024;

// La forma de un usuario y sus límites son del módulo compartido con la página (`sim/session-shape.js`).
const VERSION = SESSION_LIMITS.version;
const MAX_USERS = SESSION_LIMITS.maxUsers;
const MAX_COUNT = SESSION_LIMITS.maxCount;
const MAX_PAIR_ID = 64;
const MAX_ROUNDS = 99;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOST_OK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Lee solo propiedades propias: un JSON no puede colar nada por la cadena de prototipos. */
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COUNT;
const isKey = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** @param {unknown} v @returns {object | null | false} el partido limpio, null si no hay, false si es inválido */
function readMatch(v) {
  if (v === undefined || v === null) return null;
  if (!isObject(v)) return false;
  const pair = own(v, 'pair');
  const wins = own(v, 'wins');
  const started = own(v, 'started');
  const roundsDone = own(v, 'roundsDone');
  if (!Array.isArray(pair) || pair.length !== 2 || !isKey(pair[0], MAX_PAIR_ID) || !isKey(pair[1], MAX_PAIR_ID)) {
    return false;
  }
  if (typeof started !== 'boolean' || !isInt(roundsDone, 0, MAX_ROUNDS)) return false;
  if (!Array.isArray(wins) || wins.length !== 2 || !isInt(wins[0], 0, MAX_ROUNDS) || !isInt(wins[1], 0, MAX_ROUNDS)) {
    return false;
  }
  return { pair: [pair[0], pair[1]], started, roundsDone, wins: [wins[0], wins[1]] };
}

/**
 * Valida la forma y los límites de una copia y devuelve otra limpia, o null si algo no cumple.
 * @param {unknown} data
 */
function cleanCopy(data) {
  if (!isObject(data) || own(data, 'v') !== VERSION) return null;
  const clock = own(data, 'clock');
  const users = own(data, 'users');
  const hidden = own(data, 'hidden');
  const allHidden = own(data, 'allHidden');
  if (!isTime(clock) || clock < 0 || typeof allHidden !== 'boolean') return null;
  if (!Array.isArray(users) || users.length > MAX_USERS || !Array.isArray(hidden) || hidden.length > MAX_USERS)
    return null;
  const match = readMatch(own(data, 'match'));
  if (match === false) return null;

  const seen = new Set();
  const cleanUsers = [];
  for (const raw of users) {
    const u = readSessionUser(raw);
    if (!u) return null;
    if (seen.has(u.key)) continue; // clave repetida: queda la primera
    seen.add(u.key);
    cleanUsers.push(u);
  }
  const seenHidden = new Set();
  const cleanHidden = [];
  for (const k of hidden) {
    if (!isSessionKey(k)) return null;
    if (seenHidden.has(k)) continue;
    seenHidden.add(k);
    cleanHidden.push(k);
  }
  return { v: VERSION, clock, users: cleanUsers, hidden: cleanHidden, allHidden, match };
}

/** @param {unknown} v @returns {number} */
function clampMaxBytes(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_MAX_BYTES;
  return Math.min(MAX_MAX_BYTES, Math.max(MIN_MAX_BYTES, Math.floor(v)));
}

/** Lee el cuerpo hasta `maxBytes` bytes. Al pasarse deja de leer: pausa el flujo y no guarda nada más. */
function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    let chunks = [];
    let total = 0;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onError);
      resolve(result);
    };
    const onData = (chunk) => {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > maxBytes) {
        chunks = [];
        req.pause(); // sin oyente un flujo sigue corriendo: se frena para no leer ni un byte más
        finish({ tooBig: true });
        return;
      }
      chunks.push(b);
    };
    const onEnd = () => finish({ body: Buffer.concat(chunks).toString('utf8') });
    const onError = () => finish({ aborted: true });
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onError);
  });
}

/**
 * @param {{maxBytes?: number}} [opts] `maxBytes`: 1 MB por defecto, recortado a [64 KB, 4 MB]
 */
export function createSessionStore(opts) {
  const maxBytes = clampMaxBytes(opts?.maxBytes);
  /** La copia guardada, ya limpia y serializada. Una variable del proceso y nada más. */
  let stored = null;

  const reply = (res, status, headers = {}, body) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  /** Respuestas de rechazo: cierran la conexión, porque el cuerpo del pedido puede quedar sin leer. */
  const reject = (res, status, extra = {}) => reply(res, status, { Connection: 'close', ...extra });

  return {
    maxBytes,
    /** La copia guardada como texto JSON, o null si está vacía. */
    get: () => stored,

    /** Atiende `/api/session`. Siempre responde. */
    async handle(req, res) {
      if (!LOOPBACK.has(req.socket?.remoteAddress)) return reject(res, 403);
      if (!HOST_OK.test(String(req.headers?.host ?? ''))) return reject(res, 403);

      switch (req.method) {
        case 'GET':
          if (stored === null) return reply(res, 204);
          return reply(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, stored);
        case 'DELETE':
          stored = null;
          return reply(res, 204);
        case 'PUT':
          break;
        default:
          return reject(res, 405, { Allow: 'GET, PUT, DELETE' });
      }

      if (!JSON_TYPE.test(String(req.headers?.['content-type'] ?? '').trim())) return reject(res, 415);
      const declared = Number(req.headers?.['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) return reject(res, 413);

      const got = await readBody(req, maxBytes);
      if (got.tooBig) return reject(res, 413);
      if (got.aborted) return reject(res, 400);
      let data;
      try {
        data = JSON.parse(got.body);
      } catch {
        return reject(res, 400);
      }
      const clean = cleanCopy(data);
      if (!clean) return reject(res, 400);
      stored = JSON.stringify(clean);
      return reply(res, 204);
    },
  };
}
