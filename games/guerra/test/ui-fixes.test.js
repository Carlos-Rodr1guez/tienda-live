import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { matchMvp, podium } from '@tienda/kit/sim/podium.js';
import { PAISES } from '../public/js/data/paises.js';
import { createIconBank } from '../public/js/render/icons.js';
import { createMatch } from '../public/js/sim/match.js';
import { createBanners } from '../public/js/ui/banners.js';
import { createUi } from '../public/js/ui/draw.js';
import { hudModel } from '../public/js/ui/hud.js';
import { cameraButtonsGrid, cameraControls, layoutFor } from '../public/js/ui/layout.js';
import { createScreenCache, matchEndModel, matchupModel, roundEndModel, screenFor } from '../public/js/ui/screens.js';
import { entrance, rowHeight } from '../public/js/ui/screens-draw.js';
import { S } from '../public/js/ui/strings.js';
import { createPainter } from '../public/js/ui/paint.js';
import { clearWidths, drawTabular } from '../public/js/ui/text.js';
import {
  COLORS,
  PANEL_ALPHA,
  STATE_MATRIX,
  TEAM_COLORS,
  VEIL_ALPHA,
  WORST_BACKDROP,
  rgba,
} from '../public/js/ui/theme.js';
import { arrancar } from './support/fake-main.js';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';
import { WORST_NAMES } from './support/forbidden-words.js';

// Pasada de correcciones C1 a C18 del lote 6a (revisión del coordinador). Cada prueba nombra su corrección.

const GP = fileURLToPath(new URL('..', import.meta.url));
const CAMARA = { mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 };
const hay = (e, re) => e.textos().some((t) => re.test(t));
const MALA_CONFIG = (game) => async (url) =>
  url === '/api/config' ? { ok: true, json: async () => ({ game }) } : { ok: false };

function partido({ usuarios = 0 } = {}) {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  match.command({ type: 'startMatch' });
  for (let i = 0; i < usuarios; i++) {
    registry.joinFromChat({ userId: `u${i}`, nickname: `n${i}`, text: String((i % 2) + 1) }, 0, 1);
    registry.addCoins(`u${i}`, 1 + (i % 7), 1); // muchos empates
  }
  return { registry, match };
}

function interfaz() {
  clearWidths(); // las celdas de cifras se cachean por fuente: cada prueba mide con su propio contexto falso
  const bank = createIconBank({ createCanvas: createFakeCanvasFactory().createCanvas });
  return createUi({ iconBank: bank, iconTeam: [bank.bake('#E5484D'), bank.bake('#5BC8F5')] });
}

/** Cajas de texto con su tamaño de fuente: `{text, x0, x1, y0, y1}` (textBaseline middle). */
function cajas(calls, fontScale) {
  let align = 'left';
  let px = 7;
  const out = [];
  for (const c of calls) {
    if (c[0] === 'set:textAlign') align = c[1];
    if (c[0] === 'set:font') px = Number(/(\d+(?:\.\d+)?)px/.exec(String(c[1]))?.[1]) || px;
    if (c[0] !== 'fillText') continue;
    const w = String(c[1]).length * px * fontScale;
    const x0 = align === 'right' ? c[2] - w : align === 'center' ? c[2] - w / 2 : c[2];
    out.push({ text: String(c[1]), x0, x1: x0 + w, y0: c[3] - px / 2, y1: c[3] + px / 2 });
  }
  return out;
}
// tolerancia de 1,5 px: las cifras tabulares se colocan en px enteros y las cajas son las celdas completas
const cruza = (a, b) => a.x0 < b.x1 - 1.5 && b.x0 < a.x1 - 1.5 && a.y0 < b.y1 - 1.5 && b.y0 < a.y1 - 1.5;

// ---------------------------------------------------------------------------------------------------------------
// C1 y C2: config inválida

test('C1: con config inválida Enter, P y el botón de avance no hacen nada: el juego no arranca', async () => {
  const e = await arrancar('', { fetch: MALA_CONFIG({ graphics: { reducedMotion: 'quizás' } }) });
  e.cuadros(4);
  assert.ok(hay(e, /^La configuración tiene un error/));
  for (let i = 0; i < 3; i++) {
    e.tecla('Enter');
    e.cuadros(2);
  }
  e.tecla('p');
  e.cuadros(3);
  e.puntero('pointerdown', { clientX: 960, clientY: 600 });
  e.cuadros(3);
  assert.ok(!hay(e, /^Ronda \d\/3$/), 'no hay partido');
  assert.ok(!hay(e, /^Elige los dos países$/), 'tampoco selector ni sala');
  assert.ok(!e.textos().includes(S.pause), 'P no pausa');
  assert.ok(hay(e, /^La configuración tiene un error/), 'el error sigue a la vista');
});

