// Banners y feed (CB-17, KIT-23, NM-5, CB-20; diseño §10.3). Dos cosas hechas de los mismos eventos:
//   - el FEED de la banda inferior: todo ascenso y toda unión, las últimas líneas, nunca texto del chat ni avatares;
//   - los BANNERS: los ascensos desde Sargento, y los de regalo grande y avión que trae la cámara
//     (`rig.moments.drainBanners()`), en una cola sin pérdidas con un ritmo máximo (1 cada 1,5 s; 0,9 s con más de 5 en
//     espera). El nombre se resuelve al MOSTRARSE (un donante ocultado antes sale "anónimo" con el rango nuevo).
//
// Animación: una sola por elemento, solo opacidad y transform, con ease-out y menos de 300 ms. El banner frecuente
// (ascenso) solo cambia la opacidad: entrada 160 ms, salida 120 ms. El raro (regalo grande, avión) entra con 12 px de
// desplazamiento en 220 ms y sale en 160 ms; Coronel y General escalan 0,96 → 1 en 240 ms. Con movimiento reducido todo
// es opacidad (los raros en ≤ 150 ms). El módulo es puro: el reloj de vista llega por argumento.

import { DEFAULT_LADDER } from '@tienda/kit/sim/ranks.js';
import { S } from './strings.js';

export const BANNER_DEFAULTS = Object.freeze({
  fromRank: 'sargento',
  gapSeconds: 1.5,
  fastGapSeconds: 0.9,
  fastAfter: 5,
  feedLines: 4,
  /** Cuánto se queda en pantalla un banner raro (regalo grande, avión). */
  rareSeconds: 2.4,
});

/** Tope de la cola (10 000 banners son horas de espera: en la práctica, "sin límite"). */
const QUEUE_CAP = 10_000;
/** Escala de entrada de Coronel y General. */
const POP_FROM = 0.96;
const SLIDE_PX = 12;

const easeOut = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3;
const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const clamp = (v, lo, hi, dflt) => Math.min(hi, Math.max(lo, num(v, dflt)));

/** Config resuelta con recortes. */
export function resolveBanners(cfg) {
  const d = BANNER_DEFAULTS;
  return {
    fromRank: typeof cfg?.fromRank === 'string' ? cfg.fromRank : d.fromRank,
    gapSeconds: clamp(cfg?.gapSeconds, 0.3, 10, d.gapSeconds),
    fastGapSeconds: clamp(cfg?.fastGapSeconds, 0.3, 10, d.fastGapSeconds),
    fastAfter: Math.floor(clamp(cfg?.fastAfter, 0, 1000, d.fastAfter)),
    feedLines: Math.floor(clamp(cfg?.feedLines, 1, 8, d.feedLines)),
    rareSeconds: clamp(cfg?.rareSeconds, 0.5, 10, d.rareSeconds),
  };
}

/**
 * @param {{registry: {displayName: (k: string) => string, version?: () => number} | null, ladder?: readonly {id: string, label: string}[],
 *   cfg?: object}} o
 */
