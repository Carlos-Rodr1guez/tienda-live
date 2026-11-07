// Arranque y bucle de la vista de Batalla (lote 5a). Une el partido del sim con el render de Canvas 2D:
//   - el bucle da pasos de 30 Hz con `advance` (≤ 3 por cuadro) y dibuja con interpolación;
//   - la vista solo LEE el mundo y vacía su bandeja con `world.drain()` (nunca `registry.drain()`);
//   - F2 muestra rendimiento y el hash de estado; con `?golden` corre el log dorado y lo compara (CB-13 [M]).
//
// Provisional hasta los lotes 5c y 6: sin cámara del narrador (el mundo entero, o `?k=` para acercar y las flechas para
// moverse), sin HUD, pantallas ni atajos del narrador (solo Enter, P y F2), y sin conexión del público (eso es el
// cableado final). Parámetros de la URL: `?golden` (hash dorado), `?pair=PE-MX` (el par), `?carga` (400 unidades),
// `?k=2.25` (acercar), `?devicePass=0` (volver a LOW) y `?lod=0` (sin marcas). Solo para mirar los efectos (lote 5b):
// `?cx=100&cy=448` (centro inicial de la vista, en px de mundo) y `?rapido=4` (da 4 pasos del sim por cuadro en vez
// de 1: no cambia ninguna regla, solo acorta la espera). Con `?golden&rapido=4` el partido dorado se ve a 4 pasos por
// cuadro en vez de los 500 de la comprobación del hash (cae una base a los ~18 s).

import { createRegistry } from '@tienda/kit/sim/registry.js';
import { seedFrom } from '@tienda/kit/sim/rng.js';
import { GOLDEN } from './data/golden.js';
import { PAISES } from './data/paises.js';
import { SPRITES } from './data/sprites.js';
import { createGoldenRun } from './golden-run.js';
import { createLoop } from './loop.js';
import { createBaseLayer } from './render/bases.js';
import { drawF2, createTimer, f2Model } from './render/f2.js';
import { createFx, FX_CAPS } from './render/fx.js';
import { createRenderer } from './render/frame.js';
import { resolveLod } from './render/lod.js';
import { createMotion, MOTION_MEDIA, MOTION_NOTICE } from './render/motion.js';
import { createScene } from './render/scene.js';
import { createSpriteBank } from './render/sprites.js';
import { createTerrain } from './render/terrain.js';
import { createEntityLayer } from './render/units.js';
import { hashMatch } from './sim/hash.js';
import { createMatch } from './sim/match.js';

const params = new URLSearchParams(location.search);
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const createCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Config del juego: la del servidor si está (`/api/config`), y si no, la de fábrica. */
async function cargarConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return {};
    const cfg = await res.json();
    return cfg.game ?? {};
  } catch {
    return {};
  }
}

const game = await cargarConfig();
const render = game.render ?? {};
// Movimiento reducido (CB-20): 'auto' sigue al sistema, true lo fuerza, false lo ignora; `R` lo alterna (provisional).
const sistema = matchMedia(MOTION_MEDIA);
const motion = createMotion({ graphics: game.graphics, systemReduced: sistema.matches });
sistema.addEventListener('change', (e) => motion.setSystem(e.matches));

// ---------------------------------------------------------------------------------------------------------------
// Partido: el normal o la corrida del hash dorado

const golden = params.has('golden')
  ? createGoldenRun({ log: GOLDEN.log, steps: GOLDEN.steps, paises: PAISES, game: GOLDEN.game, onStep })
  : null;
const registry = golden ? null : createRegistry({ teams: [PAISES[0], PAISES[1]] });
const match = golden ? golden.match : createMatch({ paises: PAISES, game, registry });

// ---------------------------------------------------------------------------------------------------------------
// Render

