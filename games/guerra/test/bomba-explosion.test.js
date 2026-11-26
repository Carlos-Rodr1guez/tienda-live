import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFx, bombRing, RING_SECONDS } from '../public/js/render/fx.js';
import { createMotion } from '../public/js/render/motion.js';
import { createScene } from '../public/js/render/scene.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { DEFAULTS, resolveConfig } from '../public/js/sim/defaults.js';
import { createList, createProjector, LIST_CAPS } from '../public/js/render/canvas.js';
import { createFakeCtx } from './support/fake-canvas.js';

// v2.9: la explosión de cada bomba del bombardero se dibuja del tamaño del radio REAL de daño (`plane.bombRadius`, 38,4 px):
// bola de fuego que llega a ese radio, anillo de onda expansiva que crece hasta él y humo y escombros que quedan más tiempo.
// Con `hits > 0` (la bomba dañó a alguien) es completa y deja cráter; sobre el vacío es más chica y sin cráter (lógica v2.6).

const RADIO = DEFAULTS.plane.bombRadius;
const mundo = (cfg = DEFAULTS) => ({
  step: 0,
  cfg,
  units: [],
  planes: [],
  bombs: [],
  bases: [{ turrets: [] }, { turrets: [] }],
  over: null,
});
const normal = () => createMotion({ graphics: {}, systemReduced: false });
const reducido = () => createMotion({ graphics: { reducedMotion: true }, systemReduced: false });
const evento = (hits, x = 300, y = 300) => ({ type: 'bombImpact', x, y, side: 0, hits });
const vivas = (fx) => fx.booms.filter((b) => b.a);
const humo = (fx) => fx.particles.filter((p) => p.a && p.ty === 1);

test('con daño (hits > 0): la bola de fuego y el anillo miden el radio real de la bomba (38,4) y cava un cráter proporcional', () => {
  assert.equal(RADIO, 38.4);
  const fx = createFx({ seed: 'efectos:bomba', motion: normal() });
  fx.consume(evento(2), mundo());
  const [b] = vivas(fx);
  assert.equal(b.R, RADIO, 'bola de fuego del tamaño del radio');
  assert.equal(b.ring, RADIO, 'anillo hasta el radio');
  assert.equal(b.ringA, 1);
  assert.equal(fx.craters.length, 1);
  assert.equal(fx.craters[0].r, Math.round(RADIO * 0.6), 'el cráter crece con el radio (antes 14 px fijos)');
});

test('el tamaño sale de la config, no de un número fijo en px: con otro bombRadius la explosión cambia', () => {
  for (const r of [20, 60]) {
    const fx = createFx({ seed: 'efectos:radio', motion: normal() });
    fx.consume(evento(1), mundo(resolveConfig({ plane: { bombRadius: r } })));
    const [b] = vivas(fx);
    assert.equal(b.R, r);
    assert.equal(b.ring, r);
  }
});

test('lógica v2.6: sobre el vacío (hits 0 o sin dato) es más chica, con el anillo más tenue y sin cráter; con hits > 0 es completa', () => {
  for (const ev of [evento(0), { type: 'bombImpact', x: 300, y: 300, side: 0 }]) {
    const fx = createFx({ seed: 'efectos:vacio', motion: normal() });
    fx.consume(ev, mundo());
    const [b] = vivas(fx);
    assert.ok(Math.abs(b.R - RADIO * 0.6) < 1e-9, `bola de fuego chica (${b.R})`);
    assert.equal(b.ring, RADIO, 'el anillo igual marca el radio real');
    assert.ok(b.ringA < 1 && b.ringA > 0, 'más tenue');
    assert.equal(fx.craters.length, 0, 'sin cráter');
  }
  const fx = createFx({ seed: 'efectos:vacio', motion: normal() });
  fx.consume(evento(1), mundo());
  assert.ok(vivas(fx)[0].R > RADIO * 0.6);
});

test('las explosiones normales no llevan anillo (solo la bomba lo tiene)', () => {
  const fx = createFx({ seed: 'efectos:sinanillo', motion: normal() });
  fx.boom(300, 300, 'huge', 0);
  fx.boom(300, 300, 'med', 0);
  for (const b of vivas(fx)) assert.equal(b.ring, 0);
  // y un pool reciclado no hereda el anillo de una bomba anterior
  const pool = createFx({ seed: 'efectos:reciclado', motion: normal() });
  for (let i = 0; i < 41; i++) pool.consume(evento(1, 100 + i), mundo());
  pool.boom(300, 300, 'med', 0);
  assert.equal(
    pool.booms.filter((b) => b.a && b.x === 300).every((b) => b.ring === 0),
    true,
  );
});

