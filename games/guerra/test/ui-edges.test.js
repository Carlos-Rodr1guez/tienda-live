import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createIconBank } from '../public/js/render/icons.js';
import { createMatch } from '../public/js/sim/match.js';
import { createUi } from '../public/js/ui/draw.js';
import { hudModel } from '../public/js/ui/hud.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { lobbyModel, roundEndModel, screenFor } from '../public/js/ui/screens.js';
import { createTextFitter } from '../public/js/ui/text.js';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';

// Bordes de los modelos y del dibujo que las pruebas principales no tocan: reloj con fracciones, orden de la sala, ganador
// de la ronda por resultado, avance solo cuando el narrador puede avanzar, ajuste exacto del texto y primera entrada de
// una pantalla con y sin movimiento reducido. Cada una existe porque una mutación del código sobrevivía sin ella.

const CAMARA = { mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 };

function partido() {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  match.command({ type: 'pickPair', a: 'PE', b: 'MX' });
  return { registry, match };
}

test('el reloj redondea hacia arriba los segundos que faltan: 118,5 s se lee 1:59', () => {
  const { match, registry } = partido();
  match.command({ type: 'startMatch' });
  match.state = 'battle';
  match.world.roundStart = 0;
  match.world.step = 30 * 61 + 15;
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).center.clock, '1:59');
});

test('la sala muestra primero a quien más XP tiene y, con la misma XP, por clave: no por orden de llegada', () => {
  const { match, registry } = partido();
  for (let i = 9; i >= 0; i--) registry.joinFromChat({ userId: `u${i}`, nickname: `n${i}`, text: '1' }, 0, 1);
  match.command({ type: 'startMatch' });
  registry.joinFromChat({ userId: 'zz', nickname: 'Rica', text: '1' }, 0, 1);
  registry.addCoins('zz', 500, 1);
  const l = lobbyModel({ match, registry });
  assert.deepEqual(l.teams[0].members, ['Rica', 'n0', 'n1', 'n2', 'n3', 'n4']);
  assert.equal(l.teams[0].more, 5);
});

test('el ganador de la ronda sale del último resultado, no de quien va ganando el partido', () => {
  const { match, registry } = partido();
  match.command({ type: 'startMatch' });
  match.state = 'roundEnd';
  match.wins = [1, 1];
  match.results = [
    { round: 1, winner: 0 },
    { round: 2, winner: 1 },
  ];
  assert.equal(roundEndModel({ match, registry }).title, '¡México gana la ronda!');
  match.results = [];
  assert.equal(roundEndModel({ match, registry }).title, null, 'sin resultado en esta página no se inventa un ganador');
});

test('NM-1: durante los resultados de la ronda no hay botón de avance; solo cuando el narrador puede empezar la siguiente', () => {
  const { match, registry } = partido();
  match.command({ type: 'startMatch' });
  match.state = 'roundEnd';
  assert.equal(screenFor(match, { registry, paises: PAISES }).advance, null);
  match.state = 'waitingNextRound';
  assert.notEqual(screenFor(match, { registry, paises: PAISES }).advance, null);
  match.state = 'lobby';
  assert.equal(screenFor(match, { registry, paises: PAISES }).advance.disabled, false);
});

const ANCHO = 5;
const medir = (f, t) => [...t].length * ANCHO;

test('el recorte usa todo el ancho: un candidato que mide justo el máximo se queda', () => {
  const fit = createTextFitter({ measure: medir });
  // "abcdef" mide 30; con 25 de máximo, "abcd…" (5 símbolos) mide justo 25 y es el más largo que entra
  assert.deepEqual(fit.fit('f', 'abcdef', 25), { text: 'abcd…', width: 25, cut: true });
  assert.deepEqual(
    fit.fit('f', 'abcde', 25),
    { text: 'abcde', width: 25, cut: false },
    'si entero mide justo el máximo, no se recorta',
  );
});

test('la caché distingue el ancho máximo y la fuente: el mismo texto con otro ancho se recorta distinto', () => {
  const fit = createTextFitter({ measure: medir });
  const corto = fit.fit('f', 'abcdefghij', 25);
  const largo = fit.fit('f', 'abcdefghij', 100);
  assert.notEqual(corto.text, largo.text);
  assert.equal(largo.text, 'abcdefghij');
  assert.notEqual(fit.fit('g', 'abcdefghij', 25), undefined);
});

test('el recorte corta en un límite de grafema: cada resultado es el prefijo de grafemas completos más "…"', () => {
  const fit = createTextFitter({ measure: medir });
  const familia = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
  const piel = String.fromCodePoint(0x1f44d, 0x1f3fd);
  // la unión (ZWJ) se quita al limpiar: de la familia quedan tres emoji sueltos; la mano con tono es UN grafema de dos
  // puntos de código, y un corte por punto de código dejaría la mano sin su tono
  const casos = [
    [familia, /^(?:ab?)?\p{Extended_Pictographic}*$/u],
    [piel, /^(?:ab?)?(?:\p{Extended_Pictographic}\p{Emoji_Modifier})*$/u],
  ];
  for (const [base, forma] of casos) {
    for (const max of [10, 15, 20, 30, 45]) {
      const r = fit.fit('f', `ab${base.repeat(10)}`, max);
      assert.ok(r.cut);
      const cuerpo = r.text.slice(0, -1);
      assert.match(cuerpo, forma, `${max}: ${JSON.stringify(cuerpo)}`);
    }
  }
});

test('CB-20 y §10.3: la primera entrada de una pantalla con movimiento reducido no se desplaza; sin reducir, sí', () => {
  const { match, registry } = partido();
  match.command({ type: 'startMatch' });
  match.state = 'matchEnd';
  match.winner = 0;
  registry.joinFromChat({ userId: 'a', nickname: 'Ana', text: '1' }, 0, 1);
  registry.addCoins('a', 30, 1);
  const bank = createIconBank({ createCanvas: createFakeCanvasFactory().createCanvas });
  const hud = hudModel({ match, registry, camera: CAMARA, net: null });
  const screen = screenFor(match, { registry, paises: PAISES });
  const ys = (reduced, dt) => {
    const ui = createUi({ iconBank: bank, iconTeam: [bank.bake('#E5484D'), bank.bake('#5BC8F5')] });
    const ctx = createFakeCtx({ record: true });
    const L = layoutFor(1920, 1080);
    // primer cuadro (la pantalla entra) y otro 60 ms después
    ui.draw(ctx, { W: 1920, H: 1080, now: 10, dt: 0, reduced, hud, screen, feed: [], banner: null });
    ctx.reset();
    ui.draw(ctx, { W: 1920, H: 1080, now: 10 + dt, dt, reduced, hud, screen, feed: [], banner: null });
    const titulo = ctx.calls.find((c) => c[0] === 'fillText' && c[1] === '¡Perú gana la batalla!');
    return { y: titulo[3], base: L.top.y };
  };
  const quieto = ys(true, 0.03).y;
  const asentado = ys(true, 1).y;
  assert.equal(quieto, asentado, 'reducido: el título no se mueve mientras entra');
  assert.notEqual(ys(false, 0.03).y, asentado, 'sin reducir: se desplaza hasta asentarse');
  assert.equal(ys(false, 1).y, asentado);
});
