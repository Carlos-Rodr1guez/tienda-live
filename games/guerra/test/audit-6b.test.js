import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { createIconBank } from '../public/js/render/icons.js';
import { createLabelLayer } from '../public/js/render/labels-layer.js';
import { createMatch } from '../public/js/sim/match.js';
import { createBanners } from '../public/js/ui/banners.js';
import { createUi } from '../public/js/ui/draw.js';
import { hudModel } from '../public/js/ui/hud.js';
import { uiScale } from '../public/js/ui/layout.js';
import { helpModel, scoreboardModel, top3Model } from '../public/js/ui/overlays.js';
import { screenFor } from '../public/js/ui/screens.js';
import { S } from '../public/js/ui/strings.js';
import { auditLog, createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';
import { arrancar } from './support/fake-main.js';

// Auditoría de dibujo (B12, B13, B14): ningún texto queda DEBAJO de un fillRect dibujado después (salvo los velos). Los paneles
// están al 78 %: lo que queda debajo se transparenta y se lee encimado. Es la misma auditoría que se hizo en el navegador.

const TAMANOS = [
  [480, 270],
  [640, 360],
  [512, 288],
  [683, 384],
];
const PANTALLAS = ['matchup', 'lobby', 'battle', 'waitingNextRound', 'matchEnd'];
const PANELES = [null, 'H', 'G', 'T'];

function escenario(estado, usuarios = 10) {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  if (estado !== 'matchup') match.command({ type: 'pickPair', a: 'AR', b: 'BO' });
  for (let i = 0; i < usuarios; i++) {
    registry.touch({ userId: `u${i}`, nickname: `Donante ${i}` });
    registry.joinFromChat({ userId: `u${i}`, nickname: `Donante ${i}`, text: String(1 + (i % 2)) }, 0, 0);
  }
  if (estado === 'battle') {
    match.command({ type: 'startMatch' });
    for (let i = 0; i < 40; i++) match.step();
  }
  if (['waitingNextRound', 'matchEnd'].includes(estado)) {
    match.state = estado;
    match.winner = 0;
    match.results = [{ round: 1, winner: 0 }];
    registry.startMatch();
    for (let i = 0; i < 4; i++) registry.addCoins(`u${i}`, 50 + i, 1);
  }
  return { registry, match };
}

const SITIOS = [
  [100, 350],
  [1340, 350],
  [720, 300],
  [720, 760],
  [1300, 700],
  [560, 220],
  [720, 130],
  [200, 780],
  [900, 500],
  [400, 600],
];
const BANNER = {
  id: 1,
  kind: 'rank',
  text: 'anónimo ascendió a Capitán',
  team: 1,
  alpha: 1,
  dy: 0,
  scale: 1,
  rare: false,
};
const TOASTS = {
  0: [],
  1: [S.audio.on],
  3: [S.newLive.confirm, S.audio.off, S.moderation.namesVisible ?? S.moderation.namesShown],
};

/** Un cuadro completo en el orden de `main.js`: etiquetas (con el HUD del cuadro anterior) y después la interfaz. */
function cuadro(
  [W, H],
  estado,
  { panel = null, aviso = false, banner = false, toasts = 0, etiquetas = true, usuarios = 10, cola = false } = {},
) {
  const { registry, match } = escenario(estado, usuarios);
  // C21: tropas de tierra en cola en los dos lados (el estado del sim se arma a mano en el escenario de prueba)
  if (cola) {
    match.world.queues[0].groundUnits = 37;
    match.world.queues[1].groundUnits = 120;
  }
  const iconBank = createIconBank({ createCanvas: createFakeCanvasFactory().createCanvas });
  const ui = createUi({ iconBank, iconTeam: [iconBank.bake('#E5484D'), iconBank.bake('#5BC8F5')] });
  const hud = hudModel({
    match,
    registry,
    camera: { mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 },
    net: aviso ? { state: 'noUser', since: 0 } : { state: 'demo', since: 0 },
  });
  const screen = screenFor(match, { registry, paises: PAISES, selection: { left: 'AR', right: 'BO', focus: 'AR' } });
  const ov = panel
    ? {
        scoreboard: panel === 'G' && match.pair ? scoreboardModel({ match, registry }) : null,
        top3: panel === 'T' && match.pair ? top3Model({ registry }) : null,
        help: panel === 'H' ? helpModel() : null,
        safe: false,
      }
    : null;
  const f = {
    W,
    H,
    now: 5,
    dt: 0.016,
    reduced: false,
    frame: true,
    hud,
    screen,
    feed: [],
    pause: { visible: false, text: S.pause },
    notices: TOASTS[toasts],
    overlays: ov,
    teamColors: ['#E5484D', '#5BC8F5'],
    banner: null,
  };
  // cuadro anterior (da los obstáculos al siguiente) y cuadro que se audita
  ui.draw(createFakeCtx({ record: true, fontScale: 0.6 }), f);
  // como main.js: con un panel abierto (D13) o sin hueco para el banner (D15) el banner espera y no se dibuja; fuera de la
  // batalla no se desliza (dy 0)
  if (banner && !panel && ui.placed.bannerSlot !== null) {
    const raro = banner === 'raro';
    f.banner = raro
      ? {
          id: 2,
          kind: 'gift',
          text: 'anónimo envió Galaxy',
          team: null,
          alpha: 1,
          dy: estado === 'battle' ? 12 : 0,
          scale: 1,
          rare: true,
        }
      : BANNER;
  }
  // el cuadro anterior ya traía el banner: sus obstáculos llegan a las etiquetas
  if (f.banner) ui.draw(createFakeCtx({ record: true, fontScale: 0.6 }), f);
  const ctx = createFakeCtx({ record: true, fontScale: 0.6 });
  // el mundo con donantes se ve en la batalla y en los resultados; en el selector y la sala no hay unidades
  if (etiquetas && ['battle', 'waitingNextRound', 'matchEnd'].includes(estado)) {
    const reg = {
      get: () => ({ xp: { match: 10 } }),
      rankOf: () => ({ index: 2, label: 'Cabo' }),
      displayName: (k) => `donante ${k}`,
    };
    const capa = createLabelLayer({
      registry: reg,
      teamHex: ['#E5484D', '#5BC8F5'],
      spriteAy: { soldado: SPRITES.soldado.ay, jeep: 0, tanque: 0, pesado: 0 },
      marksSize: { soldado: [3, 2], jeep: [6, 3], tanque: [8, 4], pesado: [10, 5] },
    });
    const units = SITIOS.map(([x, y], i) => ({
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
    }));
    const s = Math.min(W / 1440, H / 810);
    for (const now of [1, 1.5])
      capa.draw(ctx, {
        W,
        H,
        u: uiScale(W, H),
        units,
        k: 1,
        screen: { s, ox: 0, oy: 0, device: false, marks: false, x0: 0, y0: 0 },
        alpha: 1,
        now,
        spotlight: null,
        onlyRank: false,
        icons: { descs: [], count: 0 },
        blockers: ui.obstacles,
      });
    ctx.reset();
    capa.draw(ctx, {
      W,
      H,
      u: uiScale(W, H),
      units,
      k: 1,
      screen: { s, ox: 0, oy: 0, device: false, marks: false, x0: 0, y0: 0 },
      alpha: 1,
      now: 2,
      spotlight: null,
      onlyRank: false,
      icons: { descs: [], count: 0 },
      blockers: ui.obstacles,
    });
  }
  ui.draw(ctx, f);
  return { ctx, W, H, ui };
}

/** Los textos que quedan debajo de un fillRect dibujado después (salvo los velos: ≥ 60 % del lienzo). */
function tapados({ ctx, W, H }) {
  const log = auditLog(ctx.calls, 0.6);
  const malos = [];
  for (const t of log.filter((e) => e.kind === 'text' && e.text.trim())) {
    for (const r of log.filter((e) => e.kind === 'rect' && e.i > t.i)) {
      if (r.w * r.h >= 0.6 * W * H) continue;
      if (t.x < r.x + r.w && r.x < t.x + t.w && t.y < r.y + r.h && r.y < t.y + t.h) {
        malos.push(
          `"${t.text}" (x ${Math.round(t.x)}, y ${Math.round(t.y)}) queda debajo de un panel (x ${Math.round(r.x)}-${Math.round(r.x + r.w)}, y ${Math.round(r.y)}-${Math.round(r.y + r.h)})`,
        );
        break;
      }
    }
  }
  return malos;
}

function matriz(estados, extras) {
  for (const tam of TAMANOS) {
    for (const estado of estados) {
      for (const panel of PANELES) {
        for (const [nombre, o] of extras) {
          const malos = tapados(cuadro(tam, estado, { panel, ...o }));
          assert.deepEqual(
            malos.slice(0, 3),
            [],
            `${tam[0]}x${tam[1]} ${estado} panel ${panel ?? '-'} ${nombre}: ${malos.length} textos tapados`,
          );
        }
      }
    }
  }
}

test('B13: con H, G o T abiertas ninguna pieza de la pantalla queda debajo del panel (selector, sala, batalla, fin de ronda y de partido)', () => {
  matriz(PANTALLAS, [
    ['sin extras', {}],
    ['aviso largo', { aviso: true }],
  ]);
});

test('B12: con H, G o T abiertas ningún banner queda debajo del panel (batalla, con la cola llena)', () => {
  matriz(['battle'], [['banner a la vista', { banner: true, etiquetas: false }]]);
});

test('B14: las etiquetas de donantes no quedan debajo de los avisos de teclas (1 y 3 avisos; batalla y resultados, con cada panel)', () => {
  matriz(
    ['battle', 'waitingNextRound', 'matchEnd'],
    [
      ['1 aviso', { toasts: 1 }],
      ['3 avisos', { toasts: 3 }],
      ['todo junto', { aviso: true, banner: true, toasts: 3 }],
    ],
  );
});

// ---------------------------------------------------------------------------------------------------------------
// B12 (D13): los banners esperan con un panel abierto

test('B12 (D13): con H, G o T abiertas no se dibuja ningún banner; al cerrar sale el que estaba y la cola no pierde ninguno', () => {
  const registry = { displayName: () => 'ana', version: () => 0 };
  const b = createBanners({ registry });
  b.consume(
    [1, 2, 3, 4].map((i) => ({ type: 'rankUp', key: `k${i}`, team: 1, from: 0, to: 4 })),
    () => 'Perú',
  );
  b.update(1, false, true, false);
  assert.ok(b.current(), 'sin panel el banner se ve');
  const id = b.current().id;
  const texto = b.current().text;
  for (let t = 1.1; t < 30; t += 0.1) {
    b.update(t, false, true, true); // panel abierto: 29 s
    assert.equal(b.current(), null, `t ${t.toFixed(1)}: con el panel abierto no se dibuja`);
  }
  assert.equal(b.pending(), 3, 'la cola sigue completa');
  b.update(30, false, true, false);
  assert.ok(b.current(), 'al cerrar sigue el banner');
  assert.equal(b.current().id, id, 'el mismo que se estaba mostrando');
  assert.equal(b.current().text, texto);
  assert.ok(b.current().alpha > 0.5, 'sin haber gastado su tiempo');
  let vistos = 1;
  let ultimo = id;
  for (let t = 30.1; t < 60; t += 0.1) {
    b.update(t, false, true, false);
    if (b.current() && b.current().id !== ultimo) {
      ultimo = b.current().id;
      vistos++;
    }
  }
  assert.equal(vistos, 4, 'salieron los cuatro, ninguno se perdió');
});

test('B12 en main.js: con la ayuda abierta no se dibuja ningún banner (letra de banner, 8 px virtuales) y al cerrarla vuelven', async () => {
  const e = await arrancar('?donantes&rapido=8');
  // el banner usa la letra de 8 px virtuales (32 px a 1080p); el feed, la de 7 (28 px)
  const bannerVisible = () => {
    let px = 0;
    for (const c of e.ctx.calls) {
      if (c[0] === 'set:font') px = Number(/(\d+)px/.exec(String(c[1]))?.[1]);
      else if (c[0] === 'fillText' && px === 32 && /ascendió a|envió/.test(String(c[1]))) return true;
    }
    return false;
  };
  let sin = false;
  for (let i = 0; i < 80 && !sin; i++) {
    e.cuadros(1, 100);
    sin = bannerVisible();
  }
  assert.ok(sin, 'sin panel se ven banners');
  e.tecla('h');
  for (let i = 0; i < 40; i++) {
    e.cuadros(1, 100);
    assert.equal(bannerVisible(), false, `cuadro ${i}: con H abierta no se dibuja ningún banner`);
  }
  e.tecla('h');
  let vuelve = false;
  for (let i = 0; i < 30 && !vuelve; i++) {
    e.cuadros(1, 100);
    vuelve = bannerVisible();
  }
  assert.ok(vuelve, 'al cerrar la ayuda los banners siguen');
});

// ---------------------------------------------------------------------------------------------------------------
// B15 (D15): el lugar del banner fuera de la batalla

test('B15: el banner (de ascenso y raro) no tapa nada en ninguna pantalla, con y sin aviso largo y con 0, 1 y 3 avisos de teclas', () => {
  const pantallas = [
    ['matchup', 10],
    ['lobby', 0],
    ['lobby', 16],
    ['battle', 10],
    ['waitingNextRound', 10],
    ['matchEnd', 10],
  ];
  for (const tam of TAMANOS) {
    for (const [estado, usuarios] of pantallas) {
      for (const aviso of [false, true]) {
        for (const toasts of [0, 1, 3]) {
          for (const banner of ['rank', 'raro']) {
            const malos = tapados(cuadro(tam, estado, { banner, aviso, toasts, usuarios, etiquetas: false }));
            assert.deepEqual(
              malos.slice(0, 3),
              [],
              `${tam[0]}x${tam[1]} ${estado}(${usuarios}) aviso ${aviso} ${toasts} avisos banner ${banner}: ${malos.length} tapados`,
            );
          }
        }
      }
    }
  }
});

test('B15: el hueco del banner no depende de que haya banner (no oscila), es del tamaño máximo y en la batalla queda donde estaba', () => {
  for (const tam of TAMANOS) {
    for (const estado of ['matchup', 'lobby', 'battle', 'waitingNextRound', 'matchEnd']) {
      for (const aviso of [false, true]) {
        const con = cuadro(tam, estado, { banner: 'rank', aviso, etiquetas: false });
        const sin = cuadro(tam, estado, { aviso, etiquetas: false });
        assert.deepEqual(
          con.ui.placed.bannerSlot,
          sin.ui.placed.bannerSlot,
          `${tam[0]}x${tam[1]} ${estado} aviso ${aviso}: el hueco cambia con el banner`,
        );
        const hueco = sin.ui.placed.bannerSlot;
        if (hueco)
          assert.equal(hueco.w, Math.min(260 * uiScale(...tam), tam[0] - 16 * uiScale(...tam)) + 14 * uiScale(...tam));
      }
    }
  }
  const a = cuadro([480, 270], 'battle', { banner: 'rank', etiquetas: false });
  assert.equal(a.ui.placed.bannerSlot.y, 96, 'en la batalla queda donde estaba: y 96 a 480×270');
});

test('B15: sin hueco el banner espera: no se dibuja y su tiempo no corre; cuando vuelve a haber lugar sale (main.js)', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true, servidor: true, fontScale: 0.6 });
  e.ws.abrir();
  for (const id of ['a', 'b', 'c'])
    e.ws.recibir({
      type: 'gift',
      userId: id,
      uniqueId: id,
      nickname: `Donante ${id}`,
      giftId: 'g',
      giftName: 'Rose',
      coins: 100,
      count: 1,
    });
  e.tecla('Enter'); // la sala
  e.cuadros(3, 100);
  const bannerVisible = () => {
    let px = 0;
    for (const c of e.ctx.calls) {
      if (c[0] === 'set:font') px = Number(/(\d+)px/.exec(String(c[1]))?.[1]);
      else if (c[0] === 'fillText' && px === 32 && /ascendió a|envió/.test(String(c[1]))) return true;
    }
    return false;
  };
  // con el aviso largo de "sin usuario" la sala no tiene hueco para el banner
  e.ws.estado({ state: 'sin-usuario' });
  for (let i = 0; i < 120; i++) {
    e.cuadros(1, 100);
    assert.equal(bannerVisible(), false, `cuadro ${i}: sin hueco no se dibuja el banner`);
  }
  e.ws.estado({ state: 'conectado' });
  let sale = false;
  for (let i = 0; i < 30 && !sale; i++) {
    e.cuadros(1, 100);
    sale = bannerVisible();
  }
  assert.ok(sale, 'al volver a haber lugar sale el banner que esperaba (sus 6 s no se gastaron)');
});

