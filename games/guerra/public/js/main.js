// Arranque y bucle de la vista de Batalla (lote 5a). Une el partido del sim con el render de Canvas 2D:
//   - el bucle da pasos de 30 Hz con `advance` (≤ 3 por cuadro) y dibuja con interpolación;
//   - la vista solo LEE el mundo y vacía su bandeja con `world.drain()` (nunca `registry.drain()`);
//   - F2 muestra rendimiento y el hash de estado; con `?golden` corre el log dorado y lo compara (CB-13 [M]).
//
// Provisional hasta el lote 6: la cámara del narrador y la automática ya están (lote 5c), pero sin HUD, pantallas ni
// atajos definitivos (solo Enter, P, F2, R y las teclas de cámara) y sin conexión del público (eso es el cableado
// final). Parámetros de la URL: `?golden` (hash dorado), `?pair=PE-MX` (el par), `?carga` (400 unidades),
// `?devicePass=0` (volver a LOW) y `?lod=0` (sin marcas). Vista MANUAL inicial, ayuda de desarrollo: `?k=2.25` (el
// nivel de zoom más cercano) y `?cx=100&cy=448` (centro, en px de mundo). `?rapido=4` da 4 pasos del sim por cuadro en
// vez de 1: no cambia ninguna regla, solo acorta la espera. Con `?golden&rapido=4` el partido dorado se ve a 4 pasos
// por cuadro en vez de los 500 de la comprobación del hash (cae una base a los ~18 s).
//
// Etiquetas e íconos de rol (lote 5d): los íconos van en la capa 10 del mundo y las etiquetas de donantes en pantalla.
// `?donantes` crea donantes sintéticos por los dos equipos (ayuda de desarrollo; con `?golden` no hay registro).
//
// Cámara (lote 5c): rueda, arrastre, pellizco, doble toque, flechas, + y −, V (ver todo), 1 y 2 (las bases), Espacio (la
// pelea más caliente), A (cámara automática), los botones y el minimapa. Todo eso es presentación (NM-2): también vale
// con `?golden`, donde siguen bloqueados los comandos del partido. R alterna el movimiento reducido.

import { createRegistry } from '@tienda/kit/sim/registry.js';
import { seedFrom } from '@tienda/kit/sim/rng.js';
import { createGestures } from './camera/gestures.js';
import { minimapRect, minimapVisible, uiScale } from './camera/minimap.js';
import { autoRuns, createCameraRig } from './camera/rig.js';
import { CAMERA_TEXT } from './camera/text.js';
import { GOLDEN } from './data/golden.js';
import { PAISES } from './data/paises.js';
import { SPRITES } from './data/sprites.js';
import { createGoldenRun } from './golden-run.js';
import { createLiveSession, sessionOffLines } from './live-session.js';
import { createLoop } from './loop.js';
import { createBaseLayer } from './render/bases.js';
import { drawF2, createTimer, f2Model } from './render/f2.js';
import { createFx, FX_CAPS } from './render/fx.js';
import { createRenderer } from './render/frame.js';
import { createIconBank, createIconLayer, resolveIcons } from './render/icons.js';
import { createLabelLayer } from './render/labels-layer.js';
import { resolveLod } from './render/lod.js';
import { viewOf } from './render/project.js';
import { drawMinimap } from './render/minimap.js';
import { createMotion, MOTION_MEDIA, MOTION_NOTICE } from './render/motion.js';
import { createScene } from './render/scene.js';
import { createSpriteBank } from './render/sprites.js';
import { createTerrain } from './render/terrain.js';
import { createEntityLayer, MARCAS } from './render/units.js';
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
const dpr = () => Math.min(window.devicePixelRatio || 1, 3);

/**
 * Config del juego: la del servidor si está (`/api/config`), y si no, la de fábrica. `session` solo viene si el servidor
 * tiene prendida la sesión de la transmisión (lote 5e) e informa el mismo `maxBytes` que usa el servidor.
 */
async function cargarConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return { game: {}, known: false };
    const cfg = await res.json();
    return { game: cfg.game ?? {}, session: cfg.session, known: true };
  } catch {
    return { game: {}, known: false };
  }
}

