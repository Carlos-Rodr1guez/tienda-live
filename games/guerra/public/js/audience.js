// Adaptador del público (lote 6b, diseño §11). Lo que llega de TikTok (por el puente) o del simulador F1 es un evento
// normalizado del kit; el partido solo entiende comandos. Este módulo traduce uno en otro, con la misma forma que arma
// `tools/golden.mjs`: `gift` con `owner`, `coins` y `orders`; `likes` con `team` y `count`; `follow` y `share` con `team` y
// `owner`; `chat` con `evt`.
//
// Es la FRONTERA de confianza: lo que viene del público no es de confianza. Valida tipo y rango de cada campo (monedas y
// cantidades finitas y acotadas, textos con largo máximo), ignora sin lanzar lo desconocido o mal formado, y el texto del
// chat solo viaja dentro del comando `chat` (el partido lo usa para unir a un equipo; nunca se dibuja, NM-11 y KIT-11). Los
// nombres salen siempre saneados por el registro del kit. Sin DOM, sin reloj y sin azar: el reloj y el equipo salen del
// registro y del partido.
//
// `createFlow` agrega lo que necesita la página: los eventos esperan al GET de la sesión (nota 48: se encolan hasta que
// `ready()` y se aplican en orden, sin perder ninguno), y de cada resultado salen los efectos de vista: el regalo grande
// (`rig.bigGift`), el aviso de "máx. por regalo" y el de refuerzos en el feed.

import { ConfigError, deepMerge } from '@tienda/kit/sim/config.js';
import { compileRouter, routeGift } from '@tienda/kit/sim/router.js';
import { DEFAULTS } from './sim/defaults.js';

/** Las unidades que el router conoce: los tipos de tierra del juego y el avión. */
export const UNIT_KINDS = Object.freeze([
  'soldado',
  'francotirador',
  'jeep',
  'blindado',
  'tanque',
  'lanzacohetes',
  'avion',
  'pesado',
  'lobo',
]);

/** Poder de los regalos, proporcional a las monedas (diseño §4). El README explica cómo cambiarlos en `config.json`. */
export const ROUTER_DEFAULTS = Object.freeze({
  tiers: [
    // v2.9: una moneda da 5 soldados (0,2 monedas por soldado; 4 monedas → 20). floor(n / 0,2) es exacto de 1 a 4 monedas y
    // cada soldado vale 0,2: la suma de valor de un regalo sigue siendo igual a sus monedas (crédito, XP, MVP y ranking).
    { minCoins: 1, unit: 'soldado', coinsPerUnit: 0.2, maxPerGift: 20 },
    { minCoins: 5, unit: 'francotirador', coinsPerUnit: 5, maxPerGift: 1 },
    { minCoins: 10, unit: 'jeep', coinsPerUnit: 10, maxPerGift: 2 },
    { minCoins: 30, unit: 'blindado', coinsPerUnit: 30, maxPerGift: 3 },
    { minCoins: 100, unit: 'tanque', coinsPerUnit: 100, maxPerGift: 2 },
    { minCoins: 300, unit: 'lanzacohetes', coinsPerUnit: 300, maxPerGift: 1 },
    { minCoins: 500, unit: 'avion', coinsPerUnit: 500, maxPerGift: 1 },
    { minCoins: 1000, unit: 'pesado', coinsPerUnit: 1000, maxPerGift: 2 },
    { minCoins: 3000, unit: 'lobo', coinsPerUnit: 3000, maxPerGift: 1 },
  ],
  giftOverrides: {},
  // v2.9: con 5 soldados por moneda el tope del evento sube de 40 a 100 (antes 40 monedas de rosas, ahora 20): sin esto,
  // un combo de 9 rosas ya se recortaría. Los demás tipos tienen topes propios mucho menores.
  maxPerEvent: 100,
  // v2.8: un avión por unidad de regalo (un combo ×5 da 5 aviones, que salen de a uno); más de 5 se recorta.
  // v2.8 (precios por monedas de un solo regalo): un regalo único nunca se recorta (`maxPerGift` ≤ tope del evento); los
  // topes cortan solo combos. El lobo es héroe: 2 por evento y, como mucho, 1 vivo por lado (sim/queue.js).
  eventCaps: {
    soldado: 100,
    francotirador: 10,
    jeep: 8,
    blindado: 6,
    tanque: 6,
    lanzacohetes: 3,
    avion: 5,
    pesado: 3,
    lobo: 2,
  },
  bigUnits: ['tanque', 'lanzacohetes', 'avion', 'pesado', 'lobo'],
  bannerCoins: 500,
});

