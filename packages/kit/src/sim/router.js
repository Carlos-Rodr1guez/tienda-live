// Router de regalos (KIT-14 a KIT-18): una función pura de (evento, equipo, dueño, config). No conoce el mundo,
// el reloj ni la vista, y no usa azar. Devuelve órdenes de aparición; quien las ejecuta es el sim del juego.
// No deduplica: confía en que `count` ya es un delta (KIT-2; lo garantiza el normalizador del servidor).

import { ConfigError } from './config.js';
import { normWord } from './words.js';

/**
 * @typedef {{minCoins:number, unit:string, coinsPerUnit:number, maxPerGift:number}} Tier
 * @typedef {{kind:string, team:number, owner:string|null, count:number, unitValue:number,
 *   source:'gift'|'join'|'likes'|'follow'|'share'|'baseline'}} SpawnOrder
 *   `owner` es la clave del usuario; null para dueños que no son usuarios (los refuerzos de "Likes").
 * @typedef {{orders:SpawnOrder[], coins:number, trimmed:number, big:boolean, giftName:string}} GiftRoute
 */

const DEFAULT_MAX_PER_GIFT = 99;
const DEFAULT_MAX_PER_EVENT = 400;

/** @param {unknown} v @returns {number} entero >= 1 */
const atLeastOne = (v) => Math.max(1, Math.floor(Number(v) || 1));

/**
 * Valida y precompila la config del router. Lanza ConfigError si los tiers no ascienden estrictamente, si
 * `coinsPerUnit <= 0` o si un tope no es válido. Un override con unidad desconocida va a `warnings` y se descarta.
 * @param {Record<string, any>} cfg
 * @param {string[]} [unitKinds] unidades del juego; si falta, no se revisan los nombres
 * @returns {{router: object, warnings: string[]}}
 */
export function compileRouter(cfg, unitKinds) {
  const known = unitKinds ? new Set(unitKinds) : null;
  const warnings = [];
  if (!Array.isArray(cfg?.tiers) || cfg.tiers.length === 0)
    throw new ConfigError('tiers: hace falta al menos un nivel');
  /** @type {Tier[]} */
  const tiers = cfg.tiers.map((t, i) => {
    const minCoins = Number(t?.minCoins);
    const coinsPerUnit = Number(t?.coinsPerUnit);
    if (!Number.isFinite(minCoins) || minCoins < 0) throw new ConfigError(`tiers[${i}]: minCoins inválido`);
    if (!(coinsPerUnit > 0) || !Number.isFinite(coinsPerUnit)) {
      throw new ConfigError(`tiers[${i}]: coinsPerUnit debe ser mayor que 0`);
    }
    if (typeof t.unit !== 'string' || !t.unit) throw new ConfigError(`tiers[${i}]: falta la unidad`);
    if (known && !known.has(t.unit)) throw new ConfigError(`tiers[${i}]: unidad "${t.unit}" desconocida`);
    const maxPerGift = t.maxPerGift === undefined ? DEFAULT_MAX_PER_GIFT : Math.floor(Number(t.maxPerGift));
    if (!(maxPerGift >= 1)) throw new ConfigError(`tiers[${i}]: maxPerGift debe ser al menos 1`);
    return { minCoins, unit: t.unit, coinsPerUnit, maxPerGift };
  });
  for (let i = 1; i < tiers.length; i++) {
    if (!(tiers[i].minCoins > tiers[i - 1].minCoins)) {
      throw new ConfigError(`tiers: minCoins ${tiers[i].minCoins} no asciende (nivel ${i})`);
    }
  }

  const maxPerEvent = cfg.maxPerEvent === undefined ? DEFAULT_MAX_PER_EVENT : Math.floor(Number(cfg.maxPerEvent));
  if (!(maxPerEvent >= 1)) throw new ConfigError('maxPerEvent debe ser al menos 1');
  /** @type {Map<string, number>} */
  const eventCaps = new Map();
  for (const [kind, cap] of Object.entries(cfg.eventCaps ?? {})) {
    if (!(Number(cap) >= 1)) throw new ConfigError(`eventCaps.${kind} debe ser al menos 1`);
    eventCaps.set(kind, Math.floor(Number(cap)));
  }

  /** @type {Map<string, {unit:string, count:number}>} */
  const overrides = new Map();
  for (const [name, o] of Object.entries(cfg.giftOverrides ?? {})) {
    if (!o || typeof o.unit !== 'string' || (known && !known.has(o.unit))) {
      warnings.push(`giftOverrides "${name}": unidad "${o?.unit}" desconocida, se ignora`);
      continue;
    }
    const raw = String(name).trim();
    const key = /^id:/i.test(raw) ? 'id:' + raw.slice(3).trim() : normWord(raw);
    if (!key || key === 'id:') {
      warnings.push(`giftOverrides "${name}": nombre vacío, se ignora`);
      continue;
    }
    overrides.set(key, { unit: o.unit, count: atLeastOne(o.count) });
  }

  const router = {
    tiers,
    overrides,
    eventCaps,
    maxPerEvent,
    bigUnits: new Set(cfg.bigUnits ?? []),
    bannerCoins: Number(cfg.bannerCoins) > 0 ? Number(cfg.bannerCoins) : Infinity,
    likes: cfg.likes ?? null,
    follow: cfg.follow ?? null,
    share: cfg.share ?? null,
  };
  return { router, warnings };
}

