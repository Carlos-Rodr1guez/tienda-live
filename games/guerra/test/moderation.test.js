import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { createLabelLayer } from '../public/js/render/labels-layer.js';
import { hitLabel } from '../public/js/render/labels.js';
import { createModeration } from '../public/js/ui/moderation.js';
import { createSpotlight } from '../public/js/ui/spotlight.js';
import { helpModel, scoreboardModel, top3Model } from '../public/js/ui/overlays.js';
import { createScreenCache } from '../public/js/ui/screens.js';
import { S } from '../public/js/ui/strings.js';
import { createFakeCtx } from './support/fake-canvas.js';

// Moderación (NM-11, KIT-11, KIT-13): Alt+clic en una etiqueta oculta al donante, Alt+Z deshace sin mostrar el nombre, N
// enmascara todo y las pantallas de resultados (que son una foto) se vuelven a armar. Nada del nombre llega a disco.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const registro = () => createRegistry({ teams: [PAISES[0], PAISES[1]] });
const donante = (r, key, nick, team, coins) => {
  r.touch({ userId: key, nickname: nick });
  r.joinFromChat({ userId: key, nickname: nick, text: String(team) }, 0, 0);
  if (coins) r.addCoins(key, coins, 1);
};
const rect = (key, x = 10, y = 10) => ({ key, x, y, w: 50, h: 10 });
const nombre = (r, k) => r.displayName(k);

function banco({ rects = [rect('a')] } = {}) {
  const r = registro();
  donante(r, 'a', 'ana_23', 1, 40);
  donante(r, 'b', 'beto', 2, 30);
  const cambios = [];
  const m = createModeration({ registry: r, rects: () => rects, onChange: () => cambios.push(1) });
  return { r, m, cambios, rects };
}

test('Alt+clic en el área de una etiqueta oculta al donante: "anónimo" al cuadro siguiente; fuera no oculta nada', () => {
  const { r, m, cambios } = banco();
  assert.equal(m.hideAt({ x: 200, y: 200 }), null);
  assert.equal(nombre(r, 'a'), 'ana_23');
  assert.equal(cambios.length, 0);
  assert.equal(m.hideAt({ x: 30, y: 15 }), 'a');
  assert.equal(nombre(r, 'a'), 'anónimo');
  assert.equal(cambios.length, 1, 'avisa a la interfaz (las pantallas son una foto)');
});

test('Alt+Z deshace en pila, uno por uno, sin mostrar el nombre en el aviso; con la pila vacía lo dice', () => {
  const rects = [rect('a', 10, 10), rect('b', 100, 10)];
  const { r, m } = banco({ rects });
  m.hideAt({ x: 20, y: 12 });
  m.hideAt({ x: 110, y: 12 });
  assert.equal(m.size, 2);
  assert.equal(m.undo(), 'undone');
  assert.equal(nombre(r, 'b'), 'beto', 'el último en ocultarse es el primero en volver');
  assert.equal(nombre(r, 'a'), 'anónimo');
  assert.equal(m.undo(), 'undone');
  assert.equal(nombre(r, 'a'), 'ana_23');
  assert.equal(m.undo(), 'empty');
  for (const t of [S.moderation.hidden, S.moderation.undone, S.moderation.nothingToUndo])
    assert.ok(!/ana_23|beto/.test(t), 'el aviso nunca muestra el nombre');
});

test('ocultar a quien ya está oculto no apila dos veces', () => {
  const { m } = banco();
  m.hideAt({ x: 20, y: 12 });
  m.hideAt({ x: 20, y: 12 });
  assert.equal(m.size, 1);
});

test('N enmascara los nombres (registro) y N otra vez los restaura; llama a invalidar la foto en los dos sentidos', () => {
  const { r, m, cambios } = banco();
  assert.equal(m.toggleNames(), true);
  assert.equal(nombre(r, 'a'), 'anónimo');
  assert.equal(nombre(r, 'b'), 'anónimo');
  assert.equal(m.toggleNames(), false);
  assert.equal(nombre(r, 'a'), 'ana_23');
  assert.equal(cambios.length, 2);
});

