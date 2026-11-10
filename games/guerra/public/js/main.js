// Arranque y bucle de la vista de Batalla (lote 5a). Une el partido del sim con el render de Canvas 2D:
//   - el bucle da pasos de 30 Hz con `advance` (≤ 3 por cuadro) y dibuja con interpolación;
//   - la vista solo LEE el mundo y vacía su bandeja con `world.drain()` (nunca `registry.drain()`);
//   - F2 muestra rendimiento y el hash de estado; con `?golden` corre el log dorado y lo compara (CB-13 [M]).
//
// Parámetros de la URL (ayudas de desarrollo; sin ninguno la página abre el SELECTOR de países):
//   `?pair=PE-MX` preselecciona el par (el narrador confirma con Enter); `?golden` corre el log dorado y compara el hash
//   (CB-13 [M]); `?carga` pone 400 unidades para probar el tope; `?rapido=4` da 4 pasos del sim por cuadro (no cambia ninguna
//   regla, solo acorta la espera); `?f2` abre el panel de rendimiento; `?devicePass=0` vuelve a LOW y `?lod=0` quita las marcas;
//   `?k=2.25&cx=100&cy=448` fija una vista MANUAL inicial; `?demo` fuerza el modo demo (sin puente) aunque haya servidor.
//
// El público (lote 6b, §11): los eventos de TikTok llegan por el puente (`/ws`, SIEMPRE del mismo origen) y los del simulador F1
// por `POST /api/simulate` (o sin red en demo); los dos pasan por el MISMO adaptador (`audience.js`), que los vuelve comandos
// del partido. Esperan al GET de la sesión (nota 48) y después se aplican en orden. Los atajos, el puntero y la rueda los
// escucha UN solo módulo (`ui/input.js`) con el mapa de `ui/keys.js`.
//
// Etiquetas e íconos de rol (lote 5d): los íconos van en la capa 10 del mundo y las etiquetas de donantes en pantalla.
// Cámara (lote 5c): rueda, arrastre, pellizco, doble toque, flechas, + y −, V, 1 y 2, Espacio, A, los botones y el minimapa.
// Todo eso es presentación (NM-2): también vale con `?golden`, donde siguen bloqueados los comandos del partido.

import { connectBridge } from '@tienda/kit/client/net.js';
import { SimulatorPanel } from '@tienda/kit/client/simulator.js';
import { panelModel } from '@tienda/kit/client/simulator-events.js';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { createBlocklist } from '@tienda/kit/sim/names.js';
import { topUsers } from '@tienda/kit/sim/podium.js';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { seedFrom } from '@tienda/kit/sim/rng.js';
import { SIM_GIFTS, buildRouter, createAudience, createFlow } from './audience.js';
import { Sfx } from './audio.js';
import { createGestures } from './camera/gestures.js';
import { minimapVisible } from './camera/minimap.js';
import { autoRuns, createCameraRig } from './camera/rig.js';
import { GOLDEN } from './data/golden.js';
import { NOMBRES_VETADOS } from './data/nombres-vetados.js';
import { PAISES } from './data/paises.js';
import { SPRITES } from './data/sprites.js';
import { loadFonts } from './fonts.js';
import { createGoldenRun } from './golden-run.js';
import { createLiveSession, sessionOffLines } from './live-session.js';
import { createLoop } from './loop.js';
import { createNet } from './net-status.js';
import { createBaseLayer } from './render/bases.js';
import { drawF2, createTimer, f2Model } from './render/f2.js';
import { createFx, FX_CAPS } from './render/fx.js';
import { createRenderer } from './render/frame.js';
import { createIconBank, createIconLayer, resolveIcons } from './render/icons.js';
import { hitLabel } from './render/labels.js';
import { createLabelLayer } from './render/labels-layer.js';
import { resolveLod } from './render/lod.js';
import { viewOf } from './render/project.js';
import { drawMinimap } from './render/minimap.js';
import { createMotion, MOTION_MEDIA } from './render/motion.js';
import { createScene } from './render/scene.js';
import { createSpriteBank } from './render/sprites.js';
import { createTerrain } from './render/terrain.js';
import { createEntityLayer, MARCAS } from './render/units.js';
import { hashMatch } from './sim/hash.js';
import { createMatch } from './sim/match.js';
import { applyPresence, createPresenceGuard } from './sim/presence.js';
import { createBanners } from './ui/banners.js';
import { createUi } from './ui/draw.js';
import { hudModel } from './ui/hud.js';
import { createInput, createPresenceFeed } from './ui/input.js';
import { cameraButtonsGrid, frameEnabled, minimapRect, uiScale } from './ui/layout.js';
import { createModeration } from './ui/moderation.js';
import { helpModel, scoreboardModel, top3Model } from './ui/overlays.js';
import { createScreenCache, pauseModel } from './ui/screens.js';
import { createSelector } from './ui/selector.js';
import { createShortcuts } from './ui/shortcuts.js';
import { createSpotlight } from './ui/spotlight.js';
import { S } from './ui/strings.js';
import { FONTS } from './ui/theme.js';

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
    if (!res.ok) return { game: {}, known: false, serverMode: false };
    const cfg = await res.json();
    return { game: cfg.game ?? {}, session: cfg.session, known: true, serverMode: cfg.serverMode === true };
  } catch {
    return { game: {}, known: false, serverMode: false };
  }
}

