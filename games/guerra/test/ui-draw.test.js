import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createIconBank } from '../public/js/render/icons.js';
import { createMatch } from '../public/js/sim/match.js';
import { createBanners } from '../public/js/ui/banners.js';
import { createUi } from '../public/js/ui/draw.js';
import { hudModel } from '../public/js/ui/hud.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { screenFor } from '../public/js/ui/screens.js';
import { cardRects } from '../public/js/ui/screens-draw.js';
import { S } from '../public/js/ui/strings.js';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';
import { WORST_NAMES } from './support/forbidden-words.js';

// Dibujo del HUD, las pantallas y los banners: nada se sale de su caja ni entra al marco del narrador, los nombres del
// peor caso se recortan con "…", un carácter bidi no da vuelta la línea, y lo que solo cambia con eventos no se re-mide.

const CAMARA = { mode: 'auto', autoEnabled: true, k: 1.5, kShown: 1.5, level: 1, levels: 8 };
const TAMANOS = [
  [640, 360],
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
];
const PROHIBIDOS = /[\p{Cf}\p{Cc}]/u;

function fixtura() {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  match.command({ type: 'startMatch' });
  const { createCanvas } = createFakeCanvasFactory();
  const iconBank = createIconBank({ createCanvas });
  const iconTeam = [iconBank.bake(match.pair.teams[0].color), iconBank.bake(match.pair.teams[1].color)];
  const ui = createUi({ iconBank, iconTeam });
  return { registry, match, ui };
}

/** Cajas de los textos dibujados: `{text, x0, x1, y}` según el `textAlign` vigente y el ancho del `measureText` falso. */
function cajas(calls) {
  let align = 'left';
  const out = [];
  for (const c of calls) {
    if (c[0] === 'set:textAlign') align = c[1];
    if (c[0] !== 'fillText') continue;
    const w = String(c[1]).length * 5;
    const x0 = align === 'right' ? c[2] - w : align === 'center' ? c[2] - w / 2 : c[2];
    out.push({ text: String(c[1]), x0, x1: x0 + w, y: c[3] });
  }
  return out;
}
const dentro = (b, r) => b.x0 >= r.x && b.x1 <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h;
const choca = (b, r) => b.x0 < r.x + r.w && r.x < b.x1 && b.y > r.y && b.y < r.y + r.h;

function cuadro(ui, ctx, { W, H }, f) {
  ctx.reset();
  ui.draw(ctx, { W, H, now: 10, dt: 1 / 60, reduced: false, frame: true, ...f });
  return cajas(ctx.calls);
}

function modelos(fx, { hudOverride } = {}) {
  const hud = hudModel({ match: fx.match, registry: fx.registry, camera: CAMARA, net: null });
  if (hudOverride) hudOverride(hud);
  const screen = screenFor(fx.match, {
    registry: fx.registry,
    paises: PAISES,
    selection: { left: 'PE', right: 'MX', focus: 'PE' },
  });
  return { hud, screen };
}

test('CB-17: el HUD entra en sus paneles a todos los tamaños, sin tocar el marco, con nombres del peor caso', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  for (const [W, H] of TAMANOS) {
    const L = layoutFor(W, H);
    const ctx = createFakeCtx({ record: true });
    const peor = WORST_NAMES.filter(Boolean);
    const { hud, screen } = modelos(fx, {
      hudOverride(h) {
        h.panels[0].name = peor[0];
        h.panels[1].name = peor[4]; // 200 caracteres
        h.rails[0].joinName = peor[2]; // CJK
        h.rails[1].joinName = peor[1]; // 24 emoji
      },
    });
    const feed = peor.map((n, i) => ({ text: `${n} ascendió a Sargento`, team: (i % 2) + 1, kind: 'rank' }));
    const bx = cuadro(fx.ui, ctx, { W, H }, { hud, screen, feed, banner: null });
    assert.ok(bx.length > 10, `${W}×${H}: dibujó texto`);
    const regiones = [L.panelL, L.panelR, L.center, L.railL, L.railR, L.feed, L.status, L.field, L.frame];
    for (const b of bx) {
      assert.doesNotMatch(b.text, PROHIBIDOS, `${W}×${H}: ${JSON.stringify(b.text)}`);
      assert.ok(b.x0 >= 0 && b.x1 <= W && b.y >= 0 && b.y <= H, `${W}×${H} fuera del lienzo: ${b.text}`);
      assert.ok(
        regiones.some((r) => dentro(b, r)),
        `${W}×${H}: "${b.text.slice(0, 30)}" se sale de su caja (${b.x0}..${b.x1}, ${b.y})`,
      );
      if (b.text !== S.frame)
        assert.ok(!choca(b, L.frame) || dentro(b, L.frame), `${W}×${H}: pisa el marco: ${b.text}`);
    }
  }
});

