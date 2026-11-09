// Modelo de vista del HUD (CB-17, diseño §10.1): paneles por equipo, rieles, centro, chips de conexión y puente perdido.
// PURO: lee el partido y el registro y devuelve datos; el dibujo está en `hud-draw.js`. Cuesta O(1) por cuadro: nunca
// recorre a los usuarios (usa `teamSizes()`), así que 5000 donantes cuestan lo mismo que ninguno. El estado de la red
// llega inyectado (`net`): en 6a la página pasa `null` ("sin fuente") y el chip no se muestra; el lote 6b lo conecta.

import { departedCounts } from '../render/icons.js';
import { SIM_HZ } from '../sim/defaults.js';
import { cameraControls } from './layout.js';
import { S } from './strings.js';

/** Estados del partido en los que se ve el HUD de la batalla. */
const HUD_STATES = new Set(['intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd']);
/** Estados en los que el reloj cuenta desde el inicio de la batalla. */
const CLOCK_STATES = new Set(['battle', 'roundEnd', 'waitingNextRound', 'matchEnd']);
/** Cuánto dura el chip "Conectado" en pantalla. */
const CONNECTED_SECONDS = 3;

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** % de la base: hacia arriba (1 HP es 1 %), entre 0 y 100, nunca NaN ni dividir por cero. */
function basePct(b) {
  const max = Number(b?.maxHp);
  const hp = Number(b?.hp);
  if (!(max > 0)) return 0;
  if (Number.isNaN(hp)) return 0;
  return Math.min(100, Math.max(0, Math.ceil((100 * Math.min(hp, max)) / max)));
}

/**
 * Chip de conexión según el estado de la red. `null`/'none' (sin fuente) no muestra nada; "Conectado" se va a los 3 s.
 * @param {{state?: unknown, since?: unknown} | null | undefined} net
 * @returns {{text: string, kind: 'info'|'warn'} | null}
 */
export function netChip(net) {
  switch (net?.state) {
    case 'demo':
      return { text: S.connection.demo, kind: 'info' };
    case 'connecting':
      return { text: S.connection.connecting, kind: 'info' };
    case 'reconnecting':
    case 'lost':
      return { text: S.connection.reconnecting, kind: 'warn' };
    case 'noUser':
      return { text: S.connection.noUser, kind: 'warn' };
    case 'noDeps':
      return { text: S.connection.noConnection, kind: 'warn' };
    case 'connected':
      return Number(net.since) < CONNECTED_SECONDS ? { text: S.connection.connected, kind: 'info' } : null;
    default:
      return null;
  }
}

/** Tropas de tierra en cola de un lado (C21): solo lectura de `world.queues[side].groundUnits`; lo roto vale 0. Los aviones no cuentan. */
function enCola(w, side) {
  const n = Number(w?.queues?.[side]?.groundUnits);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Aviso grande de puente perdido: nombra el problema y la salida. */
export function bridgeAlert(net) {
  if (net?.state === 'lost') return { text: S.errors.bridgeLost };
  if (net?.state === 'noUser') return { text: S.errors.noUser };
  if (net?.state === 'noDeps') return { text: S.errors.noDeps };
  return null;
}

/**
 * @param {{
 *   match: any, registry: any | null, net?: {state?: unknown, since?: unknown} | null,
 *   camera: {mode: string, autoEnabled: boolean, k: number, kShown: number, level: number, levels: number}
 * }} i `registry` es null con `?golden`
 */
export function hudModel({ match, registry, camera, net }) {
  const controls = cameraControls(camera);
  const base = {
    visible: false,
    panels: [],
    rails: [],
    legend: S.legend,
    controls,
    chip: netChip(net),
    alert: bridgeAlert(net),
    noTroops: null,
    center: null,
  };
  if (!match.pair || !HUD_STATES.has(match.state)) return base;

  const w = match.world;
  const cfg = w.cfg.round;
  const total = 2 * cfg.winsToMatch - 1;
  const departed = departedCounts(w);
  const sizes = registry ? registry.teamSizes() : [0, 0];
  const elapsed = CLOCK_STATES.has(match.state) ? Math.max(0, (w.step - w.roundStart) / SIM_HZ) : 0;
  const remaining = Math.max(0, cfg.seconds - elapsed);

  const panels = match.pair.teams.map((team, side) => {
    const pct = basePct(w.bases[side]);
    return {
      side,
      name: team.name,
      color: team.color,
      pct,
      pctText: S.hud.percent(pct),
      wins: match.wins[side],
      dots: Array.from({ length: cfg.winsToMatch }, (_, i) => ({
        filled: i < match.wins[side],
        shape: side === 0 ? 'circle' : 'diamond',
      })),
      departed: departed[side],
    };
  });
  const rails = match.pair.teams.map((team, side) => ({
    side,
    color: team.color,
    joinPrefix: S.hud.joinPrefix(side + 1),
    joinName: team.name,
    members: sizes[side] ?? 0,
    likes: clamp01(w.counters?.likeProgress?.(side + 1)),
    energy: clamp01(w.counters?.energyProgress?.(side + 1)),
    queued: enCola(w, side),
  }));
  return {
    ...base,
    visible: true,
    panels,
    rails,
    noTroops: match.state === 'battle' && w.units.length === 0 ? S.hud.noTroops : null,
    center: {
      clock: S.hud.clock(Math.ceil(remaining)),
      round: S.hud.round(match.round, total),
      status: controls.status,
      autoOn: camera.mode === 'auto',
      paused: match.pause !== null,
    },
  };
}