const { game, session: sessionCfg, known: configKnown, serverMode } = await cargarConfig();
// Con servidor del kit hay puente (`/ws`) y el simulador F1 manda por POST; sin él (demo) F1 entra sin red.
const conServidor = serverMode && !params.has('demo');
// Si el servidor respondió y no trae `session`, la sesión está apagada ahí: no se arma nada ni se hace el GET (C4). Si la
// config no se pudo leer, no se sabe, y se intenta el GET como siempre.
const sesionApagada = configKnown && sessionCfg === undefined;
const render = game.render ?? {};
// Movimiento reducido (CB-20): 'auto' sigue al sistema, true lo fuerza, false lo ignora; `R` lo alterna (provisional).
const sistema = matchMedia(MOTION_MEDIA);
// Una config inválida no deja la página en blanco: el juego no arranca y la pantalla de error dice qué falló y cómo salir
// (CB-17). Mientras tanto se usan los valores de fábrica para que todo lo demás exista.
/** @type {{kind: string, detail: string} | null} */
let errorUI = null;
const conFallback = (hacer, alternativa) => {
  try {
    return hacer();
  } catch (e) {
    // solo un error de CONFIG se muestra como tal; un TypeError de programación no se disfraza
    if (!(e instanceof ConfigError)) throw e;
    errorUI ??= { kind: 'config', detail: e instanceof Error ? e.message : String(e) };
    return alternativa();
  }
};
const marcoActivo = frameEnabled(game.camera);
const motion = conFallback(
  () => createMotion({ graphics: game.graphics, systemReduced: sistema.matches }),
  () => createMotion({ systemReduced: sistema.matches }),
);
sistema.addEventListener('change', (e) => motion.setSystem(e.matches));

// Cámara (lote 5c): controlador, calor de eventos y momentos de regalo grande. Con movimiento reducido arranca apagada.
const rigCanvas = {
  w: Math.round(canvas.clientWidth * dpr()) || canvas.width,
  h: Math.round(canvas.clientHeight * dpr()) || canvas.height,
};
const rig = conFallback(
  () => createCameraRig({ canvas: rigCanvas, view: game.view, graphics: game.graphics, motion }),
  () => createCameraRig({ canvas: rigCanvas, motion }),
);
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
const avisos = /** @type {{text: string, until: number, family: string}[]} */ ([]);
/**
 * Un aviso nuevo reemplaza al anterior de su familia (N ocultos y N visibles, A, R, M…); `ms` es cuánto dura (la
 * confirmación de Esc ×2 o de Shift+N ×2 dura su ventana de 2 s y el aviso que la resuelve la reemplaza).
 */
const avisar = (text, family = '', ms = 2500) => {
  if (family !== '') {
    const i = avisos.findIndex((a) => a.family === family);
    if (i >= 0) avisos.splice(i, 1);
  }
  avisos.push({ text, until: ultimoTs + ms, family });
};

// ---------------------------------------------------------------------------------------------------------------
// Partido: el normal o la corrida del hash dorado

const golden = params.has('golden')
  ? createGoldenRun({ log: GOLDEN.log, steps: GOLDEN.steps, paises: PAISES, game: GOLDEN.game, onStep })
  : null;