// ---------------------------------------------------------------------------------------------------------------
// B16: G y T sin par no retienen los banners

for (const tecla of ['g', 't']) {
  test(`B16: en el selector sin par, ${tecla.toUpperCase()} no retiene los banners; con par (sala), sí`, async () => {
    const e = await arrancar('?pair=PE-MX', { selector: true, servidor: true });
    e.ws.abrir();
    for (const id of ['a', 'b', 'c', 'd'])
      e.ws.recibir({
        type: 'gift',
        userId: id,
        uniqueId: id,
        nickname: `Donante ${id}`,
        giftId: 'g',
        giftName: 'Rose',
        coins: 100,
        count: 1,
      });
    const bannerVisible = () => {
      let px = 0;
      for (const c of e.ctx.calls) {
        if (c[0] === 'set:font') px = Number(/(\d+)px/.exec(String(c[1]))?.[1]);
        else if (c[0] === 'fillText' && px === 32 && /ascendió a|envió/.test(String(c[1]))) return true;
      }
      return false;
    };
    e.tecla(tecla);
    let visto = false;
    for (let i = 0; i < 40 && !visto; i++) {
      e.cuadros(1, 100);
      visto = bannerVisible();
    }
    assert.ok(visto, 'sin par G no se dibuja y no frena los banners');
    e.tecla(tecla);
    e.tecla('Enter'); // la sala: ahora hay par
    e.cuadros(40, 100); // pasan los banners que quedaban
    e.ws.recibir({
      type: 'gift',
      userId: 'z',
      uniqueId: 'z',
      nickname: 'Zeta',
      giftId: 'g',
      giftName: 'Rose',
      coins: 1000,
      count: 1,
    });
    e.tecla(tecla);
    for (let i = 0; i < 40; i++) {
      e.cuadros(1, 100);
      assert.equal(bannerVisible(), false, `cuadro ${i}: con par y G abierta los banners esperan`);
    }
  });
}