const bank = createSpriteBank({ createCanvas, sprites: SPRITES });
const team = [0, 0];
// Efectos (lote 5b): `fx` es el único dueño de partículas, explosiones, cráteres y restos; la escena le reparte los eventos.
const fx = createFx({ seed: 'efectos:inicio', sprites: SPRITES, flash: game.fx?.flash, motion });
const scene = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES, fx });
const terreno = createTerrain({ createCanvas });
const bases = createBaseLayer({ createCanvas, worldW: 1440 });
const renderer = createRenderer({
  createCanvas,
  canvas,
  world: { w: 1440, h: 810 },
  devicePass: params.get('devicePass') !== '0' && render.devicePass !== false,
  lod: resolveLod({ ...(render.lod ?? {}), ...(params.get('lod') === '0' ? { marks: false } : {}) }),
  layers: {
    terrain: (ctx, seed) => terreno.paint(ctx, seed),
    sky: (P) => terreno.drawClouds(P, P.frame.time, P.frame.reduced),
    craters: (P) => scene.drawCraters(P),
    bases: (P) => bases.layer(P),
    entities: createEntityLayer({ bank, team }),
  },
});
const timer = createTimer();
// los efectos se miden aparte (dentro de la etapa del mundo) para poder nombrar la causa si algo pasa del presupuesto
scene.drawEffects = (P) => {
  timer.begin('fx');
  fx.draw(P);
  timer.end('fx');
};
let partidos = 0;
let ultimoPar = '';

/** Un par nuevo: hornea los equipos y pinta el terreno una vez (una vez por partido). */
function prepararPartido() {
  const teams = match.pair?.teams;
  if (!teams) return;
  const clave = teams.map((t) => t.id).join('-');
  if (clave === ultimoPar) return;
  ultimoPar = clave;
  team[0] = bank.bake(teams[0].color);
  team[1] = bank.bake(teams[1].color);
  scene.teamHex = [teams[0].color, teams[1].color];
  bases.bake([teams[0].color, teams[1].color], [teams[0].art, teams[1].art]);
  const n = partidos++;
  renderer.startMatch(seedFrom(`terreno:${clave}:${n}`));
  fx.startMatch(`efectos:${clave}:${n}`); // RNG de efectos propio, sembrado por partido
}

let estadoAnterior = '';
/** Cada paso del sim: se vacía la bandeja del mundo y los eventos van a la escena de la vista. */
function onStep(m) {
  scene.consume(m.world.drain(), m.world);
  if (m.state !== estadoAnterior) {
    if (m.state === 'intro') scene.reset();
    estadoAnterior = m.state;
  }
  prepararPartido();
}
function pasoDelPartido() {
  match.step();
  onStep(match);
}
const loop = createLoop({ step: pasoDelPartido });

// ---------------------------------------------------------------------------------------------------------------
// Arranque sin narrador (provisional): el par de la URL o Perú contra México, y empieza solo