// los términos vetados salen de un archivo de datos del dueño (lo revisa en cada versión con tools/check-seed.mjs)
const registry = golden
  ? null
  : createRegistry({ teams: [PAISES[0], PAISES[1]], blocklist: createBlocklist(NOMBRES_VETADOS) });
const match = golden
  ? golden.match
  : conFallback(
      () => createMatch({ paises: PAISES, game, registry }),
      () => createMatch({ paises: PAISES, game: {}, registry }),
    );

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

// El público (lote 6b): el adaptador traduce cada evento en un comando del partido; los eventos esperan al GET de la sesión
// (nota 48) y se aplican en orden en cuanto resuelve (con copia, vacía o con error). El puente se abre ANTES de pedir la
// copia: lo que llegue mientras tanto se encola, no se pierde.
const banners = createBanners({ registry, cfg: game.banners });
const armado = conFallback(
  () => buildRouter(game),
  () => buildRouter({}),
);
const router = armado.router;
/** Avisos de la config del router (p. ej. un override con una unidad que no existe): F2 los muestra. */
const avisosDeConfig = armado.warnings.map((w, i) => ({
  key: `routerWarning${i}`,
  label: S.f2.configWarning,
  value: String(w).slice(0, 120),
}));
const flow = registry ? createFlow({ audience: createAudience({ registry, router }), match, rig, banners }) : null;
const net = createNet({ demo: !conServidor, clock: () => ultimoTs / 1000 });
if (conServidor && flow) {
  // siempre del mismo origen: no hay parámetro para apuntarlo a otro servidor
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  connectBridge(url, { onEvent: (evt) => flow.push(evt), onStatus: (s) => net.set(s) });
}
// Simulador F1: sus botones mandan los mismos eventos que llegarían de TikTok, por POST /api/simulate (con servidor, y vuelven
// por el puente) o al adaptador sin pasar por la red (demo). Lo arma el kit con textContent: un nombre nunca se interpreta como HTML.
const simEl = document.getElementById('sim');
const simConfig = (teams) => ({
  teams,
  simulator: { gifts: game.simulator?.gifts ?? SIM_GIFTS },
  giftOverrides: game.giftOverrides ?? {},
});
const simulador =
  simEl && flow
    ? new SimulatorPanel(simEl, {
        config: simConfig([]),
        onEvent: conServidor ? undefined : (evt) => flow.push(evt),
        fab: false,
        hotkey: false,
        floating: true,
      })
    : null;
if (simulador) simEl.style?.setProperty?.('font-family', FONTS.body.family);
let restaurada;
try {
  restaurada = sesion ? await sesion.restore() : null;
} finally {
  flow?.ready();
}

// ---------------------------------------------------------------------------------------------------------------
// Render

