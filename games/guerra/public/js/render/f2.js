// Panel de rendimiento F2 (diseño D21 punto 17; CB-18, CB-13): modelo puro del texto y temporizador por etapa. Es lo
// que el dueño mira para la medición de 5a.10: fps, trabajo por cuadro (sim, mundo, UI) contra el presupuesto de 8 ms,
// entidades, llamadas de dibujo, escala y modo, y el hash de estado del paso actual (con `?golden`, el dorado).

import { S } from '../ui/strings.js';
import { COLORS, fontCss } from '../ui/theme.js';

/** Presupuesto de CB-18: trabajo por cuadro y cuadros por segundo con 400 unidades. */
export const BUDGET = Object.freeze({ workMs: 8, minFps: 50 });

const ETAPAS = ['sim', 'world', 'ui', 'fx'];

/**
 * Temporizador con ventana deslizante y reloj inyectable. No reserva memoria por cuadro.
 * @param {{now?: () => number, window?: number}} [o] `now` en milisegundos
 */
export function createTimer({ now = () => performance.now(), window: size = 60 } = {}) {
  const ring = new Float64Array(size);
  const stages = Object.fromEntries(ETAPAS.map((e) => [e, new Float64Array(size)]));
  const cur = { sim: 0, world: 0, ui: 0, fx: 0 };
  const start = { sim: 0, world: 0, ui: 0, fx: 0 };
  let n = 0;
  let last = -1;
  return {
    /** Al empezar cada cuadro: el intervalo con el anterior da los fps. */
    beginFrame() {
      const t = now();
      if (last >= 0) {
        const i = n % size;
        ring[i] = t - last;
        for (const e of ETAPAS) stages[e][i] = cur[e];
        n++;
      }
      last = t;
      for (const e of ETAPAS) cur[e] = 0;
    },
    begin(stage) {
      start[stage] = now();
    },
    end(stage) {
      cur[stage] += now() - start[stage];
    },
    endFrame() {},
    snapshot() {
      const m = Math.min(n, size);
      if (m === 0) return { fps: 0, ms: { sim: 0, world: 0, ui: 0, fx: 0, work: 0 } };
      let total = 0;
      const ms = { sim: 0, world: 0, ui: 0, fx: 0, work: 0 };
      for (let i = 0; i < m; i++) {
        total += ring[i];
        for (const e of ETAPAS) ms[e] += stages[e][i];
      }
      for (const e of ETAPAS) ms[e] /= m;
      // los efectos se miden DENTRO de la etapa del mundo: se muestran aparte pero no suman al trabajo
      ms.work = ms.sim + ms.world + ms.ui;
      return { fps: total > 0 ? (1000 * m) / total : 0, ms };
    },
  };
}

const f = (n, d) => Number(n).toFixed(d);

/**
 * Modelo de F2: una lista de `{key, label, value}` (texto ya formateado) y el veredicto del presupuesto.
 * @param {{
 *   timer: {snapshot: () => {fps: number, ms: {sim: number, world: number, ui: number, work: number}}},
 *   stats: any, counts: {units: number, squads: number, planes: number, hits: number}, bakeCount: number,
 *   hash: string, golden?: {expected: string, done: boolean, hash: string, step?: number, steps?: number},
 *   camera?: {k: number, kShown: number, text: string, mode: string, idle: number, auto: boolean, tx: number, ty: number},
 *   session?: {key: string, label: string, value: string}[],
 *   fx?: {usage: {particles: number, booms: number, craters: number, wrecks: number},
 *     caps: {particles: number, booms: number, craters: number, wrecks: number}, recentLarge: number}
 * }} i
 */