const { game, session: sessionCfg, known: configKnown } = await cargarConfig();
// Si el servidor respondió y no trae `session`, la sesión está apagada ahí: no se arma nada ni se hace el GET (C4). Si la
// config no se pudo leer, no se sabe, y se intenta el GET como siempre.
const sesionApagada = configKnown && sessionCfg === undefined;
const render = game.render ?? {};
// Movimiento reducido (CB-20): 'auto' sigue al sistema, true lo fuerza, false lo ignora; `R` lo alterna (provisional).
const sistema = matchMedia(MOTION_MEDIA);
const motion = createMotion({ graphics: game.graphics, systemReduced: sistema.matches });
sistema.addEventListener('change', (e) => motion.setSystem(e.matches));

// Cámara (lote 5c): controlador, calor de eventos y momentos de regalo grande. Con movimiento reducido arranca apagada.
const rig = createCameraRig({
  canvas: {
    w: Math.round(canvas.clientWidth * dpr()) || canvas.width,
    h: Math.round(canvas.clientHeight * dpr()) || canvas.height,
  },
  view: game.view,
  graphics: game.graphics,
  motion,
});
const camera = rig.controller;
let ultimoTs = performance.now();
/** Número de la URL, o el valor por defecto si falta o no es un número. */
const numero = (nombre, dflt) => {
  const v = Number(params.get(nombre));
  return params.has(nombre) && Number.isFinite(v) ? v : dflt;
};
/** Vista MANUAL inicial (ayuda de desarrollo): `?k`, `?cx`, `?cy`. Se aplica una vez, también al empezar la 1.ª ronda. */
let vistaInicial =
  params.has('k') || params.has('cx') || params.has('cy')
    ? { k: numero('k', 1), cx: numero('cx', 720), cy: numero('cy', 405) }
    : null;
/** Avisos breves en pantalla (R, A): se apilan arriba y duran 2,5 s del reloj de los cuadros. */
const avisos = /** @type {{text: string, until: number}[]} */ ([]);
const avisar = (text) => avisos.push({ text, until: ultimoTs + 2500 });

// ---------------------------------------------------------------------------------------------------------------
// Partido: el normal o la corrida del hash dorado

const golden = params.has('golden')
  ? createGoldenRun({ log: GOLDEN.log, steps: GOLDEN.steps, paises: PAISES, game: GOLDEN.game, onStep })
  : null;
const registry = golden ? null : createRegistry({ teams: [PAISES[0], PAISES[1]] });
const match = golden ? golden.match : createMatch({ paises: PAISES, game, registry });

// Sesión de la transmisión en memoria (lote 5e, KIT-28): la copia vive en el servidor local, nunca en disco ni en el navegador.
// Se pide ANTES del primer evento: si hay copia, vuelven los rangos, los ocultos y el partido (a la espera del narrador, a la
// sala o al selector). Con `?golden` no hay registro ni sesión: cero tráfico de sesión. `fetch` y `addEventListener` se
// resuelven al llamar, no al importar.
const sesion =
  golden || sesionApagada
    ? null
    : createLiveSession({
        registry,
        match,
        fetch: (url, init) => fetch(url, init),
        addEventListener: (type, fn) => addEventListener(type, fn),
        maxBytes: sessionCfg?.maxBytes,
        // mide lo que cuesta armar la copia para espaciar los envíos si fuera caro (el reloj es de la página, no del sim)
        clockMs: () => performance.now(),
      });
const restaurada = sesion ? await sesion.restore() : null;

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
// Íconos de rol (lote 5d): la capa 10 del mundo, que la escena llama tras los efectos. Se dibujan también con marcas.
const spriteAy = Object.fromEntries(['soldado', 'jeep', 'tanque', 'pesado'].map((k) => [k, SPRITES[k].ay]));
const iconBank = createIconBank({ createCanvas });
const iconTeam = [0, 0];
const iconLayer = createIconLayer({
  bank: iconBank,
  team: iconTeam,
  spriteAy,
  marksSize: MARCAS,
  formingAlpha: resolveIcons(render.icons).formingAlpha,
});
scene.drawIcons = (P) => iconLayer(P, scene.squads, scene.cfg, scene.field);
// Etiquetas de donantes (lote 5d): en pantalla, tras las capas del mundo. Sin registro (`?golden`) no hay donantes.
// Provisional hasta el lote 6: nombres visibles y sin foco (`spotlight: null`); el foco, `N`, Alt+clic y el clic llegan
// con ui/keys.js y ui/moderation.js (`hitLabel(labelLayer.rects, x, y)` ya está listo).
const labelHex = ['#E5484D', '#5BC8F5'];
const labelLayer = createLabelLayer({
  registry,
  teamHex: labelHex,
  spriteAy,
  marksSize: MARCAS,
  cfg: game.labels,
});
// cuando carga una fuente (lote 6.9) los anchos medidos cambian: se vacía la caché de texto de las etiquetas
document.fonts?.addEventListener?.('loadingdone', () => labelLayer.invalidate());
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
  iconTeam[0] = iconBank.bake(teams[0].color);
  iconTeam[1] = iconBank.bake(teams[1].color);
  labelHex[0] = teams[0].color;
  labelHex[1] = teams[1].color;
  bases.bake([teams[0].color, teams[1].color], [teams[0].art, teams[1].art]);
  const n = partidos++;
  renderer.startMatch(seedFrom(`terreno:${clave}:${n}`));
  fx.startMatch(`efectos:${clave}:${n}`); // RNG de efectos propio, sembrado por partido
}

