import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { createIconBank } from '../public/js/render/icons.js';
import { createLabelLayer } from '../public/js/render/labels-layer.js';
import { createMatch } from '../public/js/sim/match.js';
import { createUi } from '../public/js/ui/draw.js';
import { chipRect } from '../public/js/ui/hud-draw.js';
import { hudModel } from '../public/js/ui/hud.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { helpModel, scoreboardModel, top3Model } from '../public/js/ui/overlays.js';
import { overlayRects } from '../public/js/ui/overlays-draw.js';
import { cardRects } from '../public/js/ui/screens-draw.js';
import { screenFor } from '../public/js/ui/screens.js';
import { S } from '../public/js/ui/strings.js';
import { COLORS } from '../public/js/ui/theme.js';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';

// Segunda ronda del lote 6 (B7 a B11): solapes. La medida falsa de las pruebas tiene que ser IGUAL O MÁS ANCHA que la real
// (Pixelify Sans y Silkscreen medidas en Chromium) y la matriz cubre todas las pantallas, tamaños y estados.

const TAMANOS = [
  [480, 270],
  [640, 360],
  [512, 288],
  [683, 384],
];
const solapa = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const CUERPO = (px) => `600 ${px}px "Pixelify Sans", system-ui, sans-serif`;
const TITULO = (px) => `700 ${px}px "Silkscreen", system-ui, sans-serif`;

