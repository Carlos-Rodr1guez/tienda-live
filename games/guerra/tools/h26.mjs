// Medición H26 (diseño §14 y §21.1; tareas H26.1 y H26.2). Mide en el sim real cuánto se aparta la regla de contar
// GRUPOS (la anterior a la enmienda v2.5: un grupo de 1 soldado pesaba lo mismo que uno de 10) de la regla de MIEMBROS
// VIVOS, que desde la enmienda v2.5 (CB-21, H26.3) es la que usa el comandante. "Por miembros" sale de los mismos
// helpers del sim (`wL`, `cL`, `scaleL`, `currentQuota`), así el informe mide la regla real; "por grupos" queda como
// la comparación con la regla anterior. Se corre a propósito: `node tools/h26.mjs` (dentro de games/guerra).
//
// Qué se compara, en cada tick del comandante (cada 15 pasos, 2 Hz; Duda 4 del desglose) y por lado:
//  a) la elección: corredor (el de menor costo para un grupo de ataque nuevo) y sector (el de menor costo con puesto
//     alcanzable para la DEFENSA), con el costo por grupos (el actual) y con el costo por miembros vivos;
//  b) la cuota de DEFENSA y la parte de DEFENSA (`D / S`), con `S` y `D` contados por grupos y por miembros vivos;
//  c) el porcentaje de ticks en que la elección difiere (corredor o sector);
//  d) la racha más larga, en segundos de reloj de juego, en que la parte de DEFENSA por miembros se aparta de la
//     cuota en más de 15 puntos.
// Umbrales: la elección difiere en más del 20 % de los ticks, o la racha pasa de 30 s. Si alguno se cumple, hay que
// enmendar la spec (CB-21 fija el peso por grupo) antes de H26.3.
//
// "Por miembros vivos": cada grupo pesa `peso · vivos / tamaño` (un grupo entero pesa lo mismo que antes; uno
// diezmado, proporcionalmente menos), y `S` y `D` suman `vivos / tamaño` en lugar de 1 por grupo. La herramienta trabaja
// en unidades humanas (los L-avos del sim divididos por `L`).
//
// Las rondas salen de logs deterministas que genera esta herramienta con su propio generador sembrado (no el del
// sim, que no tiene azar): 20 rondas de 120 s con pedidos de los dos lados, aviones y golpes de energía que
// dejan muchos grupos diezmados.

import { fileURLToPath } from 'node:url';
import { SIM_HZ } from '../public/js/sim/defaults.js';
import { corridorOf } from '../public/js/sim/field.js';
import { cL, currentQuota, quotaQuarters, reachablePost, scaleL, squadWeight, wL } from '../public/js/sim/commander.js';
import { applyEvent, createWorld, stepWorld } from '../public/js/sim/world.js';

/** Un tick del comandante cada 15 pasos (2 Hz). */
export const COMMANDER_TICK = 15;
/** Umbrales del diseño. */
export const THRESHOLD_DIFF = 0.2;
export const THRESHOLD_POINTS = 15;
export const THRESHOLD_SECONDS = 30;
/** Rondas y duración de la medición. */
export const ROUNDS = 20;
export const ROUND_SECONDS = 120;

const TIE_RANK = [1, 0, 2];
const orderByCost = (costs) => [0, 1, 2].sort((a, b) => costs[a] - costs[b] || TIE_RANK[a] - TIE_RANK[b]);
const live = (sq) => sq.members.length > 0;

// ---------------------------------------------------------------------------------------------------------------
// Pesos: por grupos (el actual) y por miembros vivos

/** Peso por grupos (la regla anterior a la v2.5): 2 para tanques y pesado, 1 para el resto, vivan los que vivan. */
export const weightGroups = (_world, sq) => squadWeight(sq);
/** Peso por miembros vivos (la regla del sim): `wL` del comandante en unidades humanas. */
export const weightMembers = (world, sq) => wL(world.cfg, sq) / scaleL(world.cfg);
/** Cuenta de un grupo para `S` y `D`: 1 por grupo, o la fracción viva (`cL` del comandante en unidades humanas). */
export const countGroups = () => 1;
export const countMembers = (world, sq) => cL(world.cfg, sq) / scaleL(world.cfg);

// ---------------------------------------------------------------------------------------------------------------
// Elección de corredor y de sector (misma regla que `commander.js`, con el peso como parámetro)

