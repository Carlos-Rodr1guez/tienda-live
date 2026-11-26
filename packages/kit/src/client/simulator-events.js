// Constructores puros de eventos del simulador de público (KIT-27). Sin DOM: se prueban sin navegador.
// Cada evento sigue el contrato `LiveEvent` de normalize.js, igual que si llegara de TikTok. Los eventos
// simulados NO llevan ninguna marca: la guardia de presencia solo mira entrada real del DOM (NM-8).

import { normWord } from '../sim/words.js';

/** @typedef {{userId:string, uniqueId:string, nickname:string, avatar:string}} SimUser */
/** @typedef {{name:string, coins:number, id?:string, image?:string}} SimGift */
/** @typedef {{team:number, label:string, word:string}} PanelTeam */
/** @typedef {{teams: PanelTeam[], gifts: SimGift[], names?: string[], level?: string}} AutoConfig */

/** Eventos medios por vuelta de 100 ms de cada nivel automático. "max" llena los topes de los dos lados. */
export const AUTO_LEVELS = Object.freeze({ low: 0.8 / 10, mid: 2.2 / 10, high: 5 / 10, max: 4 });

const LEVEL_LABELS = [
  ['off', 'Apagado'],
  ['low', 'Bajo'],
  ['mid', 'Medio'],
  ['high', 'Alto'],
  ['max', 'Tráfico máximo'],
];

/** Nombres de ejemplo para el modo automático cuando la config no trae los suyos. */
export const DEFAULT_NAMES = Object.freeze([
  'ana_23',
  'lucho.pe',
  'mari_q',
  'elpepe',
  'sofi.x',
  'kevin_007',
  'gato.loco',
  'rocio.lp',
  'jhon.ar',
  'vale.cusco',
  'tito99',
  'meli.pz',
  'dany_god',
  'pao.tq',
  'brayan.x',
  'nico.aqp',
  'flor_17',
  'gamer.puno',
  'cami.v',
  'diego.rx',
]);

/** @param {SimUser} u @returns {SimUser} solo los cuatro campos del contrato */
const userFields = (u) => ({
  userId: String(u.userId),
  uniqueId: String(u.uniqueId),
  nickname: String(u.nickname),
  avatar: String(u.avatar ?? ''),
});

/** @param {unknown} v @returns {number} entero >= 1 */
const atLeastOne = (v) => {
  const n = Math.floor(Number(v));
  return n >= 1 ? n : 1;
};

/** Usuario simulado a partir de un nombre. El saneado del nombre es del registro (KIT-11), no de aquí. */
export function buildUser(nick) {
  return { userId: `sim_${nick}`, uniqueId: String(nick), nickname: String(nick), avatar: '' };
}

/**
 * @param {SimUser} user
 * @param {SimGift} gift
 * @param {number} [count]
 */
export function buildGift(user, gift, count = 1) {
  const coins = Number(gift.coins);
  return {
    type: /** @type {const} */ ('gift'),
    ...userFields(user),
    giftId: String(gift.id || `sim_${gift.name}`),
    giftName: String(gift.name),
    coins: coins >= 1 ? coins : 1,
    count: atLeastOne(count),
    image: String(gift.image ?? ''),
  };
}

/** @param {SimUser} user @param {string} text */
export function buildChat(user, text) {
  return { type: /** @type {const} */ ('chat'), ...userFields(user), text: String(text ?? '') };
}

/** @param {SimUser} user @param {number} count */
export function buildLike(user, count) {
  return { type: /** @type {const} */ ('like'), ...userFields(user), count: atLeastOne(count) };
}

/** @param {SimUser} user @param {'follow'|'share'} type */
export function buildSocial(user, type) {
  if (type !== 'follow' && type !== 'share') throw new TypeError(`evento social desconocido: "${type}"`);
  return { type, ...userFields(user) };
}

/**
 * Modelo de los controles del panel F1, sacado de la config del juego (nada fijo en el código):
 * - `teams`: un botón por equipo, con su nombre y la palabra para unirse (su primer alias, o su número);
 * - `gifts`: los regalos de `simulator.gifts` más los nombres de `giftOverrides`, de menos a más monedas;
 * - `auto`: los niveles del tráfico automático. No hay botones de voto del chat.
 * @param {{teams?: {id?:string, name?:string, aliases?:string[]}[], giftOverrides?: Record<string, unknown>,
 *   simulator?: {gifts?: SimGift[]}} | undefined} config
 */
