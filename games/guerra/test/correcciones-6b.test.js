import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { buildRouter, createAudience, createFlow } from '../public/js/audience.js';
import { createGestures } from '../public/js/camera/gestures.js';
import { createPresenceGuard } from '../public/js/sim/presence.js';
import { Sfx } from '../public/js/audio.js';
import { createUi } from '../public/js/ui/draw.js';
import { chipRect } from '../public/js/ui/hud-draw.js';
import { createInput, createPresenceFeed } from '../public/js/ui/input.js';
import { isEditing } from '../public/js/ui/keys.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { createModeration } from '../public/js/ui/moderation.js';
import { overlayRects } from '../public/js/ui/overlays-draw.js';
import { cardRects } from '../public/js/ui/screens-draw.js';
import { screenFor } from '../public/js/ui/screens.js';
import { createShortcuts } from '../public/js/ui/shortcuts.js';
import { createSpotlight } from '../public/js/ui/spotlight.js';
import { S } from '../public/js/ui/strings.js';
import { findForbidden } from './support/forbidden-words.js';
import { createFakeCtx } from './support/fake-canvas.js';
import { arrancar } from './support/fake-main.js';

// Ronda de correcciones del lote 6 (C1 a C29): frontera del adaptador, presencia, teclas y foco, avisos, ayuda, chip de red,
// moderación y cableado en main.js.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const GP = fileURLToPath(new URL('..', import.meta.url));
const registro = () => createRegistry({ teams: [PAISES[0], PAISES[1]] });
const hay = (e, re) => e.textos().some((t) => re.test(t));
const usuario = (id, nick = 'Ana') => ({ userId: id, uniqueId: id, nickname: nick, avatar: '' });
const regalo = (id, coins, extra = {}) => ({
  type: 'gift',
  ...usuario(id),
  giftId: 'g',
  giftName: 'Rose',
  coins,
  count: 1,
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------------
// P1. Corrección y frontera

test('C1: nickname, uniqueId, userId y giftName como objeto, arreglo, función o número no lanzan en la frontera', () => {
  const registry = registro();
  const audience = createAudience({ registry, router: buildRouter({}).router });
  const raros = [
    { toString: 1 },
    { toString: () => 'x' },
    [],
    [1, 2],
    () => 1,
    Symbol.iterator.description,
    42,
    true,
    null,
    Object.create(null),
  ];
  for (const r of raros) {
    for (const campo of ['nickname', 'uniqueId', 'userId', 'giftName', 'text']) {
      for (const tipo of ['gift', 'chat', 'like', 'follow']) {
        const evt = { type: tipo, ...usuario('u1'), coins: 5, count: 1, [campo]: r };
        assert.doesNotThrow(() => audience.translate(evt), `${tipo}.${campo}`);
      }
    }
  }
  assert.doesNotThrow(() => audience.translate({ type: 'gift', nickname: { toString: 1 }, coins: 5 }));
});

test('C1: ready() con un evento que lanza aplica los demás y no lanza', () => {
  const log = [];
  const match = {
    world: { step: 1 },
    pair: null,
    command(c) {
      if (c.coins === 2) throw new Error('boom');
      log.push(c.coins);
      return { ok: true };
    },
  };
  const registry = registro();
  const flow = createFlow({
    audience: createAudience({ registry, router: buildRouter({}).router }),
    match,
    rig: { bigGift() {} },
    banners: { note() {} },
  });
  for (const c of [1, 2, 3]) flow.push(regalo(`u${c}`, c));
  assert.doesNotThrow(() => flow.ready());
  assert.deepEqual(log, [1, 3]);
  assert.equal(flow.dropped(), 1, 'se cuenta el que se perdió');
  assert.doesNotThrow(() => flow.push(regalo('u9', 2)));
});

test('C4: bigUnits, eventCaps y giftOverrides de otro tipo son ConfigError (pantalla de error), y un override con unidad desconocida avisa', () => {
  for (const game of [
    { bigUnits: 5 },
    { bigUnits: 'tanque' },
    { bigUnits: [1] },
    { eventCaps: 5 },
    { giftOverrides: 'x' },
    { giftOverrides: { Rose: 5 } },
    { maxPerEvent: 'a' },
    { tiers: 3 },
  ])
    assert.throws(() => buildRouter(game), ConfigError, JSON.stringify(game));
  const { warnings } = buildRouter({ giftOverrides: { Rose: { unit: 'tanques', count: 2 } } });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tanques/);
});

test('C4: con bigUnits inválido la página muestra la pantalla de error de config (no queda en blanco) y un aviso del router sale en F2', async () => {
  const fetch = async (u) =>
    String(u) === '/api/config'
      ? { ok: true, json: async () => ({ game: { bigUnits: 5 }, serverMode: false }) }
      : { ok: false };
  const e = await arrancar('?f2', { fetch, selector: true });
  e.cuadros(4);
  assert.ok(hay(e, /^La configuración tiene un error: bigUnits/), 'error de config');
  const f = await arrancar('?f2', {
    fetch: async (u) =>
      String(u) === '/api/config'
        ? { ok: true, json: async () => ({ game: { giftOverrides: { Rose: { unit: 'tanques' } } } }) }
        : { ok: false },
    selector: true,
  });
  f.cuadros(4);
  assert.equal(f.f2()[S.f2.configWarning] !== undefined, true, 'F2 muestra el aviso');
});

test('C5 (D7): monedas × cantidad no pasa de 10 000 000: se recorta la cantidad, no se descarta el regalo', () => {
  const registry = registro();
  const audience = createAudience({ registry, router: buildRouter({}).router });
  const r = audience.translate(regalo('u1', 9_000_000, { count: 999 }));
  assert.ok(r, 'el regalo no se descarta');
  assert.ok(r.cmd.coins <= 10_000_000, `${r.cmd.coins}`);
  assert.equal(audience.translate(regalo('u1', 1e300, { count: 1e9 })).cmd.coins <= 10_000_000, true);
  assert.equal(audience.translate(regalo('u2', 100, { count: 3 })).cmd.coins, 300, 'lo normal no se toca');
});

test('C7: cuando la cámara suelta sola al seguido, el foco de las etiquetas también se limpia', () => {
  const r = registro();
  r.touch({ userId: 'a', nickname: 'A' });
  r.joinFromChat({ userId: 'a', nickname: 'A', text: '1' }, 0, 0);
  r.startMatch();
  r.addCoins('a', 10, 1);
  const units = [{ id: 1, owner: 'a', alive: true, x: 1, y: 2, unitValue: 1 }];
  let punto;
  const s = createSpotlight({
    registry: r,
    units: () => units,
    camera: { follow: (g) => (punto = g), stopFollow() {} },
  });
  assert.equal(s.next(), 'a');
  assert.deepEqual(punto(), { x: 1, y: 2 });
  units[0].alive = false;
  assert.equal(punto(), null);
  assert.equal(s.key, null, 'el foco ya no apunta a un donante que no está');
});

test('C8: Alt+clic sobre quien ya estaba oculto (p. ej. restaurado de la copia) no lo apila: Alt+Z nunca lo muestra', () => {
  const r = registro();
  r.touch({ userId: 'a', nickname: 'Ana' });
  r.hide('a');
  const m = createModeration({ registry: r, rects: () => [{ key: 'a', x: 0, y: 0, w: 10, h: 10 }] });
  m.hideAt({ x: 1, y: 1 });
  assert.equal(m.size, 0);
  assert.equal(m.undo(), 'empty');
  assert.equal(r.displayName('a'), 'anónimo', 'sigue oculto');
});

// ---------------------------------------------------------------------------------------------------------------
// Presencia, teclas y foco

function entorno({ editable = false } = {}) {
  const oyentes = { win: new Map(), canvas: new Map() };
  const add = (m) => (t, f) => m.set(t, [...(m.get(t) ?? []), f]);
  const win = { addEventListener: add(oyentes.win) };
  const canvas = {
    width: 1920,
    height: 1080,
    addEventListener: add(oyentes.canvas),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const reloj = { t: 0 };
  const guard = createPresenceGuard({ minutes: 5, now: () => reloj.t });
  const match = {
    state: 'battle',
    pause: null,
    command(c) {
      match.log.push(c.type);
      if (c.type === 'pause') match.pause = c.by;
      if (c.type === 'resume') match.pause = null;
      return { ok: true };
    },
    log: [],
  };
  guard.update('battle', 0);
  const sh = createShortcuts({
    now: () => reloj.t,
    match,
    camera: {},
    rig: { hottest() {} },
    advance() {},
    avisar() {},
    motion: { toggle: () => true },
    moderation: {},
    spotlight: {},
    view: { help: false, safe: false, f2: false, frame: true, scoreboardUntil: 0, top3Until: 0 },
    sim: null,
    audio: null,
    blocked: () => false,
  });
  const corridas = [];
  createInput({
    win,
    canvas,
    shortcuts: { run: (id, e) => (corridas.push(id), sh.run(id, e)) },
    raw: () => false,
    gestures: { down() {}, move() {}, up: () => ({ tap: false }), cancel() {}, wheel() {} },
    presence: createPresenceFeed({ guard, match, now: () => reloj.t }),
    pointer: { advance: () => false, click() {}, hover() {} },
    arrows() {},
    unload: () => false,
    blocked: () => false,
  });
  const lanzar = (donde, type, e = {}) => {
    const ev = {
      type,
      isTrusted: true,
      preventDefault() {
        ev.evitado = true;
      },
      ...e,
    };
    for (const f of oyentes[donde].get(type) ?? []) f(ev);
    return ev;
  };
  return { lanzar, guard, reloj, match, corridas, editable };
}

test('C2 (NM-8): un clic de confianza en un botón del DOM (cámara, panel F1) reinicia la guardia; uno no confiable no', () => {
  const e = entorno();
  e.reloj.t = 4 * 60000;
  e.lanzar('win', 'pointerdown', { pointerType: 'mouse', isTrusted: false, target: { tagName: 'BUTTON' } });
  e.reloj.t = 5 * 60000;
  assert.equal(e.guard.tick(e.reloj.t), 'idle');
  e.lanzar('win', 'pointerdown', { pointerType: 'mouse', target: { tagName: 'BUTTON' } });
  assert.equal(e.guard.tick(e.reloj.t), 'active', 'el clic en el botón cuenta');
});

test('C3: P durante una pausa de presencia levanta esa pausa y NO la deja en pausa manual', () => {
  const e = entorno();
  e.reloj.t = 6 * 60000;
  e.match.command({ type: 'pause', by: 'presence' });
  assert.equal(e.match.pause, 'presence');
  e.lanzar('win', 'keydown', { key: 'p', target: { tagName: 'BODY' } });
  assert.equal(e.match.pause, null, 'la pausa de presencia se levantó y nada la volvió a poner');
  e.lanzar('win', 'keydown', { key: 'p', target: { tagName: 'BODY' } });
  assert.equal(e.match.pause, 'manual', 'una P posterior sí pausa a mano');
});

test('C11: solo bloquean los atajos los campos de texto; un checkbox, un radio o un botón no', () => {
  for (const type of ['text', 'search', 'email', 'number', 'password', 'url', 'tel', undefined, ''])
    assert.equal(isEditing({ tagName: 'INPUT', type }), true, String(type));
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'range'])
    assert.equal(isEditing({ tagName: 'INPUT', type }), false, type);
  assert.equal(isEditing({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditing({ tagName: 'SELECT' }), true);
  assert.equal(isEditing({ tagName: 'BUTTON' }), false);
  const e = entorno();
  e.lanzar('win', 'keydown', { key: 'g', target: { tagName: 'INPUT', type: 'checkbox' } });
  assert.deepEqual(e.corridas, ['scoreboard'], 'con foco en un checkbox el atajo sí actúa');
});

test('C11: Espacio o Enter con foco en un botón activan el botón y no el atajo', () => {
  const e = entorno();
  for (const key of [' ', 'Enter']) e.lanzar('win', 'keydown', { key, target: { tagName: 'BUTTON' } });
  assert.deepEqual(e.corridas, []);
  e.lanzar('win', 'keydown', { key: ' ', target: { tagName: 'BODY' } });
  assert.deepEqual(e.corridas, ['hottest']);
});

test('C11: en el selector Tab y las flechas son del selector solo con el foco en el escenario o el cuerpo; dentro del panel F1, no', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true });
  e.cuadros(3, 100);
  const antes = e.ctx.calls.filter((c) => c[0] === 'fillRect').length;
  const t = e.tecla('Tab', { target: { tagName: 'BUTTON' } });
  assert.notEqual(t.evitado, true, 'Tab dentro del panel sigue al navegador');
  const b = e.tecla('Tab', { target: { tagName: 'BODY' } });
  assert.equal(b.evitado, true, 'Tab en el cuerpo es del selector');
  assert.ok(antes >= 0);
});