export function createBanners({ registry, ladder = DEFAULT_LADDER, cfg }) {
  const conf = resolveBanners(cfg);
  const desde = Math.max(
    0,
    ladder.findIndex((r) => r.id === conf.fromRank),
  );
  const nombre = (key) => String(registry?.displayName(key) ?? S.anon);
  const rango = (i) => ladder[Math.min(ladder.length - 1, Math.max(0, Math.trunc(Number(i)) || 0))].label;

  /** @type {any[]} */
  const queue = [];
  /** @type {{kind: string, key: string | null, to?: number, team?: number | null, teamName?: string, count?: number}[]} */
  const feed = [];
  let nextId = 1;
  let current = /** @type {any} */ (null);
  /** Instante en que podría empezar el siguiente. */
  let readyAt = -Infinity;
  /** D13: con un panel abierto los banners esperan; `desfase` es el tiempo que pasaron esperando (no cuenta para ningún banner). */
  let retenido = /** @type {number | null} */ (null);
  let desfase = 0;
  const view = { id: 0, kind: '', text: '', team: null, alpha: 0, dy: 0, scale: 1, rare: false };

  function pushFeed(item) {
    feed.push(item);
    if (feed.length > conf.feedLines) feed.shift();
  }

  /** Texto de una línea del feed, resuelto ahora (así un ocultamiento posterior también enmascara). */
  const feedText = (f) => {
    if (f.kind === 'join') return S.feed.join(nombre(f.key), f.teamName ?? '');
    if (f.kind === 'trim') return S.feed.maxPerGift(nombre(f.key));
    if (f.kind === 'reinforce') return S.feed.reinforcements(f.teamName ?? '', f.count);
    if (f.kind === 'wolf') return S.feed.wolfConverted(nombre(f.key), f.count);
    return S.banners.rankUp(nombre(f.key), rango(f.to));
  };

  function textOf(b) {
    if (b.kind === 'rank') return S.banners.rankUp(nombre(b.key), rango(b.to));
    if (b.kind === 'wolf') return S.banners.wolf(nombre(b.key));
    if (b.kind === 'plane')
      return b.giftName ? S.banners.plane(nombre(b.key), b.giftName) : S.banners.planeNoGift(nombre(b.key));
    return b.giftName ? S.banners.gift(nombre(b.key), b.giftName) : S.banners.giftNoName(nombre(b.key));
  }

  function enqueue(b) {
    if (queue.length >= QUEUE_CAP) queue.shift();
    queue.push({ id: nextId++, ...b });
  }

  /** Duraciones de entrada y salida y desplazamiento, por tipo y movimiento reducido. */
  function timing(b, reduced, slide) {
    // el desplazamiento lo decide `motion.politica.bannerSlide`; sin él la entrada de 220 ms es solo opacidad
    if (b.rare)
      return reduced ? { inn: 0.12, out: 0.12, slide: 0 } : { inn: 0.22, out: 0.16, slide: slide ? SLIDE_PX : 0 };
    const pop = b.to >= 7 && !reduced; // Coronel y General
    return { inn: pop ? 0.24 : 0.16, out: 0.12, slide: 0, pop };
  }

  return {
    /**
     * Eventos de UN paso (lo que devolvió `world.drain()`): `rankUp` y `join`. Todo ascenso va al feed; los de Sargento
     * para arriba además hacen cola de banners. Cualquier otra cosa se ignora.
     * @param {any[]} events
     * @param {(team: number) => string} [teamNameOf]
     */
    consume(events, teamNameOf) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e === null || typeof e !== 'object') continue;
        if (e.type === 'rankUp' && typeof e.key === 'string' && Number.isFinite(e.to)) {
          pushFeed({ kind: 'rank', key: e.key, to: e.to, team: e.team ?? null });
          if (e.to >= desde) enqueue({ kind: 'rank', key: e.key, to: e.to, team: e.team ?? null, rare: false });
        } else if (e.type === 'loboConverted') {
          // v2.8: el lobo que sobraba se volvió pesados; el feed lo cuenta con el nombre del dueño
          pushFeed({
            kind: 'wolf',
            key: typeof e.owner === 'string' ? e.owner : null,
            team: e.side + 1,
            count: e.pesados,
          });
        } else if (e.type === 'join' && typeof e.key === 'string') {
          // sin par elegido (selector) no hay país que nombrar: esa unión no deja línea ("se unió a ..." sin país)
          const teamName = String(teamNameOf?.(e.team) ?? '');
          if (teamName !== '') pushFeed({ kind: 'join', key: e.key, team: e.team ?? null, teamName });
        }
      }
    },
    /**
     * Una línea del feed que no sale del registro: la del adaptador del público (lote 6b). `trim`: un regalo pasó el tope de
     * unidades por regalo ("máx. por regalo"); `reinforce`: los likes de un equipo juntaron refuerzos.
     * @param {{kind: 'trim' | 'reinforce', key?: string | null, team?: number | null, teamName?: string, count?: number}} n
     */
    note(n) {
      if (n === null || typeof n !== 'object' || (n.kind !== 'trim' && n.kind !== 'reinforce')) return;
      pushFeed({
        kind: n.kind,
        key: typeof n.key === 'string' ? n.key : null,
        team: n.team ?? null,
        teamName: String(n.teamName ?? ''),
        count: n.count,
      });
    },
    /**
     * Los momentos de la cámara (`rig.moments.drainBanners()`): regalo grande y avión. El nombre del regalo es opcional
     * (el adaptador del público lo trae en 6b); sin él, el avión dice "lanzó un bombardeo".
     * @param {{kind?: string, owner?: string | null, giftName?: string, coins?: number}[]} items
     */
    gift(items) {
      for (const g of items) {
        if (g === null || typeof g !== 'object') continue;
        enqueue({
          kind: g.kind === 'plane' ? 'plane' : g.kind === 'wolf' ? 'wolf' : 'gift',
          key: typeof g.owner === 'string' ? g.owner : null,
          giftName: typeof g.giftName === 'string' ? g.giftName : '',
          team: null,
          rare: true,
        });
      }
    },
    /**
     * Avanza el reloj de vista. Un banner nuevo empieza cuando termina el anterior y se cumple el ritmo.
     * @param {number} now segundos
     * @param {boolean} reduced movimiento reducido
     * @param {boolean} [slide] `motion.politica.bannerSlide`: si el banner raro se desliza (por defecto, si no hay reducido)
     */
    update(now, reduced, slideOk = !reduced, hold = false) {
      // con H, G o T abiertas (D13) no se dibuja ni corre el tiempo: ni el del banner a la vista ni el de la cola; al cerrar
      // el panel todo sigue donde estaba, y nada se pierde (los eventos siguen entrando a la cola)
      if (hold) {
        retenido ??= now;
        return;
      }
      if (retenido !== null) {
        desfase += now - retenido;
        retenido = null;
      }
      now -= desfase;
      if (current !== null && now >= current.end) current = null;
      if (current === null && queue.length > 0 && now >= readyAt - 1e-9) {
        const b = queue.shift();
        const rapido = queue.length > conf.fastAfter;
        const gap = rapido ? conf.fastGapSeconds : conf.gapSeconds;
        const dur = b.rare ? conf.rareSeconds : gap;
        current = {
          ...b,
          start: now,
          end: now + dur,
          text: textOf(b),
          version: registry?.version?.() ?? 0,
          tm: timing(b, reduced, slideOk),
        };
        readyAt = now + gap;
      }
      if (current === null) return;
      // el nombre se vuelve a resolver si cambió el registro (`N`, ocultar a un donante): un banner en pantalla también enmascara
      const version = registry?.version?.() ?? 0;
      if (version !== current.version) {
        current.version = version;
        current.text = textOf(current);
      }
      const t = now - current.start;
      const { inn, out, slide, pop } = current.tm;
      const left = current.end - now;
      const entrada = easeOut(t / inn);
      const salida = left < out ? easeOut(1 - left / out) : 0;
      view.id = current.id;
      view.kind = current.kind;
      view.text = current.text;
      view.team = current.team;
      view.rare = current.rare;
      view.alpha = Math.max(0, Math.min(1, entrada * (1 - salida)));
      view.dy = slide > 0 ? Math.round(slide * (1 - entrada) * 100) / 100 : 0;
      view.scale = pop ? Math.round((POP_FROM + (1 - POP_FROM) * entrada) * 10000) / 10000 : 1;
    },
    /** El banner en pantalla ahora (un objeto reutilizado) o null. */
    current() {
      return current === null || retenido !== null ? null : view;
    },
    /** Banners en espera. */
    pending: () => queue.length,
    /** Las últimas líneas del feed, de la más vieja a la más nueva, con el nombre resuelto ahora. */
    feed() {
      return feed.map((f) => ({ text: feedText(f), team: f.team, kind: f.kind }));
    },
    reset() {
      queue.length = 0;
      feed.length = 0;
      current = null;
      readyAt = -Infinity;
      retenido = null;
      desfase = 0;
    },
  };
}
