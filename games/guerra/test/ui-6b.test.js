import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAISES } from '../public/js/data/paises.js';
import { createUi } from '../public/js/ui/draw.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { createBanners } from '../public/js/ui/banners.js';
import { createSelector } from '../public/js/ui/selector.js';
import { matchupModel, screenFor } from '../public/js/ui/screens.js';
import { listHit } from '../public/js/ui/screens-draw.js';
import { overlayRects } from '../public/js/ui/overlays-draw.js';
import { safeZones } from '../public/js/ui/safe-zones.js';
import { COLORS, TYPE } from '../public/js/ui/theme.js';
import { S } from '../public/js/ui/strings.js';
import { createFakeCtx } from './support/fake-canvas.js';

// Selector con teclado y puntero (10.2), la acción de avance como un solo componente (pulido de 6a), la sala con los dos
// nombres a la misma altura, las zonas seguras de F3 y las superposiciones G, T y H.

const EQ = [
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
  pair: state === 'matchup' ? null : { teams: EQ },
  world: {
    cfg: { round: { winsToMatch: 2 } },
    bases: [
      { hp: 100, maxHp: 100 },
      { hp: 100, maxHp: 100 },
    ],
  },
  ...extra,
});
const pantalla = (match, selection = { left: 'PE', right: 'MX', focus: 'PE' }) =>
  screenFor(match, { registry: null, paises: PAISES, selection });

// ---------------------------------------------------------------------------------------------------------------
// Selector

test('selector: las flechas mueven el foco dentro de la lista y eligen; Tab pasa a la otra lista', () => {
  const s = createSelector({ paises: PAISES, left: null, right: null });
  assert.equal(s.sel.focusCol, 0);
  assert.equal(s.key({ key: 'ArrowDown' }), true);
  const primero = s.sel.left;
  assert.equal(primero, PAISES[0].id, 'la primera flecha elige el primero');
  s.key({ key: 'ArrowDown' });
  assert.equal(s.sel.left, PAISES[1].id);
  s.key({ key: 'ArrowUp' });
  assert.equal(s.sel.left, PAISES[0].id);
  assert.equal(s.key({ key: 'Tab' }), true);
  assert.equal(s.sel.focusCol, 1);
  assert.equal(s.sel.left, PAISES[0].id, 'cambiar de lista no cambia lo elegido');
  s.key({ key: 'ArrowDown' });
  s.key({ key: 'ArrowDown' });
  assert.equal(s.sel.right, PAISES[1].id);
  assert.equal(s.key({ key: 'Tab', shiftKey: true }), true);
  assert.equal(s.sel.focusCol, 0);
  assert.equal(s.key({ key: 'q' }), false);
});

test('selector: los bordes de la lista no se pasan y Home y End saltan al primero y al último', () => {
  const s = createSelector({ paises: PAISES, left: PAISES[0].id, right: null });
  s.key({ key: 'ArrowUp' });
  assert.equal(s.sel.left, PAISES[0].id);
  s.key({ key: 'End' });
  assert.equal(s.sel.left, PAISES.at(-1).id);
  s.key({ key: 'ArrowDown' });
  assert.equal(s.sel.left, PAISES.at(-1).id);
  s.key({ key: 'Home' });
  assert.equal(s.sel.left, PAISES[0].id);
});

test('selector: el par solo existe con dos países distintos; ?pair preselecciona y un id desconocido no', () => {
  const s = createSelector({ paises: PAISES, left: 'PE', right: 'PE' });
  assert.equal(s.pair(), null);
  s.pick(1, 'MX');
  assert.deepEqual(s.pair(), { a: 'PE', b: 'MX' });
  const pre = createSelector({ paises: PAISES, left: 'AR', right: 'BO' });
  assert.deepEqual(pre.pair(), { a: 'AR', b: 'BO' });
  const mal = createSelector({ paises: PAISES, left: 'XX', right: 'YY' });
  assert.equal(mal.sel.left, null);
  assert.equal(mal.sel.right, null);
  assert.equal(mal.pair(), null);
  const vacio = createSelector({ paises: [], left: null, right: null });
  assert.equal(vacio.key({ key: 'ArrowDown' }), true);
  assert.equal(vacio.pair(), null);
});

