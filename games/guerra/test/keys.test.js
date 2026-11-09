import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPresenceGuard } from '../public/js/sim/presence.js';
import { KEYMAP, RESERVED, createDouble, helpLines, isEditing, resolveKey } from '../public/js/ui/keys.js';
import { createInput, createPresenceFeed } from '../public/js/ui/input.js';
import { createShortcuts } from '../public/js/ui/shortcuts.js';
import { S } from '../public/js/ui/strings.js';

// Atajos del narrador (D25, NM-3, NM-8, NM-2): un solo mapa de teclas, un solo escuchador de entrada, la guardia de
// presencia cableada solo con eventos de confianza y "Nuevo en vivo" con confirmación.

const k = (key, extra = {}) => ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });
const GP = fileURLToPath(new URL('..', import.meta.url));

test('el mapa no tiene teclas duplicadas ni ids repetidos, y las reservadas son solo de sus acciones', () => {
  const firmas = new Set();
  const ids = new Set();
  for (const a of KEYMAP) {
    assert.ok(!ids.has(a.id), `id repetido ${a.id}`);
    ids.add(a.id);
    for (const key of a.keys) {
      const f = `${a.mod ?? ''}|${String(key).toLowerCase()}`;
      assert.ok(!firmas.has(f), `tecla repetida ${f}`);
      firmas.add(f);
    }
  }
  assert.deepEqual(RESERVED, ['F1', 'F2', 'F3', 'n', 'm']);
  const dueños = { F1: 'sim', F2: 'perf', F3: 'safe', n: 'names', m: 'mute' };
  for (const a of KEYMAP) {
    for (const r of RESERVED) {
      if (a.mod === 'shift' || a.mod === 'alt') continue;
      if (a.keys.map((x) => x.toLowerCase()).includes(r.toLowerCase()))
        assert.equal(a.id, dueños[r], `${r} es de ${dueños[r]}`);
    }
  }
});

test('toda acción de NM-3 tiene tecla', () => {
  const ids = new Set(KEYMAP.map((a) => a.id));
  for (const id of [
    'advance',
    'pause',
    'endMatch',
    'scoreboard',
    'top3',
    'followNext',
    'followStop',
    'autoCam',
    'viewAll',
    'base1',
    'base2',
    'hottest',
    'pan',
    'zoomIn',
    'zoomOut',
    'frame',
    'reduced',
    'help',
    'undo',
    'newLive',
    'names',
    'mute',
    'sim',
    'perf',
    'safe',
  ])
    assert.ok(ids.has(id), id);
});

test('resolveKey: la tabla D25 completa', () => {
  const casos = [
    [k('Enter'), 'advance'],
    [k('p'), 'pause'],
    [k('P'), 'pause'],
    [k('Escape'), 'endMatch'],
    [k('g'), 'scoreboard'],
    [k('t'), 'top3'],
    [k('s'), 'followNext'],
    [k('S', { shiftKey: true }), 'followStop'],
    [k('a'), 'autoCam'],
    [k('v'), 'viewAll'],
    [k('1'), 'base1'],
    [k('2'), 'base2'],
    [k(' '), 'hottest'],
    [k('ArrowLeft'), 'pan'],
    [k('ArrowDown'), 'pan'],
    [k('+'), 'zoomIn'],
    [k('='), 'zoomIn'],
    [k('-'), 'zoomOut'],
    [k('_'), 'zoomOut'],
    [k('c'), 'frame'],
    [k('r'), 'reduced'],
    [k('h'), 'help'],
    [k('z', { altKey: true }), 'undo'],
    [k('Ω', { altKey: true, code: 'KeyZ' }), 'undo'],
    [k('N', { shiftKey: true }), 'newLive'],
    [k('n'), 'names'],
    [k('m'), 'mute'],
    [k('F1'), 'sim'],
    [k('F2'), 'perf'],
    [k('F3'), 'safe'],
  ];
  for (const [e, id] of casos) assert.equal(resolveKey(e), id, JSON.stringify(e));
  const nada = [
    k('0'),
    k('Tab'),
    k('q'),
    k('z', { ctrlKey: true }),
    k('r', { metaKey: true }),
    k('a', { altKey: true }),
    k('Enter', { ctrlKey: true }),
  ];
  for (const e of nada) assert.equal(resolveKey(e), null, JSON.stringify(e));
});