const bank = createSpriteBank({ createCanvas, sprites: SPRITES });
const team = [0, 0];
// Efectos (lote 5b): `fx` es el único dueño de partículas, explosiones, cráteres y restos; la escena le reparte los eventos.
const fx = conFallback(
  () => createFx({ seed: 'efectos:inicio', sprites: SPRITES, flash: game.fx?.flash, motion }),
  () => createFx({ seed: 'efectos:inicio', sprites: SPRITES, motion }),
);
const scene = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES, fx });
const terreno = createTerrain({ createCanvas });
const bases = createBaseLayer({ createCanvas, worldW: 1440 });
const lodCfg = conFallback(
  () => resolveLod({ ...(render.lod ?? {}), ...(params.get('lod') === '0' ? { marks: false } : {}) }),
  () => resolveLod({}),
);
const renderer = createRenderer({
  createCanvas,
  canvas,
  world: { w: 1440, h: 810 },
  devicePass: params.get('devicePass') !== '0' && render.devicePass !== false,
  lod: lodCfg,
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
// El foco (S, Shift+S y el clic) y `N` (solo el rango) llegan de `ui/spotlight.js` y `ui/moderation.js`; el clic y el Alt+clic
// responden en `labelLayer.hitRects`, también en las etiquetas que se están apagando.
const labelHex = ['#E5484D', '#5BC8F5'];
const labelLayer = createLabelLayer({
  registry,
  teamHex: labelHex,
  spriteAy,
  marksSize: MARCAS,
  cfg: game.labels,
});
// Interfaz (lote 6a): HUD, pantallas, feed y banners sobre el lienzo, con los textos de `ui/strings.js`. Los banners salen
// de los eventos del sim (`rankUp`, `join`) y de los momentos de la cámara; el nombre se resuelve al mostrarse.
const ui = createUi({ iconBank, iconTeam });
// cuando carga una fuente (6.9) los anchos medidos cambian: se vacía la caché de texto de las etiquetas y de la interfaz.
// Lo dispara el aviso `loadingdone` del navegador y también el cargador de fuentes al llegar cada cara
function fuentesCambiaron() {
  labelLayer.invalidate();
  ui.invalidate();
}
document.fonts?.addEventListener?.('loadingdone', fuentesCambiaron);
// Fuentes locales (Pixelify Sans y Silkscreen, `/fonts/*.woff2`): tope de 1,5 s y respaldo `system-ui, sans-serif`
await loadFonts({
  FontFace: globalThis.FontFace,
  fonts: document.fonts,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
  onLoaded: fuentesCambiaron,
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
  iconTeam[0] = iconBank.bake(teams[0].color);
  iconTeam[1] = iconBank.bake(teams[1].color);
  labelHex[0] = teams[0].color;
  labelHex[1] = teams[1].color;
  bases.bake([teams[0].color, teams[1].color], [teams[0].art, teams[1].art]);
  // el simulador ofrece los dos equipos del par (su palabra para unirse y su nombre)
  if (simulador) {
    simulador.model = panelModel(simConfig(teams.map((t) => PAISES.find((p) => p.id === t.id)).filter(Boolean)));
    simulador.build();
  }
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
  banners.consume(eventos, (team) => m.pair?.teams[team - 1]?.name ?? '');
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
// Arranque: sin parámetros la página abre el SELECTOR; nadie arranca solo. Tras una recarga en pleno LIVE el partido vuelve a
// donde estaba (sesión restaurada: la espera de la ronda, la sala o el selector)

if (!golden && !errorUI && restaurada?.status === 'restored' && match.pair) prepararPartido();
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
// Selector, atajos, moderación y entrada del narrador (lote 6b)

// `?pair=PE-MX` solo PRESELECCIONA el par en el selector: el narrador confirma con Enter. Un id desconocido no elige nada.
const [parIzq, parDer] = (params.get('pair') ?? '').split('-');
const selector = createSelector({ paises: PAISES, left: parIzq || null, right: parDer || null });
const seleccion = selector.sel;
/** Estado de PRESENTACIÓN de las superposiciones y de F2 (NM-2: nada de esto vuelve al sim). Los tiempos van en ms del reloj de vista. */
const vistaUi = {
  help: false,
  safe: false,
  f2: golden !== null || params.has('f2'),
  frame: marcoActivo,
  scoreboardUntil: 0,
  top3Until: 0,
};
/** La fila del selector bajo el puntero (solo con puntero fino) o null. */
let hoverFila = /** @type {{col: number, id: string} | null} */ (null);

// Sin registro (`?golden`) no hay donantes que moderar ni seguir
const MODERACION_VACIA = { size: 0, hideAt: () => null, undo: () => 'empty', toggleNames: () => false, reset() {} };
const SEGUIR_VACIO = { key: null, next: () => null, stop() {}, follow() {} };
const moderation = registry
  ? createModeration({
      registry,
      rects: () => labelLayer.hitRects,
      // la foto de resultados y los paneles G y T (que se rearman a 5 Hz) muestran nombres: se vuelven a armar al cambiar
      onChange: () => {
        cachePantalla.invalidate();
        superposicion.at = -Infinity;
      },
    })
  : MODERACION_VACIA;
const spotlight = registry ? createSpotlight({ registry, units: () => match.world.units, camera }) : SEGUIR_VACIO;
const sfx = new Sfx({ AudioContextCtor: globalThis.AudioContext ?? globalThis.webkitAudioContext });
sfx.load(); // sin archivos de audio no hace nada; con ellos los baja al arrancar
// el audio se desbloquea con la primera entrada confiable del narrador (política de reproducción del navegador)
let audioDesbloqueado = false;
for (const type of ['keydown', 'pointerdown']) {
  addEventListener(
    type,
    (e) => {
      if (e.isTrusted !== true || audioDesbloqueado) return;
      audioDesbloqueado = true;
      sfx.unlock();
    },
    true,
  );
}

/** Vuelve al selector (o "Nuevo en vivo"): la interfaz arranca limpia (feed, cola de banners, foto de la pantalla, ocultos y foco). */
function reiniciarInterfaz() {
  banners.reset();
  cachePantalla.invalidate();
  if (spotlight.key !== null) spotlight.stop();
}
/** `Enter` y el botón hacen lo que dice la pantalla: elegir el par, empezar el partido, empezar la ronda o volver al selector. */
function avanzar() {
  // en pausa Enter y el botón no hacen nada (NM-9: P reanuda); con un error de config el juego no arranca (10.2)
  if (golden || errorUI || match.pause !== null) return;
  if (match.state === 'matchup') {
    const par = selector.pair();
    if (par === null) return;
    ultimoPar = '';
    if (match.command({ type: 'pickPair', a: par.a, b: par.b }).ok) prepararPartido();
  } else if (match.state === 'lobby') match.command({ type: 'startMatch' });
  else if (match.state === 'waitingNextRound') match.command({ type: 'startRound' });
  else if (match.state === 'matchEnd') {
    if (match.command({ type: 'endMatch' }).ok) reiniciarInterfaz(); // vuelve al selector
  }
}

const bloqueado = () => golden !== null || errorUI !== null;
const atajos = createShortcuts({
  now: () => ultimoTs,
  match,
  camera,
  rig,
  advance: avanzar,
  avisar,
  motion,
  moderation,
  spotlight,
  view: vistaUi,
  // lo oculto dura el LIVE: terminar un partido no vacía la pila de Alt+Z, solo "Nuevo en vivo" (el registro también lo olvida)
  onNewLive: () => {
    reiniciarInterfaz();
    moderation.reset();
  },
  onMatchEnded: reiniciarInterfaz,
  sim: simulador,
  audio: sfx,
  blocked: bloqueado,
  golden: golden !== null,
});

// Guardia de presencia (NM-7, NM-8): solo la entrada de confianza del narrador la reinicia
const guardia = createPresenceGuard({ minutes: game.presence?.minutes, now: () => performance.now() });
const presencia = createPresenceFeed({ guard: guardia, match, now: () => performance.now() });

const gestos = createGestures({
  controller: camera,
  minimap: () => (minimapVisible(camera.state.kShown) ? minimapRect(canvas.width, canvas.height) : null),
});
const dentro = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
createInput({
  win: { addEventListener: (type, fn, opts) => addEventListener(type, fn, opts) },
  canvas,
  shortcuts: atajos,
  // en el selector las flechas y Tab son de las listas (no hay mundo que panear)
  // y solo con el foco en el escenario o el cuerpo de la página: dentro del panel F1 `Tab` y las flechas son del panel
  raw: (e) =>
    match.state === 'matchup' &&
    !bloqueado() &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    (!e.target || e.target === canvas || e.target.tagName === 'BODY') &&
    selector.key(e),
  gestures: gestos,
  presence: presencia,
  pointer: {
    advance(p) {
      if (errorUI || match.pause !== null) return false;
      const s = pantalla();
      if (!s.advance || s.advance.disabled) return false;
      const r = ui.advanceRect(canvas.width, canvas.height, s, vistaUi.frame);
      if (r === null || !dentro(p, r)) return false;
      avanzar();
      return true;
    },
    click(p, e) {
      if (registry === null) return;
      if (e.altKey) {
        // Alt+clic en una etiqueta oculta a ese donante (también si se está apagando)
        if (moderation.hideAt(p) !== null) avisar(S.moderation.hidden, 'hide');
        return;
      }
      if (match.state === 'matchup') {
        const h = ui.listHit(canvas.width, canvas.height, pantalla(), p.x, p.y, vistaUi.frame);
        if (h) selector.pick(h.col, h.id);
        return;
      }
      const key = hitLabel(labelLayer.hitRects, p);
      if (key !== null) spotlight.follow(key);
    },
    hover(p) {
      hoverFila =
        p && match.state === 'matchup' && !errorUI
          ? ui.listHit(canvas.width, canvas.height, pantalla(), p.x, p.y, vistaUi.frame)
          : null;
    },
  },
  arrows: (x, y) => camera.input('keys', { x, y }),
  // con usuarios en memoria cerrar o recargar pide confirmación (D25)
  unload: () => registry !== null && registry.users().length > 0,
  blocked: bloqueado,
});

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
botones.auto?.addEventListener('click', () => avisar(camera.toggleAuto().notice, 'auto'));
/** Solo toca el DOM cuando algo cambió. */
function fijarBoton(b, texto, deshabilitado, pulsado) {
  if (!b) return;
  if (pulsado !== undefined && b._pulsado !== pulsado) {
    b._pulsado = pulsado;
    b.setAttribute?.('aria-pressed', String(pulsado));
  }
  if (b._texto !== texto) {
    b._texto = texto;
    b.textContent = texto;
  }
  if (b._off !== deshabilitado) {
    b._off = deshabilitado;
    b.disabled = deshabilitado;
  }
}
/** Los botones dicen lo que hacen al pulsarlos; el ESTADO de la cámara se lee aparte, en el centro del HUD (S3). */
function actualizarBotones(controls, ocultar) {
  const bar = document.getElementById('cam-bar');
  if (bar && bar.hidden !== ocultar) bar.hidden = ocultar;
  fijarBoton(botones.all, controls.viewAll.text, controls.viewAll.disabled);
  fijarBoton(botones.in, controls.zoomIn.text, controls.zoomIn.disabled);
  fijarBoton(botones.out, controls.zoomOut.text, controls.zoomOut.disabled);
  fijarBoton(botones.auto, controls.auto.text, controls.auto.disabled, controls.auto.pressed);
}

/** Los botones de la cámara van en su región de la banda inferior (`ui/layout.js`), a la escala entera de la interfaz. */
function ubicarBotones(W, H) {
  const bar = document.getElementById('cam-bar');
  const style = bar?.style;
  if (!style?.setProperty) return;
  const g = cameraButtonsGrid(W, H);
  const d = dpr();
  style.setProperty('left', `${g.rect.x / d}px`);
  style.setProperty('top', `${g.rect.y / d}px`);
  style.setProperty('width', `${g.rect.w / d}px`);
  style.setProperty('height', `${g.rect.h / d}px`);
  style.setProperty('gap', `${g.gap / d}px`);
  style.setProperty('grid-template-rows', `repeat(2, ${g.cell.h / d}px)`);
  style.setProperty('font-size', `${g.fontPx / d}px`);
  style.setProperty('font-family', FONTS.body.family);
}

// ---------------------------------------------------------------------------------------------------------------
// Tamaño y vista

function ajustar() {
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr()));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr()));
  if (canvas.width !== W || canvas.height !== H) {
    renderer.resize(W, H);
    camera.resize(W, H);
    ubicarBotones(W, H);
    ui.invalidate(); // otro tamaño, otra escala `u`, otras fuentes: se vuelve a medir
  }
}
new ResizeObserver(ajustar).observe(canvas);
// primer tamaño: el del elemento ya maquetado (si aún no lo está, el del atributo del lienzo hasta que avise el observador)
renderer.resize(
  Math.round(canvas.clientWidth * dpr()) || canvas.width,
  Math.round(canvas.clientHeight * dpr()) || canvas.height,
);
ubicarBotones(
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
let hashTs = -Infinity;
const goldenEstado = { expected: GOLDEN.hash, done: false, hash: '', step: 0, steps: GOLDEN.steps };

/** Avisos breves de R y A (se ven 2,5 s del reloj de los cuadros); los dibuja la interfaz. */
function avisosVisibles() {
  for (let i = avisos.length - 1; i >= 0; i--) if (ultimoTs >= avisos[i].until) avisos.splice(i, 1);
  return avisos.map((a) => a.text);
}

// La pantalla (selector, sala, fin de ronda, fin de partido o error): las de resultados son una foto que se arma al entrar al
// estado, no con cada regalo (C3); la sala y el selector cambian con las uniones y la elección.
const cachePantalla = createScreenCache();
const pantalla = () => cachePantalla.get(match, { registry, paises: PAISES, selection: seleccion, error: errorUI });

/** Qué paneles hay abiertos: G y T solo existen con un par elegido (sin par no se dibujan), y H en todas las pantallas. */
function paneles(ts) {
  return {
    g: match.pair !== null && vistaUi.scoreboardUntil > ts,
    t: match.pair !== null && vistaUi.top3Until > ts,
    h: vistaUi.help,
  };
}
/** ¿Hay H, G o T a la vista? Es la MISMA cuenta con que se dibujan (B16). */
function hayPanelAbierto(ts) {
  const p = paneles(ts);
  return p.g || p.t || p.h;
}

/** Superposiciones del narrador (G, T, H y F3): los modelos se rearman a 5 Hz del reloj de vista, no en cada cuadro. */
const superposicion = { at: -Infinity, key: '', value: /** @type {any} */ (null) };
function superposiciones(ts) {
  const { g, t } = paneles(ts);
  if (!g && !t && !vistaUi.help && !vistaUi.safe) return null;
  const k = `${g}|${t}|${vistaUi.help}|${vistaUi.safe}`;
  if (k === superposicion.key && ts - superposicion.at < 200) return superposicion.value;
  superposicion.key = k;
  superposicion.at = ts;
  // una sola pasada por los usuarios para el marcador y el top 3
  const top = registry && (g || t) ? topUsers(registry, 'match', 3) : [];
  superposicion.value = {
    scoreboard: g ? scoreboardModel({ match, registry, top }) : null,
    top3: t ? top3Model({ registry, top }) : null,
    help: vistaUi.help ? helpModel() : null,
    safe: vistaUi.safe,
  };
  return superposicion.value;
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
  // la guardia de presencia: con tantos minutos sin entrada del narrador el partido se pausa (NM-7); es reloj de pared
  if (!golden) applyPresence(guardia, match, performance.now());
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
  for (const aviso of rig.drainNotices()) avisar(aviso, 'auto');
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
    spotlight: spotlight.key,
    onlyRank: registry?.allNamesHidden() === true,
    icons: { descs: iconLayer.descs, count: iconLayer.count },
    // el HUD del cuadro anterior: ningún cartel de donante lo cruza (rieles, banda inferior, marco, chip, aviso, paneles)
    blockers: ui.obstacles,
  });
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
  // HUD, pantallas, feed, banner, pausa y marco del narrador (lote 6a). Los modelos son puros y solo leen el partido y el
  // registro; el estado de la red llega inyectado y en 6a es "sin fuente" (`null`): el chip no se muestra.
  const cs = camera.state;
  const hud = hudModel({
    match,
    registry,
    camera: {
      mode: cs.mode,
      autoEnabled: cs.autoEnabled,
      k: cs.k,
      kShown: cs.kShown,
      level: cs.level,
      levels: camera.levels().length,
    },
    net: net.view(),
  });
  // los banners de la cámara (avión, regalo grande) se vacían en cada cuadro: antes se apilaban hasta `newRound`; el avión
  // dice el nombre del regalo que lo pagó
  const momentos = rig.moments.drainBanners();
  if (momentos.length > 0) banners.gift(flow ? flow.nameBanners(momentos) : momentos);
  // D13 y D15: con un panel abierto, o sin hueco para el banner, los banners esperan (ni se dibujan ni corre su tiempo) y después
  // siguen donde estaban. Fuera de la batalla el banner no se desliza: su lugar es exactamente su rectángulo
  const enBatalla = pantalla().kind === null;
  banners.update(
    ts / 1000,
    motion.reduced,
    motion.politica.bannerSlide && enBatalla,
    hayPanelAbierto(ts) || ui.placed.bannerSlot === null,
  );
  ui.draw(ctx, {
    W: canvas.width,
    H: canvas.height,
    now: ts / 1000,
    dt,
    reduced: motion.reduced,
    frame: vistaUi.frame,
    hud,
    hover: hoverFila,
    overlays: superposiciones(ts),
    minimap: minimapVisible(camera.state.kShown),
    screen: pantalla(),
    feed: banners.feed(),
    banner: banners.current(),
    pause: pauseModel(match),
    notices: avisosVisibles(),
    teamColors: scene.teamHex,
  });
  const tipo = pantalla().kind;
  actualizarBotones(hud.controls, tipo === 'matchup' || tipo === 'error'); // sin mundo no hay cámara que mover
  if (vistaUi.f2) {
    // el hash del paso es caro con muchos usuarios (recorre el registro): F2 lo refresca a 2 Hz, no en cada cuadro
    if (hashPaso !== match.world.step && ts - hashTs >= 500) {
      hashPaso = match.world.step;
      hashTs = ts;
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
      session: [...(sesion ? sesion.f2() : sesionApagada && !golden ? sessionOffLines() : []), ...avisosDeConfig],
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