test('calibración: la medida falsa de las pruebas es igual o más ancha que la real de Chromium (cuerpo y títulos)', () => {
  const muestras = [
    [CUERPO(28), 'No hay usuario de TikTok. Escribe tu usuario en config.json o pásalo al arrancar;', 1107],
    [CUERPO(28), 'mientras tanto puedes probar con F1.', 531],
    [CUERPO(28), 'Sin usuario de TikTok', 284],
    [CUERPO(28), 'República Dominicana', 290],
    [CUERPO(14), 'Comenta 1 o Argentina · 2 o Bolivia para unirte', 318],
    [CUERPO(14), 'Deshacer ocultamiento', 163],
    [TITULO(40), 'Elige los dos países', 600],
    [TITULO(20), 'Atajos del narrador', 313],
  ];
  for (const [font, texto, real] of muestras) {
    const ctx = createFakeCtx({ fontScale: 0.6 });
    ctx.font = font;
    const falso = ctx.measureText(texto).width;
    assert.ok(falso >= real, `"${texto}" a ${font}: falso ${falso.toFixed(0)} < real ${real}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Escenarios

function escenario(estado, { llena = false } = {}) {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  if (estado !== 'matchup') match.command({ type: 'pickPair', a: 'AR', b: 'BO' });
  if (llena) {
    // las uniones llegan con el par ya elegido: la sala llena sus columnas hasta que aparece "+N más"
    for (let i = 0; i < 16; i++) {
      registry.touch({ userId: `u${i}`, nickname: `Donante largo ${i}` });
      registry.joinFromChat({ userId: `u${i}`, nickname: `Donante largo ${i}`, text: String(1 + (i % 2)) }, 0, 0);
    }
  }
  if (['intro', 'battle'].includes(estado)) {
    match.command({ type: 'startMatch' });
    for (let i = 0; i < 40; i++) match.step();
  }
  if (['waitingNextRound', 'matchEnd'].includes(estado)) {
    match.state = estado;
    match.winner = 0;
    match.results = [{ round: 1, winner: 0 }];
  }
  return { registry, match };
}
const CAMARA = { mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 };
const NET = {
  noUser: { state: 'noUser', since: 0 },
  noDeps: { state: 'noDeps', since: 0 },
  lost: { state: 'lost', since: 0 },
  demo: { state: 'demo', since: 0 },
};
const TOASTS = {
  0: [],
  1: [S.moderation.namesHidden],
  3: [S.newLive.confirm, S.audio.off, S.moderation.undone],
};

function dibujar({ W, H }, estado, { net = 'demo', overlays = null, toasts = 0, llena = false } = {}) {
  const { registry, match } = escenario(estado, { llena });
  const iconBank = createIconBank({ createCanvas: createFakeCanvasFactory().createCanvas });
  const ui = createUi({ iconBank, iconTeam: [iconBank.bake('#E5484D'), iconBank.bake('#5BC8F5')] });
  const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
  const hud = hudModel({ match, registry, camera: CAMARA, net: NET[net] });
  const screen = screenFor(match, { registry, paises: PAISES, selection: { left: 'AR', right: 'BO', focus: 'AR' } });
  const ov =
    overlays && match.pair
      ? {
          scoreboard: overlays.includes('G') ? scoreboardModel({ match, registry }) : null,
          top3: overlays.includes('T') ? top3Model({ registry }) : null,
          help: overlays.includes('H') ? helpModel() : null,
          safe: false,
        }
      : null;
  ui.draw(ctx, {
    W,
    H,
    now: 5,
    dt: 0.016,
    reduced: false,
    frame: true,
    hud,
    screen,
    feed: [],
    banner: null,
    pause: { visible: false, text: S.pause },
    notices: TOASTS[toasts],
    overlays: ov,
    teamColors: ['#E5484D', '#5BC8F5'],
  });
  const L = layoutFor(W, H);
  // obstáculos calculados aparte, desde la geometría de cada pieza (no desde lo que decida el código que se prueba)
  const obs = [];
  if (L.frame) obs.push(['marco', L.frame]);
  if (hud.visible && !['roundEnd', 'matchEnd'].includes(screen.kind))
    obs.push(['riel izq', L.railL], ['riel der', L.railR]);
  if (hud.visible || screen.kind === 'lobby') obs.push(['feed', L.feed]);
  if (screen.kind) cardRects(L, screen.kind, screen.model).forEach((r, i) => obs.push([`${screen.kind}#${i}`, r]));
  const adv = ui.advanceRect(W, H, screen, true);
  if (adv) obs.push(['avance', adv]);
  if (ov)
    for (const k of ['scoreboard', 'top3', 'help'])
      if (ov[k]) overlayRects(L, { [k]: ov[k] }).forEach((r) => obs.push([`panel ${k}`, r]));
  return { ui, ctx, L, obs, hud, screen };
}
const PANTALLAS = ['matchup', 'lobby', 'battle', 'waitingNextRound', 'matchEnd'];

test('B11: el chip de conexión queda anclado a 4 px virtuales sobre el feed en los cuatro tamaños (y no pisa nada)', () => {
  for (const [W, H] of TAMANOS) {
    for (const estado of PANTALLAS) {
      const d = dibujar({ W, H }, estado, { net: 'noUser' });
      const u = d.L.u;
      const chip = d.ui.placed.chip;
      assert.ok(chip, `${W}x${H} ${estado}: hay chip`);
      assert.equal(
        chip.y + chip.h + 4 * u,
        d.L.feed.y,
        `${W}x${H} ${estado}: chip en y ${chip.y} (feed en ${d.L.feed.y})`,
      );
      for (const [n, r] of d.obs) assert.ok(!solapa(chip, r), `${W}x${H} ${estado}: el chip pisa ${n}`);
    }
  }
  const d = dibujar({ W: 480, H: 270 }, 'battle', { net: 'noUser' });
  assert.equal(chipRect(d.ui.painter, d.L, S.connection.noUser).y, 210, 'en 480×270 queda como antes (y 210)');
});

test('B7 (D10): el aviso largo de conexión nunca pisa nada ni se corta, y no se dibuja con H, G o T abiertas ni en los resultados', () => {
  for (const [W, H] of TAMANOS) {
    for (const estado of PANTALLAS) {
      for (const net of ['noUser', 'noDeps', 'lost']) {
        for (const overlays of [null, 'H', 'GT']) {
          const d = dibujar({ W, H }, estado, { net, overlays });
          const texto = d.hud.alert.text;
          const permitido = (!overlays || estado === 'matchup') && !['waitingNextRound', 'matchEnd'].includes(estado);
          const id = `${W}x${H} ${estado} ${net} ${overlays ?? '-'}`;
          if (!permitido) {
            assert.equal(d.ui.placed.alert, null, `${id}: no se dibuja`);
            continue;
          }
          const a = d.ui.placed.alert;
          assert.ok(a, `${id}: se dibuja (hay lugar)`);
          for (const [n, r] of d.obs)
            assert.ok(!solapa(a, r), `${id}: el aviso (x ${a.x}-${a.x + a.w}, y ${a.y}-${a.y + a.h}) pisa ${n}`);
          if (d.ui.placed.chip) assert.ok(!solapa(a, d.ui.placed.chip), `${id}: pisa el chip`);
          // los renglones del aviso son los únicos textos que se dibujan con el color de error
          let estilo = null;
          const lineas = [];
          for (const c of d.ctx.calls) {
            if (c[0] === 'set:fillStyle') estilo = c[1];
            else if (c[0] === 'fillText' && estilo === COLORS.errorText) lineas.push(String(c[1]));
          }
          assert.equal(lineas.join(' ').replace(/\s+/g, ' ').trim(), texto, `${id}: el aviso se dibuja entero`);
        }
      }
    }
  }
});

test('B8 y B10 (D11): los avisos de teclas nunca van encima de un panel abierto ni del contenido de la pantalla (sala llena, uno y tres avisos)', () => {
  for (const [W, H] of TAMANOS) {
    for (const estado of PANTALLAS) {
      for (const overlays of [null, 'H', 'G', 'T', 'GT']) {
        for (const n of [1, 3]) {
          const d = dibujar({ W, H }, estado, { overlays, toasts: n, llena: estado === 'lobby', net: 'noUser' });
          const id = `${W}x${H} ${estado} ${overlays ?? '-'} ${n} avisos`;
          const t = d.ui.placed.toasts;
          if (!overlays) assert.ok(t.length >= 1, `${id}: con la pantalla libre al menos el último aviso se ve`);
          t.forEach((r, i) => {
            for (const [nombre, o] of d.obs)
              assert.ok(!solapa(r, o), `${id}: el aviso ${i + 1} (y ${r.y}-${r.y + r.h}) pisa ${nombre}`);
            if (d.ui.placed.chip) assert.ok(!solapa(r, d.ui.placed.chip), `${id}: pisa el chip`);
            if (d.ui.placed.alert) assert.ok(!solapa(r, d.ui.placed.alert), `${id}: pisa el aviso largo`);
            t.slice(i + 1).forEach((q) => assert.ok(!solapa(r, q), `${id}: avisos encimados`));
            assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${id}: dentro del lienzo`);
          });
        }
      }
    }
  }
});

test('B8: en la sala con las columnas llenas ("+N más") tres avisos no tapan las filas de ninguna columna', () => {
  for (const [W, H] of TAMANOS) {
    const d = dibujar({ W, H }, 'lobby', { toasts: 3, llena: true });
    assert.ok(
      d.screen.model.teams.some((t) => t.more > 0),
      'la sala llega a "+N más"',
    );
    for (const r of d.ui.placed.toasts)
      for (const [n, o] of d.obs) assert.ok(!solapa(r, o), `${W}x${H}: aviso y ${r.y} pisa ${n}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// B9: etiquetas de donantes contra el HUD

test('B9: las etiquetas de donantes no cortan rieles, banda inferior, marco, chip, aviso ni paneles abiertos (cuatro tamaños)', () => {
  const AY = { soldado: SPRITES.soldado.ay, jeep: 0, tanque: 0, pesado: 0 };
  for (const [W, H] of TAMANOS) {
    for (const overlays of [null, 'H', 'GT']) {
      const d = dibujar({ W, H }, 'battle', { net: 'noUser', overlays });
      const u = d.L.u;
      const registry = {
        get: () => ({ xp: { match: 10 } }),
        rankOf: () => ({ index: 2, label: 'Cabo' }),
        displayName: (k) => `donante ${k}`,
      };
      const capa = createLabelLayer({
        registry,
        teamHex: ['#E5484D', '#5BC8F5'],
        spriteAy: AY,
        marksSize: { soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] },
      });
      // unidades repartidas por todo el campo: algunas caen bajo el HUD
      const units = [];
      // los de menor id (los que llevan etiqueta a k = 1) caen sobre el riel izquierdo, el derecho, el centro (bajo H, G y T),
      // la banda inferior y el marco
      const sitios = [
        [100, 350],
        [1340, 350],
        [720, 300],
        [720, 760],
        [1300, 700],
        [560, 220],
        [720, 130],
        [200, 780],
      ];
      sitios.forEach(([x, y], i) =>
        units.push({
          id: i + 1,
          side: i % 2,
          owner: `d${i}`,
          unitValue: 5,
          kind: 'soldado',
          alive: true,
          x,
          y,
          px: x,
          py: y,
        }),
      );
      const s = Math.min(W / 1440, H / 810);
      const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
      capa.draw(ctx, {
        W,
        H,
        u,
        units,
        k: 1,
        screen: { s, ox: 0, oy: 0, device: false, marks: false, x0: 0, y0: 0 },
        alpha: 1,
        now: 1,
        spotlight: null,
        onlyRank: false,
        icons: { descs: [], count: 0 },
        blockers: d.ui.obstacles ?? [],
      });
      const bloqueos = [
        ...d.obs.filter(([n]) => !n.startsWith('avance')),
        ['chip', d.ui.placed.chip],
        ['aviso', d.ui.placed.alert],
        ['banda inferior', d.L.bottom],
      ];
      for (const r of capa.rects) {
        for (const [n, o] of bloqueos) {
          if (!o) continue;
          assert.ok(
            !solapa(r, o),
            `${W}x${H} ${overlays ?? '-'}: la etiqueta "${r.key}" (x ${r.x}, y ${r.y}) corta ${n}`,
          );
        }
      }
      assert.ok(capa.rects.length > 0, `${W}x${H}: quedan etiquetas visibles`);
    }
  }
});