test('H25: Shift+N nunca oculta nombres; N con Bloq Mayús (key "N" sin Shift) sí; N sola nunca abre "Nuevo en vivo"', () => {
  assert.equal(resolveKey(k('N', { shiftKey: true })), 'newLive');
  assert.equal(resolveKey(k('n', { shiftKey: true })), 'newLive');
  assert.equal(resolveKey(k('N', { shiftKey: false })), 'names');
  assert.equal(resolveKey(k('n')), 'names');
});

test('isEditing: input, textarea, select y contenteditable no son del narrador', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isEditing({ tagName }), true);
  assert.equal(isEditing({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditing({ tagName: 'BUTTON' }), false);
  assert.equal(isEditing(null), false);
});

test('la ayuda H se arma desde el mapa: una línea por entrada y todo el texto sale de S.help', () => {
  const l = helpLines();
  assert.equal(l.length, KEYMAP.length + 2, 'cada acción más el clic y el Alt+clic en una etiqueta');
  for (const a of KEYMAP) assert.equal(typeof S.help[a.id], 'string', a.id);
  assert.deepEqual(
    Object.keys(S.help).filter(
      (id) => id !== 'title' && !['click', 'altClick'].includes(id) && !KEYMAP.some((a) => a.id === id),
    ),
    [],
  );
  for (const line of l) assert.ok(line.keys.length > 0 && line.text.length > 0);
});

test('createDouble: la segunda pulsación dentro de 2 s confirma; fuera de la ventana es otra primera', () => {
  const d = createDouble(2000);
  assert.equal(d.press(0), 'first');
  assert.equal(d.press(1999), 'confirm');
  assert.equal(d.press(2000), 'first', 'tras confirmar, se vuelve a empezar');
  assert.equal(d.press(4500), 'first', 'pasó la ventana');
  assert.equal(d.press(5000), 'confirm');
});

// ---------------------------------------------------------------------------------------------------------------
// Atajos con dependencias falsas

function banco(estado = 'matchup') {
  const t = { now: 0 };
  const cmds = [];
  const avisos = [];
  const llamadas = [];
  const match = {
    state: estado,
    pause: null,
    world: {},
    command(c) {
      cmds.push(c);
      return { ok: true };
    },
  };
  const spy =
    (n) =>
    (...a) => {
      llamadas.push([n, ...a]);
      return { notice: n };
    };
  const view = { help: false, safe: false, f2: false, frame: true, scoreboardUntil: 0, top3Until: 0 };
  const sh = createShortcuts({
    now: () => t.now,
    match,
    camera: {
      viewAll: spy('viewAll'),
      focusBase: spy('focusBase'),
      toggleAuto: spy('toggleAuto'),
      input: spy('input'),
    },
    rig: { hottest: spy('hottest') },
    advance: spy('advance'),
    avisar: (x) => avisos.push(x),
    motion: { toggle: () => true },
    moderation: { toggleNames: spy('names'), undo: () => llamadas.push(['undo']) ?? 'vacio', hideAt: spy('hideAt') },
    spotlight: { next: spy('next'), stop: spy('stop') },
    view,
    onNewLive: spy('onNewLive'),
    onMatchEnded: spy('onMatchEnded'),
    sim: { toggle: spy('sim') },
    audio: { toggleMute: spy('mute') },
    blocked: () => false,
    golden: false,
  });
  return { sh, t, cmds, avisos, llamadas, match, view };
}

test('Shift+N: en matchup el primero pide confirmar (con la ventana de 2 s) y dos en 2 s mandan newLive confirmado', () => {
  const b = banco('matchup');
  b.sh.run('newLive', {});
  assert.deepEqual(b.cmds, []);
  assert.deepEqual(b.avisos, [S.newLive.confirm]);
  b.t.now = 1500;
  b.sh.run('newLive', {});
  assert.deepEqual(b.cmds, [{ type: 'newLive', confirmed: true }]);
  assert.equal(b.avisos.at(-1), S.newLive.done);
  assert.ok(
    b.llamadas.some((c) => c[0] === 'onNewLive'),
    'la interfaz se reinicia',
  );
});

test('Shift+N: con la segunda pulsación pasada la ventana no se envía nada', () => {
  const b = banco('matchup');
  b.sh.run('newLive', {});
  b.t.now = 2600;
  b.sh.run('newLive', {});
  assert.deepEqual(b.cmds, []);
});