test('CB-17: los textos del HUD salen de S: título del estado de la cámara, leyenda "Defensa" y "Ataque", marco y rótulos', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  const ctx = createFakeCtx({ record: true });
  const { hud, screen } = modelos(fx);
  const textos = cuadro(fx.ui, ctx, { W: 1920, H: 1080 }, { hud, screen, feed: [], banner: null }).map((b) => b.text);
  for (const esperado of [
    S.camera.auto,
    S.legend.defensa,
    S.legend.ataque,
    S.frame,
    S.hud.joinPrefix(1),
    'Perú',
    'México',
    S.feed.empty,
  ]) {
    assert.ok(textos.includes(esperado), `falta "${esperado}"`);
  }
  // el rótulo de estado crece con u (S6): a 1080p la fuente del estado es de 28 px
  const fuentes = ctx.calls.filter((c) => c[0] === 'set:font').map((c) => String(c[1]));
  assert.ok(
    fuentes.some((f) => /\b28px\b/.test(f)),
    'texto de 7 px virtuales × u = 4',
  );
  assert.ok(
    fuentes.every((f) => !/\b12px\b/.test(f)),
    'ninguna fuente de 12 px a 1080p',
  );
});

test('S3: el estado de la cámara y el rótulo del botón se leen por separado en el modelo, y el HUD dibuja el estado', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  const ctx = createFakeCtx({ record: true });
  const { hud, screen } = modelos(fx);
  const t = cuadro(fx.ui, ctx, { W: 1920, H: 1080 }, { hud, screen, feed: [], banner: null }).map((b) => b.text);
  assert.ok(t.includes(S.camera.auto));
  assert.ok(!t.includes(S.camera.zoomIn), 'los botones son del DOM, no del lienzo');
  const manual = hudModel({ match: fx.match, registry: fx.registry, camera: { ...CAMARA, mode: 'manual' }, net: null });
  assert.equal(manual.controls.auto.text, hud.controls.auto.text, 'el rótulo del botón es fijo');
  assert.notEqual(manual.center.status, hud.center.status, 'el estado sí cambia');
});

test('D21 punto 16: lo que solo cambia con eventos no se re-mide: del segundo cuadro en adelante, cero measureText', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  const ctx = createFakeCtx({ record: true });
  const { hud, screen } = modelos(fx);
  const feed = [{ text: 'Ana ascendió a Sargento', team: 1, kind: 'rank' }];
  cuadro(fx.ui, ctx, { W: 1920, H: 1080 }, { hud, screen, feed, banner: null });
  assert.ok(ctx.byName.measureText > 0, 'el primer cuadro mide');
  let medidas = 0;
  for (let i = 0; i < 60; i++) {
    cuadro(fx.ui, ctx, { W: 1920, H: 1080 }, { hud, screen, feed, banner: null });
    medidas += ctx.byName.measureText ?? 0;
  }
  assert.equal(medidas, 0, '60 cuadros iguales no miden nada');
  // un cambio de tamaño sí vuelve a medir (otra fuente, otros anchos)
  cuadro(fx.ui, ctx, { W: 1280, H: 720 }, { hud, screen, feed, banner: null });
  assert.ok(ctx.byName.measureText > 0);
});