let estadoAnterior = '';
/** Cada paso del sim: se vacía la bandeja del mundo y los eventos van a la escena de la vista y a la cámara. */
function onStep(m) {
  // el ÚNICO vaciado de la bandeja: lo reparten la escena (efectos) y la cámara (calor de eventos)
  const eventos = m.world.drain();
  scene.consume(eventos, m.world);
  rig.consume(eventos, m.world);
  if (m.state !== estadoAnterior) {
    if (m.state === 'intro') {
      scene.reset();
      rig.newRound(); // cada ronda empieza con el mapa entero
      if (vistaInicial) {
        camera.jumpTo(vistaInicial); // salvo la vista manual inicial de ?k, ?cx y ?cy, que vale para el primer partido
        vistaInicial = null;
      }
    }
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
  if (restaurada?.status === 'restored') {
    // recarga en pleno LIVE: el partido vuelve a donde estaba (o al selector) y nadie arranca solo
    if (match.pair) prepararPartido();
  } else {
    const [a, b] = (params.get('pair') ?? 'PE-MX').split('-');
    const r = match.command({ type: 'pickPair', a, b });
    if (r.ok) {
      prepararPartido();
      match.command({ type: 'startMatch' });
    }
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

// `?donantes` (ayuda de desarrollo, no vale con `?golden`): 12 donantes sintéticos por equipo, con los nombres del peor
// caso (largo, 24 emoji, escritura CJK) y XP distintas, para ver las etiquetas sin el adaptador del público. Entran por
// el mismo camino público que usará ese adaptador: un comentario que pide equipo y un regalo (comandos del partido); el
// registro del kit y el sim hacen el resto, y nada se escribe en objetos del sim.
const donantes = params.has('donantes') && registry !== null;
let rondaDonantes = -1;
const EMOJI = String.fromCodePoint(0x1f600).repeat(24);
const CJK = '田中太郎さんの動画チャンネル';
const LARGO = 'xX_el_mas_capo_del_live_Xx';
const NOMBRES_SINTETICOS = [
  ['ana_23', LARGO, EMOJI, CJK, 'Luis', 'María', 'Pepe_2000', 'k', 'Vale', 'Nico', 'Sol', 'Tomás'],
  [CJK, 'bea_77', EMOJI, LARGO, 'Juan', 'Lupe', 'Rodri', 'z', 'Mica', 'Beto', 'Ceci', 'Fede'],
];
function inyectarDonantes() {
  for (const team of [1, 2]) {
    NOMBRES_SINTETICOS[team - 1].forEach((nickname, i) => {
      const userId = `sint-${team}-${i}`;
      match.command({ type: 'chat', evt: { userId, nickname, text: String(team) } });
      const orders = [{ kind: 'soldado', team, owner: userId, count: 3, unitValue: 40 + (i % 3) * 20, source: 'gift' }];
      if (i % 4 === 0) orders.push({ kind: 'jeep', team, owner: userId, count: 1, unitValue: 160, source: 'gift' });
      // la XP baja con el índice: el top 3 de k = 1 es distinto de lo que se ve a k >= 3
      match.command({ type: 'gift', owner: userId, coins: (12 - i) * 80 + team * 7, orders });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Teclado provisional: Enter avanza, P pausa, F2 rendimiento, R movimiento reducido y las teclas de cámara

let f2 = golden !== null || params.has('f2');
const EDITABLES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const enEdicion = (t) => Boolean(t) && (EDITABLES.has(t.tagName) || t.isContentEditable === true);
/** Flechas sostenidas: la cámara se mueve mientras estén pulsadas. */
const flechas = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
const enviarFlechas = () =>
  camera.input('keys', {
    x: Number(flechas.ArrowRight) - Number(flechas.ArrowLeft),
    y: Number(flechas.ArrowDown) - Number(flechas.ArrowUp),
  });

addEventListener('keydown', (e) => {
  if (enEdicion(e.target)) return;
  if (e.key === 'F2') {
    e.preventDefault();
    f2 = !f2;
    return;
  }
  // con Ctrl, Alt o Meta las teclas son del navegador (zoom de la página, recargar…): no se tocan
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  if (key === 'r' || key === 'R') {
    // R alterna el movimiento reducido (provisional hasta el lote 6, que lo mueve a ui/keys.js)
    if (!e.repeat) avisar(motion.toggle() ? MOTION_NOTICE.on : MOTION_NOTICE.off);
    return;
  }
  // Lote 6 (ui/keys.js): G marcador, T top 3, S y Shift+S foco en un donante (la cámara ya sabe seguir: `follow`),
  // Alt+clic ocultar donante, N nombres, C marco, H ayuda y Shift+N nuevo en vivo. Aquí no existen todavía.
  // cámara: solo presentación (NM-2), así que también vale con ?golden
  if (key in flechas) {
    e.preventDefault();
    if (!flechas[key]) {
      flechas[key] = true;
      enviarFlechas();
    }
    return;
  }
  if (key === ' ') {
    e.preventDefault();
    if (!e.repeat) rig.hottest(match.world);
    return;
  }
  if (!e.repeat) {
    switch (key) {
      case 'v':
      case 'V':
        camera.viewAll();
        return;
      case '1':
        camera.focusBase(0);
        return;
      case '2':
        camera.focusBase(1);
        return;
      case 'a':
      case 'A':
        avisar(camera.toggleAuto().notice);
        return;
      case '+':
      case '=':
        camera.input('factor', { f: camera.cfg.keyZoom });
        return;
      case '-':
      case '_':
        camera.input('factor', { f: 1 / camera.cfg.keyZoom });
        return;
      default:
        break;
    }
  }
  if (golden) return;
  // Enter sobre un botón con foco lo activa el navegador (para quien llega con Tab): no es el Enter del narrador
  if (key === 'Enter' && e.target?.tagName === 'BUTTON') return;
  if (key === 'Enter') {
    if (match.state === 'matchup') {
      // sin selector todavía (lote 6): tras recargar sin par elegido, Enter elige el par de la URL y queda en la sala
      const [a, b] = (params.get('pair') ?? 'PE-MX').split('-');
      ultimoPar = '';
      if (match.command({ type: 'pickPair', a, b }).ok) prepararPartido();
    } else if (match.state === 'lobby') match.command({ type: 'startMatch' });
    else if (match.state === 'waitingNextRound') match.command({ type: 'startRound' });
    else if (match.state === 'matchEnd') {
      match.command({ type: 'endMatch' });
      const [a, b] = (params.get('pair') ?? 'PE-MX').split('-');
      ultimoPar = '';
      match.command({ type: 'pickPair', a, b });
      prepararPartido();
      match.command({ type: 'startMatch' });
    }
  } else if (key === 'p' || key === 'P') {
    match.command({ type: match.pause === 'manual' ? 'resume' : 'pause', by: 'manual' });
  }
});
addEventListener('keyup', (e) => {
  if (e.key in flechas && flechas[e.key]) {
    flechas[e.key] = false;
    enviarFlechas();
  }
});
addEventListener('blur', () => {
  // perder el foco con una flecha pulsada no deja la cámara corriendo
  let alguna = false;
  for (const k of Object.keys(flechas)) {
    alguna ||= flechas[k];
    flechas[k] = false;
  }
  if (alguna) enviarFlechas();
});

// ---------------------------------------------------------------------------------------------------------------
// Puntero sobre el lienzo (rueda, arrastre, pellizco, doble toque, minimapa) y botones de cámara

const gestos = createGestures({
  controller: camera,
  minimap: () => (minimapVisible(camera.state.kShown) ? minimapRect(canvas.width, canvas.height) : null),
});
/** Posición del evento en px de dispositivo del lienzo. */
function enLienzo(e) {
  const r = canvas.getBoundingClientRect();
  const sx = r.width > 0 ? canvas.width / r.width : 1;
  const sy = r.height > 0 ? canvas.height / r.height : 1;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // sin captura el arrastre sigue funcionando dentro del lienzo
  }
  gestos.down({ id: e.pointerId, ...enLienzo(e), t: e.timeStamp });
});
canvas.addEventListener('pointermove', (e) => gestos.move({ id: e.pointerId, ...enLienzo(e), t: e.timeStamp }));
canvas.addEventListener('pointerup', (e) => {
  gestos.up({ id: e.pointerId, ...enLienzo(e), t: e.timeStamp });
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // ya estaba suelto
  }
});
canvas.addEventListener('pointercancel', (e) => gestos.cancel({ id: e.pointerId }));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault(); // ni scroll ni zoom de la página
    gestos.wheel({ dy: e.deltaY, deltaMode: e.deltaMode, ctrl: e.ctrlKey, ...enLienzo(e) });
  },
  { passive: false },
);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const botones = {
  all: document.getElementById('cam-all'),
  in: document.getElementById('cam-in'),
  out: document.getElementById('cam-out'),
  auto: document.getElementById('cam-auto'),
};
// el mouse no deja el foco en los botones: así Enter y Espacio siguen siendo del narrador (el clic funciona igual)
for (const tipo of ['mousedown', 'pointerdown']) {
  document.getElementById('cam-bar')?.addEventListener(tipo, (e) => e.preventDefault());
}
botones.all?.addEventListener('click', () => camera.viewAll());
botones.in?.addEventListener('click', () => camera.input('factor', { f: camera.cfg.buttonZoom }));
botones.out?.addEventListener('click', () => camera.input('factor', { f: 1 / camera.cfg.buttonZoom }));
botones.auto?.addEventListener('click', () => avisar(camera.toggleAuto().notice));
/** Solo toca el DOM cuando algo cambió. */
function fijarBoton(b, texto, deshabilitado) {
  if (!b) return;
  if (b._texto !== texto) {
    b._texto = texto;
    b.textContent = texto;
  }
  if (b._off !== deshabilitado) {
    b._off = deshabilitado;
    b.disabled = deshabilitado;
  }
}
function actualizarBotones() {
  const st = camera.state;
  fijarBoton(botones.all, CAMERA_TEXT.viewAll, st.k === 1 && st.kShown === 1);
  fijarBoton(botones.in, CAMERA_TEXT.zoomIn, st.level === camera.levels().length - 1);
  fijarBoton(botones.out, CAMERA_TEXT.zoomOut, st.k === 1);
  fijarBoton(botones.auto, camera.status(), false);
}

// ---------------------------------------------------------------------------------------------------------------
// Tamaño y vista

function ajustar() {
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr()));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr()));
  if (canvas.width !== W || canvas.height !== H) {
    renderer.resize(W, H);
    camera.resize(W, H);
  }
}
new ResizeObserver(ajustar).observe(canvas);
// primer tamaño: el del elemento ya maquetado (si aún no lo está, el del atributo del lienzo hasta que avise el observador)
renderer.resize(
  Math.round(canvas.clientWidth * dpr()) || canvas.width,
  Math.round(canvas.clientHeight * dpr()) || canvas.height,
);