export function f2Model({ timer, stats, counts, bakeCount, hash, golden, fx, camera, labels, icons, session }) {
  const t = timer.snapshot();
  const lines = [
    { key: 'fps', label: S.f2.fps, value: f(t.fps, 1) },
    { key: 'ms.sim', label: S.f2.msSim, value: f(t.ms.sim, 2) },
    { key: 'ms.world', label: S.f2.msWorld, value: f(t.ms.world, 2) },
    { key: 'ms.ui', label: S.f2.msUi, value: f(t.ms.ui, 2) },
    { key: 'ms.fx', label: S.f2.msFx, value: f(t.ms.fx, 2) },
    { key: 'ms.work', label: S.f2.msWork, value: f(t.ms.work, 2) },
    { key: 'units', label: S.f2.units, value: String(counts.units) },
    { key: 'squads', label: S.f2.squads, value: String(counts.squads) },
    { key: 'planes', label: S.f2.planes, value: String(counts.planes) },
    { key: 'hits', label: S.f2.hits, value: String(counts.hits) },
    { key: 'particles', label: S.f2.particles, value: String(stats.particles) },
    { key: 'drawCalls', label: S.f2.drawCalls, value: String(stats.drawCalls) },
    { key: 'culled', label: S.f2.culled, value: String(stats.culled) },
    { key: 's', label: S.f2.scale, value: f(stats.s, 3) },
    { key: 'mode', label: S.f2.mode, value: stats.mode },
    { key: 'lod', label: S.f2.lod, value: stats.marks ? S.f2.marks : S.f2.sprites },
    { key: 'devicePass', label: S.f2.devicePass, value: stats.devicePass ? S.f2.yes : S.f2.no },
    { key: 'bakeCount', label: S.f2.bakeCount, value: String(bakeCount) },
    { key: 'canvases', label: S.f2.canvases, value: String(stats.canvasesAllocated) },
    { key: 'hash', label: S.f2.hash, value: hash },
  ];
  if (fx) {
    const n = (k) => `${fx.usage[k]}/${fx.caps[k]}`;
    lines.push({ key: 'fx.particles', label: S.f2.fxParticles, value: n('particles') });
    lines.push({ key: 'fx.booms', label: S.f2.fxBooms, value: n('booms') });
    lines.push({ key: 'fx.craters', label: S.f2.fxCraters, value: n('craters') });
    lines.push({ key: 'fx.wrecks', label: S.f2.fxWrecks, value: n('wrecks') });
    lines.push({ key: 'fx.large', label: S.f2.fxLarge, value: String(fx.recentLarge) });
  }
  if (labels) {
    lines.push({
      key: 'labels.drawn',
      label: S.f2.labelsDrawn,
      value: String(labels.drawn),
    });
    lines.push({ key: 'labels.selected', label: S.f2.labelsSelected, value: String(labels.selected ?? 0) });
    lines.push({ key: 'labels.dropped', label: S.f2.labelsDropped, value: String(labels.dropped) });
  }
  if (icons) lines.push({ key: 'icons.drawn', label: S.f2.iconsDrawn, value: String(icons.drawn) });
  // sesión de la transmisión (lote 5e): ya vienen armadas, con sus textos, desde `live-session.js`; sin sesión (?golden) no hay
  if (session) lines.push(...session);
  if (camera) {
    lines.push({
      key: 'cam.k',
      label: S.f2.camK,
      value: `${f(camera.k, 3)} / ${f(camera.kShown, 3)}`,
    });
    lines.push({ key: 'cam.mode', label: S.f2.camMode, value: `${camera.text} · ${camera.mode}` });
    lines.push({ key: 'cam.idle', label: S.f2.camIdle, value: f(camera.idle, 1) });
    lines.push({ key: 'cam.auto', label: S.f2.camAuto, value: camera.auto ? S.f2.on : S.f2.off });
    lines.push({
      key: 'cam.focus',
      label: S.f2.camFocus,
      value: camera.k === 1 ? S.f2.wholeMap : `${Math.round(camera.tx)}, ${Math.round(camera.ty)}`,
    });
  }
  if (golden) {
    lines.push({ key: 'goldenHash', label: S.f2.goldenHash, value: golden.expected });
    lines.push({
      key: 'goldenMatch',
      label: S.f2.goldenMatch,
      value: golden.done
        ? golden.hash === golden.expected
          ? S.f2.matches
          : S.f2.noMatch
        : S.f2.running(golden.step ?? 0, golden.steps ?? 0),
    });
  }
  const fallas = [];
  if (t.ms.work > BUDGET.workMs) fallas.push(S.f2.workOver(f(t.ms.work, 1), BUDGET.workMs));
  if (t.fps > 0 && t.fps < BUDGET.minFps) fallas.push(S.f2.fpsUnder(f(t.fps, 0), BUDGET.minFps));
  return {
    lines,
    budget: { ok: fallas.length === 0, text: fallas.length ? fallas.join(' · ') : S.f2.withinBudget },
  };
}

/**
 * Dibuja el modelo en el canvas principal (espacio de pantalla, texto de canvas: nunca HTML).
 * @param {any} ctx
 * @param {ReturnType<typeof f2Model>} model
 * @param {number} scale px de dispositivo por px de interfaz
 */
export function drawF2(ctx, model, scale = 1) {
  const sz = 12 * scale;
  const pad = 6 * scale;
  const lineH = sz + 3 * scale;
  const w = 290 * scale;
  const h = pad * 2 + lineH * (model.lines.length + 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(11,15,23,0.86)';
  ctx.fillRect(pad, pad, w, h);
  ctx.font = fontCss('mono', sz);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let y = pad * 2;
  ctx.fillStyle = model.budget.ok ? '#2FBF71' : '#E5484D';
  ctx.fillText(model.budget.text, pad * 2, y);
  y += lineH;
  for (const l of model.lines) {
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(l.label, pad * 2, y);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.fillText(l.value, pad + w - pad, y);
    ctx.textAlign = 'left';
    y += lineH;
  }
}
