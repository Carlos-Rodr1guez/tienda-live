// Podio y MVP (KIT-24, KIT-25). Funciones puras sobre el registro: ni azar ni orden del Map.
// Cadena de desempate: XP, monedas, valor destruido, `firstXpAt` menor y clave en orden de punto de código.

import { cmpCodePoints } from './words.js';

/**
 * @typedef {{key:string, name:string, avatar:string, team:number|null, xp:number, coins:number, value:number,
 *   kills:number, rank:number}} PodiumEntry
 *   `name` ya viene resuelto con los ocultos de este momento ("anónimo" si está oculto o vetado).
 */

/** Alcances que admiten ranking. `live` no tiene `firstXpAt`: su desempate cae a la clave. */
const SCOPES = ['live', 'match', 'round'];

/**
 * Usuarios con XP > 0 del alcance, ordenados por la cadena de desempate.
 * @param {ReturnType<import('./registry.js').createRegistry>} registry
 * @param {'live'|'match'|'round'} scope
 * @param {{team?: number}} [o] equipo 1..N opcional
 * @returns {PodiumEntry[]}
 */
export function rankUsers(registry, scope, { team } = {}) {
  if (!SCOPES.includes(scope)) throw new TypeError(`alcance desconocido: "${scope}"`);
  const rows = [];
  for (const u of registry.users()) {
    if (!(u.xp[scope] > 0)) continue;
    if (team !== undefined && u.team !== team) continue;
    rows.push({ u, first: scope === 'live' ? 0 : u.firstXpAt[scope] });
  }
  rows.sort(
    (a, b) =>
      b.u.xp[scope] - a.u.xp[scope] ||
      b.u.coins[scope] - a.u.coins[scope] ||
      b.u.value[scope] - a.u.value[scope] ||
      a.first - b.first ||
      cmpCodePoints(a.u.key, b.u.key),
  );
  return rows.map(({ u }) => ({
    key: u.key,
    name: registry.displayName(u.key),
    avatar: registry.avatarOf(u.key),
    team: u.team,
    xp: u.xp[scope],
    coins: u.coins[scope],
    value: u.value[scope],
    kills: u.kills[scope],
    rank: u.rank,
  }));
}

/** `firstXpAt` del alcance (en `live` no hay: el desempate cae a la clave). */
const primero = (u, scope) => (scope === 'live' ? 0 : u.firstXpAt[scope]);

/** ¿`a` va antes que `b`? (negativo si sí). La MISMA cadena de desempate que `rankUsers`, sin reservar memoria. */
function antes(a, b, scope) {
  return (
    b.xp[scope] - a.xp[scope] ||
    b.coins[scope] - a.coins[scope] ||
    b.value[scope] - a.value[scope] ||
    primero(a, scope) - primero(b, scope) ||
    cmpCodePoints(a.key, b.key)
  );
}

/**
 * Los `n` primeros de `rankUsers(registry, scope, {team})` en UNA pasada: guarda solo los N mejores por inserción, con la misma
 * cadena de desempate, así que cuesta O(usuarios · log n) y no ordena a todos (con 20 000 usuarios, de ~10 ms a menos de 1 ms).
 * `filter(user)` es opcional (p. ej. solo donantes con una unidad viva).
 * @param {ReturnType<import('./registry.js').createRegistry>} registry
 * @param {'live'|'match'|'round'} scope
 * @param {number} n
 * @param {{team?: number, filter?: (u: any) => boolean}} [o]
 * @returns {PodiumEntry[]}
 */
export function topUsers(registry, scope, n, { team, filter } = {}) {
  if (!SCOPES.includes(scope)) throw new TypeError(`alcance desconocido: "${scope}"`);
  const cap = Math.floor(Number(n));
  if (!(cap > 0)) return [];
  const top = [];
  for (const u of registry.users()) {
    if (!(u.xp[scope] > 0)) continue;
    if (team !== undefined && u.team !== team) continue;
    if (filter !== undefined && !filter(u)) continue;
    if (top.length === cap && antes(u, top[cap - 1], scope) >= 0) continue;
    // búsqueda binaria del lugar y inserción; el peor sale si pasa el tope
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (antes(u, top[mid], scope) < 0) hi = mid;
      else lo = mid + 1;
    }
    top.splice(lo, 0, u);
    if (top.length > cap) top.pop();
  }
  return top.map((u) => ({
    key: u.key,
    name: registry.displayName(u.key),
    avatar: registry.avatarOf(u.key),
    team: u.team,
    xp: u.xp[scope],
    coins: u.coins[scope],
    value: u.value[scope],
    kills: u.kills[scope],
    rank: u.rank,
  }));
}

/**
 * Los n primeros por XP de partido. Con `team`, solo ese país (sin relleno si hay menos).
 * @returns {PodiumEntry[]}
 */
export function podium(registry, n = 3, { team } = {}) {
  const count = Math.floor(Number(n));
  if (!(count > 0)) return [];
  return topUsers(registry, 'match', count, { team });
}

/** El de más XP de partido entre todos los equipos, o null si nadie tiene XP. */
export function matchMvp(registry) {
  return topUsers(registry, 'match', 1)[0] ?? null;
}

/** El de más XP de ronda de ese equipo, o null si nadie del equipo ganó XP en la ronda. */
export function mvp(registry, team) {
  return topUsers(registry, 'round', 1, { team })[0] ?? null;
}
