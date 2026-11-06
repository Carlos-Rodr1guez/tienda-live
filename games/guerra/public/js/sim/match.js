// Partido al mejor de 3 (diseño D20, CB-5, CB-6, NM-1, NM-2, NM-9). Máquina de estados sobre el mundo del sim:
//
//   matchup -pickPair-> lobby -startMatch-> intro -> battle -> roundEnd -> waitingNextRound -startRound-> intro -> ...
//   battle -ronda decisiva-> matchEnd -endMatch-> matchup        (endMatch aborta desde cualquier estado)
//
// Nada avanza solo (NM-1): la intro corre sola hasta la batalla porque ya se pidió, pero después de cada ronda y del
// partido el juego espera al narrador. El sim acepta exactamente 7 comandos del narrador; cualquier otro, y todo lo
// de vista (cámara, marcador, ocultar...), devuelve `{ok:false}` sin cambiar el estado (NM-2). Además recibe los
// eventos de la audiencia (`gift`, `order`, `chat`, `likes`, `follow`, `share`, `strike`), que son los de un log.
// Sin azar y sin reloj de pared: `tick` es el reloj del log (un tick por llamada a `step`, también en pausa).

import { retireQueues, retireRound } from './credit.js';
import { SIM_HZ } from './defaults.js';
import { describePair } from './matchup.js';
import { applyEvent, createWorld, resetRound, stepWorld } from './world.js';

/** Comandos del narrador (NM-2 v2.3). */
export const NARRATOR_COMMANDS = Object.freeze([
  'pickPair',
  'startMatch',
  'startRound',
  'pause',
  'resume',
  'endMatch',
  'newLive',
]);

/** Eventos de la audiencia que el partido pasa al mundo. En `matchup` solo vale el regalo (suma monedas y XP). */
const AUDIENCE = new Set(['gift', 'order', 'chat', 'likes', 'follow', 'share', 'strike']);
/** Estados con partido en marcha en los que se puede pausar (de la sala hasta la espera de la ronda siguiente). */
const PAUSABLE = new Set(['lobby', 'intro', 'battle', 'roundEnd', 'waitingNextRound']);

const no = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * Desempate de una ronda (CB-5). Pura: lee el mundo y no lo cambia. La base que cayó pierde; si ninguna cayó, gana
 * la de más HP en porcentaje; con porcentajes iguales, o si cayeron las dos en el mismo paso, decide esta cadena:
 * 1. más daño efectivo a la base enemiga y a sus torretas; 2. más valor destruido; 3. más monedas pagadas; 4. más
 * miembros con bando; 5. el equipo cuyo primer miembro se unió antes; 6. el equipo izquierdo. Nunca hay azar.
 * @param {any} world
 * @param {{sizes: number[], firstJoin: (number|null)[]}} ctx miembros por lado y orden de llegada del primero
 * @returns {{winner: 0|1, reason: string}}
 */
export function decideRound(world, { sizes, firstJoin }) {
  const [a, b] = world.bases;
  const fallA = a.hp <= 0;
  const fallB = b.hp <= 0;
  if (fallA !== fallB) return { winner: fallA ? 1 : 0, reason: 'base' };
  if (!fallA) {
    const pa = a.hp / a.maxHp;
    const pb = b.hp / b.maxHp;
    if (pa !== pb) return { winner: pa > pb ? 0 : 1, reason: 'hp' };
  }
  const by = (x, y, reason) => (x === y ? null : { winner: x > y ? 0 : 1, reason });
  const [t0, t1] = world.teams;
  const c = world.credit;
  const early = (x, y) => (x === null ? (y === null ? 0 : 1) : y === null ? -1 : x < y ? -1 : x > y ? 1 : 0);
  const joined = early(firstJoin[0], firstJoin[1]);
  return (
    by(t0.structDamage, t1.structDamage, 'damage') ??
    by(c.teamValue[0], c.teamValue[1], 'value') ??
    by(c.teamCoins[0], c.teamCoins[1], 'coins') ??
    by(sizes[0], sizes[1], 'members') ??
    (joined !== 0 ? { winner: joined < 0 ? 0 : 1, reason: 'joined' } : { winner: 0, reason: 'left' })
  );
}