test('Shift+N: fuera de matchup no se envía nada y se avisa que hay que terminar el partido', () => {
  for (const estado of ['lobby', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd', 'intro']) {
    const b = banco(estado);
    b.sh.run('newLive', {});
    b.sh.run('newLive', {});
    assert.deepEqual(b.cmds, [], estado);
    assert.equal(b.avisos[0], S.newLive.blocked, estado);
  }
});

test('N dos veces en 2 s alterna los nombres dos veces y nunca abre "Nuevo en vivo"', () => {
  const b = banco('matchup');
  b.sh.run('names', {});
  b.sh.run('names', {});
  assert.equal(b.llamadas.filter((c) => c[0] === 'names').length, 2);
  assert.deepEqual(b.cmds, []);
});

test('Esc ×2: el primero avisa, el segundo dentro de 2 s termina el partido; en matchup no hace nada', () => {
  const b = banco('battle');
  b.sh.run('endMatch', {});
  assert.deepEqual(b.cmds, []);
  assert.equal(b.avisos.length, 1);
  b.t.now = 800;
  b.sh.run('endMatch', {});
  assert.deepEqual(b.cmds, [{ type: 'endMatch' }]);
  const m = banco('matchup');
  m.sh.run('endMatch', {});
  m.sh.run('endMatch', {});
  assert.deepEqual(m.cmds, []);
});

test('P alterna pausa y reanudación manual; G, T y H alternan sus superposiciones; F3 y C también', () => {
  const b = banco('battle');
  b.sh.run('pause', {});
  assert.deepEqual(b.cmds.at(-1), { type: 'pause', by: 'manual' });
  b.match.pause = 'manual';
  b.sh.run('pause', {});
  assert.deepEqual(b.cmds.at(-1), { type: 'resume', by: 'manual' });
  b.sh.run('scoreboard', {});
  assert.equal(b.view.scoreboardUntil, 6000, '6 s');
  b.t.now = 100;
  b.sh.run('scoreboard', {});
  assert.equal(b.view.scoreboardUntil, 0, 'otra vez lo quita');
  b.sh.run('top3', {});
  assert.equal(b.view.top3Until, 6100);
  b.sh.run('help', {});
  assert.equal(b.view.help, true);
  b.sh.run('safe', {});
  b.sh.run('safe', {});
  assert.equal(b.view.safe, false, 'F3 dos veces muestra y oculta');
  b.sh.run('frame', {});
  assert.equal(b.view.frame, false);
});

test('con ?golden o un error de config los comandos del partido no se envían, pero la cámara sí responde', () => {
  const b = banco('battle');
  const g = createShortcuts({
    ...{ now: () => 0 },
    match: b.match,
    camera: { viewAll: () => b.llamadas.push(['viewAll']) },
    rig: {},
    advance: () => b.llamadas.push(['advance']),
    avisar() {},
    motion: { toggle: () => true },
    moderation: {},
    spotlight: {},
    view: b.view,
    sim: null,
    audio: null,
    blocked: () => true,
    golden: false,
  });
  g.run('pause', {});
  g.run('advance', {});
  g.run('viewAll', {});
  assert.deepEqual(b.cmds, []);
  assert.deepEqual(
    b.llamadas.map((c) => c[0]),
    ['viewAll'],
  );
});

// ---------------------------------------------------------------------------------------------------------------
// input.js: el único que escucha teclado, puntero, rueda y toque

function entorno({ dpr = 1, usuarios = 0 } = {}) {
  const oyentes = { win: new Map(), canvas: new Map() };
  const add = (m) => (type, fn) => m.set(type, [...(m.get(type) ?? []), fn]);
  const win = { addEventListener: add(oyentes.win) };
  const canvas = {
    width: Math.round(1280 * dpr),
    height: Math.round(720 * dpr),
    style: {},
    addEventListener: add(oyentes.canvas),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const run = [];
  const gest = [];
  const arrows = [];
  const clicks = [];
  const reloj = { t: 0 };
  const guard = createPresenceGuard({ minutes: 5, now: () => reloj.t });
  const match = { state: 'battle', pause: null, command: () => ({ ok: true }) };
  guard.update('battle', 0);
  const input = createInput({
    win,
    canvas,
    shortcuts: { run: (id, e) => run.push([id, e.key]) },
    raw: () => false,
    gestures: {
      down: (e) => gest.push(['down', e.x, e.y]),
      move: (e) => gest.push(['move', e.x, e.y]),
      up: (e) => {
        gest.push(['up']);
        return { tap: gest.filter((g) => g[0] === 'move').length === 0, x: e.x, y: e.y };
      },
      cancel: () => {},
      wheel: (e) => gest.push(['wheel', e.dy]),
    },
    presence: createPresenceFeed({ guard, match, now: () => reloj.t }),
    pointer: { advance: () => false, click: (p, e) => clicks.push([p, e.altKey === true]), hover: () => {} },
    arrows: (x, y) => arrows.push([x, y]),
    unload: () => usuarios > 0,
    blocked: () => false,
  });
  const lanzar = (donde, type, e = {}) => {
    const ev = {
      preventDefault() {
        ev.evitado = true;
      },
      isTrusted: true,
      ...e,
    };
    for (const fn of oyentes[donde].get(type) ?? []) fn(ev);
    return ev;
  };
  return { input, lanzar, run, gest, arrows, clicks, guard, reloj, oyentes };
}

test('el teclado llega al mapa; con el foco en un campo de texto ninguna tecla del narrador actúa', () => {
  const e = entorno();
  e.lanzar('win', 'keydown', { key: 'n', target: { tagName: 'BODY' } });
  assert.deepEqual(e.run, [['names', 'n']]);
  for (const key of ['n', 'c', 'r', 'Enter', 'p', ' ']) {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }])
      e.lanzar('win', 'keydown', { key, target });
  }
  assert.equal(e.run.length, 1, 'escribir "n", "c", "r" en el campo del F1 no hace nada');
});