/** Costos de corredor para un grupo de ataque nuevo: Σ peso enemigos en la franja + Σ peso propios de ATAQUE ahí. */
export function corridorCosts(world, side, weight) {
  const costs = [0, 0, 0];
  for (const sq of world.squads) {
    if (!live(sq)) continue;
    if (sq.side !== side) costs[corridorOf(world.field, sq.anchor.y)] += weight(world, sq);
    else if (sq.role === 'ataque') costs[sq.corridor] += weight(world, sq);
  }
  return costs;
}

/** Costos de sector para la DEFENSA: Σ peso propios de DEFENSA − Σ peso enemigos en la mitad propia − 1 por torreta caída. */
export function sectorCosts(world, side, weight) {
  const { field } = world;
  const own = field.sides[side];
  const costs = [0, 0, 0];
  for (const sq of world.squads) {
    if (!live(sq)) continue;
    if (sq.side === side) {
      if (sq.role === 'defensa' && sq.sector >= 0) costs[sq.sector] += weight(world, sq);
    } else if ((sq.anchor.x - field.midX) * own.dir < 0) {
      costs[corridorOf(field, sq.anchor.y)] -= weight(world, sq);
    }
  }
  const turrets = world.bases[side].turrets;
  for (let c = 0; c < 3; c++) if (turrets[c].hp <= 0) costs[c] -= 1;
  return costs;
}

/** Corredor elegido (el de menor costo; empate medio > arriba > abajo). */
export const corridorPick = (world, side, weight) => orderByCost(corridorCosts(world, side, weight))[0];