/**
 * Crea el partido. Empieza en `matchup`.
 * @param {{paises: readonly any[], game?: object, registry?: any}} o `paises`: la lista curada (datos);
 *   `game`: sección `game` de la config; `registry`: el del kit (si falta, no hay uniones ni XP)
 */
export function createMatch({ paises, game = {}, registry = null }) {
  const newWorld = (phase) => createWorld(game, { registry, phase });
  const m = {
    paises,
    game,
    registry,
    state: 'matchup',
    pair: null,
    world: newWorld('matchup'),
    wins: [0, 0],
    /** Ronda en juego (o la que acaba de terminar). */
    round: 1,
    /** `{round, winner, reason, step}` de cada ronda terminada. */
    results: [],
    winner: null,
    /** `null`, `'presence'` o `'manual'` (NM-9). */
    pause: null,
    /** Reloj del log: un tick por `step`, también en pausa y en las pantallas. */
    tick: 0,
    /** Pasos de reloj de la intro o de los resultados que se están contando. */
    stateSteps: 0,
    /** Orden de llegada de los `join` del partido y el del primero de cada lado (CB-5, paso 5). */
    joinSeq: 0,
    firstJoin: [null, null],
    command: (p) => command(m, p),
    step: () => step(m),
  };
  m.newWorld = newWorld;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Comandos

function command(m, p) {
  const type = p !== null && typeof p === 'object' ? p.type : undefined;
  if (typeof type !== 'string') return no('unknown');
  switch (type) {
    case 'pickPair':
      return pickPair(m, p);
    case 'startMatch':
      return startMatch(m);
    case 'startRound':
      return startRound(m);
    case 'pause':
      return pause(m, p);
    case 'resume':
      return resume(m, p);
    case 'endMatch':
      return endMatch(m);
    case 'newLive':
      return newLive(m, p);
    default:
      break;
  }
  // todo lo demás (`spawn`, `damage`, `setScore`, `setRole`, `assignSquad`, `vote`, el andamiaje del sim y los
  // comandos de vista) no existe para el sim
  if (!AUDIENCE.has(type)) return no('unknown');
  if (m.state === 'matchup' && type !== 'gift') return no('matchup');
  const r = applyEvent(m.world, p);
  syncRegistry(m);
  return r;
}

const defOf = (pais) => ({
  id: pais.id,
  name: pais.name,
  iso: pais.iso,
  aliases: pais.aliases,
  firstOnly: pais.firstOnly,
});

function pickPair(m, p) {
  if (m.state !== 'matchup' && m.state !== 'lobby') return no('state');
  const r = describePair(m.paises, p.a, p.b);
  if (!r.ok) return no('pair', { error: r.error });
  if (m.registry) {
    try {
      m.registry.setTeams([p.a, p.b].map((id) => defOf(m.paises.find((c) => c.id === id))));
    } catch (e) {
      return no('teams', { error: e instanceof Error ? e.message : String(e) });
    }
  }
  m.pair = { teams: r.teams };
  m.world = m.newWorld('lobby');
  m.state = 'lobby';
  m.wins = [0, 0];
  m.round = 1;
  m.results = [];
  m.winner = null;
  m.pause = null;
  m.stateSteps = 0;
  m.joinSeq = 0;
  m.firstJoin = [null, null];
  m.world.drain();
  return { ok: true, teams: r.teams };
}

function startMatch(m) {
  if (m.state !== 'lobby') return no('state');
  m.registry?.startMatch();
  m.wins = [0, 0];
  m.round = 1;
  m.world.round = 1;
  m.results = [];
  m.winner = null;
  m.state = 'intro';
  m.stateSteps = 0;
  return { ok: true };
}

function startRound(m) {
  if (m.state !== 'waitingNextRound') return no('state');
  resetRound(m.world);
  m.registry?.startRound();
  m.round++;
  m.world.round = m.round;
  m.state = 'intro';
  m.stateSteps = 0;
  return { ok: true, round: m.round };
}

function pause(m, p) {
  if (!PAUSABLE.has(m.state)) return no('state');
  const by = p.by === 'presence' ? 'presence' : 'manual';
  // una pausa manual solo la levanta `resume`: la guardia no la cambia; una de presencia sí pasa a manual
  if (m.pause === 'manual' || (m.pause === 'presence' && by === 'presence')) return no('already');
  m.pause = by;
  m.world.paused = true;
  m.world.emit({ type: 'pause', by });
  return { ok: true, by };
}

function resume(m, p) {
  if (m.pause === null) return no('notPaused');
  const by = p.by === 'presence' ? 'presence' : 'manual';
  if (m.pause === 'manual' && by === 'presence') return no('manual');
  m.pause = null;
  m.world.paused = false;
  m.world.emit({ type: 'resume', by });
  return { ok: true };
}

function endMatch(m) {
  if (m.state === 'matchup') return no('state');
  const aborted = m.state !== 'matchEnd';
  retireRound(m.world);
  retireQueues(m.world);
  m.state = 'matchup';
  m.pair = null;
  m.pause = null;
  m.stateSteps = 0;
  m.world = m.newWorld('matchup');
  return { ok: true, aborted };
}

function newLive(m, p) {
  if (m.state !== 'matchup' || p.confirmed !== true) return no('state');
  m.registry?.resetLive();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Paso

/**
 * El registro es la fuente de los `join` y los `rankUp`: se vacía con `drain()` (un solo camino) y pasan a la bandeja
 * del mundo, que es la que lee la vista. De los `join` se anota solo el orden de llegada (CB-5, paso 5): las unidades
 * del soldado gratis salen de `submitChat`, no de aquí.
 */
function syncRegistry(m) {
  const reg = m.registry;
  if (!reg) return;
  for (const e of reg.drain()) {
    if (e.type === 'join') {
      const side = e.team - 1;
      if (m.firstJoin[side] === null) m.firstJoin[side] = m.joinSeq;
      m.joinSeq++;
    }
    m.world.emit(e);
  }
}

function enterBattle(m) {
  m.state = 'battle';
  m.world.phase = 'battle';
  m.world.roundStart = m.world.step;
  m.stateSteps = 0;
}

function finishRound(m, timeout) {
  const w = m.world;
  const decision = decideRound(w, {
    sizes: m.registry ? m.registry.teamSizes() : [0, 0],
    firstJoin: m.firstJoin,
  });
  if (w.over === null) w.over = { step: w.step, winner: decision.winner, both: false, timeout };
  retireRound(w);
  w.phase = 'lobby';
  m.wins[decision.winner]++;
  const result = { round: m.round, winner: decision.winner, reason: decision.reason, step: w.step - w.roundStart };
  m.results.push(result);
  w.emit({ type: 'roundEnd', ...result });
  m.stateSteps = 0;
  if (m.wins[decision.winner] >= w.cfg.round.winsToMatch) {
    // la ronda decisiva cierra el partido en este mismo paso; las colas que sobran pasan a retirado
    m.state = 'matchEnd';
    m.winner = decision.winner;
    retireQueues(w);
    w.emit({ type: 'matchEnd', winner: decision.winner, wins: [...m.wins] });
  } else {
    m.state = 'roundEnd';
    // lo que llegue ahora (la unión da un soldado por usuario y ronda) cuenta para la ronda que viene
    w.round = m.round + 1;
  }
}

function step(m) {
  m.tick++;
  if (m.pause === null) {
    const w = m.world;
    const cfg = w.cfg.round;
    switch (m.state) {
      case 'intro':
        if (++m.stateSteps >= Math.round(cfg.introSeconds * SIM_HZ)) enterBattle(m);
        break;
      case 'battle': {
        stepWorld(w);
        const timeout = w.over === null && w.step - w.roundStart >= Math.round(cfg.seconds * SIM_HZ);
        if (w.over !== null || timeout) finishRound(m, timeout);
        break;
      }
      case 'roundEnd':
        // la pantalla de resultados es solo vista: pasado su tiempo se espera al narrador, nada arranca solo
        if (++m.stateSteps >= Math.round(cfg.resultsSeconds * SIM_HZ)) m.state = 'waitingNextRound';
        break;
      default:
        break;
    }
  }
  syncRegistry(m);
}