/** Regalos que ofrece el simulador F1 (`config.json → game.simulator.gifts` los reemplaza): uno por cada tramo de los tiers. */
export const SIM_GIFTS = Object.freeze([
  Object.freeze({ name: 'Rose', coins: 1, id: '5655' }),
  Object.freeze({ name: 'Finger Heart', coins: 5 }),
  Object.freeze({ name: '10 monedas', coins: 10 }),
  Object.freeze({ name: 'Doughnut', coins: 30 }),
  Object.freeze({ name: 'Hand Hearts', coins: 100 }),
  // v2.8: los tramos de 300 y 3000 monedas no tienen un regalo cuyo precio esté confirmado: botón por monedas, nombre neutro.
  // Precios de TikTok sin verificar (fuente no oficial): Doughnut 30 y Airplane 500; confirmarlos en el panel de la app.
  Object.freeze({ name: '300 monedas', coins: 300, autoWeight: 0.6 }),
  // el avión pesa 0,2 en el tráfico automático (medio y alto): sigue en el botón manual, pero sale mucho menos
  Object.freeze({ name: 'Airplane', coins: 500, autoWeight: 0.2 }),
  Object.freeze({ name: 'Galaxy', coins: 1000, autoWeight: 0.4 }),
  // v2.9: el héroe SOLO sale por donación (este botón o un regalo real de ≥ 3000 monedas): `auto: false` lo deja fuera del
  // tráfico automático en todos los niveles, incluido el «máximo». El regalo grande del tráfico es Galaxy (1000 → pesados).
  Object.freeze({ name: '3000 monedas', coins: 3000, auto: false }),
]);

/** Las claves de `config.json → game` que mueven el router. */
const ROUTER_KEYS = ['tiers', 'giftOverrides', 'maxPerEvent', 'eventCaps', 'bigUnits', 'bannerCoins'];

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Valida los tipos de lo que consume `compileRouter`: un valor de otro tipo es un error de config, no un TypeError. */
function validarRouter(g) {
  const mal = (k, que) => {
    throw new ConfigError(`${k} debe ser ${que}`);
  };
  if (g?.tiers !== undefined && !Array.isArray(g.tiers)) mal('tiers', 'una lista');
  if (g?.bigUnits !== undefined && (!Array.isArray(g.bigUnits) || g.bigUnits.some((x) => typeof x !== 'string')))
    mal('bigUnits', 'una lista de nombres de unidad');
  if (g?.eventCaps !== undefined && !esObjeto(g.eventCaps)) mal('eventCaps', 'un objeto { unidad: tope }');
  if (g?.giftOverrides !== undefined && !esObjeto(g.giftOverrides)) mal('giftOverrides', 'un objeto');
  for (const k of ['maxPerEvent', 'bannerCoins'])
    if (g?.[k] !== undefined && (typeof g[k] !== 'number' || !Number.isFinite(g[k]))) mal(k, 'un número');
  for (const [n, o] of Object.entries(g?.giftOverrides ?? {}))
    if (!esObjeto(o) || typeof o.unit !== 'string') mal(`giftOverrides.${n}`, 'un objeto con "unit" (texto) y "count"');
}

/**
 * El router del partido, armado UNA vez. Lanza `ConfigError` si la config de los tiers es inválida (el juego la muestra).
 * @param {Record<string, any>} [game] `config.json → game`
 */