// vista MANUAL inicial (ayuda de desarrollo): ?k, ?cx, ?cy; la primera ronda la vuelve a aplicar (onStep)
if (vistaInicial) camera.jumpTo(vistaInicial);
const vista = { x0: 0, y0: 0, s: 1, w: 0, h: 0, k: 1 };
const temblor = { x: 0, y: 0 };
const rapido = Math.max(1, Math.min(60, Math.floor(Number(params.get('rapido'))) || 1));

// ---------------------------------------------------------------------------------------------------------------
// Bucle

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

/** Estado de la cámara ("CÁMARA AUTO" o "CÁMARA MANUAL"), siempre visible en la preparación y la batalla (NM-4). */
function dibujarEstadoCamara(ctx, k) {
  if (match.state !== 'intro' && match.state !== 'battle') return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${12 * k}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(11,15,23,0.78)';
  ctx.fillRect(canvas.width / 2 - 75 * k, 6 * k, 150 * k, 20 * k);
  ctx.fillStyle = camera.state.mode === 'auto' ? '#5BC8F5' : '#F4F7FF';
  ctx.fillText(camera.status(), canvas.width / 2, 16 * k);
}

/** Avisos breves de R y A, apilados debajo del estado de la cámara. */
function dibujarAvisos(ctx, k) {
  let y = 38 * k;
  for (let i = avisos.length - 1; i >= 0; i--) if (ultimoTs >= avisos[i].until) avisos.splice(i, 1);
  if (avisos.length === 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${12 * k}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of avisos) {
    ctx.fillStyle = 'rgba(11,15,23,0.78)';
    ctx.fillRect(canvas.width / 2 - 150 * k, y - 12 * k, 300 * k, 24 * k);
    ctx.fillStyle = '#F4F7FF';
    ctx.fillText(a.text, canvas.width / 2, y);
    y += 28 * k;
  }
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
    if (donantes && match.state === 'battle' && rondaDonantes !== match.round) {
      rondaDonantes = match.round; // una vez por ronda: los donantes vuelven a regalar al empezar cada una
      inyectarDonantes();
    }
    anima = match.state === 'battle' && match.pause === null && match.world.over === null;
  }
  timer.end('sim');
  // sesión de la transmisión: detecta cambios del registro y del partido y envía como mucho una vez por segundo (reloj de vista)
  sesion?.frame(ts / 1000);

  scene.sync(match.world);
  timer.begin('world');
  // el reloj de vista de los efectos sigue corriendo cuando el mundo ya no avanza (la secuencia de la base se ve
  // DESPUÉS de que la ronda terminó) y se detiene con la pausa; la cámara lenta solo estira este reloj
  timer.begin('fx');
  fx.update(match.pause === null ? dt : 0, match.world);
  timer.end('fx');
  // la cámara sigue el reloj de vista (también en pausa: el narrador puede mover la cámara); la automática solo corre
  // en batalla y solo LEE el mundo
  rig.update(dt, match.world, autoRuns(match.state));
  for (const aviso of rig.drainNotices()) avisar(aviso);
  camera.viewRect(vista);
  // el temblor mueve la vista unos px enteros de mundo (≤ 2 con la config por defecto) y nunca el sim
  fx.shakeOffset(temblor);
  vista.x0 += temblor.x;
  vista.y0 += temblor.y;
  fx.setView({ W: canvas.width, H: canvas.height, s: vista.s, marks: renderer.stats.marks });
  renderer.draw(vista, { alpha: anima ? loop.alpha : 1, time: ts / 1000, scene, reduced: motion.reduced });
  timer.end('world');

  timer.begin('ui');
  const k = dpr();
  const ctx = renderer.ctx;
  // etiquetas de donantes: en pantalla, tras el mundo y antes del HUD, el minimapa y los avisos (D21 punto 6)
  labelLayer.draw(ctx, {
    W: canvas.width,
    H: canvas.height,
    u: uiScale(canvas.width, canvas.height),
    units: match.world.units,
    k: camera.state.k, // el nivel del controlador y no `kShown`: la densidad no parpadea durante las transiciones
    screen: { ...viewOf(renderer.stats), marks: renderer.stats.marks, x0: vista.x0, y0: vista.y0 },
    alpha: anima ? loop.alpha : 1,
    now: ts / 1000,
    spotlight: null,
    onlyRank: false,
    icons: { descs: iconLayer.descs, count: iconLayer.count },
  });
  if (!golden) estado(ctx, k);
  if (minimapVisible(camera.state.kShown)) {
    const W = canvas.width;
    const H = canvas.height;
    drawMinimap(ctx, minimapRect(W, H), {
      view: vista,
      squads: match.world.squads,
      teamHex: /** @type {[string, string]} */ (scene.teamHex),
      u: uiScale(W, H),
    });
  }
  dibujarEstadoCamara(ctx, k);
  dibujarAvisos(ctx, k);
  actualizarBotones();
  if (f2) {
    if (hashPaso !== match.world.step) {
      hashPaso = match.world.step;
      hash = hashMatch(match);
    }
    const w = match.world;
    const st = camera.state;
    const modelo = f2Model({
      timer,
      stats: renderer.stats,
      counts: { units: w.units.length, squads: w.squads.length, planes: w.planes.length, hits: w.hits.length },
      bakeCount: bank.bakeCount,
      hash,
      golden: golden ? goldenEstado : undefined,
      fx: { usage: fx.usage(), caps: FX_CAPS, recentLarge: fx.recentLarge() },
      labels: labelLayer.stats,
      icons: iconLayer.stats,
      session: sesion ? sesion.f2() : sesionApagada && !golden ? sessionOffLines() : undefined,
      camera: {
        k: st.k,
        kShown: st.kShown,
        text: camera.status(),
        mode: st.mode,
        idle: st.idle,
        auto: st.autoEnabled,
        tx: st.tx,
        ty: st.ty,
      },
    });
    drawF2(ctx, modelo, k);
  }
  timer.end('ui');
  timer.endFrame();
  requestAnimationFrame(cuadro);
}
requestAnimationFrame(cuadro);