test('B15: fuera de la batalla el banner raro no se desliza: su y no cambia entre cuadros (main.js)', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true, servidor: true, fontScale: 0.6 });
  e.ws.abrir();
  e.ws.recibir({
    type: 'gift',
    userId: 'a',
    uniqueId: 'a',
    nickname: 'Ana',
    giftId: 'g',
    giftName: 'Galaxy',
    coins: 1000,
    count: 1,
  });
  const y = () => {
    let px = 0;
    for (const c of e.ctx.calls) {
      if (c[0] === 'set:font') px = Number(/(\d+)px/.exec(String(c[1]))?.[1]);
      else if (c[0] === 'fillText' && px === 32 && /envió Galaxy/.test(String(c[1]))) return c[3];
    }
    return null;
  };
  let visto = false;
  for (let i = 0; i < 200 && !visto; i++) {
    e.cuadros(1, 50);
    visto = y() !== null;
  }
  assert.ok(visto, 'sale el banner del regalo grande en el selector');
  const ys = new Set();
  for (let i = 0; i < 12; i++) {
    e.cuadros(1, 16);
    if (y() !== null) ys.add(y());
  }
  assert.equal(ys.size, 1, `la y del banner no cambia entre cuadros (${[...ys].join(', ')})`);
});

// ---------------------------------------------------------------------------------------------------------------
// C21: "+{n} en cola" debajo de cada riel