export function buildRouter(game = {}) {
  validarRouter(game);
  const over = {};
  for (const k of ROUTER_KEYS) if (game?.[k] !== undefined) over[k] = game[k];
  const social = deepMerge(DEFAULTS.social, game?.social ?? {});
  const cfg = deepMerge(ROUTER_DEFAULTS, over);
  return compileRouter({ ...cfg, likes: social.likes, follow: social.follow, share: social.share }, [...UNIT_KINDS]);
}

// Topes de lo que se acepta del público.
const MAX_ID = 64;
const MAX_NICK = 200;
const MAX_TEXT = 200;
const MAX_GIFT_NAME = 40;
const MAX_AVATAR = 512;
const MAX_COINS = 10_000_000;
const MAX_COUNT = 999;
const MAX_LIKES = 100_000;

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Un valor del público como texto: solo texto o número; todo lo demás (objetos, arreglos, funciones) es vacío y nunca lanza. */
function safeStr(v) {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** Un texto: sin controles ni caracteres de formato (bidi, ancho cero), colapsado, con largo máximo en grafemas. */
function clean(v, max) {
  if (typeof v !== 'string') return '';
  const s = v
    .slice(0, max * 4)
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  if (s.length <= max) return s;
  let out = '';
  let n = 0;
  for (const { segment } of SEGMENTER.segment(s)) {
    if (++n > max) break;
    out += segment;
  }
  return out;
}

/** Entero finito en [lo, hi], o `null` si no es un número finito ≥ 1 (lo enorme se acota, lo inválido se descarta). */
function amount(v, hi, { min = 1 } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) return null;
  return Math.min(hi, Math.floor(v));
}

/** Los campos del usuario que entiende el registro del kit, saneados. */
function who(evt) {
  const userId = clean(safeStr(evt.userId), MAX_ID);
  const uniqueId = clean(safeStr(evt.uniqueId), MAX_ID);
  return {
    userId,
    uniqueId,
    nickname: clean(safeStr(evt.nickname), MAX_NICK),
    avatar: typeof evt.avatar === 'string' && evt.avatar.length <= MAX_AVATAR ? evt.avatar : '',
  };
}

/**
 * @param {{registry: any, router: any}} o `registry` es el del kit; `router`, el de `buildRouter`
 */
export function createAudience({ registry, router }) {
  return {
    /**
     * Un evento normalizado del kit → `{cmd, meta}` o `null` si se ignora. Nunca lanza.
     * @param {unknown} raw
     */
    translate(raw) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const evt = /** @type {Record<string, any>} */ (raw);
      switch (evt.type) {
        case 'chat': {
          const e = { type: 'chat', ...who(evt), text: clean(evt.text, MAX_TEXT) };
          return { cmd: { type: 'chat', evt: e }, meta: { kind: 'chat' } };
        }
        case 'gift': {
          const paid = amount(evt.coins, MAX_COINS);
          if (paid === null) return null;
          let count = amount(evt.count ?? 1, MAX_COUNT) ?? 1;
          // D7: monedas × cantidad no pasa del tope del evento; se recorta la cantidad, no se descarta el regalo
          if (paid * count > MAX_COINS) count = Math.max(1, Math.floor(MAX_COINS / paid));
          const u = registry.touch(who(evt));
          // quien regala sin haberse unido recibe equipo del registro (balance, sin azar)
          const team = registry.ensureTeam(u);
          const giftName = clean(evt.giftName, MAX_GIFT_NAME);
          const route = routeGift({ ...evt, coins: paid, count, giftName }, team, u.key, router);
          return {
            cmd: { type: 'gift', owner: u.key, coins: route.coins, orders: route.orders },
            meta: {
              kind: 'gift',
              owner: u.key,
              team,
              giftName,
              big: route.big,
              trimmed: route.trimmed,
              plane: route.orders.some((o) => o.kind === 'avion'),
              wolf: route.orders.some((o) => o.kind === 'lobo'),
            },
          };
        }
        case 'like': {
          const n = amount(evt.count, MAX_LIKES);
          if (n === null) return null;
          const u = registry.touch(who(evt));
          // likes, follow y share de quien no tiene equipo se ignoran hasta que se une o regala (KIT-9)
          if (u.team === null) return null;
          return {
            cmd: { type: 'likes', team: u.team, count: n },
            meta: { kind: 'likes', team: u.team, per: Math.max(1, Math.floor(Number(router.likes?.count) || 1)) },
          };
        }
        case 'follow':
        case 'share': {
          const u = registry.touch(who(evt));
          if (u.team === null) return null;
          return {
            cmd: { type: evt.type, team: u.team, owner: u.key },
            meta: { kind: evt.type, team: u.team, owner: u.key },
          };
        }
        default:
          return null;
      }
    },
  };
}