if (!golden) {
  const [a, b] = (params.get('pair') ?? 'PE-MX').split('-');
  const r = match.command({ type: 'pickPair', a, b });
  if (r.ok) {
    prepararPartido();
    match.command({ type: 'startMatch' });
  }
}
let carga = params.has('carga');
function cargar() {
  // 200 por lado: 150 soldados, 30 jeeps, 15 tanques y 5 pesados, para probar el tope
  for (const team of [1, 2]) {
    for (const [kind, count] of [
      ['soldado', 150],
      ['jeep', 30],
      ['tanque', 15],
      ['pesado', 5],
    ]) {
      match.command({ type: 'order', order: { kind, team, owner: null, count, unitValue: 0, source: 'baseline' } });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Teclado provisional: Enter avanza, P pausa, F2 rendimiento, flechas mueven la vista acercada

let f2 = golden !== null || params.has('f2');
const mover = { dx: 0, dy: 0 };
let aviso = '';
let avisoHasta = 0;
addEventListener('keydown', (e) => {
  if (e.key === 'F2') {
    e.preventDefault();
    f2 = !f2;
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    // R alterna el movimiento reducido (provisional hasta el lote 6, que lo mueve a ui/keys.js)
    aviso = motion.toggle() ? MOTION_NOTICE.on : MOTION_NOTICE.off;
    avisoHasta = performance.now() + 2500;
    return;
  }
  if (golden) return;
  if (e.key === 'Enter') {
    if (match.state === 'lobby') match.command({ type: 'startMatch' });
    else if (match.state === 'waitingNextRound') match.command({ type: 'startRound' });
    else if (match.state === 'matchEnd') {
      match.command({ type: 'endMatch' });
      const [a, b] = (params.get('pair') ?? 'PE-MX').split('-');
      ultimoPar = '';
      match.command({ type: 'pickPair', a, b });
      prepararPartido();
      match.command({ type: 'startMatch' });
    }
  } else if (e.key === 'p' || e.key === 'P') {
    match.command({ type: match.pause === 'manual' ? 'resume' : 'pause', by: 'manual' });
  } else if (e.key.startsWith('Arrow')) {
    mover.dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : mover.dx;
    mover.dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : mover.dy;
  }
});
addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') mover.dx = 0;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') mover.dy = 0;
});

// ---------------------------------------------------------------------------------------------------------------
// Tamaño y vista

const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
function ajustar() {
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr()));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr()));
  if (canvas.width !== W || canvas.height !== H) renderer.resize(W, H);
}
new ResizeObserver(ajustar).observe(canvas);
// primer tamaño: el del elemento ya maquetado (si aún no lo está, el del atributo del lienzo hasta que avise el observador)
renderer.resize(
  Math.round(canvas.clientWidth * dpr()) || canvas.width,
  Math.round(canvas.clientHeight * dpr()) || canvas.height,
);

const cam = { cx: Number(params.get('cx')) || 720, cy: Number(params.get('cy')) || 405 };
const temblor = { x: 0, y: 0 };
const rapido = Math.max(1, Math.min(60, Math.floor(Number(params.get('rapido'))) || 1));
/** Vista provisional: el mundo entero (k = 1) o `?k=` veces más cerca; en reposo, escala entera sobre k = 1. */
function vista(dt) {
  const W = canvas.width;
  const H = canvas.height;
  const fd = Math.min(W / 1440, H / 810);
  const k = Math.max(1, Math.min(6, Number(params.get('k')) || 1));
  let s = fd * k;
  if (s >= 2) s = Math.round(s);
  const vw = W / s;
  const vh = H / s;
  cam.cx += (mover.dx * 500 * dt) / (s / fd);
  cam.cy += (mover.dy * 500 * dt) / (s / fd);
  cam.cx = vw >= 1440 ? 720 : Math.max(vw / 2, Math.min(1440 - vw / 2, cam.cx));
  cam.cy = vh >= 810 ? 405 : Math.max(vh / 2, Math.min(810 - vh / 2, cam.cy));
  // el temblor mueve la vista unos px enteros de mundo (≤ 2 con la config por defecto) y nunca el sim
  fx.shakeOffset(temblor);
  return { x0: cam.cx - vw / 2 + temblor.x, y0: cam.cy - vh / 2 + temblor.y, s };
}

// ---------------------------------------------------------------------------------------------------------------
// Bucle

let ultimoTs = performance.now();
let hash = '';
let hashPaso = -1;
const goldenEstado = { expected: GOLDEN.hash, done: false, hash: '', step: 0, steps: GOLDEN.steps };

const ESTADOS = {
  matchup: 'elegir par',
  lobby: 'sala',
  intro: 'preparación',
  battle: 'batalla',
  roundEnd: 'fin de ronda',
  waitingNextRound: 'esperando al narrador',
  matchEnd: 'fin del partido',
};

