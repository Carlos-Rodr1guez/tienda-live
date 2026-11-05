// Arranque del juego: carga configuración, arma mundo + render + HUD y corre el bucle.

import { DEFAULT_CONFIG, deepMerge } from './sim/defaults.js';
import { World } from './sim/world.js';
import { ViewerRouter } from './sim/events.js';
import { GameRenderer } from './render/renderer.js';
import { Overlay } from './render/overlay.js';
import { Hud } from './ui/hud.js';
import { SimulatorPanel } from './ui/simulator.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { connectBridge } from './net.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

async function loadConfig() {
  if (window.ASEDIO_DEMO || params.has('demo')) return { cfg: DEFAULT_CONFIG, server: null };
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    return { cfg: deepMerge(DEFAULT_CONFIG, data.game || {}), server: data };
  } catch {
    return { cfg: DEFAULT_CONFIG, server: null };
  }
}

const STATUS_TEXT = {
  bridge: ['warn', 'PUENTE OK'],
  'bridge-lost': ['err', 'SIN PUENTE'],
  'sin-usuario': ['warn', 'SIN USUARIO'],
  conectando: ['warn', 'CONECTANDO…'],
  conectado: ['ok', 'EN VIVO'],
  offline: ['warn', 'ESPERANDO LIVE'],
  desconectado: ['err', 'RECONECTANDO'],
  fin: ['warn', 'LIVE TERMINADO'],
  error: ['err', 'ERROR'],
};

async function boot() {
  const { cfg, server } = await loadConfig();
  const demo = !server;

  const world = new World(cfg);
  const glCanvas = $('gl');
  const renderer = new GameRenderer(glCanvas, world, cfg, {
    bloom: params.get('bloom') !== '0',
    cinematics: params.get('cine') !== '0',
    pixelRatio: params.get('pr'),
  });
  if (params.get('cam')) {
    // ajuste fino de cámara para pruebas: ?cam=x,y,z,lookX,lookY,lookZ,fov
    const [x, y, z, lx, ly, lz, fov] = params.get('cam').split(',').map(Number);
    renderer.camPos.set(x, y, z);
    renderer.camLook.set(lx, ly, lz);
    if (fov) {
      renderer.camera.fov = fov;
      renderer.camera.updateProjectionMatrix();
    }
  }
  const overlay = new Overlay($('ov'), renderer, world);
  let hud;
  const router = new ViewerRouter(world, cfg, {
    feed: (m) => hud?.feed(m),
    banner: (b) => hud?.banner(b),
  });
  hud = new Hud(cfg, world, router);
  renderer.onCine = (state, c) => hud.cine(state, c);
  $('hud').classList.add('hidden'); // se muestra al pulsar JUGAR
  const sfx = new Sfx(cfg.audio?.volume ?? 0.5, {
    music: cfg.audio?.music !== false && params.get('music') !== '0',
    musicVolume: cfg.audio?.musicVolume ?? 0.35,
  });
  const sim = new SimulatorPanel($('sim'), (evt) => router.handle(evt));

  let running = false;
  const start = () => {
    if (running) return;
    running = true;
    sfx.unlock();
    $('start').classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (demo) sim.setAuto('mid');
  };
  $('startBtn').addEventListener('click', start);

  const input = new Input($('game'), renderer, {
    toggleSim: () => {
      sim.toggle();
      layout();
    },
    toggleSafe: () => hud.toggleSafe(),
    toggleMute: () => sfx.toggleMute(),
    toggleHud: () => hud.toggleHud(),
    toggleNames: () => {
      overlay.showNames = !overlay.showNames;
    },
    toggleCam: () => hud.toggleCam(),
    start,
  });

  // ---------------------------------------------------------------- tamaño 9:16
  const game = $('game');
  const app = $('app');
  function layout() {
    const cs = getComputedStyle(app);
    const W = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const wantsPanel = sim.el.classList.contains('on');
    const docked = wantsPanel && W - Math.round((H * 9) / 16) >= 330;
    sim.floating = wantsPanel && !docked;
    sim.el.classList.toggle('floating', sim.floating);
    sim.fab.classList.toggle('on', demo && !wantsPanel && W < Math.round((H * 9) / 16) + 330);
    const availW = docked ? W - 316 : W;
    let h = H;
    let w = Math.round((h * 9) / 16);
    if (w > availW) {
      w = availW;
      h = Math.round((w * 16) / 9);
    }
    game.style.width = `${w}px`;
    game.style.height = `${h}px`;
    game.style.fontSize = `${(h / 960) * 16}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(w, h);
    overlay.resize(w, h, dpr);
  }
  sim.onToggle = () => layout();
  window.addEventListener('resize', layout);

  // con espacio de sobra y en modo demo, el simulador se muestra al lado
  if (demo && app.clientWidth - Math.round((app.clientHeight * 9) / 16) >= 360) sim.show(true);
  layout();

  // ---------------------------------------------------------------- modelos y miniaturas
  try {
    let found = [];
    if (window.ASEDIO_MODELS) {
      // demo de un solo archivo: los modelos vienen dentro de la página en base64
      const embedded = {};
      for (const [name, b64] of Object.entries(window.ASEDIO_MODELS)) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        embedded[name] = bytes.buffer;
      }
      found = await renderer.models.loadOverrides('', null, embedded);
    } else if (server) {
      found = await renderer.models.loadOverrides('models/', server.models || null);
    }
    renderer.applySceneModels();
    if (found.length) console.info('[modelos] usando .glb para:', found.join(', '));
  } catch (err) {
    console.warn('[modelos] se usan los modelos por código:', err);
  }
  try {
    hud.setThumbs(renderer.thumbnails());
  } catch (err) {
    console.warn('miniaturas', err);
  }

  // ---------------------------------------------------------------- conexión con TikTok
  if (server) {
    const user = server.tiktokUsername ? `@${server.tiktokUsername}` : '';
    hud.setConn('warn', 'CONECTANDO…');
    $('startInfo').textContent = user
      ? `Conectando con el LIVE de ${user}…`
      : 'Sin usuario de TikTok en config.json: solo simulador (F1).';
    const wsUrl = params.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    connectBridge(wsUrl, {
      onEvent: (evt) => router.handle(evt),
      onStatus: (s) => {
        const [cls, text] = STATUS_TEXT[s.state] || ['warn', String(s.state || '').toUpperCase()];
        hud.setConn(cls, s.state === 'conectado' && s.username ? `EN VIVO @${s.username}` : text);
        if (s.message) $('startInfo').textContent = s.message;
        else if (s.state === 'conectado') $('startInfo').textContent = `Conectado al LIVE de @${s.username}.`;
      },
    });
  } else {
    hud.setConn('', 'DEMO');
    $('startInfo').textContent = 'Modo demo: el público es simulado. Abre el simulador con F1.';
  }

  // ---------------------------------------------------------------- bucle
  let last = performance.now();
  function frame(now) {
    // el reloj de requestAnimationFrame puede ir unos ms detrás: nunca un paso negativo
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const inp = input.read();
    if (running) world.update(dt, inp);
    const fx = world.drainFx();
    renderer.handleFx(fx);
    sfx.handle(fx);
    hud.handleFx(fx);
    renderer.update(dt);
    renderer.render();
    overlay.aim = inp.aim;
    overlay.draw();
    hud.update(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (params.has('autostart')) start();

  // acceso para depurar desde la consola
  window.__asedio = { world, router, renderer, hud, sim, start, cfg, sfx };
}

boot().catch((err) => {
  console.error(err);
  const info = document.getElementById('startInfo');
  if (info) info.textContent = `Error al iniciar: ${err.message}`;
});