/** Eventos que esperan al GET de la sesión: más que esto en espera es un LIVE descontrolado y sale el más viejo. */
export const MAX_QUEUED = 10_000;

/**
 * El flujo del público al partido. `match`: `command`, `world.step`, `world.field.sides` y `pair`; `rig`: `bigGift`;
 * `banners`: `note` (líneas del feed).
 * @param {{audience: ReturnType<typeof createAudience>, match: any, rig: any, banners: any, maxQueued?: number}} o
 */
export function createFlow({ audience, match, rig, banners, maxQueued = MAX_QUEUED }) {
  /** @type {unknown[]} */
  let queue = [];
  let listo = false;
  let perdidos = 0;
  /** El nombre del regalo de cada avión que espera despegar, por dueño (para "envió X: bombardeo"). */
  const aviones = new Map();

  const equipo = (team) => String(match.pair?.teams?.[team - 1]?.name ?? '');

  function efectos(r, res) {
    const m = r.meta;
    if (m.kind === 'gift') {
      if (m.plane) {
        aviones.set(m.owner, m.giftName);
        if (aviones.size > 64) aviones.delete(aviones.keys().next().value);
      } else if (m.big) {
        const w = match.world;
        const lado = w?.field?.sides?.[m.team - 1];
        rig.bigGift(
          {
            coins: r.cmd.coins,
            big: true,
            giftName: m.giftName,
            hero: m.wolf ? 'lobo' : undefined,
            owner: m.owner,
            x: lado?.exitX ?? 720,
            y: lado?.door?.y ?? 405,
          },
          w?.step ?? 0,
        );
      }
      if (m.trimmed > 0) banners.note({ kind: 'trim', key: m.owner, team: m.team, teamName: equipo(m.team) });
    } else if (m.kind === 'likes' && Number(res?.orders) > 0) {
      banners.note({ kind: 'reinforce', key: null, team: m.team, teamName: equipo(m.team), count: res.orders * m.per });
    }
  }

  function aplicar(raw) {
    // un evento que lanza (dato raro del público) se pierde solo a él: ni los demás ni el arranque lo notan
    try {
      const r = audience.translate(raw);
      if (r === null) return;
      efectos(r, match.command(r.cmd));
    } catch {
      perdidos++;
    }
  }

  return {
    /** Un evento del público: se aplica al llegar, o espera si la sesión todavía no resolvió. */
    push(raw) {
      if (!listo) {
        queue.push(raw);
        if (queue.length > maxQueued) {
          queue.shift();
          perdidos++;
        }
        return;
      }
      aplicar(raw);
    },
    /** La sesión resolvió (con copia, vacía o con error): se aplica lo que esperaba, en orden. */
    ready() {
      if (listo) return;
      listo = true;
      const espera = queue;
      queue = [];
      for (const raw of espera) aplicar(raw);
    },
    pending: () => queue.length,
    dropped: () => perdidos,
    /** Los banners de avión sin nombre de regalo lo reciben del regalo que lo pagó (una sola vez). */
    nameBanners(items) {
      for (const it of items) {
        if (
          it?.kind === 'plane' &&
          typeof it.owner === 'string' &&
          it.giftName === undefined &&
          aviones.has(it.owner)
        ) {
          it.giftName = aviones.get(it.owner);
          aviones.delete(it.owner);
        }
      }
      return items;
    },
  };
}