test('bombRing: el anillo crece de un cuarto del radio al radio completo y se desvanece; con movimiento reducido no crece', () => {
  const o = { r: 0, a: 0, th: 0 };
  bombRing(RADIO, 0, false, o);
  assert.ok(o.r < RADIO * 0.4 && o.r >= 1, `nace chico (${o.r})`);
  assert.ok(o.a > 0.8, 'y bien visible');
  let antes = 0;
  for (let t = 0; t <= RING_SECONDS; t += 0.05) {
    bombRing(RADIO, t, false, o);
    assert.ok(o.r >= antes, 'nunca se encoge');
    antes = o.r;
  }
  bombRing(RADIO, RING_SECONDS, false, o);
  assert.equal(o.r, Math.round(RADIO), 'llega al radio real');
  assert.equal(o.a, 0, 'y desaparece');
  assert.equal(o.th, 1, 'más fino al final');
  for (const t of [0, 0.1, 0.3]) {
    bombRing(RADIO, t, true, o);
    assert.equal(o.r, Math.round(RADIO), `reducido: ya está en el radio completo a los ${t} s`);
  }
  bombRing(RADIO, 0.3, true, o);
  assert.ok(o.a > 0 && o.a < 1, 'con movimiento reducido solo cambia la opacidad');
});

// ---------------------------------------------------------------------------------------------------------------- dibujo

const proyector = (mul = 1) => {
  const stats = { culled: 0, drawCalls: 0, marks: false };
  const lists = { entities: createList(1500), particles: createList(LIST_CAPS.particles), labels: createList(24) };
  const P = createProjector(stats, lists);
  P.ctx = createFakeCtx({ record: true });
  P.mul = mul;
  P.offX = 0;
  P.offY = 0;
  P.vx0 = 0;
  P.vy0 = 0;
  P.vx1 = 1440;
  P.vy1 = 810;
  P.frame = { alpha: 0, time: 0, reduced: false, scene: null };
  return P;
};
const COLORES_ANILLO = new Set(['#FFF1C1', '#FFB86B']);
/** Caja (px de destino) de lo que se pintó con los colores del anillo. */
function cajaDelAnillo(ctx) {
  let fill = '';
  const c = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0 };
  for (const [n, ...a] of ctx.calls) {
    if (n === 'set:fillStyle') fill = a[0];
    else if (n === 'fillRect' && COLORES_ANILLO.has(fill)) {
      c.x0 = Math.min(c.x0, a[0]);
      c.x1 = Math.max(c.x1, a[0] + a[2]);
      c.y0 = Math.min(c.y0, a[1]);
      c.y1 = Math.max(c.y1, a[1] + a[3]);
      c.n++;
    }
  }
  return c;
}
const avanzar = (fx, seg, w) => {
  for (let t = 0; t < seg - 1e-9; t += 1 / 30) fx.update(1 / 30, w);
};

test('dibujo: el anillo llega al radio real en px de mundo, en LOW (×1) y en la pasada de dispositivo (×4)', () => {
  for (const mul of [1, 4]) {
    const fx = createFx({ seed: 'efectos:dibujo', motion: normal() });
    const w = mundo();
    fx.consume(evento(2, 700, 400), w);
    avanzar(fx, 0.42, w); // casi al final del crecimiento, todavía con opacidad
    const P = proyector(mul);
    fx.draw(P);
    const c = cajaDelAnillo(P.ctx);
    assert.ok(c.n > 20, `se dibujó el anillo (×${mul})`);
    const medio = (c.x1 - c.x0) / 2 / mul;
    assert.ok(Math.abs(medio - RADIO) <= 3, `radio dibujado ${medio} px de mundo contra ${RADIO} (×${mul})`);
    // es un círculo: tan alto como ancho, centrado en el punto de impacto (no aplastado en elipse)
    assert.ok(Math.abs((c.y1 - c.y0) / 2 / mul - RADIO) <= 3, 'círculo del radio real, no una elipse');
    assert.ok(
      Math.abs((c.x0 + c.x1) / 2 - 700 * mul) <= mul && Math.abs((c.y0 + c.y1) / 2 - 400 * mul) <= mul,
      'centrado en el punto de impacto (a lo sumo medio píxel de mundo de diferencia)',
    );
    assert.equal(P.ctx.state.globalAlpha, 1, 'la opacidad vuelve a 1');
  }
});