test('selector: el foco de teclado se ve en UNA lista (la activa) y se marca la elegida en cada una', () => {
  const m = matchupModel({ paises: PAISES, left: 'PE', right: 'MX', focus: 'MX', focusCol: 1 });
  assert.equal(m.columns[1].rows.find((r) => r.id === 'MX').focused, true);
  assert.equal(m.columns[0].rows.find((r) => r.id === 'MX').focused, false, 'la otra lista no muestra foco');
  assert.equal(m.columns[0].rows.find((r) => r.id === 'PE').selected, true);
  const compat = matchupModel({ paises: PAISES, left: 'PE', right: 'MX', focus: 'PE' });
  assert.equal(compat.columns[0].rows.find((r) => r.id === 'PE').focused, true, 'sin focusCol, como en 6a');
});

test('selector con puntero: un clic en una fila la elige en esa lista y listHit da la columna y el país', () => {
  const W = 1920;
  const H = 1080;
  const L = layoutFor(W, H, { frame: true });
  const screen = pantalla(partido('matchup'));
  const u = L.u;
  // primera fila de la lista izquierda: x dentro de la lista, y = 20 + 12 virtuales + media fila
  const hit = listHit(L, screen, 10 * u, (20 + 12 + 2) * u);
  assert.deepEqual(hit, { col: 0, id: PAISES[0].id });
  const der = listHit(L, screen, L.top.w - 10 * u, (20 + 12 + 2) * u);
  assert.deepEqual(der, { col: 1, id: PAISES[0].id });
  assert.equal(listHit(L, screen, L.top.w / 2, 100 * u), null, 'la vista previa no es una fila');
  assert.equal(listHit(L, pantalla(partido('lobby')), 10 * u, 40 * u), null, 'fuera del selector no hay filas');
  const s = createSelector({ paises: PAISES, left: null, right: null });
  s.pick(hit.col, hit.id);
  assert.equal(s.sel.left, PAISES[0].id);
  assert.equal(s.sel.focusCol, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// La acción de avance: UN componente en el selector, la sala, la espera entre rondas y el final

function dibujar(
  match,
  { W = 1920, H = 1080, now = 1, ui = createUi({ iconBank: null, iconTeam: [0, 0] }), overlays = null, ctx } = {},
) {
  const c = ctx ?? createFakeCtx({ record: true, fontScale: 0.6 });
  c.reset();
  const screen = pantalla(match);
  ui.draw(c, {
    W,
    H,
    now,
    dt: 0.016,
    reduced: false,
    frame: true,
    hud: null,
    screen,
    feed: [],
    banner: null,
    pause: { visible: match.pause !== null, text: S.pause },
    teamColors: ['#E5484D', '#5BC8F5'],
    notices: [],
    overlays,
  });
  return { ui, ctx: c, screen };
}
const rellenos = (ctx) => {
  const out = [];
  let estilo = null;
  for (const c of ctx.calls) {
    if (c[0] === 'set:fillStyle') estilo = c[1];
    else if (c[0] === 'fillRect') out.push({ estilo, x: c[1], y: c[2], w: c[3], h: c[4] });
  }
  return out;
};

for (const [nombre, estado, texto] of [
  ['selector', 'matchup', S.matchup.start],
  ['sala', 'lobby', S.lobby.start],
  ['espera entre rondas', 'waitingNextRound', S.roundEnd.next],
  ['final', 'matchEnd', S.matchEnd.back],
]) {
  test(`avance (${nombre}): la tecla "Enter" con su rótulo, a la medida de su contenido y centrada`, () => {
    for (const [W, H] of [
      [1920, 1080],
      [1280, 720],
    ]) {
      const { ui, ctx, screen } = dibujar(partido(estado), { W, H });
      const r = ui.advanceRect(W, H, screen, true);
      assert.ok(r, 'hay botón');
      const u = layoutFor(W, H).u;
      const contenido = ui.painter.width('body', TYPE.body, S.keys.enter) + ui.painter.width('body', TYPE.body, texto);
      assert.ok(r.w >= contenido, `${r.w} >= ${contenido}`);
      assert.ok(r.w <= contenido + 16 * u, `a la medida: ${r.w} <= ${contenido + 16 * u}`);
      assert.ok(r.w < W / 2, 'no es una barra a lo ancho');
      assert.ok(Math.abs(r.x + r.w / 2 - W / 2) <= 1, 'centrado');
      assert.ok(r.h >= 12 * u);
      const textos = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
      assert.ok(textos.includes(S.keys.enter), 'la tecla con su rótulo');
      assert.ok(textos.includes(texto), 'y la acción');
      const dibujado = rellenos(ctx).find((f) => f.x === r.x && f.y === r.y && f.w === r.w && f.h === r.h);
      assert.ok(dibujado, 'el rectángulo que se dibuja es el mismo del clic');
      assert.ok([COLORS.focus, COLORS.track].includes(dibujado.estilo));
    }
  });
}

test('avance: nunca aparece con pausa ni con error de config; sin él no hay rectángulo de clic', () => {
  for (const estado of ['lobby', 'waitingNextRound', 'matchEnd']) {
    const { ui, screen } = dibujar(partido(estado, { pause: 'manual' }));
    assert.equal(ui.advanceRect(1920, 1080, screen, true), null, estado);
  }
  const err = screenFor(partido('matchup'), { registry: null, paises: PAISES, error: { kind: 'config', detail: 'x' } });
  assert.equal(err.advance, null);
  const { ui } = dibujar(partido('lobby'));
  assert.equal(ui.advanceRect(1920, 1080, err, true), null);
});

test('avance en el selector: deshabilitado sin dos países, con el mismo componente (color de pista)', () => {
  const m = partido('matchup');
  const c = createFakeCtx({ record: true, fontScale: 0.6 });
  const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
  const screen = pantalla(m, { left: 'PE', right: null, focus: 'PE' });
  ui.draw(c, {
    W: 1920,
    H: 1080,
    now: 1,
    dt: 0.016,
    reduced: false,
    frame: true,
    hud: null,
    screen,
    feed: [],
    banner: null,
    pause: null,
    notices: [],
  });
  const r = ui.advanceRect(1920, 1080, screen, true);
  assert.equal(screen.advance.disabled, true);
  assert.equal(rellenos(c).find((f) => f.x === r.x && f.w === r.w).estilo, COLORS.track);
});

test('la sala: los nombres de los dos equipos van a la misma altura en cualquier momento de la entrada', () => {
  const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
  const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
  for (const now of [10, 10.02, 10.05, 10.1, 10.2, 11]) {
    const { ctx: c } = dibujar(partido('lobby'), { ui, now, ctx });
    const ys = (t) => c.calls.filter((x) => x[0] === 'fillText' && x[1] === t).map((x) => x[3]);
    // el chip con el nombre es el único texto "Perú"/"México" de la sala que se repite en el título: tomo el último
    assert.equal(ys('Perú').at(-1), ys('México').at(-1), `now ${now}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Zonas seguras (F3) y superposiciones

test('F3: las zonas seguras horizontales caen todas dentro del canvas 16:9', () => {
  for (const [W, H] of [
    [1920, 1080],
    [1280, 720],
    [640, 360],
    [2560, 1440],
  ]) {
    const z = safeZones(W, H);
    assert.ok(z.length >= 2);
    for (const r of z) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0, JSON.stringify(r));
      assert.ok(r.x + r.w <= W && r.y + r.h <= H, `${W}x${H} ${JSON.stringify(r)}`);
      assert.equal(typeof r.id, 'string');
    }
  }
});

test('F3 dibuja la superposición solo cuando está encendida, con colores del tema', () => {
  const m = partido('battle');
  const sin = dibujar(m, { overlays: { safe: false } });
  const con = dibujar(m, { overlays: { safe: true } });
  const n = (c) => rellenos(c.ctx).filter((f) => f.estilo === COLORS.safeZone).length;
  assert.equal(n(sin), 0);
  assert.ok(n(con) >= 2);
});

test('marcador G, top 3 T y ayuda H: se dibujan con sus textos y nunca entran al marco del narrador', () => {
  const L = layoutFor(1920, 1080, { frame: true });
  const f = L.frame;
  const solapa = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const ov = {
    scoreboard: {
      title: S.overlays.scoreboard,
      teams: [
        { name: 'Perú', color: '#E5484D', wins: 1, pct: 50 },
        { name: 'México', color: '#5BC8F5', wins: 0, pct: 100 },
      ],
      round: 'Ronda 1/3',
      leader: { name: 'anónimo', rank: 'Cabo', xp: '40 XP' },
    },
    top3: { title: S.overlays.top3, rows: [{ name: 'ana', rank: 'Cabo', xp: '40 XP', team: 0 }], empty: null },
    help: {
      title: S.help.title,
      lines: [
        { keys: 'Enter', text: 'Continuar' },
        { keys: 'P', text: 'Pausa' },
      ],
    },
    safe: false,
  };
  for (const clave of ['scoreboard', 'top3', 'help']) {
    for (const r of overlayRects(L, { [clave]: ov[clave] })) assert.ok(!solapa(r, f), `${clave} fuera del marco`);
  }
  const { ctx } = dibujar(partido('battle'), { overlays: ov });
  const textos = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  for (const t of [
    S.overlays.scoreboard,
    'Perú',
    'México',
    'Ronda 1/3',
    S.overlays.top3,
    'ana',
    S.help.title,
    'Continuar',
  ])
    assert.ok(textos.includes(t), t);
});

test('selector con puntero: debajo de la última fila (aunque dentro de la lista) no hay fila', () => {
  const L = layoutFor(1920, 1080, { frame: true });
  const screen = pantalla(partido('matchup'));
  const u = L.u;
  const n = PAISES.length;
  const fila = Math.floor((176 * u - 12 * u) / n);
  const justoDebajo = (20 + 12) * u + n * fila + 1;
  assert.ok(justoDebajo < (20 + 176) * u, 'queda lugar en la lista debajo de la última fila');
  assert.equal(listHit(L, screen, 10 * u, justoDebajo), null);
  assert.deepEqual(listHit(L, screen, 10 * u, justoDebajo - 3), { col: 0, id: PAISES[n - 1].id });
});

test('el feed del adaptador: "máx. por regalo" con el nombre enmascarable y "Refuerzos para {país}: +{n}"; sin par no hay línea de unión', () => {
  const registry = { displayName: (k) => (k === 'oculto' ? 'anónimo' : 'ana'), version: () => 0 };
  const b = createBanners({ registry });
  b.note({ kind: 'trim', key: 'k', team: 1, teamName: 'Perú' });
  b.note({ kind: 'reinforce', key: null, team: 2, teamName: 'México', count: 3 });
  b.note({ kind: 'trim', key: 'oculto', team: 1, teamName: 'Perú' });
  b.note({ kind: 'otra', key: 'k' });
  b.note(null);
  assert.deepEqual(
    b.feed().map((f) => f.text),
    ['ana: máx. por regalo', 'Refuerzos para México: +3', 'anónimo: máx. por regalo'],
  );
  b.consume([{ type: 'join', key: 'k', team: 1 }], () => '');
  assert.equal(b.feed().length, 3, 'sin país que nombrar no deja línea');
  b.consume([{ type: 'join', key: 'k', team: 1 }], () => 'Perú');
  assert.equal(b.feed().at(-1).text, 'ana se unió a Perú');
});
