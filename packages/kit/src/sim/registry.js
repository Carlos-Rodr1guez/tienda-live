// Registro de equipos y usuarios del LIVE (KIT-5 a KIT-13, KIT-20 a KIT-23). Todo vive en memoria: este módulo no escribe nada
// a disco. No recibe azar: los desempates salen de una función estable de la clave del usuario.
// El reloj (`now`) y la ronda (`round`) llegan por argumento, nunca se leen del entorno.

import { ANON, sanitizeName } from './names.js';
import { ConfigError, clampNumber } from './config.js';
import { DEFAULT_LADDER, compileLadder, rankAt } from './ranks.js';
import { hashKey, normWord, tokenize } from './words.js';

/** Fecha lejana en el pasado: el primer ingreso nunca queda en cooldown (y sobrevive a JSON). */
const NEVER = -1e9;
const MAX_AVATAR = 2048;
/** "Todavía sin XP" en `firstXpAt`: tarde a propósito, para que ordene al final y sobreviva a JSON. */
const NO_XP_YET = 1e9;

/**
 * @typedef {{id:string, name:string, iso?:string, aliases?:string[], firstOnly?:string[]}} TeamDef
 * @typedef {{live:number, match:number, round:number}} Scoped
 * @typedef {{key:string, name:string, avatar:string, team:number|null, blocked:boolean, hidden:boolean,
 *   joinedRound:number, lastSwitch:number, coins:Scoped, value:Scoped, xp:Scoped, kills:Scoped,
 *   firstXpAt:{match:number, round:number}, rank:number}} User
 *   `name` y `avatar` son los datos saneados REALES: las vistas pasan siempre por displayName() y avatarOf().
 * @typedef {{type:'join', key:string, team:number, switched:boolean, auto:boolean, freeUnit:boolean}
 *   | {type:'rankUp', key:string, team:number|null, from:number, to:number}} RegistryEvent
 *   `rankUp` lleva la clave y nunca el nombre: la vista lo resuelve al mostrar (KIT-23).
 */

/** @returns {Scoped} */
const scoped = () => ({ live: 0, match: 0, round: 0 });

/** @param {unknown} v @returns {number} un número positivo y finito, o 0 */
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Valida la lista de equipos y arma los índices de lectura de comentarios.
 * @param {unknown} teams
 */
function compileTeams(teams) {
  if (!Array.isArray(teams) || teams.length < 2) {
    throw new ConfigError('se necesitan al menos 2 equipos');
  }
  const ids = new Set();
  /** @type {Map<string, {team:number, firstOnly:boolean}>} */
  const aliases = new Map();
  /** @type {Map<string, number>} */
  const isos = new Map();
  teams.forEach((def, i) => {
    const team = i + 1;
    if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !def.id) {
      throw new ConfigError(`el equipo ${team} no tiene id`);
    }
    if (ids.has(def.id)) throw new ConfigError(`id "${def.id}" repetido entre equipos`);
    ids.add(def.id);
    if (def.iso !== undefined && def.iso !== null && def.iso !== '') {
      const iso = String(def.iso).toUpperCase();
      if (isos.has(iso)) throw new ConfigError(`código "${iso}" repetido entre equipos`);
      isos.set(iso, team);
    }
    for (const [list, firstOnly] of [
      [def.aliases ?? [], false],
      [def.firstOnly ?? [], true],
    ]) {
      for (const raw of list) {
        const alias = normWord(raw);
        if (!alias) throw new ConfigError(`alias "${raw}" vacío en el equipo "${def.id}"`);
        if (/^\d+$/.test(alias)) throw new ConfigError(`alias "${alias}" es un número suelto en el equipo "${def.id}"`);
        const prev = aliases.get(alias);
        if (prev && prev.team !== team) throw new ConfigError(`alias "${alias}" repetido entre equipos`);
        // si el mismo equipo lo declara en las dos listas, manda la restricción
        aliases.set(alias, { team, firstOnly: firstOnly || (prev?.firstOnly ?? false) });
      }
    }
  });
  return { aliases, isos, ids: [...ids] };
}

/**
 * @param {{teams: TeamDef[], policy?: string, allowSwitch?: boolean, switchCooldownSeconds?: number,
 *   ladder?: import('./ranks.js').Rank[], valueFactor?: number,
 *   names?: {maxGraphemes?: number, maxMarks?: number}, blocklist?: {isBlocked(n: string): boolean} | null}} o
 */