/** Sector elegido para soldados (calle A): el de menor costo con un puesto alcanzable, o -1 si no hay. */
export function sectorPick(world, side, weight) {
  for (const s of orderByCost(sectorCosts(world, side, weight))) {
    if (reachablePost(world, side, s, 'A') >= 0) return s;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Cuota y parte de DEFENSA

/** `H` y `Z` con el peso dado (mismo criterio que `pressure` de commander.js), en unidades humanas. */
export function pressureWeighted(world, side, weight) {
  const { field } = world;
  const own = field.sides[side];
  let H = 0;
  let Z = 0;
  for (const e of world.squads) {
    if (e.side === side || !live(e)) continue;
    const x = e.anchor.x;
    if ((x - field.midX) * own.dir < 0) {
      const w = weight(world, e);
      H += w;
      if (x >= own.defenseZone[0] && x <= own.defenseZone[1]) Z += w;
    }
  }
  return { H, Z };
}

/** `S` (grupos de los dos roles) y `D` (los de DEFENSA) del lado, con la cuenta dada. Cuentan también los que arman. */
export function shareCounts(world, side, count) {
  let S = 0;
  let D = 0;
  for (const sq of world.squads) {
    if (sq.side !== side || !live(sq)) continue;
    const c = count(world, sq);
    S += c;
    if (sq.role === 'defensa') D += c;
  }
  return { S, D };
}

/** Parte de DEFENSA en puntos (0 a 100), o null si el lado no tiene grupos. */
export const sharePoints = (S, D) => (S > 0 ? (100 * D) / S : null);

// ---------------------------------------------------------------------------------------------------------------
// Una muestra por tick y por lado

/**
 * Lo que mide H26 en el estado actual, para un lado.
 * @returns {{S:number, corridorG:number, corridorM:number, sectorG:number, sectorM:number, shareG:number|null,
 *   shareM:number|null, quota:number, quotaM:number, decimated:number, groups:number}}
 */
export function sampleSide(world, side) {
  const bias = world.cfg.commander.bias;
  const pg = pressureWeighted(world, side, weightGroups);
  const g = shareCounts(world, side, countGroups);
  const m = shareCounts(world, side, countMembers);
  let decimated = 0;
  for (const sq of world.squads) {
    if (sq.side === side && live(sq) && sq.members.length * 2 <= world.cfg.squads.size[sq.kind]) decimated++;
  }
  return {
    S: g.S,
    groups: g.S,
    decimated,
    corridorG: corridorPick(world, side, weightGroups),
    corridorM: corridorPick(world, side, weightMembers),
    sectorG: sectorPick(world, side, weightGroups),
    sectorM: sectorPick(world, side, weightMembers),
    shareG: sharePoints(g.S, g.D),
    shareM: sharePoints(m.S, m.D),
    quota: quotaQuarters(pg.H, pg.Z, bias) / 4,
    quotaM: currentQuota(world, side) / (4 * scaleL(world.cfg)),
  };
}

/** ¿La elección difiere? Devuelve si difiere el corredor, el sector y cualquiera de los dos. */
export const choiceDiffers = (s) => ({
  corridor: s.corridorG !== s.corridorM,
  sector: s.sectorG !== s.sectorM,
  any: s.corridorG !== s.corridorM || s.sectorG !== s.sectorM,
});

/**
 * Racha más larga, en segundos de reloj de juego, de ticks seguidos con la bandera encendida. Una muestra nula (null)
 * corta la racha. `tickSeconds` es lo que dura un tick (15 pasos = 0,5 s).
 * @param {(boolean|null)[]} flags
 */
export function longestStreak(flags, tickSeconds) {
  let best = 0;
  let run = 0;
  for (const f of flags) {
    run = f === true ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best * tickSeconds;
}

/** ¿La parte de DEFENSA `share` se aparta de la cuota en más de `points`? Null si el lado no tiene grupos. */
export const deviates = (share, quota, points = THRESHOLD_POINTS) =>
  share === null ? null : Math.abs(share - quota) > points;

// ---------------------------------------------------------------------------------------------------------------
// Rondas grabadas: logs deterministas con un generador sembrado propio (mulberry32)

/** Generador sembrado de la herramienta (el sim no tiene azar y no se toca). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = [
  ['soldado', 0.58, 6, 30],
  ['jeep', 0.2, 2, 12],
  ['tanque', 0.17, 1, 6],
  ['pesado', 0.05, 1, 2],
];

/**
 * Log de una ronda: pedidos de los dos lados, aviones y golpes de energía, a intervalos al azar sembrado. Devuelve
 * `[{step, payload}]` ordenado por paso.
 */
export function generateLog(seed, seconds = ROUND_SECONDS) {
  const rnd = seeded(seed);
  const steps = seconds * SIM_HZ;
  const log = [];
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  for (const team of [1, 2]) {
    for (let t = between(0, 20); t < steps; t += between(30, 110)) {
      let r = rnd();
      let pick = KINDS[0];
      for (const k of KINDS) {
        if (r < k[1]) {
          pick = k;
          break;
        }
        r -= k[1];
      }
      const order = {
        kind: pick[0],
        team,
        owner: null,
        count: between(pick[2], pick[3]),
        unitValue: 0,
        source: 'gift',
      };
      log.push({ step: t, payload: { type: 'order', order } });
    }
    for (let t = between(300, 500); t < steps; t += between(240, 480)) {
      log.push({ step: t, payload: { type: 'launchPlane', side: team - 1 } });
    }
    for (let t = between(400, 700); t < steps; t += between(300, 600)) {
      log.push({ step: t, payload: { type: 'strike', side: team - 1 } });
    }
  }
  log.sort((a, b) => a.step - b.step);
  return log;
}

/** Mundo de medición: fase de batalla y bases que no caen (la ronda dura lo que dura el log). */
export function createMeasureWorld() {
  const w = createWorld({ hq: { hp: 1e12 } }, { phase: 'battle' });
  w.roundStart = 0;
  return w;
}

/**
 * Corre una ronda grabada y devuelve las muestras de cada tick del comandante: `[{step, sides:[muestra, muestra]}]`.
 * El tick se toma ANTES de dar el paso en que el comandante decide (`step % 15 === 0`): es el estado que ve.
 */
export function runRound(log, seconds = ROUND_SECONDS, world = createMeasureWorld()) {
  const steps = seconds * SIM_HZ;
  const ticks = [];
  let i = 0;
  for (let s = 0; s < steps; s++) {
    while (i < log.length && log[i].step <= s) applyEvent(world, log[i++].payload);
    if (world.step % COMMANDER_TICK === 0) {
      ticks.push({ step: world.step, sides: [sampleSide(world, 0), sampleSide(world, 1)] });
    }
    stepWorld(world);
  }
  return ticks;
}

// ---------------------------------------------------------------------------------------------------------------
// Resumen

/**
 * Métricas de una ronda a partir de sus muestras.
 * @param {ReturnType<typeof runRound>} ticks
 */
export function summarizeRound(ticks, tickSeconds = COMMANDER_TICK / SIM_HZ) {
  let n = 0;
  let any = 0;
  let corridor = 0;
  let sector = 0;
  let groups = 0;
  let decimated = 0;
  let worstG = 0;
  const flagsM = [[], []];
  const flagsMq = [[], []];
  const flagsG = [[], []];
  let sumG = 0;
  let sumM = 0;
  let nShare = 0;
  for (const t of ticks) {
    for (let side = 0; side < 2; side++) {
      const s = t.sides[side];
      if (s.groups === 0) {
        flagsM[side].push(null);
        flagsMq[side].push(null);
        flagsG[side].push(null);
        continue;
      }
      n++;
      const d = choiceDiffers(s);
      if (d.any) any++;
      if (d.corridor) corridor++;
      if (d.sector) sector++;
      groups += s.groups;
      decimated += s.decimated;
      flagsM[side].push(deviates(s.shareM, s.quota));
      flagsMq[side].push(deviates(s.shareM, s.quotaM));
      flagsG[side].push(deviates(s.shareG, s.quota));
      worstG = Math.max(worstG, Math.abs(s.shareM - s.quota));
      sumG += Math.abs(s.shareG - s.quota);
      sumM += Math.abs(s.shareM - s.quota);
      nShare++;
    }
  }
  const streak = (f) => Math.max(longestStreak(f[0], tickSeconds), longestStreak(f[1], tickSeconds));
  return {
    samples: n,
    diffAny: n ? any / n : 0,
    diffCorridor: n ? corridor / n : 0,
    diffSector: n ? sector / n : 0,
    avgGroups: n ? groups / n : 0,
    decimatedShare: groups ? decimated / groups : 0,
    streakMembers: streak(flagsM),
    streakMembersVsOwnQuota: streak(flagsMq),
    streakGroups: streak(flagsG),
    maxDevMembers: worstG,
    meanDevGroups: nShare ? sumG / nShare : 0,
    meanDevMembers: nShare ? sumM / nShare : 0,
  };
}

/** Veredicto sobre las rondas. */
export function verdict(rounds) {
  const samples = rounds.reduce((a, r) => a + r.samples, 0);
  const diff = samples ? rounds.reduce((a, r) => a + r.diffAny * r.samples, 0) / samples : 0;
  const streak = Math.max(0, ...rounds.map((r) => r.streakMembers));
  const overDiff = diff > THRESHOLD_DIFF;
  const overStreak = streak > THRESHOLD_SECONDS;
  return { diff, streak, overDiff, overStreak, needsH263: overDiff || overStreak };
}

// ---------------------------------------------------------------------------------------------------------------
// Ejecución

const pct = (x) => `${(100 * x).toFixed(1)} %`;

function main() {
  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    const log = generateLog(1000 + r);
    const m = summarizeRound(runRound(log));
    rounds.push(m);
    console.log(
      `ronda ${String(r + 1).padStart(2)}: ticks ${m.samples} · grupos ${m.avgGroups.toFixed(1)} (diezmados ${pct(m.decimatedShare)})` +
        ` · difiere ${pct(m.diffAny)} (corredor ${pct(m.diffCorridor)}, sector ${pct(m.diffSector)})` +
        ` · racha >15 pts: ${m.streakMembers.toFixed(1)} s (por grupos ${m.streakGroups.toFixed(1)} s)` +
        ` · desvío medio ${m.meanDevMembers.toFixed(1)} (grupos ${m.meanDevGroups.toFixed(1)}), máx ${m.maxDevMembers.toFixed(1)}`,
    );
  }
  const v = verdict(rounds);
  console.log(
    `\nla elección difiere en ${pct(v.diff)} de los ticks (umbral ${pct(THRESHOLD_DIFF)}): ${v.overDiff ? 'SUPERA' : 'no supera'}`,
  );
  console.log(
    `racha más larga de DEFENSA por miembros a > ${THRESHOLD_POINTS} puntos de la cuota: ${v.streak.toFixed(1)} s (umbral ${THRESHOLD_SECONDS} s): ${v.overStreak ? 'SUPERA' : 'no supera'}`,
  );
  console.log(
    v.needsH263
      ? 'VEREDICTO: supera un umbral; H26.3 queda pendiente de la aprobación del dueño y de enmendar la spec.'
      : 'VEREDICTO: no supera ningún umbral; queda como está y H26.3 no se hace.',
  );
  return { rounds, verdict: v };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