test('dibujo: al nacer el anillo es chico y crece (a los 0,1 s es menor que a los 0,3 s)', () => {
  const ancho = (seg) => {
    const fx = createFx({ seed: 'efectos:crece', motion: normal() });
    const w = mundo();
    fx.consume(evento(2, 700, 400), w);
    avanzar(fx, seg, w);
    const P = proyector(1);
    fx.draw(P);
    const c = cajaDelAnillo(P.ctx);
    return c.x1 - c.x0;
  };
  const [a, b] = [ancho(0.1), ancho(0.3)];
  assert.ok(a > 0 && a < b, `${a} < ${b}`);
  assert.ok(b > 1.4 * a, 'el crecimiento se nota');
});

test('movimiento reducido: el anillo aparece ya del radio completo (sin expandirse) y solo se desvanece', () => {
  const fx = createFx({ seed: 'efectos:reducido', motion: reducido() });
  const w = mundo();
  fx.consume(evento(2, 700, 400), w);
  avanzar(fx, 0.05, w);
  const P = proyector(1);
  fx.draw(P);
  const c = cajaDelAnillo(P.ctx);
  assert.ok(Math.abs((c.x1 - c.x0) / 2 - RADIO) <= 3, `radio completo desde el inicio (${(c.x1 - c.x0) / 2})`);
});

test('el anillo se dibuja aunque el limitador de destellos le niegue el núcleo blanco (zoom grande)', () => {
  const fx = createFx({ seed: 'efectos:zoom', motion: normal() });
  fx.setView({ W: 1920, H: 1080, s: 8 }); // k = 6: el núcleo de la bomba cubriría más del 5 % de la vista
  const w = mundo();
  fx.consume(evento(2, 700, 400), w);
  assert.equal(vivas(fx)[0].degraded, true, 'sin núcleo: lo manda el límite de destellos, no cambia');
  avanzar(fx, 0.2, w);
  const P = proyector(4);
  fx.draw(P);
  assert.ok(cajaDelAnillo(P.ctx).n > 20, 'pero el anillo marca igual el radio');
});

test('el humo y los escombros de la bomba duran más que los de una explosión común, y el fuego se va antes', () => {
  const fx = createFx({ seed: 'efectos:humo', motion: normal() });
  const w = mundo();
  fx.consume(evento(2), w);
  avanzar(fx, 1.2, w);
  assert.equal(vivas(fx).length, 0, 'la bola de fuego ya terminó');
  const comun = createFx({ seed: 'efectos:humo', motion: normal() });
  comun.boom(300, 300, 'large', 2);
  avanzar(comun, 1.9, w);
  assert.equal(humo(comun).length, 0, 'el humo de una explosión común dura 1,8 s como mucho');
  avanzar(fx, 0.7, w); // 1,9 s en total
  assert.ok(humo(fx).length >= 3, `la bomba todavía deja humo a los 1,9 s (${humo(fx).length})`);
  avanzar(fx, 1.5, w);
  assert.equal(fx.usage().particles, 0, 'a los 3,4 s no queda nada');
});

test('con movimiento reducido el humo de la bomba queda quieto (sin deriva ni crecimiento)', () => {
  const fx = createFx({ seed: 'efectos:humoquieto', motion: reducido() });
  const w = mundo();
  fx.consume(evento(2), w);
  const quedan = humo(fx).filter((p) => p.l > 1.8);
  assert.ok(quedan.length >= 3, 'hay humo de larga vida');
  for (const p of quedan) assert.deepEqual([p.vx, p.vy, p.gr], [0, 0, 0]);
});

test('una alfombra completa (34 bombas, 2 aviones a la vez) no desborda los pools ni produce NaN, en ×1 y ×4', () => {
  for (const mul of [1, 4]) {
    const fx = createFx({ seed: 'efectos:alfombra', motion: normal() });
    const w = mundo();
    const P = proyector(mul);
    for (let paso = 0; paso < 300; paso++) {
      if (paso % 10 === 0)
        for (const f of [0, 1]) fx.consume(evento(paso % 20 === 0 ? 0 : 2, 40 + (paso % 34) * 40, 300 + f * 100), w);
      fx.update(1 / 30, w);
      P.ctx.reset();
      P.lists.particles.clear();
      fx.draw(P);
      const u = fx.usage();
      assert.ok(u.particles <= 600 && u.booms <= 40 && u.craters <= 60, JSON.stringify(u));
      assert.ok(
        P.ctx.calls.every(([n, ...a]) => n !== 'fillRect' || a.every(Number.isFinite)),
        'sin NaN en lo que se dibuja',
      );
    }
  }
});

test('la escena entrega el radio de la config al efecto: bombImpact desde createScene también mide 38,4', () => {
  const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
  sc.consume([evento(1)], { ...mundo(), step: 5 });
  const [b] = sc.fx.booms.filter((x) => x.a);
  assert.equal(b.R, RADIO);
  assert.equal(b.ring, RADIO);
});