test('con una pantalla de resultados a la vista, ocultar un donante, Alt+Z y N la vuelven a armar con el nombre enmascarado', () => {
  const { r, m } = banco();
  const match = {
    state: 'matchEnd',
    round: 2,
    wins: [2, 0],
    winner: 0,
    results: [{ winner: 0 }],
    pause: null,
    pair: {
      teams: [
        { id: 'PE', name: 'Perú', color: '#E5484D' },
        { id: 'MX', name: 'México', color: '#5BC8F5' },
      ],
    },
  };
  const cache = createScreenCache();
  const ctx = { registry: r, paises: PAISES, selection: {} };
  const conCache = createModeration({ registry: r, rects: () => [rect('a')], onChange: () => cache.invalidate() });
  r.startMatch();
  r.addCoins('a', 40, 2);
  const nom = () => cache.get(match, ctx).model.mvp?.name;
  assert.equal(nom(), 'ana_23');
  assert.equal(cache.get(match, ctx), cache.get(match, ctx), 'es una foto: el mismo objeto');
  conCache.hideAt({ x: 20, y: 12 });
  assert.equal(nom(), 'anónimo', 'tras ocultar, en el cuadro siguiente');
  conCache.undo();
  assert.equal(nom(), 'ana_23');
  conCache.toggleNames();
  assert.equal(nom(), 'anónimo', 'con N también');
  assert.ok(m);
});

test('N enmascara el marcador G y el top 3 T; el donante oculto también; todo vuelve con N otra vez', () => {
  const { r, m } = banco();
  r.startMatch();
  r.addCoins('a', 40, 2);
  r.addCoins('b', 30, 2);
  const match = {
    state: 'battle',
    round: 1,
    wins: [1, 0],
    pause: null,
    pair: {
      teams: [
        { id: 'PE', name: 'Perú', color: '#E5484D' },
        { id: 'MX', name: 'México', color: '#5BC8F5' },
      ],
    },
    world: {
      cfg: { round: { winsToMatch: 2 } },
      bases: [
        { hp: 50, maxHp: 100 },
        { hp: 100, maxHp: 100 },
      ],
    },
  };
  const filas = () => top3Model({ match, registry: r }).rows.map((x) => x.name);
  assert.deepEqual(filas(), ['ana_23', 'beto']);
  assert.equal(scoreboardModel({ match, registry: r }).leader.name, 'ana_23');
  m.toggleNames();
  assert.deepEqual(filas(), ['anónimo', 'anónimo']);
  assert.equal(scoreboardModel({ match, registry: r }).leader.name, 'anónimo');
  m.toggleNames();
  r.hide('a');
  assert.deepEqual(filas(), ['anónimo', 'beto']);
  assert.equal(
    top3Model({ match, registry: { ...r, users: r.users, get: r.get, displayName: r.displayName } }).rows.length,
    2,
  );
  const sb = scoreboardModel({ match, registry: r });
  assert.deepEqual(
    sb.teams.map((t) => [t.name, t.wins, t.pct]),
    [
      ['Perú', 1, 50],
      ['México', 0, 100],
    ],
  );
});

test('el marcador y el top 3 sin XP no inventan filas ni líder', () => {
  const r = registro();
  const match = {
    state: 'battle',
    round: 1,
    wins: [0, 0],
    pause: null,
    pair: {
      teams: [
        { id: 'PE', name: 'Perú', color: '#E5484D' },
        { id: 'MX', name: 'México', color: '#5BC8F5' },
      ],
    },
    world: {
      cfg: { round: { winsToMatch: 2 } },
      bases: [
        { hp: 100, maxHp: 100 },
        { hp: 100, maxHp: 100 },
      ],
    },
  };
  assert.deepEqual(top3Model({ match, registry: r }).rows, []);
  assert.equal(top3Model({ match, registry: r }).empty, S.matchEnd.empty);
  assert.equal(scoreboardModel({ match, registry: r }).leader, null);
});