/**
 * Unidades que da UN regalo de `each` monedas: primero el override (id y luego nombre), después el tier.
 * @returns {{unit:string, perGift:number}}
 */
function unitsFor(evt, each, router) {
  const id = evt.giftId !== undefined && evt.giftId !== null && evt.giftId !== '' ? `id:${evt.giftId}` : null;
  const ov = (id && router.overrides.get(id)) || router.overrides.get(normWord(evt.giftName));
  if (ov) return { unit: ov.unit, perGift: ov.count };
  let tier = router.tiers[0];
  for (const t of router.tiers) if (each >= t.minCoins) tier = t;
  const per = Math.floor(each / tier.coinsPerUnit);
  return { unit: tier.unit, perGift: Math.max(1, Math.min(tier.maxPerGift, per)) };
}

/**
 * Ruta un regalo. `unitValue = pagado / generado`, así que `count x unitValue` es exactamente lo pagado: lo
 * recortado por los topes no se encola y su valor queda en las unidades que sí salen (KIT-17, KIT-18).
 * @param {Record<string, any>} evt evento `gift` ya normalizado (`count` es un delta)
 * @param {number} team 1..N
 * @param {string|null} ownerKey clave del usuario
 * @param {object} router resultado de compileRouter
 * @returns {GiftRoute}
 */
export function routeGift(evt, team, ownerKey, router) {
  const each = Math.max(1, Number(evt?.coins) || 1);
  const count = atLeastOne(evt?.count);
  const paid = each * count;
  const { unit, perGift } = unitsFor(evt ?? {}, each, router);
  const total = perGift * count;
  const spawned = Math.min(total, router.eventCaps.get(unit) ?? Infinity, router.maxPerEvent);
  return {
    orders: [{ kind: unit, team, owner: ownerKey, count: spawned, unitValue: paid / spawned, source: 'gift' }],
    coins: paid,
    trimmed: total - spawned,
    big: router.bigUnits.has(unit) || paid >= router.bannerCoins,
    giftName: String(evt?.giftName || 'Regalo'),
  };
}

/**
 * Orden gratuita (unión, likes, follow, share, refuerzos, energía): nunca lleva valor.
 * @param {string} kind
 * @param {number} team
 * @param {string|null} ownerKey
 * @param {number} count
 * @param {SpawnOrder['source']} source
 * @returns {SpawnOrder}
 */
export function freeOrder(kind, team, ownerKey, count, source) {
  return { kind, team, owner: ownerKey, count, unitValue: 0, source };
}

/**
 * Orden por un follow o un share. Un usuario sin equipo (`team` null) se ignora: no se encola nada.
 * @param {{follow?: any, share?: any}} router
 * @param {'follow'|'share'} type
 * @param {number|null} team
 * @param {string|null} ownerKey
 * @returns {SpawnOrder|null}
 */
export function socialOrder(router, type, team, ownerKey) {
  const c = router[type];
  if (!team || !c || !c.unit || !(c.count > 0)) return null;
  return freeOrder(c.unit, team, ownerKey, Math.floor(c.count), type);
}

/**
 * Una orden de refuerzo por cada `perReinforcement` likes que juntó el equipo. El dueño es "Likes", que no es
 * un usuario: `owner` va en null y `source` es 'likes'.
 * @param {{likes?: any}} router
 * @param {number} team
 * @param {number} reinforcements lo que devolvió counters.addLikes
 * @returns {SpawnOrder[]}
 */
export function likeOrders(router, team, reinforcements) {
  const c = router.likes;
  if (!c || !c.unit || !(c.count > 0)) return [];
  return Array.from({ length: Math.max(0, reinforcements) }, () =>
    freeOrder(c.unit, team, null, Math.floor(c.count), 'likes'),
  );
}