function estado(ctx, k) {
  const m = match;
  const w = m.world;
  const pct = (b) => `${Math.round((100 * b.hp) / b.maxHp)} %`;
  const nombres = m.pair ? m.pair.teams.map((t) => t.name) : ['-', '-'];
  const l1 = `${nombres[0]} ${pct(w.bases[0])}   ${nombres[1]} ${pct(w.bases[1])}   ronda ${m.round}   ${ESTADOS[m.state] ?? m.state}${m.pause ? ' (pausa)' : ''}`;
  const l2 = 'Enter: siguiente · P: pausa · R: movimiento reducido · F2: rendimiento';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${12 * k}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(11,15,23,0.78)';
  ctx.fillRect(canvas.width / 2 - 260 * k, canvas.height - 40 * k, 520 * k, 36 * k);
  ctx.fillStyle = '#F4F7FF';
  ctx.fillText(l1, canvas.width / 2, canvas.height - 22 * k);
  ctx.fillStyle = '#A9B5DC';
  ctx.fillText(l2, canvas.width / 2, canvas.height - 8 * k);
}

/** Aviso breve de `R` (también durante `?golden`). */
function dibujarAviso(ctx, k) {
  if (!aviso || performance.now() >= avisoHasta) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${12 * k}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(11,15,23,0.78)';
  ctx.fillRect(canvas.width / 2 - 150 * k, 10 * k, 300 * k, 24 * k);
  ctx.fillStyle = '#F4F7FF';
  ctx.fillText(aviso, canvas.width / 2, 22 * k);
}

function cuadro(ts) {
  timer.beginFrame();
  const dt = Math.min(0.25, Math.max(0, (ts - ultimoTs) / 1000));
  ultimoTs = ts;

  timer.begin('sim');
  let anima = false;
  if (golden) {
    if (!golden.done) golden.advance(params.has('rapido') ? rapido : 500);
    Object.assign(goldenEstado, { done: golden.done, step: golden.tick, hash: golden.done ? golden.hash() : '' });
  } else {
    loop.frame(dt);
    // solo para mirar los efectos: más pasos por cuadro, con las mismas reglas
    for (let i = 1; i < rapido; i++) pasoDelPartido();
    if (carga && match.state === 'battle') {
      carga = false;
      cargar();
    }
    anima = match.state === 'battle' && match.pause === null && match.world.over === null;
  }
  timer.end('sim');

  scene.sync(match.world);
  timer.begin('world');
  // el reloj de vista de los efectos sigue corriendo cuando el mundo ya no avanza (la secuencia de la base se ve
  // DESPUÉS de que la ronda terminó) y se detiene con la pausa; la cámara lenta solo estira este reloj
  timer.begin('fx');
  fx.update(match.pause === null ? dt : 0, match.world);
  timer.end('fx');
  const v = vista(dt);
  fx.setView({ W: canvas.width, H: canvas.height, s: v.s, marks: renderer.stats.marks });
  renderer.draw(v, { alpha: anima ? loop.alpha : 1, time: ts / 1000, scene, reduced: motion.reduced });
  timer.end('world');

  timer.begin('ui');
  const k = dpr();
  if (!golden) estado(renderer.ctx, k);
  dibujarAviso(renderer.ctx, k);
  if (f2) {
    if (hashPaso !== match.world.step) {
      hashPaso = match.world.step;
      hash = hashMatch(match);
    }
    const w = match.world;
    const modelo = f2Model({
      timer,
      stats: renderer.stats,
      counts: { units: w.units.length, squads: w.squads.length, planes: w.planes.length, hits: w.hits.length },
      bakeCount: bank.bakeCount,
      hash,
      golden: golden ? goldenEstado : undefined,
      fx: { usage: fx.usage(), caps: FX_CAPS, recentLarge: fx.recentLarge() },
    });
    drawF2(renderer.ctx, modelo, k);
  }
  timer.end('ui');
  timer.endFrame();
  requestAnimationFrame(cuadro);
}
requestAnimationFrame(cuadro);
