import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { createMatch } from '../public/js/sim/match.js';
import { hashMatch } from '../public/js/sim/hash.js';
import { queuedRect } from '../public/js/ui/hud-draw.js';
import { hudModel } from '../public/js/ui/hud.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { arrancar } from './support/fake-main.js';

// C21: "+{n} en cola" debajo del riel de cada país: el modelo lee `world.queues[side].groundUnits` (solo lectura).

const CAMARA = { mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 };
function partido(estado = 'battle') {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  if (estado !== 'matchup') match.command({ type: 'pickPair', a: 'AR', b: 'BO' });
  if (estado === 'battle') {
    match.command({ type: 'startMatch' });
    for (let i = 0; i < 40; i++) match.step();
  }
  return { registry, match };
}
const colas = (m) =>
  hudModel({ match: m.match, registry: m.registry, camera: CAMARA, net: null }).rails.map((r) => r.queued);

test('C21 modelo: queued es groundUnits de cada lado y vale 0 sin cola', () => {
  const m = partido();
  assert.deepEqual(colas(m), [0, 0]);
  m.match.world.queues[0].groundUnits = 37;
  m.match.world.queues[1].groundUnits = 120;
  assert.deepEqual(colas(m), [37, 120]);
  m.match.world.queues[0].airUnits = 5;
  assert.deepEqual(colas(m), [37, 120], 'los aviones no cuentan');
});

test('C21 modelo: valores rotos (falta, no finito, negativo, texto) y los estados sin HUD valen 0', () => {
  const m = partido();
  for (const malo of [undefined, null, Number.NaN, Infinity, -4, 'x', {}]) {
    m.match.world.queues[0].groundUnits = malo;
    assert.equal(colas(m)[0], 0, String(malo));
  }
  m.match.world.queues = undefined;
  assert.deepEqual(colas(m), [0, 0], 'sin colas');
  const sinHud = partido('lobby');
  const h = hudModel({ match: sinHud.match, registry: sinHud.registry, camera: CAMARA, net: null });
  assert.equal(h.visible, false);
  assert.ok(h.rails.every((r) => r.queued === 0 || r.queued === undefined));
});

test('C21 modelo: armar el HUD no toca la cola ni el hash del partido', () => {
  const m = partido();
  m.match.world.queues[0].groundUnits = 37;
  const antes = hashMatch(m.match);
  const cola = JSON.stringify(m.match.world.queues);
  for (let i = 0; i < 5; i++) colas(m);
  assert.equal(hashMatch(m.match), antes);
  assert.equal(JSON.stringify(m.match.world.queues), cola);
});

test('C21 por main.js: un lado al tope de tropas con sobrantes muestra la cola, y desaparece cuando la cola se vacía', async () => {
  const e = await arrancar('?rapido=3', {
    servidor: true,
    fontScale: 0.6,
    game: { limits: { maxAlivePerSide: 40 }, round: { seconds: 150, introSeconds: 1, resultsSeconds: 5 } },
  });
  e.ws.abrir();
  for (let i = 0; i < 12; i++)
    e.ws.recibir({
      type: 'gift',
      userId: `d${i}`,
      uniqueId: `d${i}`,
      nickname: `Donante ${i}`,
      giftId: 'g',
      giftName: 'Rose',
      coins: 5,
      count: 999,
    });
  const cola = () => e.textos().find((t) => /^\+\d+ en cola$/.test(t));
  let n = null;
  for (let i = 0; i < 400 && n === null; i++) {
    e.cuadros(1, 100);
    n = cola() ?? null;
  }
  assert.ok(n, 'con un lado al tope y tropas de sobra aparece "+N en cola"');
  let fin = false;
  for (let i = 0; i < 3000 && !fin; i++) {
    e.cuadros(1, 100);
    fin = cola() === undefined;
  }
  assert.ok(fin, 'cuando la cola se vacía la pastilla desaparece');
});

test('C21 lugar: la pastilla va debajo de cada riel, con su ancho y 2 px virtuales de separación, sin tocarlo (cuatro tamaños)', () => {
  for (const [W, H] of [
    [480, 270],
    [640, 360],
    [512, 288],
    [683, 384],
    [1920, 1080],
  ]) {
    const L = layoutFor(W, H);
    for (const [side, riel] of [
      [0, L.railL],
      [1, L.railR],
    ]) {
      const r = queuedRect(L, side);
      assert.equal(r.x, riel.x, `${W}x${H}`);
      assert.equal(r.w, riel.w, `${W}x${H}`);
      assert.equal(r.y, riel.y + riel.h + 2 * L.u, `${W}x${H}: 2 px virtuales de separación`);
      assert.ok(r.y >= riel.y + riel.h, `${W}x${H}: no toca el riel`);
      assert.ok(r.y + r.h <= L.feed.y, `${W}x${H}: queda sobre el feed`);
    }
  }
});