test('Enter sobre un botón con foco es del navegador y las teclas con Ctrl o Meta no se tocan', () => {
  const e = entorno();
  e.lanzar('win', 'keydown', { key: 'Enter', target: { tagName: 'BUTTON' } });
  e.lanzar('win', 'keydown', { key: 'r', ctrlKey: true, target: { tagName: 'BODY' } });
  assert.deepEqual(e.run, []);
});

test('las flechas se mantienen y se sueltan; perder el foco no deja la cámara corriendo', () => {
  const e = entorno();
  e.lanzar('win', 'keydown', { key: 'ArrowRight', target: {} });
  e.lanzar('win', 'keydown', { key: 'ArrowRight', target: {}, repeat: true });
  e.lanzar('win', 'keydown', { key: 'ArrowUp', target: {} });
  assert.deepEqual(e.arrows, [
    [1, 0],
    [1, -1],
  ]);
  e.lanzar('win', 'blur');
  assert.deepEqual(e.arrows.at(-1), [0, 0]);
  e.lanzar('win', 'keydown', { key: 'ArrowLeft', target: {} });
  e.lanzar('win', 'keyup', { key: 'ArrowLeft' });
  assert.deepEqual(e.arrows.at(-1), [0, 0]);
});

test('NM-8: solo los eventos de confianza reinician la guardia; un keydown sintético no, un pellizco táctil sí', () => {
  const e = entorno();
  const minuto = 60000;
  e.reloj.t = 4 * minuto;
  e.lanzar('win', 'keydown', { key: 'v', isTrusted: false, target: {} });
  e.lanzar('win', 'pointerdown', { pointerType: 'mouse', isTrusted: false });
  e.reloj.t = 5 * minuto;
  assert.equal(e.guard.tick(e.reloj.t), 'idle', 'lo sintético no cuenta');
  e.lanzar('win', 'pointerdown', { pointerType: 'touch' });
  assert.equal(e.guard.tick(e.reloj.t), 'active', 'un toque (pellizco) de confianza reinicia');
  e.reloj.t = 10 * minuto + 1;
  e.lanzar('win', 'keydown', { key: 'v', target: {} });
  assert.equal(e.guard.tick(e.reloj.t), 'active');
  e.reloj.t += 6 * minuto;
  e.lanzar('win', 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(e.guard.tick(e.reloj.t), 'active', 'la rueda cuenta');
});

test('el puntero: nada de scroll ni zoom de la página (preventDefault en rueda y menú contextual, touch-action none)', () => {
  const e = entorno();
  const w = e.lanzar('canvas', 'wheel', { deltaY: 100, deltaMode: 0, clientX: 5, clientY: 5 });
  assert.equal(w.evitado, true);
  assert.equal(e.lanzar('canvas', 'contextmenu').evitado, true);
  const css = fs.readFileSync(`${GP}public/css/style.css`, 'utf8');
  assert.match(css, /touch-action:\s*none/);
});

test('Nota 35: el umbral de arrastre se mide en px de DISPOSITIVO, no en CSS (dpr 1,5)', () => {
  // la posición que recibe el reconocedor es del lienzo en px de dispositivo: 2 px CSS son 3, y 3 px CSS son 4,5
  const e = entorno({ dpr: 1.5 });
  e.lanzar('canvas', 'pointerdown', {
    pointerType: 'mouse',
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    timeStamp: 0,
  });
  e.lanzar('canvas', 'pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 102, clientY: 100, timeStamp: 1 });
  const [, x1] = e.gest.at(-1);
  assert.equal(x1, 153, '102 px CSS → 153 px de dispositivo');
  assert.equal(e.gest[0][1], 150);
  assert.ok(Math.abs(x1 - 150) < 4, '3 px de dispositivo: todavía no es un arrastre');
  e.lanzar('canvas', 'pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 103, clientY: 100, timeStamp: 2 });
  assert.ok(Math.abs(e.gest.at(-1)[1] - 150) >= 4, '4,5 px de dispositivo: ya es un arrastre');
});

test('clic simple (sin arrastre) llega a pointer.click con la posición del lienzo y el estado de Alt', () => {
  const e = entorno();
  e.lanzar('canvas', 'pointerdown', {
    pointerType: 'mouse',
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 20,
    altKey: true,
  });
  e.lanzar('canvas', 'pointerup', { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 20, altKey: true });
  assert.deepEqual(e.clicks, [[{ x: 10, y: 20 }, true]]);
});

test('beforeunload pide confirmación solo mientras haya usuarios en memoria', () => {
  const con = entorno({ usuarios: 3 });
  const a = con.lanzar('win', 'beforeunload');
  assert.equal(a.evitado, true);
  assert.equal(a.returnValue, '');
  const sin = entorno({ usuarios: 0 });
  assert.equal(sin.lanzar('win', 'beforeunload').evitado, undefined);
});

test('createDouble: el límite de la ventana es inclusivo (2000 ms confirma, 2001 no)', () => {
  const a = createDouble(2000);
  a.press(0);
  assert.equal(a.press(2000), 'confirm');
  const b = createDouble(2000);
  b.press(0);
  assert.equal(b.press(2001), 'first');
});

test('un arrastre no es un clic: con movimiento entre pointerdown y pointerup no llega nada a pointer.click', () => {
  const e = entorno();
  e.lanzar('canvas', 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 10, clientY: 20 });
  e.lanzar('canvas', 'pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 90, clientY: 20 });
  e.lanzar('canvas', 'pointerup', { pointerType: 'mouse', pointerId: 1, clientX: 90, clientY: 20 });
  assert.deepEqual(e.clicks, []);
});

test('el reconocedor de gestos dice si el pointerup fue un toque: sí sin arrastre, no tras arrastrar, ni en pellizco ni en el minimapa', async () => {
  const { createGestures } = await import('../public/js/camera/gestures.js');
  const controller = { cfg: { dragThresholdPx: 4, dblTapZoom: 1.6 }, input() {} };
  let mapa = null;
  const g = createGestures({ controller, minimap: () => mapa });
  g.down({ id: 1, x: 100, y: 100, t: 0 });
  assert.deepEqual(g.up({ id: 1, x: 100, y: 100, t: 10 }), { tap: true, x: 100, y: 100 });
  g.down({ id: 2, x: 100, y: 100, t: 1000 });
  g.move({ id: 2, x: 140, y: 100, t: 1010 });
  assert.equal(g.up({ id: 2, x: 140, y: 100, t: 1020 }).tap, false, 'tras arrastrar');
  g.down({ id: 3, x: 10, y: 10, t: 2000 });
  g.down({ id: 4, x: 60, y: 10, t: 2001 });
  g.move({ id: 4, x: 90, y: 10, t: 2010 });
  assert.equal(g.up({ id: 4, x: 90, y: 10, t: 2020 }).tap, false, 'pellizco');
  g.up({ id: 3, x: 10, y: 10, t: 2030 });
  mapa = { x: 0, y: 0, w: 200, h: 200 };
  g.down({ id: 5, x: 50, y: 50, t: 3000 });
  assert.equal(g.up({ id: 5, x: 50, y: 50, t: 3010 }).tap, false, 'sobre el minimapa');
  assert.equal(g.up({ id: 99, x: 0, y: 0, t: 0 }), undefined, 'un puntero desconocido no devuelve nada');
});