test('CB-17: banner y feed dentro de la banda inferior, con nombre del peor caso recortado y sin entrar al marco', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  for (const [W, H] of TAMANOS) {
    const L = layoutFor(W, H);
    const ctx = createFakeCtx({ record: true });
    const { hud, screen } = modelos(fx);
    const banners = createBanners({ registry: fx.registry });
    fx.registry.joinFromChat({ userId: 'w', nickname: WORST_NAMES[4], text: '1' }, 0, 1);
    banners.consume([{ type: 'rankUp', key: 'w', team: 1, from: 2, to: 3 }]);
    banners.update(0.5, false);
    const feed = banners.feed();
    const bx = cuadro(fx.ui, ctx, { W, H }, { hud, screen, feed, banner: banners.current() });
    const delBanner = bx.find((b) => b.text.includes('ascendió'));
    assert.ok(delBanner, 'el banner se dibujó');
    assert.ok(delBanner.x1 - delBanner.x0 <= W - 8, 'cabe en el lienzo');
    assert.doesNotMatch(delBanner.text, PROHIBIDOS);
    // el registro ya topa el nombre a 16 grafemas; el recorte por ancho es la segunda red de seguridad
    const completo = `${fx.registry.displayName('w')} ascendió a Sargento`;
    if (completo.length * 5 > Math.min(260 * L.u, W - 16 * L.u))
      assert.ok(delBanner.text.includes('…'), 'el nombre de 200 caracteres se recortó con …');
    else assert.equal(delBanner.text, completo);
    for (const b of bx) assert.ok(!choca(b, L.frame) || dentro(b, L.frame), `${W}×${H}: ${b.text}`);
  }
});

test('NM-9: la pausa dibuja el texto exacto sobre un velo que deja libre el marco del narrador', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  fx.match.command({ type: 'pause', by: 'manual' });
  const { hud, screen } = modelos(fx);
  const ctx = createFakeCtx({ record: true });
  const L = layoutFor(1920, 1080);
  const bx = cuadro(
    fx.ui,
    ctx,
    { W: 1920, H: 1080 },
    { hud, screen, feed: [], banner: null, pause: { visible: true, text: S.pause } },
  );
  assert.ok(bx.some((b) => b.text === 'Pausa: el narrador vuelve enseguida'));
  const veloSobreMarco = ctx.calls.some((c) => {
    if (c[0] !== 'fillRect') return false;
    const [, x, y, w, h] = c;
    return (
      x < L.frame.x + L.frame.w && L.frame.x < x + w && y < L.frame.y + L.frame.h && L.frame.y < y + h && w * h > 40000
    );
  });
  assert.equal(veloSobreMarco, false, 'ningún rectángulo grande (el velo) cubre el marco');
});

test('CB-17 y NM-10: cada pantalla entra en sus tarjetas, a todos los tamaños, sin pisar el marco, con el peor caso', () => {
  const fx = fixtura();
  WORST_NAMES.filter(Boolean).forEach((n, i) => {
    fx.registry.joinFromChat({ userId: `w${i}`, nickname: n, text: String((i % 2) + 1) }, 0, 1);
    fx.registry.addCoins(`w${i}`, 100 - i * 7, 1);
  });
  for (const estado of ['lobby', 'roundEnd', 'waitingNextRound', 'matchEnd', 'matchup']) {
    fx.match.state = estado;
    fx.match.winner = 0;
    fx.match.results = [{ round: 1, winner: 0 }];
    if (estado === 'matchup') fx.match.pair = null;
    for (const [W, H] of TAMANOS) {
      const L = layoutFor(W, H);
      const { hud, screen } = modelos(fx);
      const ctx = createFakeCtx({ record: true });
      const bx = cuadro(fx.ui, ctx, { W, H }, { hud, screen, feed: [], banner: null });
      const cartas = cardRects(L, screen.kind, screen.model);
      assert.ok(cartas.length > 0, `${estado}: tiene tarjetas`);
      for (const c of cartas)
        assert.ok(
          !(
            c.x < L.frame.x + L.frame.w &&
            L.frame.x < c.x + c.w &&
            c.y < L.frame.y + L.frame.h &&
            L.frame.y < c.y + c.h
          ),
          `${estado} ${W}×${H}: tarjeta en el marco`,
        );
      for (const b of bx) {
        assert.doesNotMatch(b.text, PROHIBIDOS);
        assert.ok(b.x0 >= 0 && b.x1 <= W, `${estado} ${W}×${H} ${b.text}: fuera del ancho`);
        if (!hud.visible || b.y > L.field.y) {
          assert.ok(!choca(b, L.frame) || dentro(b, L.frame), `${estado} ${W}×${H} "${b.text}" pisa el marco`);
        }
      }
      // el texto de cada tarjeta cae dentro de alguna de ellas (o es del HUD)
      const regiones = [...cartas, L.panelL, L.panelR, L.center, L.railL, L.railR, L.feed, L.frame, L.status];
      for (const b of bx)
        assert.ok(
          regiones.some((r) => dentro(b, r)),
          `${estado} ${W}×${H} "${b.text.slice(0, 24)}" fuera de su tarjeta`,
        );
    }
  }
});