export function panelModel(config) {
  const teams = (config?.teams ?? []).map((t, i) => {
    const alias = Array.isArray(t?.aliases) ? t.aliases.find((a) => typeof a === 'string' && a) : undefined;
    return { team: i + 1, label: String(t?.name ?? t?.id ?? i + 1), word: alias ?? String(i + 1) };
  });
  /** @type {Map<string, SimGift>} */
  const gifts = new Map();
  const add = (name, coins, id, autoWeight) => {
    const key = normWord(name);
    if (!key || gifts.has(key)) return;
    const gift = { name: String(name), coins: Number(coins) >= 1 ? Number(coins) : 1, id: id ? String(id) : '' };
    if (Number.isFinite(autoWeight) && autoWeight > 0) gift.autoWeight = autoWeight;
    gifts.set(key, gift);
  };
  for (const g of config?.simulator?.gifts ?? [])
    if (g && typeof g.name === 'string') add(g.name, g.coins, g.id, Number(g.autoWeight));
  // un override sin nombre ("id:5655") solo vale si un regalo del simulador lleva ese id
  for (const name of Object.keys(config?.giftOverrides ?? {})) if (!name.startsWith('id:')) add(name, 1, '');
  const list = [...gifts.values()].sort((a, b) => a.coins - b.coins);
  return { teams, gifts: list, auto: LEVEL_LABELS.map(([id, label]) => ({ id, label })) };
}

/**
 * Cuántos eventos salen en esta vuelta del temporizador: la parte entera de la media y, con la
 * probabilidad de la fracción, uno más. Nivel desconocido o "off": 0.
 * @param {() => number} rng
 * @param {string} level
 */
export function autoCount(rng, level) {
  const mean = AUTO_LEVELS[/** @type {keyof typeof AUTO_LEVELS} */ (level)] ?? 0;
  const whole = Math.floor(mean);
  return whole + (rng() < mean - whole ? 1 : 0);
}

// Reparto de las categorías (acumulado) por nivel: chat, regalo barato, regalo medio, regalo caro, likes, social.
const MIX_DEFAULT = [0.22, 0.55, 0.8, 0.85, 0.93, 1];
const MIX_MAX = [0.05, 0.25, 0.55, 0.9, 0.95, 1];

/**
 * El próximo evento del modo automático, elegido solo con `rng` (repetible con `mulberry32`). Un regalo sale
 * precedido por la unión de esa misma persona a un equipo, como pasa en un LIVE real.
 * @param {() => number} rng
 * @param {AutoConfig | undefined} [cfg]
 * @returns {object[]} uno o dos eventos del contrato
 */
export function pickAuto(rng, cfg) {
  const teams = cfg?.teams ?? [];
  const gifts = [...(cfg?.gifts ?? [])].sort((a, b) => a.coins - b.coins);
  const names = cfg?.names?.length ? cfg.names : DEFAULT_NAMES;
  const mix = cfg?.level === 'max' ? MIX_MAX : MIX_DEFAULT;
  const pickFrom = (list) => list[Math.floor(rng() * list.length)];

  const x = rng();
  let kind = ['chat', 'cheap', 'mid', 'big', 'like', 'social'][mix.findIndex((m) => x < m)];
  const user = buildUser(pickFrom(names));
  const team = teams.length ? pickFrom(teams) : null;
  if (kind === 'chat' && !team) kind = 'like';
  if ((kind === 'cheap' || kind === 'mid' || kind === 'big') && !gifts.length) kind = 'like';

  if (kind === 'chat') return [buildChat(user, team.word)];
  if (kind === 'like') return [buildLike(user, 40 + Math.floor(rng() * 120))];
  if (kind === 'social') return [buildSocial(user, rng() < 0.5 ? 'follow' : 'share')];

  let gift;
  let count = 1;
  if (kind === 'cheap') {
    gift = gifts[0];
    count = 1 + Math.floor(rng() * 6);
  } else if (kind === 'big') {
    // `autoWeight` también reparte entre los dos regalos más caros (solo si alguno lo trae y no es el nivel «max»): un héroe
    // de 3000 monedas sale poco. Sin pesos en ninguno de los dos, es el más caro de siempre y no se gasta ningún azar de más.
    const tops = gifts.slice(-2);
    if (cfg?.level !== 'max' && tops.length === 2 && tops.some((g) => g.autoWeight !== undefined)) {
      const [a, b] = tops.map((g) => g.autoWeight ?? 1);
      gift = rng() * (a + b) < a ? tops[0] : tops[1];
    } else {
      gift = gifts[gifts.length - 1];
    }
  } else if (gifts.length > 2) {
    const medios = gifts.slice(1, -1);
    // `autoWeight` (opcional, 1 por defecto) baja la frecuencia de un regalo en el tráfico automático; los botones manuales
    // no lo usan y el nivel "máximo" tampoco. Sin pesos el reparto es el de siempre (uno por índice).
    const pesos = cfg?.level === 'max' ? null : medios.map((g) => g.autoWeight ?? 1);
    if (pesos === null || pesos.every((p) => p === 1)) {
      gift = medios[Math.floor(rng() * medios.length)];
    } else {
      let r = rng() * pesos.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < medios.length - 1 && r >= pesos[i]) r -= pesos[i++];
      gift = medios[i];
    }
  } else {
    gift = pickFrom(gifts);
  }
  const out = team ? [buildChat(user, team.word)] : [];
  out.push(buildGift(user, gift, count));
  return out;
}