test('C12: audio: sin archivos unlock() y load() no hacen nada ni lanzan; con archivos unlock crea el contexto y load pide cada archivo', async () => {
  const pedidos = [];
  const mudo = new Sfx({ fetch: async (u) => pedidos.push(u), AudioContextCtor: class {} });
  mudo.unlock();
  await mudo.load();
  assert.deepEqual(pedidos, []);
  class Ctx {
    createGain() {
      return { gain: {}, connect() {} };
    }
    decodeAudioData(ab, ok) {
      ok({ ab });
    }
  }
  const con = new Sfx({
    files: ['boom'],
    fetch: async (u) => (pedidos.push(u), { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
    AudioContextCtor: Ctx,
  });
  con.unlock();
  assert.ok(con.ctx, 'el contexto se crea al primer gesto');
  await con.load();
  assert.deepEqual(pedidos, ['sounds/boom.mp3']);
  assert.ok(con.buf.boom, 'el archivo se cargó y quedó listo para reproducir');
});

// ---------------------------------------------------------------------------------------------------------------
// Atajos de superposición y avisos

test('C17 (D3): abrir H cierra G y T, y abrir G o T cierra H', () => {
  const view = { help: false, safe: false, f2: false, frame: true, scoreboardUntil: 0, top3Until: 0 };
  const t = { now: 0 };
  const sh = createShortcuts({
    now: () => t.now,
    match: { state: 'battle' },
    camera: {},
    rig: {},
    advance() {},
    avisar() {},
    motion: {},
    moderation: {},
    spotlight: {},
    view,
    sim: null,
    audio: null,
    blocked: () => false,
  });
  sh.run('scoreboard');
  sh.run('top3');
  assert.ok(view.scoreboardUntil > 0 && view.top3Until > 0);
  sh.run('help');
  assert.equal(view.help, true);
  assert.equal(view.scoreboardUntil + view.top3Until, 0, 'H cerró G y T');
  sh.run('scoreboard');
  assert.equal(view.help, false, 'G cerró H');
  sh.run('help');
  sh.run('top3');
  assert.equal(view.help, false, 'T cerró H');
});

test('C14: un aviso nuevo de la misma familia reemplaza al anterior; la confirmación de Esc ×2 y de Shift+N ×2 se va al confirmar', async () => {
  const e = await arrancar('');
  e.cuadros(10, 100);
  e.tecla('n');
  e.cuadros(1, 100);
  e.tecla('n');
  e.cuadros(1, 100);
  assert.ok(e.textos().includes(S.moderation.namesShown));
  assert.ok(!e.textos().includes(S.moderation.namesHidden), 'un solo aviso de nombres');
  e.tecla('Escape');
  e.cuadros(1, 100);
  assert.ok(e.textos().includes(S.keys.endConfirm));
  e.tecla('Escape');
  e.cuadros(1, 100);
  assert.ok(e.textos().includes(S.keys.ended));
  assert.ok(!e.textos().includes(S.keys.endConfirm), 'la confirmación se fue al confirmar');
  const s = await arrancar('', { selector: true, servidor: true });
  s.tecla('N', { shiftKey: true });
  s.cuadros(1, 100);
  assert.ok(s.textos().includes(S.newLive.confirm));
  s.tecla('N', { shiftKey: true });
  s.cuadros(1, 100);
  assert.ok(s.textos().includes(S.newLive.done));
  assert.ok(!s.textos().includes(S.newLive.confirm));
  const v = await arrancar('', { selector: true });
  v.tecla('N', { shiftKey: true });
  v.cuadros(1, 100);
  v.cuadros(30, 100); // pasan 3 s: venció su ventana de 2 s
  assert.ok(!v.textos().includes(S.newLive.confirm), 'la confirmación vence con su ventana');
});

const AVISOS = [
  S.newLive.confirm,
  S.newLive.done,
  S.newLive.blocked,
  S.keys.endConfirm,
  S.keys.ended,
  S.motion.on,
  S.motion.off,
  S.audio.on,
  S.audio.off,
  S.camera.autoOn,
  S.camera.autoOff,
  S.moderation.hidden,
  S.moderation.undone,
  S.moderation.nothingToUndo,
  S.moderation.namesHidden,
  S.moderation.namesShown,
  S.spotlight.none,
  S.spotlight.stopped,
];

test('C15: todo aviso de S se dibuja entero (sin "…") en 480×270 y 640×360, y en el selector no corta las listas', () => {
  const match = { state: 'matchup', pause: null, wins: [0, 0], round: 1, pair: null };
  for (const [W, H] of [
    [480, 270],
    [640, 360],
    [1920, 1080],
  ]) {
    for (const texto of AVISOS) {
      const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
      const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
      const screen = screenFor(match, { registry: null, paises: PAISES, selection: {} });
      ui.draw(ctx, {
        W,
        H,
        now: 1,
        dt: 0,
        reduced: false,
        frame: true,
        hud: null,
        screen,
        notices: [texto],
        overlays: null,
      });
      const L = layoutFor(W, H);
      const lineas = ctx.calls.filter(
        (c) =>
          c[0] === 'fillText' && texto.includes(String(c[1]).replace(/…$/, '').slice(0, 6)) && String(c[1]).length > 3,
      );
      const partes = lineas.map((c) => String(c[1]));
      assert.ok(
        partes.every((p) => !p.endsWith('…')),
        `${W}x${H}: "${texto}" se recortó: ${partes.join(' | ')}`,
      );
      assert.equal(partes.join(' ').replace(/\s+/g, ' ').trim(), texto, `${W}x${H}: el aviso se dibuja entero`);
      // el aviso va en su lugar libre: no corta las listas ni la vista previa del selector (solapes-6b.test.js lo cubre a fondo)
      for (const r of ui.placed.toasts)
        for (const c of cardRects(L, 'matchup', screen.model))
          assert.ok(!solapa(r, c), `${W}x${H}: el aviso pisa el selector`);
    }
  }
});

test('C16: la ayuda H trae cada acción, el clic y el Alt+clic, sin glifos que las fuentes pixel no tengan, y ninguna línea se recorta', async () => {
  const { helpModel } = await import('../public/js/ui/overlays.js');
  const { KEYMAP } = await import('../public/js/ui/keys.js');
  const m = helpModel();
  for (const a of KEYMAP)
    assert.ok(
      m.lines.some((l) => l.id === a.id),
      a.id,
    );
  assert.ok(m.lines.some((l) => l.id === 'click') && m.lines.some((l) => l.id === 'altClick'));
  for (const l of m.lines) assert.doesNotMatch(`${l.keys} ${l.text}`, /[←-⇿−]/, 'flechas y signo menos Unicode');
  for (const [W, H] of [
    [480, 270],
    [640, 360],
  ]) {
    const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
    const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
    ui.draw(ctx, {
      W,
      H,
      now: 1,
      dt: 0,
      reduced: false,
      frame: true,
      hud: null,
      screen: { kind: null },
      notices: [],
      overlays: { help: m },
    });
    const textos = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
    assert.ok(
      textos.every((t) => !t.endsWith('…')),
      `${W}x${H}: ${textos.filter((t) => t.endsWith('…')).join(' | ')}`,
    );
    for (const l of m.lines) assert.ok(textos.includes(l.text) && textos.includes(l.keys), `${W}x${H}: ${l.id}`);
  }
});

test('C19 (D2): "activado / desactivado" en todos los avisos de dos estados', () => {
  for (const par of [S.motion, S.audio, { on: S.camera.autoOn, off: S.camera.autoOff }]) {
    assert.match(par.on, /: activad[oa]$/);
    assert.match(par.off, /: desactivad[oa]$/);
  }
  assert.match(S.audio.off, /^Sonido: desactivado$/);
});

test('C20: el velo de la pausa dura 200 ms también con movimiento reducido (tabla 10.3: "Igual")', () => {
  const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
  const alfas = [];
  for (const [now, visible] of [
    [0, false],
    [1, true],
    [1.1, true],
    [1.3, true],
  ]) {
    const ctx = createFakeCtx({ record: true });
    ui.draw(ctx, {
      W: 1920,
      H: 1080,
      now,
      dt: 0,
      reduced: true,
      frame: true,
      hud: null,
      screen: { kind: null },
      pause: { visible, text: S.pause },
      notices: [],
    });
    alfas.push(ctx.calls.filter((c) => c[0] === 'set:globalAlpha' && c[1] > 0 && c[1] < 1).map((c) => c[1]));
  }
  assert.ok(alfas[2].length > 0, 'a mitad de camino el velo no es ni 0 ni 1');
  assert.equal(alfas[3].length, 0, 'a los 200 ms ya está completo');
});

// ---------------------------------------------------------------------------------------------------------------
// Chip de conexión (D5): su rectángulo no pisa ningún panel, tarjeta ni superposición

const solapa = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('C13: el chip de conexión no pisa ningún panel, tarjeta, chip ni superposición en ninguna pantalla (480×270, 640×360, 512×288)', () => {
  const equipos = [
    { id: 'PE', name: 'Perú', color: '#E5484D' },
    { id: 'MX', name: 'México', color: '#5BC8F5' },
  ];
  const partido = (state, extra = {}) => ({
    state,
    round: 1,
    wins: [1, 0],
    winner: 0,
    results: [{ winner: 0 }],
    pause: null,
    pair: state === 'matchup' ? null : { teams: equipos },
    world: {
      cfg: { round: { winsToMatch: 2 } },
      bases: [
        { hp: 1, maxHp: 1 },
        { hp: 1, maxHp: 1 },
      ],
    },
    ...extra,
  });
  const reg = registro();
  reg.touch({ userId: 'a', nickname: 'Ana' });
  reg.joinFromChat({ userId: 'a', nickname: 'Ana', text: '1' }, 0, 0);
  reg.startMatch();
  reg.addCoins('a', 50, 1);
  const textosChip = [
    S.connection.demo,
    S.connection.connecting,
    S.connection.connected,
    S.connection.reconnecting,
    S.connection.noUser,
    S.connection.noConnection,
  ];
  for (const [W, H] of [
    [480, 270],
    [640, 360],
    [512, 288],
  ]) {
    const L = layoutFor(W, H);
    const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
    ui.draw(createFakeCtx({ record: true, fontScale: 0.6 }), {
      W,
      H,
      now: 1,
      dt: 0,
      reduced: false,
      hud: null,
      screen: { kind: null },
      notices: [],
    });
    for (const estado of ['matchup', 'lobby', 'intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd', 'error']) {
      const m = partido(estado);
      const screen = screenFor(m, {
        registry: reg,
        paises: PAISES,
        selection: { left: 'PE', right: 'MX' },
        error: estado === 'error' ? { kind: 'config', detail: 'x' } : null,
      });
      const obstaculos = [];
      for (const k of ['panelL', 'panelR', 'center', 'feed', 'minimap', 'frame', 'buttons'])
        if (L[k] && ['intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd'].includes(estado))
          obstaculos.push([k, L[k]]);
      if (['intro', 'battle'].includes(estado)) obstaculos.push(['railL', L.railL], ['railR', L.railR]);
      if (screen.kind)
        cardRects(L, screen.kind, screen.model).forEach((r, i) => obstaculos.push([`${screen.kind}#${i}`, r]));
      const adv = ui.advanceRect(W, H, screen, true);
      if (adv) obstaculos.push(['avance', adv]);
      if (estado === 'battle')
        overlayRects(L, { scoreboard: 1, top3: 1 }).forEach((r, i) => obstaculos.push([`overlay#${i}`, r]));
      if (estado === 'battle') overlayRects(L, { help: 1 }).forEach((r) => obstaculos.push(['ayuda', r]));
      for (const t of textosChip) {
        const r = chipRect(ui.painter, L, t);
        for (const [nombre, o] of obstaculos)
          assert.ok(!solapa(r, o), `${W}x${H} ${estado}: el chip "${t}" pisa ${nombre}`);
        assert.ok(r.x >= 0 && r.y + r.h <= H && r.x + r.w <= W, 'dentro del lienzo');
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Cableado en main.js

test('C9 y C26: terminar el partido NO vacía lo ocultado; ocultar o N con la foto de resultados a la vista la vuelve a armar con el nombre enmascarado', async () => {
  const e = await arrancar('?donantes&carga&rapido=60');
  let fin = false;
  for (let i = 0; i < 6000 && !fin; i++) {
    e.cuadros(1, 100);
    fin = hay(e, /^¡.+ gana la batalla!$/);
    if (!fin && hay(e, /^El narrador inicia la siguiente ronda$/)) e.tecla('Enter');
  }
  assert.ok(fin, 'llegó al final del partido');
  const mvp = () => {
    const t = e.textos();
    return t[t.indexOf('MVP del partido') + 1];
  };
  const original = mvp();
  assert.ok(original && original !== 'anónimo', `el MVP del partido muestra su nombre (${original})`);
  e.tecla('n');
  e.cuadros(2, 100);
  assert.equal(
    mvp(),
    'anónimo',
    'N enmascara la foto de resultados en el cuadro siguiente (onChange de main.js invalida la foto)',
  );
  e.tecla('n');
  e.cuadros(2, 100);
  assert.equal(mvp(), original, 'N otra vez la restaura');
});

test('C10: ocultar o N invalidan los paneles G y T (cache de 200 ms): el nombre del líder sale enmascarado en el cuadro siguiente', async () => {
  const e = await arrancar('?f2&donantes&rapido=20');
  for (let i = 0; i < 40; i++) e.cuadros(1, 100);
  e.tecla('g');
  e.cuadros(2, 100);
  assert.ok(
    e.textos().some((t) => t === 'ana_23' || t === 'bea_77' || /^(xX_|田|😀)/.test(t)),
    'el marcador muestra al líder',
  );
  e.tecla('n');
  e.cuadros(1, 1); // 1 ms de reloj de cuadros: dentro de los 200 ms del refresco normal
  const lider = e.textos().filter((t) => t === 'anónimo');
  assert.ok(lider.length >= 1, 'en el cuadro siguiente el líder dice anónimo');
});

test('C24: F2 refresca el hash del paso a 2 Hz y no en cada cuadro', async () => {
  const e = await arrancar('?f2');
  e.cuadros(90, 100); // pasa la intro: el hash es el del paso del mundo y este avanza en batalla
  const valores = new Set();
  for (let i = 0; i < 20; i++) {
    e.cuadros(1, 16);
    valores.add(e.f2()[S.f2.hash]);
  }
  assert.ok(valores.size <= 2, `${valores.size} valores distintos en 20 cuadros (~0,3 s): se refresca cada 0,5 s`);
  e.cuadros(60, 16);
  valores.add(e.f2()[S.f2.hash]);
  assert.ok(valores.size >= 2, 'con el tiempo sí cambia');
});

test('C27 (NM-11): una sesión completa (unión, regalos, Alt+clic, Alt+Z, N y Nuevo en vivo) no llama a localStorage, indexedDB ni a la escritura de fs', async () => {
  const llamadas = [];
  const espia = (nombre) =>
    new Proxy(
      {},
      {
        get:
          (_, k) =>
          (...a) => (llamadas.push(`${nombre}.${String(k)}`), a.length),
      },
    );
  globalThis.localStorage = espia('localStorage');
  globalThis.sessionStorage = espia('sessionStorage');
  globalThis.indexedDB = espia('indexedDB');
  for (const f of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'writeSync'])
    mock.method(fs, f, () => llamadas.push(`fs.${f}`));
  mock.method(fs.promises, 'writeFile', async () => llamadas.push('fs.promises.writeFile'));
  try {
    const e = await arrancar('?donantes&rapido=20');
    for (let i = 0; i < 40; i++) e.cuadros(1, 100);
    const rango = /^(RECLUTA|SOLDADO|CABO|SARGENTO|TENIENTE|CAPITÁN|MAYOR|CORONEL|GENERAL) /;
    const llamada = e.ctx.calls.find((c) => c[0] === 'fillText' && rango.test(c[1]));
    assert.ok(llamada, 'hay una etiqueta');
    for (const t of ['pointerdown', 'pointerup'])
      e.puntero(t, { clientX: llamada[2] + 1, clientY: llamada[3], altKey: true });
    e.tecla('z', { altKey: true });
    e.tecla('n');
    e.tecla('n');
    e.tecla('Escape');
    e.tecla('Escape');
    e.cuadros(3, 100);
    e.tecla('N', { shiftKey: true });
    e.tecla('N', { shiftKey: true });
    e.cuadros(3, 100);
  } finally {
    mock.restoreAll();
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.indexedDB;
  }
  assert.deepEqual(llamadas, []);
});

// ---------------------------------------------------------------------------------------------------------------
// C28: umbral de arrastre con el reconocedor real y px de dispositivo

test('C28 (nota 35): con densidad 1,5 el umbral de 4 px se mide en dispositivo: 3 px de dispositivo no arrastran, 4,5 sí', () => {
  const arrastres = [];
  const camera = { cfg: { dragThresholdPx: 4, dblTapZoom: 1.6 }, input: (k, p) => k === 'drag' && arrastres.push(p) };
  const gestures = createGestures({ controller: camera });
  const oyentes = new Map();
  const canvas = {
    width: 1920,
    height: 1080,
    addEventListener: (t, f) => oyentes.set(t, f),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  createInput({
    win: { addEventListener() {} },
    canvas,
    shortcuts: { run() {} },
    gestures,
    presence: { feed: () => false },
    pointer: { advance: () => false, click() {}, hover() {} },
    arrows() {},
    unload: () => false,
    blocked: () => false,
  });
  const ev = (type, clientX) =>
    oyentes.get(type)({
      type,
      pointerType: 'mouse',
      button: 0,
      pointerId: 1,
      timeStamp: 0,
      clientX,
      clientY: 100,
      isTrusted: true,
      preventDefault() {},
    });
  ev('pointerdown', 100);
  ev('pointermove', 102); // 2 px CSS = 3 px de dispositivo
  assert.equal(arrastres.length, 0, '3 px de dispositivo: todavía no es un arrastre');
  ev('pointermove', 103); // 3 px CSS = 4,5 px de dispositivo
  assert.equal(arrastres.length, 1, '4,5 px de dispositivo: ya arrastra');
  assert.ok(Math.abs(arrastres[0].dx - 4.5) < 1e-9, `arrastre de ${arrastres[0].dx} px de dispositivo`);
});

// ---------------------------------------------------------------------------------------------------------------
// C29: palabras prohibidas y textos fuera de S

const recorrer = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((x) => (x.isDirectory() ? recorrer(path.join(d, x.name)) : [path.join(d, x.name)]));

test('C29: ni public/js, ni README, ni CREDITOS traen una palabra prohibida (plegado de acentos y mayúsculas)', () => {
  const archivos = [...recorrer(GJ).filter((f) => /\.(js|html|css)$/.test(f)), `${GP}README.md`, `${GP}CREDITOS.md`];
  const hallazgos = archivos
    .map((f) => [path.relative(GP, f), findForbidden(fs.readFileSync(f, 'utf8'))])
    .filter(([, h]) => h.length);
  assert.deepEqual(hallazgos, []);
});

test('C29: en ui/ y render/ lo que dibuja texto visible (P.text, fillText) no recibe literales fuera de S', () => {
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const llamada = /\b(?:P\.text|P\.num|fillText|\.wrap)\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  const permitidos = new Set(['', ' ', '·', '/', '-', ':', '%', '.', ',', '+', 'x', '×']);
  const malos = [];
  for (const dir of ['ui', 'render'])
    for (const f of recorrer(path.join(GJ, dir)).filter((x) => x.endsWith('.js') && !x.endsWith('strings.js'))) {
      const src = sinComentarios(fs.readFileSync(f, 'utf8'));
      for (const m of src.matchAll(llamada))
        if (!permitidos.has(m[2]) && !/^[\d\s.,:+\-×x/%·]*$/.test(m[2])) malos.push(`${path.relative(GP, f)}: ${m[2]}`);
    }
  assert.deepEqual(malos, []);
});

test('C9: terminar el partido (Esc ×2) no vacía la pila de Alt+Z: lo ocultado antes se deshace después', async () => {
  const e = await arrancar('?donantes&rapido=20');
  for (let i = 0; i < 40; i++) e.cuadros(1, 100);
  const rango = /^(RECLUTA|SOLDADO|CABO|SARGENTO|TENIENTE|CAPITÁN|MAYOR|CORONEL|GENERAL) /;
  const llamada = e.ctx.calls.find((c) => c[0] === 'fillText' && rango.test(c[1]));
  assert.ok(llamada, 'hay una etiqueta');
  for (const t of ['pointerdown', 'pointerup'])
    e.puntero(t, { clientX: llamada[2] + 1, clientY: llamada[3], altKey: true });
  e.cuadros(1, 100);
  assert.ok(e.textos().includes(S.moderation.hidden), 'el Alt+clic ocultó a un donante');
  e.tecla('Escape');
  e.tecla('Escape');
  e.cuadros(3, 100);
  assert.ok(e.textos().includes(S.matchup.title), 'el partido terminó');
  e.tecla('z', { altKey: true });
  e.cuadros(1, 100);
  assert.ok(e.textos().includes(S.moderation.undone), 'Alt+Z deshace el ocultamiento de antes de terminar el partido');
});