export function createRegistry(o) {
  const { aliases, isos, ids } = compileTeams(o?.teams);
  const N = ids.length;
  const policy = o.policy ?? 'balance';
  const fixedTeam = policy === 'balance' ? 0 : ids.indexOf(policy) + 1;
  if (policy !== 'balance' && !fixedTeam) throw new ConfigError(`política de equipos desconocida: "${policy}"`);
  const allowSwitch = o.allowSwitch !== false;
  const cooldown = Number.isFinite(o.switchCooldownSeconds) ? Number(o.switchCooldownSeconds) : 15;
  const nameOpts = o.names ?? {};
  const blocklist = o.blocklist ?? null;
  const ladder = compileLadder({ ladder: o.ladder ?? DEFAULT_LADDER });
  const valueFactor = clampNumber(o.valueFactor, 0, 1000, 0.5);

  /** @type {Map<string, User>} */
  const byKey = new Map();
  const hiddenKeys = new Set();
  const sizes = Array.from({ length: N }, () => 0);
  /** @type {RegistryEvent[]} */
  let outbox = [];
  let allHidden = false;

  const keyOf = (evt) => String(evt?.userId || evt?.uniqueId || evt?.nickname || 'anon');

  /** Equipo (1..N) que pide un comentario, o 0. Primera palabra: número, alias, firstOnly o bandera. */
  function teamFromText(text) {
    const tokens = tokenize(text);
    const one = (tok, first) => {
      if (tok.startsWith('flag:')) return isos.get(tok.slice(5)) ?? 0;
      if (/^\d+$/.test(tok)) {
        if (!first) return 0;
        const n = /^[1-9]\d*$/.test(tok) ? Number(tok) : 0;
        return n >= 1 && n <= N ? n : 0;
      }
      const a = aliases.get(tok);
      return a && (first || !a.firstOnly) ? a.team : 0;
    };
    for (let i = 0; i < tokens.length; i++) {
      const single = one(tokens[i], i === 0);
      if (single) return single;
      // "costa" + "rica", "el" + "salvador": dos tokens seguidos, en cualquier posición
      const next = tokens[i + 1];
      if (next !== undefined && !tokens[i].startsWith('flag:') && !next.startsWith('flag:')) {
        const a = aliases.get(tokens[i] + next);
        if (a && (i === 0 || !a.firstOnly)) return a.team;
      }
    }
    return 0;
  }

  /** @param {User} u @param {number} team */
  function setTeam(u, team) {
    if (u.team !== null) sizes[u.team - 1]--;
    u.team = team;
    sizes[team - 1]++;
  }

  /**
   * Suma XP en los tres alcances, fija `firstXpAt` una sola vez por alcance y, si el rango de LIVE sube,
   * deja UN `rankUp` con from/to (un salto de varios rangos es un solo evento). La XP nunca baja.
   * @param {User} u @param {number} xp @param {number} now
   */
  function giveXp(u, xp, now) {
    u.xp.live += xp;
    u.xp.match += xp;
    u.xp.round += xp;
    const t = Number.isFinite(now) ? now : 0;
    if (u.firstXpAt.match >= NO_XP_YET) u.firstXpAt.match = t;
    if (u.firstXpAt.round >= NO_XP_YET) u.firstXpAt.round = t;
    const to = rankAt(ladder, u.xp.live);
    if (to > u.rank) {
      outbox.push({ type: 'rankUp', key: u.key, team: u.team, from: u.rank, to });
      u.rank = to;
    }
  }

  const hideAll = (u) => allHidden || u.blocked || u.hidden;

  const api = {
    /** Alta o actualización por clave. El nombre se sanea en cada evento, venga de donde venga. */
    touch(evt) {
      const key = keyOf(evt);
      let u = byKey.get(key);
      if (!u) {
        u = {
          key,
          name: ANON,
          avatar: '',
          team: null,
          blocked: false,
          hidden: hiddenKeys.has(key),
          joinedRound: -1,
          lastSwitch: NEVER,
          coins: scoped(),
          value: scoped(),
          xp: scoped(),
          kills: scoped(),
          firstXpAt: { match: NO_XP_YET, round: NO_XP_YET },
          rank: 0,
        };
        byKey.set(key, u);
      }
      const nick = evt?.nickname || evt?.uniqueId;
      if (nick) {
        u.name = sanitizeName(nick, nameOpts);
        u.blocked = blocklist ? blocklist.isBlocked(u.name) : false;
      }
      if (typeof evt?.avatar === 'string' && evt.avatar && evt.avatar.length <= MAX_AVATAR) u.avatar = evt.avatar;
      return u;
    },

    /**
     * Lee un comentario como pedido de equipo. Devuelve el evento `join` (y lo deja también en la bandeja),
     * o null si no pide equipo, si el cambio está en cooldown o si no hay nada nuevo que dar.
     * @returns {RegistryEvent | null}
     */
    joinFromChat(evt, now, round) {
      const team = teamFromText(evt?.text);
      if (!team) return null;
      const u = api.touch(evt);
      const switched = u.team !== null && u.team !== team;
      if (switched && (!allowSwitch || now - u.lastSwitch < cooldown)) return null;
      const freeUnit = u.joinedRound !== round;
      if (u.team === team && !freeUnit) return null;
      if (u.team !== team) {
        setTeam(u, team);
        u.lastSwitch = now;
      }
      if (freeUnit) u.joinedRound = round;
      const ev = { type: /** @type {const} */ ('join'), key: u.key, team, switched, auto: false, freeUnit };
      outbox.push(ev);
      return { ...ev };
    },

    /** Equipo del usuario; si no tiene, la política le da uno (sin azar) y deja un `join` automático. */
    ensureTeam(u) {
      if (u.team !== null) return u.team;
      let team = fixedTeam;
      if (!team) {
        const min = Math.min(...sizes);
        const tied = [];
        sizes.forEach((n, i) => n === min && tied.push(i + 1));
        team = tied[hashKey(u.key) % tied.length];
      }
      setTeam(u, team);
      outbox.push({ type: 'join', key: u.key, team, switched: false, auto: true, freeUnit: false });
      return team;
    },

    /** Las monedas dan XP en el momento en que llega el regalo, aunque el juego esté en pausa. */
    addCoins(key, coins, now) {
      const u = byKey.get(key);
      const n = positive(coins);
      if (!u || !n) return;
      u.coins.live += n;
      u.coins.match += n;
      u.coins.round += n;
      giveXp(u, n, now);
    },

    /** El valor destruido da `valueFactor × valor` de XP. */
    addDestroyed(key, value, now) {
      const u = byKey.get(key);
      const n = positive(value);
      if (!u || !n) return;
      u.value.live += n;
      u.value.match += n;
      u.value.round += n;
      giveXp(u, n * valueFactor, now);
    },

    addKill(key) {
      const u = byKey.get(key);
      if (!u) return;
      u.kills.live++;
      u.kills.match++;
      u.kills.round++;
    },

    /** Partido nuevo: reinicia los alcances de partido y de ronda. Lo de LIVE queda. */
    startMatch() {
      for (const u of byKey.values()) {
        for (const s of [u.coins, u.value, u.kills, u.xp]) {
          s.match = 0;
          s.round = 0;
        }
        u.firstXpAt.match = NO_XP_YET;
        u.firstXpAt.round = NO_XP_YET;
      }
    },

    /** Ronda nueva: reinicia solo el alcance de ronda. */
    startRound() {
      for (const u of byKey.values()) {
        u.coins.round = 0;
        u.value.round = 0;
        u.kills.round = 0;
        u.xp.round = 0;
        u.firstXpAt.round = NO_XP_YET;
      }
    },

    teamSizes: () => [...sizes],
    /** Rango por XP de LIVE: índice en la escalera y su nombre. */
    rankOf(key) {
      const i = byKey.get(key)?.rank ?? 0;
      return { index: i, label: ladder[i].label };
    },
    get: (key) => byKey.get(key),
    users: () => [...byKey.values()],

    /** Nombre para mostrar: "anónimo" si está vetado, oculto o si todos los nombres están ocultos. */
    displayName(key) {
      const u = byKey.get(key);
      return !u || hideAll(u) ? ANON : u.name;
    },
    avatarOf(key) {
      const u = byKey.get(key);
      return !u || hideAll(u) ? '' : u.avatar;
    },

    /** Oculta a un usuario por el resto del LIVE (también si todavía no llegó). No hay lista visible. */
    hide(key) {
      hiddenKeys.add(String(key));
      const u = byKey.get(String(key));
      if (u) u.hidden = true;
    },
    setAllNamesHidden(b) {
      allHidden = Boolean(b);
    },
    allNamesHidden: () => allHidden,

    /** Entrega los eventos pendientes y vacía la bandeja. La vista resuelve el nombre al mostrar. */
    drain() {
      const out = outbox;
      outbox = [];
      return out;
    },
  };
  return api;
}
