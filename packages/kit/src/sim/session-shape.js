// Forma de un usuario de la copia de sesión (KIT-28, diseño D27), en UN solo lugar para el servidor y la página:
//   - el servidor la usa para rechazar una copia con un usuario inválido (400);
//   - la página la usa para filtrar ANTES de enviar, así un solo usuario inválido no deja el respaldo en 400 permanente;
//   - y la cuenta EXACTA de bytes UTF-8 del JSON de un usuario, sin serializarlo (la página la usa para cortar la copia).
// Puro: sin reloj, sin azar, sin entorno. Copia campo por campo y solo los conocidos; lee solo propiedades propias, así que
// un `__proto__` o `constructor` del JSON no cuela nada.

export const SESSION_LIMITS = Object.freeze({
  version: 1,
  maxUsers: 20000,
  maxKey: 512,
  maxName: 512,
  maxTeam: 64,
  maxCount: 1e12,
});

const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= SESSION_LIMITS.maxCount;
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= SESSION_LIMITS.maxCount;

/** @param {unknown} v @returns {boolean} una clave de usuario o de oculto: texto de 1 a 512 unidades */
export const isSessionKey = (v) => typeof v === 'string' && v.length >= 1 && v.length <= SESSION_LIMITS.maxKey;

/** @param {unknown} v @returns {{live: number, match: number} | null} */
function readPair(v) {
  if (!isObject(v)) return null;
  const live = own(v, 'live');
  const match = own(v, 'match');
  return isCount(live) && isCount(match) ? { live, match } : null;
}

const pairOk = (v) => isObject(v) && isCount(own(v, 'live')) && isCount(own(v, 'match'));

/**
 * ¿Es un usuario válido de la copia? Misma regla que `readSessionUser` pero sin copiar nada: sirve para filtrar miles de
 * usuarios sin crear un objeto por cada uno.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isSessionUser(raw) {
  if (!isObject(raw)) return false;
  const name = own(raw, 'name');
  const team = own(raw, 'team');
  const firstXpAt = own(raw, 'firstXpAt');
  if (!isSessionKey(own(raw, 'key')) || typeof name !== 'string' || name.length > SESSION_LIMITS.maxName) return false;
  if (team !== null && !(Number.isInteger(team) && team >= 1 && team <= SESSION_LIMITS.maxTeam)) return false;
  if (!isTime(own(raw, 'lastSwitch')) || (firstXpAt !== null && !isTime(firstXpAt))) return false;
  return pairOk(own(raw, 'coins')) && pairOk(own(raw, 'value')) && pairOk(own(raw, 'xp')) && pairOk(own(raw, 'kills'));
}

/**
 * Valida un usuario de la copia y devuelve otro limpio (campos conocidos, en orden canónico), o null si algo no cumple.
 * @param {unknown} raw
 * @returns {{key: string, name: string, team: number | null, lastSwitch: number, coins: {live: number, match: number},
 *   value: {live: number, match: number}, xp: {live: number, match: number}, kills: {live: number, match: number},
 *   firstXpAt: number | null} | null}
 */
export function readSessionUser(raw) {
  if (!isObject(raw)) return null;
  const key = own(raw, 'key');
  const name = own(raw, 'name');
  const team = own(raw, 'team');
  const lastSwitch = own(raw, 'lastSwitch');
  const firstXpAt = own(raw, 'firstXpAt');
  if (!isSessionKey(key) || typeof name !== 'string' || name.length > SESSION_LIMITS.maxName) return null;
  if (team !== null && !(Number.isInteger(team) && team >= 1 && team <= SESSION_LIMITS.maxTeam)) return null;
  if (!isTime(lastSwitch) || (firstXpAt !== null && !isTime(firstXpAt))) return null;
  const coins = readPair(own(raw, 'coins'));
  const value = readPair(own(raw, 'value'));
  const xp = readPair(own(raw, 'xp'));
  const kills = readPair(own(raw, 'kills'));
  if (!coins || !value || !xp || !kills) return null;
  return { key, name, team, lastSwitch, coins, value, xp, kills, firstXpAt };
}

// ---------------------------------------------------------------------------------------------------------------
// Bytes exactos del JSON

/**
 * Bytes UTF-8 de `JSON.stringify(s)` (con las comillas), sin serializar. Cuenta los escapes del JSON: comillas y barras,
 * los controles (\b \f \n \r \t son 2 bytes; los demás, \u00XX, son 6) y los sustitutos sueltos, que JSON.stringify
 * escribe como \uDXXX (6). El DEL (0x7F) no se escapa.
 * @param {string} s
 */
export function jsonStringBytes(s) {
  let n = 2;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) n += 2;
    else if (c < 0x20) n += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
    else if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) n += 6;
    else n += 3;
  }
  return n;
}

const SKELETON_USER = {
  key: '',
  name: '',
  team: null,
  lastSwitch: 0,
  coins: { live: 0, match: 0 },
  value: { live: 0, match: 0 },
  xp: { live: 0, match: 0 },
  kills: { live: 0, match: 0 },
  firstXpAt: null,
};
/** Bytes del usuario vacío: las llaves, los nombres de campo, `null`, ceros y las dos comillas de cada texto. */
const SKELETON_BYTES = new TextEncoder().encode(JSON.stringify(SKELETON_USER)).length;

/**
 * Bytes UTF-8 exactos de `JSON.stringify(usuario)` para un usuario YA limpio por `readSessionUser` (campos en orden
 * canónico). No serializa: suma el largo de cada número con `String(n)` y recorre los dos textos.
 * Sirve también para un usuario que `isSessionUser` aceptó aunque traiga campos de más: solo lee los conocidos.
 * @param {NonNullable<ReturnType<typeof readSessionUser>>} u
 */
export function sessionUserBytes(u) {
  let n = SKELETON_BYTES + (jsonStringBytes(u.key) - 2) + (jsonStringBytes(u.name) - 2);
  if (u.team !== null) n += String(u.team).length - 4;
  n += String(u.lastSwitch).length - 1;
  for (const p of [u.coins, u.value, u.xp, u.kills]) n += String(p.live).length - 1 + (String(p.match).length - 1);
  if (u.firstXpAt !== null) n += String(u.firstXpAt).length - 4;
  return n;
}