test('la ayuda se arma desde el mapa de teclas', () => {
  const h = helpModel();
  assert.equal(h.title, S.help.title);
  assert.ok(h.lines.length >= 20);
});

test('una etiqueta que se está apagando también responde al clic (nota 40)', () => {
  const ctx = createFakeCtx({ record: true });
  const r = {
    get: () => ({ xp: { match: 10 } }),
    rankOf: () => ({ index: 2, label: 'Cabo' }),
    displayName: () => 'ana_23',
  };
  const layer = createLabelLayer({
    registry: r,
    teamHex: ['#E5484D', '#5BC8F5'],
    spriteAy: { soldado: SPRITES.soldado.ay, jeep: 0, tanque: 0, pesado: 0 },
    marksSize: { soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] },
  });
  const unidad = {
    id: 1,
    side: 0,
    owner: 'ana',
    unitValue: 5,
    kind: 'soldado',
    alive: true,
    x: 300,
    y: 200,
    px: 300,
    py: 200,
  };
  const f = (units, now) => ({
    W: 1920,
    H: 1080,
    u: 4,
    units,
    k: 6,
    screen: { s: 4, ox: 100, oy: 50, device: true, marks: false, x0: 25, y0: 12.5 },
    alpha: 1,
    now,
    spotlight: null,
    onlyRank: false,
    icons: { descs: [], count: 0 },
  });
  for (let t = 0; t < 0.3; t += 1 / 60) layer.draw(ctx, f([unidad], t));
  assert.equal(layer.rects.length, 1);
  const p = { x: layer.rects[0].x + 2, y: layer.rects[0].y + 2 };
  assert.equal(hitLabel(layer.rects, p), 'ana');
  // la unidad se va: la etiqueta se apaga en 120 ms; `rects` ya no la trae, pero `hitRects` sí mientras se ve
  layer.draw(ctx, f([], 0.31));
  assert.equal(layer.rects.length, 0);
  assert.equal(hitLabel(layer.hitRects, p), 'ana', 'apagándose todavía responde');
  for (let t = 0.32; t < 0.6; t += 1 / 60) layer.draw(ctx, f([], t));
  assert.equal(hitLabel(layer.hitRects, p), null, 'ya apagada, ya no');
});

// ---------------------------------------------------------------------------------------------------------------
// Seguir a un donante (S y Shift+S)

test('S sigue al siguiente donante del top que tenga una unidad viva; Shift+S deja de seguir', () => {
  const r = registro();
  donante(r, 'a', 'ana', 1, 100);
  donante(r, 'b', 'beto', 2, 50);
  donante(r, 'c', 'cami', 1, 10);
  r.startMatch();
  r.addCoins('a', 100, 2);
  r.addCoins('b', 50, 2);
  r.addCoins('c', 10, 2);
  const units = [
    { id: 1, owner: 'a', alive: true, x: 10, y: 20, unitValue: 5 },
    { id: 2, owner: 'a', alive: true, x: 30, y: 40, unitValue: 9 },
    { id: 3, owner: 'c', alive: true, x: 70, y: 80, unitValue: 1 },
    { id: 4, owner: 'b', alive: false, x: 5, y: 5, unitValue: 9 },
  ];
  const cam = {
    puntos: [],
    stops: 0,
    follow(g) {
      this.puntos.push(g);
    },
    stopFollow() {
      this.stops++;
    },
  };
  const s = createSpotlight({ registry: r, units: () => units, camera: cam });
  assert.equal(s.next(), 'a');
  assert.deepEqual(cam.puntos.at(-1)(), { x: 30, y: 40 }, 'su unidad viva de más valor');
  assert.equal(s.key, 'a');
  assert.equal(s.next(), 'c', 'b no tiene unidades vivas');
  assert.equal(s.next(), 'a', 'da la vuelta');
  s.stop();
  assert.equal(s.key, null);
  assert.equal(cam.stops, 1);
  units.forEach((u) => (u.alive = false));
  assert.equal(s.next(), null, 'sin donantes en el campo no sigue a nadie');
  assert.equal(cam.puntos.at(-1)(), null);
});