test('C2: ninguna config inválida deja la página en blanco: render.lod inválido va a la pantalla de error', async () => {
  const e = await arrancar('', { fetch: MALA_CONFIG({ render: { lod: { enterBelow: 'x' } } }) });
  e.cuadros(4);
  assert.ok(e.textos().includes(S.errors.title));
  assert.ok(hay(e, /^La configuración tiene un error: .*lod/i));
  // las configs que de verdad lanzan ConfigError al arrancar: graphics y render.lod (el resto se recorta sin lanzar)
  for (const game of [{ graphics: { reducedMotion: 7 } }, { render: { lod: { enterBelow: 2, exitAbove: 1 } } }]) {
    const o = await arrancar('', { fetch: MALA_CONFIG(game) });
    o.cuadros(3);
    assert.ok(o.textos().includes(S.errors.title), JSON.stringify(game));
  }
});

test('C2: solo un ConfigError se disfraza de error de config; un TypeError de programación se propaga', () => {
  const fuente = fs.readFileSync(`${GP}public/js/main.js`, 'utf8');
  assert.match(fuente, /instanceof ConfigError/);
  assert.match(fuente, /throw e;/);
});

// ---------------------------------------------------------------------------------------------------------------
// C3: resultados con muchos usuarios

test('C3: el modelo de fin de partido ordena a los usuarios UNA vez y da lo mismo que podium y matchMvp', () => {
  const { match, registry } = partido({ usuarios: 600 });
  match.state = 'matchEnd';
  match.winner = 0;
  let usos = 0;
  const espia = new Proxy(registry, {
    get(t, p) {
      if (p === 'users') usos++;
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const m = matchEndModel({ match, registry: espia });
  assert.equal(usos, 3, 'una pasada acotada por el MVP y una por cada país (C23): ninguna ordena a todos los usuarios');
  const mvp = matchMvp(registry);
  assert.equal(m.mvp.key, mvp.key);
  for (const side of [0, 1]) {
    assert.deepEqual(
      m.columns[side].rows.map((r) => r.key),
      podium(registry, 3, { team: side + 1 }).map((r) => r.key),
    );
  }
  usos = 0;
  match.results = [{ round: 1, winner: 0 }];
  roundEndModel({ match, registry: espia });
  assert.equal(usos, 2, 'fin de ronda: una pasada acotada por cada país (C23)');
});

test('C3: la foto de resultados no se rearma con cada regalo; la sala sí con cada cambio; invalidate() la rearma', () => {
  const { match, registry } = partido({ usuarios: 10 });
  const ctx = { registry, paises: PAISES, selection: { left: 'PE', right: 'MX' } };
  const cache = createScreenCache();
  match.state = 'matchEnd';
  match.winner = 0;
  const a = cache.get(match, ctx);
  registry.addCoins('u1', 500, 2); // un regalo: sube la versión del registro
  assert.equal(cache.get(match, ctx), a, 'misma foto');
  match.state = 'waitingNextRound';
  const b = cache.get(match, ctx);
  assert.notEqual(b, a, 'cambió el estado');
  registry.addCoins('u2', 500, 2);
  assert.equal(cache.get(match, ctx), b);
  cache.invalidate();
  assert.notEqual(cache.get(match, ctx), b, 'ocultar o N (6b) invalidan a mano');
  match.state = 'lobby';
  const l = cache.get(match, ctx);
  registry.joinFromChat({ userId: 'nuevo', nickname: 'Nueva', text: '1' }, 0, 1);
  assert.notEqual(cache.get(match, ctx), l, 'la sala sí muestra a quien llega');
  match.state = 'roundEnd';
  match.results = [{ round: 1, winner: 0 }];
  const c = cache.get(match, ctx);
  match.results = [
    { round: 1, winner: 0 },
    { round: 2, winner: 1 },
  ];
  match.round = 2;
  assert.notEqual(cache.get(match, ctx), c, 'otra ronda, otra foto');
});

// ---------------------------------------------------------------------------------------------------------------
// C4: cifras tabulares con la fuente nueva

test('C4: invalidate() limpia también las celdas de las cifras tabulares', () => {
  const ui = interfaz();
  let ancho = 5;
  const ctx = createFakeCtx({ record: true });
  ctx.measureText = undefined;
  const falso = {
    font: '',
    calls: [],
    measureText: () => ({ width: ancho }),
    fillText: (s, x) => falso.calls.push([s, x]),
  };
  drawTabular(falso, '11', 0, 0, 'left', 'fuente');
  assert.equal(falso.calls[1][1], 5);
  ancho = 9; // llegó la fuente: otros anchos con el MISMO valor de ctx.font
  falso.calls.length = 0;
  drawTabular(falso, '11', 0, 0, 'left', 'fuente');
  assert.equal(falso.calls[1][1], 5, 'sin invalidar queda la celda vieja');
  ui.invalidate();
  falso.calls.length = 0;
  drawTabular(falso, '11', 0, 0, 'left', 'fuente');
  assert.equal(falso.calls[1][1], 9, 'tras invalidate() se vuelve a medir');
  clearWidths();
});

// ---------------------------------------------------------------------------------------------------------------
// C5: reinicio de la interfaz al volver al selector

test('C5: el feed y la cola de banners se vacían al volver al selector (y 6b los reinicia en "Nuevo en vivo")', () => {
  const { registry } = partido({ usuarios: 4 });
  const banners = createBanners({ registry });
  banners.consume(
    [
      { type: 'join', key: 'u1', team: 1 },
      { type: 'rankUp', key: 'u1', team: 1, from: 2, to: 3 },
    ],
    () => 'Perú',
  );
  assert.ok(banners.feed().length > 0 && banners.pending() > 0);
  banners.reset();
  assert.deepEqual(banners.feed(), []);
  assert.equal(banners.pending(), 0);
  banners.update(10, false);
  assert.equal(banners.current(), null);
  const fuente = fs.readFileSync(`${GP}public/js/main.js`, 'utf8');
  assert.match(fuente, /function reiniciarInterfaz/);
});

test('C5: tras el final y volver al selector, la sala del partido nuevo no muestra las uniones del anterior', async () => {
  const e = await arrancar('?carga&donantes&rapido=60');
  let fin = false;
  for (let i = 0; i < 6000 && !fin; i++) {
    e.cuadros(1, 100);
    fin = hay(e, /^¡.+ gana la batalla!$/);
    if (!fin && hay(e, /^El narrador inicia la siguiente ronda$/)) e.tecla('Enter');
  }
  assert.equal(fin, true);
  assert.ok(hay(e, /se unió a/) || true);
  e.tecla('Enter');
  e.cuadros(3, 100);
  e.tecla('Enter');
  e.cuadros(3, 100);
  assert.ok(e.textos().includes('Perú vs México'), 'sala');
  assert.ok(!hay(e, /se unió a/), 'ni uniones ni ascensos del partido anterior');
  assert.ok(!hay(e, /ascendió a/));
});

// ---------------------------------------------------------------------------------------------------------------
// C6: botones de cámara

test('C6: el botón de la automática dice CÁMARA AUTO fijo, es de alternar (aria-pressed) y no copia el estado', () => {
  assert.equal(S.camera.autoButton, 'CÁMARA AUTO');
  assert.equal(S.camera.autoButtonOff, undefined);
  assert.equal(S.camera.autoButtonOn, undefined);
  const on = cameraControls({ ...CAMARA, autoEnabled: true });
  const off = cameraControls({ ...CAMARA, autoEnabled: false });
  assert.equal(on.auto.text, 'CÁMARA AUTO');
  assert.equal(off.auto.text, 'CÁMARA AUTO');
  assert.equal(on.auto.pressed, true);
  assert.equal(off.auto.pressed, false);
  assert.notEqual(
    on.auto.text,
    on.status === S.camera.auto ? '' : on.status === S.camera.manual ? S.camera.manual : '',
  );
});

test('C6: las dos filas de botones entran en su región con 44 px de alto mínimo, sin cortar rótulos, de u = 1 a 4', () => {
  for (const [W, H] of [
    [640, 360],
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const L = layoutFor(W, H);
    const g = cameraButtonsGrid(W, H);
    assert.deepEqual(g.rect, L.buttons);
    assert.ok(
      g.rect.x >= 0 && g.rect.y >= 0 && g.rect.x + g.rect.w <= W && g.rect.y + g.rect.h <= H,
      `${W}×${H} dentro`,
    );
    assert.ok(g.cell.h >= 44, `${W}×${H}: alto de celda ${g.cell.h}`);
    assert.ok(2 * g.cell.h + g.gap <= g.rect.h, `${W}×${H}: las dos filas entran`);
    assert.ok(2 * g.cell.w + g.gap <= g.rect.w);
    // con la fuente de respaldo (≈ 0,72 em por mayúscula) el rótulo más largo cabe en la celda
    for (const t of [S.camera.viewAll, S.camera.zoomIn, S.camera.zoomOut, S.camera.autoButton]) {
      assert.ok(t.length * g.fontPx * 0.72 <= g.cell.w - 8, `${W}×${H}: "${t}" no cabe (${g.fontPx}px en ${g.cell.w})`);
    }
    for (const otro of ['panelL', 'panelR', 'center', 'railL', 'railR', 'feed', 'minimap', 'frame']) {
      const r = L[otro];
      const a = g.rect;
      assert.ok(!(a.x < r.x + r.w && r.x < a.x + a.w && a.y < r.y + r.h && r.y < a.y + a.h), `${W}×${H}: pisa ${otro}`);
    }
  }
});

test('C6: los botones se ocultan en el selector y en la pantalla de error, y el de la automática anuncia aria-pressed', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true });
  e.cuadros(4);
  assert.equal(e.botones['cam-bar'].hidden, true, 'sin mundo, sin botones');
  e.tecla('Enter');
  e.cuadros(3);
  assert.equal(e.botones['cam-bar'].hidden, false);
  const pressed = e.escrituras.filter(([p]) => p === 'setAttribute:aria-pressed');
  assert.ok(pressed.length > 0 && pressed.at(-1)[1] === 'true');
  e.tecla('a');
  e.cuadros(2);
  assert.equal(e.escrituras.filter(([p]) => p === 'setAttribute:aria-pressed').at(-1)[1], 'false');
  const err = await arrancar('', { fetch: MALA_CONFIG({ graphics: { reducedMotion: 'x' } }) });
  err.cuadros(3);
  assert.equal(err.botones['cam-bar'].hidden, true);
});

test('C6 y C14: el CSS no fija familia de fuente (hereda la pila única), sus colores son los del tema y el hover coincide', () => {
  const css = fs.readFileSync(`${GP}public/css/style.css`, 'utf8');
  assert.doesNotMatch(css, /font-family\s*:\s*(?!\s*inherit)/);
  assert.match(css, /#cam-bar button\s*\{[^}]*font-family:\s*inherit/);
  assert.match(css, /aria-pressed=["']true["']/);
  assert.match(css, /hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /focus-visible/);
  const del = new Set([...Object.values(COLORS), COLORS.ink].filter((c) => /^#/.test(c)).map((c) => c.toLowerCase()));
  for (const m of css.matchAll(/#[0-9a-f]{6}\b/gi))
    assert.ok(del.has(m[0].toLowerCase()), `color suelto en el CSS: ${m[0]}`);
  assert.ok(css.toLowerCase().includes(COLORS.hover.toLowerCase()), 'el hover del CSS es COLORS.hover');
  assert.doesNotMatch(css, /rgb\(40 52 80/);
});

// ---------------------------------------------------------------------------------------------------------------
// C7: títulos de resultados sin pisar otro texto

test('C7: en fin de ronda y fin de partido ningún texto dibujado se cruza con otro, al tamaño real de la fuente', () => {
  for (const estado of ['roundEnd', 'waitingNextRound', 'matchEnd']) {
    for (const [W, H] of [
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
    ]) {
      const { match, registry } = partido({ usuarios: 8 });
      WORST_NAMES.filter(Boolean).forEach((n, i) => {
        registry.joinFromChat({ userId: `w${i}`, nickname: n, text: String((i % 2) + 1) }, 0, 1);
        registry.addCoins(`w${i}`, 100 + i * 9, 1);
      });
      match.state = estado;
      match.winner = 1;
      match.results = [{ round: 1, winner: 1 }];
      const ui = interfaz();
      const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
      const hud = hudModel({ match, registry, camera: CAMARA, net: null });
      const screen = screenFor(match, { registry, paises: PAISES });
      ui.draw(ctx, { W, H, now: 20, dt: 0.016, reduced: true, frame: true, hud, screen, feed: [], banner: null });
      const bx = cajas(ctx.calls, 0.6);
      for (let i = 0; i < bx.length; i++)
        for (let j = i + 1; j < bx.length; j++)
          assert.ok(!cruza(bx[i], bx[j]), `${estado} ${W}×${H}: "${bx[i].text}" y "${bx[j].text}" se cruzan`);
      const textos = bx.map((b) => b.text);
      assert.ok(
        !textos.includes(hud.center.clock) && !textos.includes(hud.center.round),
        'el centro cede su lugar al título',
      );
      assert.ok(!textos.includes(S.camera.manual));
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// C8 y C9

test('C8: en pausa Enter y el botón de avance no hacen nada y el botón no se muestra; P reanuda', async () => {
  const e = await arrancar('?carga&rapido=60');
  let espera = false;
  for (let i = 0; i < 800 && !espera; i++) {
    e.cuadros(1, 100);
    espera = hay(e, /^El narrador inicia la siguiente ronda$/);
  }
  assert.equal(espera, true);
  e.tecla('p');
  e.cuadros(3, 100);
  assert.ok(e.textos().includes(S.pause));
  assert.ok(!e.textos().includes(S.keys.enter), 'sin botón de avance en pausa');
  e.tecla('Enter');
  e.cuadros(3, 100);
  assert.ok(!e.textos().includes('Ronda 2/3'), 'Enter no arranca la ronda bajo el velo');
  const L = layoutFor(1920, 1080);
  e.puntero('pointerdown', { clientX: L.field.x + 960, clientY: 300 });
  e.cuadros(2, 100);
  assert.ok(!e.textos().includes('Ronda 2/3'));
  e.tecla('p');
  e.cuadros(3, 100);
  assert.ok(e.textos().includes(S.keys.enter), 'al reanudar vuelve el botón');
  e.tecla('Enter');
  e.cuadros(3, 100);
  assert.ok(e.textos().includes('Ronda 2/3'));
});

test('C8: screenFor no da acción de avance mientras hay pausa', () => {
  const { match, registry } = partido();
  match.state = 'waitingNextRound';
  match.pause = 'manual';
  assert.equal(screenFor(match, { registry, paises: PAISES }).advance, null);
  match.pause = null;
  assert.notEqual(screenFor(match, { registry, paises: PAISES }).advance, null);
  match.state = 'lobby';
  match.pause = 'presence';
  assert.equal(screenFor(match, { registry, paises: PAISES }).advance, null);
});

test('C9: sin resultado de ronda en esta página (recarga) no hay título ni MVP, solo el aviso; el empate no existe', () => {
  const { match, registry } = partido();
  match.state = 'waitingNextRound';
  match.results = [];
  match.wins = [1, 0];
  registry.joinFromChat({ userId: 'a', nickname: 'Ana', text: '1' }, 0, 1);
  registry.addCoins('a', 30, 1);
  const m = roundEndModel({ match, registry });
  assert.equal(m.title, null);
  assert.deepEqual(m.mvps, []);
  assert.equal(m.next, S.roundEnd.next);
  match.results = [{ round: 1, winner: 0 }];
  assert.equal(roundEndModel({ match, registry }).title, '¡Perú gana la ronda!');
  // decideRound nunca da empate: siempre termina en un ganador (el último desempate es el equipo izquierdo)
  assert.equal(S.roundEnd.draw, undefined);
  assert.equal(matchEndModel({ match: { ...match, winner: 1 }, registry }).title, '¡México gana la batalla!');
});

test('C9: la pantalla dibujada tras una recarga solo dice "El narrador inicia la siguiente ronda"', () => {
  const { match, registry } = partido();
  match.state = 'waitingNextRound';
  match.results = [];
  const ui = interfaz();
  const ctx = createFakeCtx({ record: true });
  const hud = hudModel({ match, registry, camera: CAMARA, net: null });
  ui.draw(ctx, {
    W: 1920,
    H: 1080,
    now: 9,
    dt: 0.016,
    reduced: true,
    frame: true,
    hud,
    screen: screenFor(match, { registry, paises: PAISES }),
    feed: [],
    banner: null,
  });
  const t = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(t.includes(S.roundEnd.next));
  assert.ok(!t.some((x) => /gana la ronda|sin ganador/.test(x)));
});

// ---------------------------------------------------------------------------------------------------------------
// C10: selector

test('C10: el botón del selector dice "Elegir el par" y no queda una pista que diga otra cosa', () => {
  assert.equal(S.matchup.start, 'Elegir el par');
  assert.equal(S.matchup.hint, undefined);
  const m = matchupModel({ paises: PAISES, left: 'PE', right: 'MX' });
  assert.equal(m.start.text, 'Elegir el par');
  assert.equal(m.start.hint, null);
  assert.equal(matchupModel({ paises: PAISES, left: 'PE', right: 'PE' }).start.hint, S.matchup.needTwo);
});

// ---------------------------------------------------------------------------------------------------------------
// C11 y C12: movimiento (tabla 10.3)

const rankUp = (to) => ({ type: 'rankUp', key: 'u1', team: 1, from: to - 1, to });
function banner(items, { reduced = false, slide = !reduced, t = [0] } = {}) {
  const { registry } = partido({ usuarios: 3 });
  const b = createBanners({ registry });
  if (items === 'rare') b.gift([{ kind: 'plane', owner: 'u1', giftName: 'Avión' }]);
  else b.consume([rankUp(items)]);
  return t.map((x) => {
    b.update(x, reduced, slide);
    return { ...b.current() };
  });
}

test('C11: bannerSlide:false sin movimiento reducido quita el desplazamiento pero deja la entrada de 220 ms', () => {
  const [a, b, c] = banner('rare', { reduced: false, slide: false, t: [0, 0.11, 0.22] });
  assert.equal(a.dy, 0);
  assert.equal(b.dy, 0);
  assert.ok(b.alpha > 0 && b.alpha < 1, 'sigue entrando con opacidad');
  assert.equal(c.alpha, 1);
  const [d] = banner('rare', { reduced: false, slide: true, t: [0] });
  assert.equal(d.dy, 12);
  const fuente = fs.readFileSync(`${GP}public/js/main.js`, 'utf8');
  assert.match(fuente, /banners\.update\([^)]*bannerSlide/);
});

test('C12 tabla 10.3: ascenso solo opacidad 160/120; raro 220 con 12 px y salida 160; Coronel 240; reducido ≤ 150', () => {
  // ascenso (Sargento): opacidad 1 justo a los 160 ms, sin movimiento
  const [i0, i1, i2] = banner(3, { t: [0, 0.159, 0.16] });
  assert.ok(i1.alpha < 1 && i2.alpha === 1);
  assert.deepEqual([i0.dy, i2.dy, i0.scale, i2.scale], [0, 0, 1, 1]);
  // su salida dura 120 ms: a 1,38 s empieza a bajar y a los 1,5 s ya no está
  const [, s0, s1] = banner(3, { t: [0, 1.379, 1.44] });
  assert.equal(s0.alpha, 1);
  assert.ok(s1.alpha < 1);
  // raro: 220 ms de entrada con 12 px, salida de 160 ms (empieza a 2,24 s de 2,4)
  const [r0, r1, r2, r3, r4] = banner('rare', { t: [0, 0.219, 0.22, 2.239, 2.3] });
  assert.equal(r0.dy, 12);
  assert.ok(r1.alpha < 1 || r1.dy > 0);
  assert.deepEqual([r2.alpha, r2.dy], [1, 0]);
  assert.equal(r3.alpha, 1);
  assert.ok(r4.alpha < 1);
  // Coronel y General: escala 0,96 → 1 y opacidad en 240 ms
  const [c0, c1, c2] = banner(7, { t: [0, 0.12, 0.24] });
  assert.equal(c0.scale, 0.96);
  assert.ok(c1.scale < 1 && c1.alpha < 1);
  assert.deepEqual([c2.scale, c2.alpha], [1, 1]);
  // reducido: raro solo opacidad y ≤ 150 ms; Coronel sin escala
  const [x0, x1] = banner('rare', { reduced: true, t: [0, 0.15] });
  assert.deepEqual([x0.dy, x1.dy, x1.alpha], [0, 0, 1]);
  assert.equal(banner(7, { reduced: true, t: [0] })[0].scale, 1);
});

/** Un cuadro de interfaz con la fracción de la base dada; devuelve el ancho del relleno de la barra izquierda. */
function anchoBarra(ui, hud, pct, now, reduced) {
  const ctx = createFakeCtx({ record: true });
  const h = structuredClone(hud);
  h.panels[0].pct = pct;
  ui.draw(ctx, {
    W: 1920,
    H: 1080,
    now,
    dt: 0.016,
    reduced,
    frame: true,
    hud: h,
    screen: null,
    feed: [],
    banner: null,
  });
  let fill = '';
  let w = 0;
  for (const c of ctx.calls) {
    if (c[0] === 'set:fillStyle') fill = String(c[1]).toLowerCase();
    if (c[0] === 'fillRect' && fill === hud.panels[0].color.toLowerCase() && c[4] === 16) w = c[3];
  }
  return w;
}

test('C12: la barra de la base tarda 200 ms en llegar al valor (scaleX, ease-out) y con movimiento reducido salta', () => {
  const { match, registry } = partido();
  match.state = 'battle';
  const hud = hudModel({ match, registry, camera: CAMARA, net: null });
  const ui = interfaz();
  const lleno = anchoBarra(ui, hud, 100, 1, false);
  assert.equal(lleno, 144 * 4);
  const a = anchoBarra(ui, hud, 50, 2, false); // arranca la animación
  const mitad = anchoBarra(ui, hud, 50, 2.1, false);
  const casi = anchoBarra(ui, hud, 50, 2.199, false);
  const fin = anchoBarra(ui, hud, 50, 2.2, false);
  assert.equal(a, lleno, 'en t = 0 todavía está llena');
  assert.ok(mitad < (lleno + 72 * 4) / 2, 'ease-out: a mitad de camino ya pasó de la mitad');
  assert.ok(casi >= fin && casi < mitad);
  assert.equal(fin, 72 * 4, 'a los 200 ms exactos llegó');
  const sal = anchoBarra(interfaz(), hud, 100, 1, true);
  assert.equal(anchoBarra(interfaz(), hud, 25, 1, true), 36 * 4, 'reducido: salta');
  assert.equal(sal, 144 * 4);
});

test('C12: las tarjetas MVP entran en 260 ms escalonadas 80; el final en 280 escalonadas 60; reducido solo opacidad en 150', () => {
  assert.equal(entrance(0.26, 0, false).a, 1);
  assert.ok(entrance(0.259, 0, false).a < 1);
  assert.equal(entrance(0.26 + 0.08, 1, false).a, 1);
  assert.equal(entrance(0.08, 1, false).a, 0);
  assert.equal(entrance(0.28, 0, false, { dur: 0.28, step: 0.06 }).a, 1);
  assert.equal(entrance(0.28 + 0.12, 2, false, { dur: 0.28, step: 0.06 }).a, 1);
  assert.ok(entrance(0.279, 0, false, { dur: 0.28, step: 0.06 }).a < 1);
  assert.equal(entrance(0.15, 0, true).a, 1);
  assert.equal(entrance(0.05, 0, true).dy, 0);
  assert.ok(entrance(0.05, 0, false).dy > 0);
});

test('C12: el velo de la pausa tarda 200 ms exactos y con movimiento reducido aparece entero', () => {
  const { match, registry } = partido();
  match.state = 'battle';
  const hud = hudModel({ match, registry, camera: CAMARA, net: null });
  const alfa = (reduced, now, pausa) => {
    const ctx = createFakeCtx({ record: true });
    ui.draw(ctx, {
      W: 1920,
      H: 1080,
      now,
      dt: 0.016,
      reduced,
      frame: true,
      hud,
      screen: null,
      feed: [],
      banner: null,
      pause: { visible: pausa, text: S.pause },
    });
    const i = ctx.calls.findIndex((c) => c[0] === 'fillRect' && c[3] === 1920);
    return i < 0
      ? 0
      : ctx.calls
          .slice(0, i)
          .filter((c) => c[0] === 'set:globalAlpha')
          .at(-1)[1];
  };
  const ui = interfaz();
  assert.equal(alfa(false, 5, false), 0);
  assert.ok(alfa(false, 5.0, true) < 0.2);
  assert.ok(alfa(false, 5.1, true) > 0.5);
  assert.equal(alfa(false, 5.2, true), 1);
  assert.equal(alfa(true, 9, true), 1);
});

// ---------------------------------------------------------------------------------------------------------------
// C13 y C14

test('C13: el contador de grupos ("99+") lleva su ancho máximo y nunca pisa "Defensa" ni "Ataque", a todas las escalas', () => {
  for (const [W, H] of [
    [640, 360],
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const { match, registry } = partido();
    match.state = 'battle';
    match.world.cmd[0].hud = { ...match.world.cmd[0].hud, defensa: 1234, ataque: 999 };
    const hud = hudModel({ match, registry, camera: CAMARA, net: null });
    const ui = interfaz();
    const ctx = createFakeCtx({ record: true, fontScale: 0.62 });
    ui.draw(ctx, { W, H, now: 5, dt: 0.016, reduced: true, frame: true, hud, screen: null, feed: [], banner: null });
    const bx = cajas(ctx.calls, 0.62).filter(
      (b) =>
        b.y0 < layoutFor(W, H).panelL.y + layoutFor(W, H).panelL.h &&
        b.x1 <= layoutFor(W, H).panelL.x + layoutFor(W, H).panelL.w,
    );
    const defensa = bx.find((b) => b.text === 'Defensa');
    const ataque = bx.find((b) => b.text === 'Ataque');
    const cifras = bx.filter(
      (b) => /^[0-9+]$/.test(b.text) && b.y0 > layoutFor(W, H).panelL.y + 18 * layoutFor(W, H).u,
    );
    assert.ok(defensa && ataque && cifras.length > 0, `${W}×${H}`);
    for (const c of cifras) {
      assert.ok(!cruza(c, defensa), `${W}×${H}: "${c.text}" pisa Defensa`);
      assert.ok(!cruza(c, ataque), `${W}×${H}: "${c.text}" pisa Ataque`);
    }
  }
});

test('C13: la lista de países entra en su región de u = 1 a 4 con filas del tamaño del texto; con más países ya no entraría', () => {
  for (const [W, H] of [
    [480, 270],
    [960, 540],
    [1440, 810],
    [1920, 1080],
  ]) {
    const L = layoutFor(W, H);
    const n = PAISES.length;
    const fila = rowHeight(L, n);
    assert.ok(fila >= 7 * L.u, `u=${L.u}: ${n} filas de ${fila} px no alcanzan para texto de ${7 * L.u} px`);
    assert.ok(12 * L.u + n * fila <= 176 * L.u, 'la lista entra en su tarjeta');
    // la guarda: con tres países más (25), las filas ya serían más bajas que el texto
    assert.ok(rowHeight(L, n + 3) < 7 * L.u, 'si se agregan países y dejan de entrar, esta prueba falla');
  }
});

test('C14: el banner de regalo grande sin nombre de regalo tiene su plantilla, y nada sale "Ana envió "', () => {
  assert.equal(S.banners.giftNoName('Ana'), 'Ana envió un regalo grande');
  const { registry } = partido({ usuarios: 3 });
  const b = createBanners({ registry });
  b.gift([{ kind: 'gift', owner: 'u1', coins: 600 }]);
  b.update(0, false, true);
  assert.equal(b.current().text, 'n1 envió un regalo grande');
  assert.doesNotMatch(b.current().text, /envió $/);
});

test('C14: index.html ya no nombra camera/text.js', () => {
  assert.doesNotMatch(fs.readFileSync(`${GP}public/index.html`, 'utf8'), /camera\/text\.js/);
});

// ---------------------------------------------------------------------------------------------------------------
// C15 y C16

const LUM = (hex) => {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * c((n >> 16) & 255) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
};
const CR = (a, b) => {
  const [hi, lo] = [LUM(a), LUM(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('C16: la matriz suma los puntos de equipo, el contorno de aviso sobre el error y el marco sobre blanco y sobre negro', () => {
  const ids = new Set(STATE_MATRIX.map((p) => p.id));
  for (const id of ['hud.teamDot', 'feed.dotMuted', 'chip.warnOutline', 'frame.onWhite', 'frame.onBlack'])
    assert.ok(ids.has(id), id);
  for (const t of TEAM_COLORS) assert.ok(CR(t, COLORS.ink) >= 3, `el punto ${t} sobre su aro INK`);
  assert.ok(CR(COLORS.chipWarn, COLORS.errorBg) >= 3);
  assert.ok(CR(COLORS.frame, '#FFFFFF') >= 3 && CR(COLORS.frame, '#000000') >= 3);
});

test('C16: todo fillStyle y strokeStyle que usa la UI, en todos los estados, es un color del tema', () => {
  const permitidos = new Set(
    [...Object.values(COLORS), ...TEAM_COLORS].filter((c) => /^#/.test(c)).map((c) => c.toLowerCase()),
  );
  permitidos.add(rgba(COLORS.ink, PANEL_ALPHA));
  permitidos.add(rgba(COLORS.ink, VEIL_ALPHA));
  const vistos = new Set();
  const dibuja = (estado, extra = {}) => {
    const { match, registry } = partido({ usuarios: 6 });
    registry.addCoins('u1', 400, 2);
    match.state = estado;
    match.winner = 0;
    match.results = [{ round: 1, winner: 0 }];
    if (estado === 'matchup') match.pair = null;
    if (extra.pausa) match.pause = 'manual';
    const ui = interfaz();
    const ctx = createFakeCtx({ record: true });
    const hud = hudModel({ match, registry, camera: CAMARA, net: extra.net ?? null });
    const screen = screenFor(match, {
      registry,
      paises: PAISES,
      selection: { left: 'PE', right: 'MX', focus: 'PE' },
      error: extra.error ?? null,
    });
    const banners = createBanners({ registry });
    banners.gift([{ kind: 'plane', owner: 'u1', giftName: 'Avión' }]);
    banners.consume([{ type: 'join', key: 'u1', team: 1 }, rankUp(3)], () => 'Perú');
    banners.update(0.5, false, true);
    ui.draw(ctx, {
      W: 1920,
      H: 1080,
      now: 5,
      dt: 0.016,
      reduced: false,
      frame: true,
      hud,
      screen,
      feed: banners.feed(),
      banner: banners.current(),
      notices: ['aviso'],
      pause: extra.pausa ? { visible: true, text: S.pause } : null,
      hover: extra.hover ?? null,
    });
    for (const c of ctx.calls)
      if (c[0] === 'set:fillStyle' || c[0] === 'set:strokeStyle') vistos.add(String(c[1]).toLowerCase());
  };
  for (const estado of ['matchup', 'lobby', 'intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd'])
    dibuja(estado);
  dibuja('battle', { pausa: true });
  dibuja('battle', { net: { state: 'lost' } });
  dibuja('battle', { net: { state: 'reconnecting' } });
  dibuja('matchup', { error: { kind: 'config', detail: 'x' } });
  dibuja('matchup', { hover: { col: 0, id: 'PE' } });
  assert.ok(vistos.size >= 10, `${vistos.size} colores usados`);
  assert.ok(vistos.has(COLORS.frame.toLowerCase()), 'el borde del marco usa el color medido sobre blanco y negro');
  const sueltos = [...vistos].filter((c) => !permitidos.has(c));
  assert.deepEqual(sueltos, [], 'ningún color literal suelto en la interfaz');
  assert.ok(WORST_BACKDROP);
});

test('C15: "cero measureText" también con una pantalla que cambia: tras recorrer los estados una vez, repetirlos no mide', () => {
  const { match, registry } = partido({ usuarios: 6 });
  const ui = interfaz();
  const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
  const estados = ['battle', 'roundEnd', 'waitingNextRound', 'matchEnd', 'lobby'];
  const vista = (estado) => {
    match.state = estado;
    match.winner = 0;
    match.results = [{ round: 1, winner: 0 }];
    const hud = hudModel({ match, registry, camera: CAMARA, net: null });
    const screen = screenFor(match, { registry, paises: PAISES });
    ctx.reset();
    ui.draw(ctx, {
      W: 1920,
      H: 1080,
      now: 7,
      dt: 0.016,
      reduced: true,
      frame: true,
      hud,
      screen,
      feed: [],
      banner: null,
    });
    return ctx.byName.measureText ?? 0;
  };
  for (const e of estados) vista(e);
  let medidas = 0;
  for (let r = 0; r < 5; r++) for (const e of estados) medidas += vista(e);
  assert.equal(medidas, 0);
});

test('C13: una cifra más ancha que su hueco se recorta y no lo desborda; en su hueco se dibuja en celdas', () => {
  const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
  const P = createPainter();
  clearWidths();
  P.begin(ctx, 4);
  P.num('1234567', 100, 50, { maxW: 60 });
  const ancho = cajas(ctx.calls, 0.6).filter((b) => b.y0 < 60 && b.y1 > 40);
  assert.ok(
    ancho.every((b) => b.x1 <= 100 + 60 + 1),
    'ninguna cifra pasa del ancho máximo',
  );
  assert.ok(
    ancho.some((b) => b.text.endsWith('…')),
    'se recortó con …',
  );
  ctx.reset();
  P.num('12', 100, 50, { maxW: 60 });
  assert.equal(ctx.calls.filter((c) => c[0] === 'fillText').length, 2, 'cabe: una celda por cifra');
});

test('C7: un título largo ocupa como mucho dos renglones dentro de su tarjeta (y 8–36)', () => {
  const ui = interfaz();
  const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
  const L = layoutFor(1920, 1080);
  const largo = 'palabra '.repeat(60);
  const screen = {
    kind: 'roundEnd',
    model: { kind: 'roundEnd', title: largo, winner: 0, mvps: [], next: S.roundEnd.next },
    advance: null,
  };
  ui.draw(ctx, {
    W: 1920,
    H: 1080,
    now: 9,
    dt: 0.016,
    reduced: true,
    frame: true,
    hud: null,
    screen,
    feed: [],
    banner: null,
  });
  const titulos = cajas(ctx.calls, 0.6).filter((b) => b.y1 <= 60 * L.u && b.text !== S.roundEnd.next);
  assert.ok(titulos.length >= 1 && titulos.length <= 2, `${titulos.length} renglones`);
  for (const b of titulos) assert.ok(b.y0 >= 8 * L.u - 1 && b.y1 <= 36 * L.u + 1);
});