test('C21: con cola en los dos lados nada queda tapado (4 tamaños, H/G/T, aviso largo, banner y 0/1/3 avisos, con etiquetas)', () => {
  for (const tam of TAMANOS) {
    for (const panel of PANELES) {
      for (const [nombre, o] of [
        ['sin extras', {}],
        ['aviso largo', { aviso: true }],
        ['banner', { banner: 'rank' }],
        ['1 aviso', { toasts: 1 }],
        ['3 avisos', { toasts: 3 }],
        ['todo junto', { aviso: true, banner: 'raro', toasts: 3 }],
      ]) {
        const c = cuadro(tam, 'battle', { panel, cola: true, ...o });
        const textos = c.ctx.calls.filter((x) => x[0] === 'fillText').map((x) => String(x[1]));
        assert.ok(
          textos.includes('+37 en cola') && textos.includes('+120 en cola'),
          `${tam[0]}x${tam[1]} ${panel ?? '-'} ${nombre}: se ven las dos pastillas`,
        );
        const malos = tapados(c);
        assert.deepEqual(
          malos.slice(0, 3),
          [],
          `${tam[0]}x${tam[1]} ${panel ?? '-'} ${nombre}: ${malos.length} tapados`,
        );
      }
    }
  }
});

test('C21: la pastilla no sale en los resultados ni sin cola', () => {
  const hay = (c) => c.ctx.calls.some((x) => x[0] === 'fillText' && /en cola$/.test(String(x[1])));
  for (const estado of ['waitingNextRound', 'matchEnd'])
    assert.ok(!hay(cuadro([480, 270], estado, { cola: true })), estado);
  assert.ok(!hay(cuadro([480, 270], 'battle', {})));
});