test('CB-17: el fin de partido dice "Sin regalos" en la columna vacía y no inventa nombres', () => {
  const fx = fixtura();
  fx.match.state = 'matchEnd';
  fx.match.winner = 0;
  const { hud, screen } = modelos(fx);
  const ctx = createFakeCtx({ record: true });
  const t = cuadro(fx.ui, ctx, { W: 1920, H: 1080 }, { hud, screen, feed: [], banner: null }).map((b) => b.text);
  assert.equal(t.filter((x) => x === S.matchEnd.empty).length, 2);
  assert.ok(t.includes('¡Perú gana la batalla!'));
  assert.ok(t.includes(S.matchEnd.back));
});

test('CB-20: las pantallas dicen lo mismo con y sin movimiento reducido una vez asentadas', () => {
  const fx = fixtura();
  fx.registry.joinFromChat({ userId: 'a', nickname: 'Ana', text: '1' }, 0, 1);
  fx.registry.addCoins('a', 40, 1);
  fx.match.state = 'matchEnd';
  fx.match.winner = 0;
  const { hud, screen } = modelos(fx);
  const textos = (reduced) => {
    const ctx = createFakeCtx({ record: true });
    const bank = createIconBank({ createCanvas: createFakeCanvasFactory().createCanvas });
    const ui = createUi({ iconBank: bank, iconTeam: [bank.bake('#E5484D'), bank.bake('#5BC8F5')] });
    ctx.reset();
    // varios cuadros: la animación de entrada termina
    for (let i = 0; i < 80; i++) {
      ctx.reset();
      ui.draw(ctx, {
        W: 1920,
        H: 1080,
        now: 5 + i / 60,
        dt: 1 / 60,
        reduced,
        frame: true,
        hud,
        screen,
        feed: [],
        banner: null,
      });
    }
    return cajas(ctx.calls).map((b) => [b.text, b.x0, b.y]);
  };
  assert.deepEqual(textos(true), textos(false));
});

test('un modelo sin pantalla ni HUD (golden, o sin par) no dibuja nada y no lanza', () => {
  const fx = fixtura();
  const ctx = createFakeCtx({ record: true });
  ctx.reset();
  fx.ui.draw(ctx, {
    W: 1920,
    H: 1080,
    now: 1,
    dt: 0.016,
    reduced: false,
    frame: true,
    hud: null,
    screen: null,
    feed: [],
    banner: null,
  });
  assert.deepEqual(
    cajas(ctx.calls).filter((b) => b.text !== S.frame),
    [],
  );
});

test('el dibujo restaura el estado del lienzo: alfa 1, sin transformación y texto a la izquierda', () => {
  const fx = fixtura();
  fx.match.state = 'battle';
  const ctx = createFakeCtx({ record: true });
  const { hud, screen } = modelos(fx);
  const banners = createBanners({ registry: fx.registry });
  banners.gift([{ kind: 'plane', owner: null, giftName: 'Avión', slide: true }]);
  banners.update(0.05, false);
  cuadro(fx.ui, ctx, { W: 1920, H: 1080 }, { hud, screen, feed: [], banner: banners.current() });
  const alfas = ctx.calls.filter((c) => c[0] === 'set:globalAlpha').map((c) => c[1]);
  assert.equal(alfas.at(-1), 1);
  const saves = ctx.calls.filter((c) => c[0] === 'save').length;
  const restores = ctx.calls.filter((c) => c[0] === 'restore').length;
  assert.equal(saves, restores, 'cada save tiene su restore');
});