// ---------------------------------------------------------------------------------------------------------------
// NM-11: nada del nombre llega a disco ni al navegador

test('NM-11: el código nuevo no usa almacenamiento del navegador, disco ni sumideros de HTML', () => {
  const PROHIBIDO =
    /localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|outerHTML|insertAdjacentHTML|document\.write|writeFile|appendFile|createWriteStream/;
  for (const f of [
    'audience.js',
    'net-status.js',
    'fonts.js',
    'audio.js',
    'ui/keys.js',
    'ui/input.js',
    'ui/shortcuts.js',
    'ui/moderation.js',
    'ui/spotlight.js',
    'ui/overlays.js',
    'ui/selector.js',
    'ui/safe-zones.js',
  ]) {
    const src = fs
      .readFileSync(path.join(GJ, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(src, PROHIBIDO, f);
  }
});

test('KIT-13: sin comandos de voto ni botón de velocidad ×2 en el código nuevo', () => {
  for (const f of ['audience.js', 'ui/keys.js', 'ui/shortcuts.js']) {
    const src = fs.readFileSync(path.join(GJ, f), 'utf8');
    assert.doesNotMatch(src, /type:\s*'vote'|speed|velocidad/i, f);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// S1 (nota 35): cuando el donante seguido se va, el seguidor se suelta SIN reiniciar el contador de inactividad

test('S1: si getPoint() da null el seguimiento se suelta solo y no cuenta como entrada del narrador (la inactividad sigue corriendo)', async () => {
  const { createCameraController } = await import('../public/js/camera/controller.js');
  const { resolveView } = await import('../public/js/camera/config.js');
  const c = createCameraController({ canvas: { w: 1920, h: 1080 }, view: resolveView({ idleSeconds: 60 }) });
  let vivo = true;
  c.follow(() => (vivo ? { x: 400, y: 300 } : null));
  assert.equal(c.state.mode, 'follow');
  c.update(1);
  c.update(1);
  assert.equal(c.state.mode, 'follow');
  const idle = c.state.idle;
  assert.ok(idle >= 2);
  vivo = false;
  c.update(0.5);
  assert.equal(c.state.mode, 'manual', 'se soltó');
  assert.ok(c.state.idle >= idle + 0.5, `el contador sigue (${c.state.idle} desde ${idle}): no se reinició`);
  // Shift+S (stopFollow) en cambio SÍ es una entrada del narrador: reinicia el contador
  c.follow(() => ({ x: 400, y: 300 }));
  c.update(1);
  c.stopFollow();
  assert.equal(c.state.idle, 0);
});

test('el top 3 muestra como mucho tres filas aunque haya más donantes con XP', () => {
  const r = registro();
  for (const [i, k] of ['a', 'b', 'c', 'd', 'e'].entries()) donante(r, k, 'U' + k, 1 + (i % 2), 0);
  r.startMatch();
  ['a', 'b', 'c', 'd', 'e'].forEach((k, i) => r.addCoins(k, 100 - i * 10, 2));
  const match = {
    state: 'battle',
    round: 1,
    wins: [0, 0],
    pause: null,
    pair: {
      teams: [
        { id: 'PE', name: 'Perú', color: '#E5484D' },
        { id: 'MX', name: 'México', color: '#5BC8F5' },
      ],
    },
    world: {
      cfg: { round: { winsToMatch: 2 } },
      bases: [
        { hp: 1, maxHp: 1 },
        { hp: 1, maxHp: 1 },
      ],
    },
  };
  const t = top3Model({ match, registry: r });
  assert.equal(t.rows.length, 3);
  assert.deepEqual(
    t.rows.map((x) => x.name),
    ['Ua', 'Ub', 'Uc'],
  );
  assert.equal(t.empty, null);
});
