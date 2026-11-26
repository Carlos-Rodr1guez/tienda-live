import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { resolveConfig } from '../public/js/sim/defaults.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { addPaid, ledger } from '../public/js/sim/credit.js';
import { FALL_STEPS, launchPlane, planeLine } from '../public/js/sim/plane.js';
import { submitGift } from '../public/js/sim/queue.js';

// v2.6 (D-R3 y D-R5): el bombardero vuela RECTO a velocidad constante y suelta una alfombra de bombas cada 40 px a lo
// largo de todo su trayecto, desde que su impacto cae sobre el frente propio hasta el borde enemigo.

const FALL_PX = FALL_STEPS * (1 / 30) * 120; // 56 px: lo que avanza el avión mientras cae la bomba
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};

/** Una unidad quieta y que no dispara: andamiaje para medir solo lo que hacen las bombas. */
function quieta(w, side, kind, x, y, o = {}) {
  const u = seedUnits(w, { side, kind, x, y, yg: y, pinned: true, owner: o.owner, value: o.value }).units[0];
  u.cd = 1e9;
  if (o.hp) u.hp = u.maxHp = o.hp;
  return u;
}

/** Vuela el avión `p` hasta que sale; `cada` se llama tras cada paso. Devuelve las bombas vistas (por id) en orden. */
function vuela(w, p, cada = () => {}) {
  const vistas = new Map();
  let n = 0;
  while (w.planes.includes(p) && n++ < 3000) {
    stepWorld(w);
    for (const b of w.bombs) if (!vistas.has(b.id)) vistas.set(b.id, { ...b });
    cada(n);
  }
  assert.ok(!w.planes.includes(p), 'el avión no salió del mapa');
  return [...vistas.values()];
}

// ------------------------------------------------------------------------------------------------ línea recta

test('la línea es recta: y y vx constantes y vy = 0 durante TODO el vuelo, de los dos lados', () => {
  for (const side of [0, 1]) {
    const w = createWorld();
    const e = 1 - side;
    for (let i = 0; i < 4; i++) quieta(w, e, 'soldado', 700 + i * 10, 600);
    quieta(w, e, 'soldado', 800, 300);
    const p = launchPlane(w, side).plane;
    const y0 = p.y;
    const vx0 = p.vx;
    assert.equal(y0, 594, 'el centro de la banda de 48 px más poblada (570 a 618)');
    assert.equal(Math.abs(vx0), 120);
    let pasos = 0;
    vuela(w, p, () => {
      pasos++;
      assert.equal(p.y, y0, 'y constante');
      assert.equal(p.vx, vx0, 'vx constante');
      assert.equal(p.vy, 0, 'sin vy');
    });
    assert.ok(pasos > 350, 'cruzó el mapa entero');
  }
});

test('el avión entra por su borde y sale por el opuesto', () => {
  const w = createWorld();
  const a = launchPlane(w, 0).plane;
  const b = launchPlane(w, 1).plane;
  assert.equal(a.x, -44);
  assert.equal(b.x, 1484);
  const salidas = [];
  run(w, 1);
  let n = 0;
  while (w.planes.length > 0 && n++ < 3000) {
    stepWorld(w);
    for (const ev of w.drain()) if (ev.type === 'planeOut') salidas.push(ev.side);
  }
  assert.equal(salidas.length, 2);
  assert.ok(a.x >= 1484 - 1e-6, 'el de la izquierda salió por la derecha');
  assert.ok(b.x <= -44 + 1e-6, 'el de la derecha salió por la izquierda');
});

test('la altura de la línea: centro de la banda de 48 px con más fuerza enemiga; empate o vacío: la más cercana a 448', () => {
  const w = createWorld();
  assert.equal(planeLine(w, 0), 450, 'sin enemigos: la banda más cercana a 448 (426 a 474)');
  // 60 soldados en una banda contra un solo tanque (c 100) en otra: gana el tanque
  for (let i = 0; i < 60; i++) quieta(w, 1, 'soldado', 800 + (i % 10), 250);
  quieta(w, 1, 'tanque', 900, 690);
  assert.equal(planeLine(w, 0), 138 + 11 * 48 + 24, 'banda 11 (666 a 714), centro 690');
  // el tanque herido a casi nada pierde fuerza (c·hp/maxHp): ahora gana el de los soldados (60 · 1)
  const tk = w.units.find((u) => u.kind === 'tanque');
  tk.hp = 1;
  assert.equal(planeLine(w, 0), 138 + 2 * 48 + 24, 'banda 2 (234 a 282), centro 258');
  // las propias no cuentan y las muertas tampoco
  quieta(w, 0, 'pesado', 500, 400);
  assert.equal(planeLine(w, 0), 258);
  for (const u of w.units) if (u.side === 1 && u.kind === 'soldado') u.alive = false;
  assert.equal(planeLine(w, 0), 138 + 11 * 48 + 24, 'queda el tanque de 1 HP');
  // empate exacto entre dos bandas: gana la más cercana a 448
  const w2 = createWorld();
  quieta(w2, 1, 'soldado', 900, 200); // banda 1 (186 a 234): centro 210
  quieta(w2, 1, 'soldado', 900, 600); // banda 9 (570 a 618): centro 594
  assert.equal(planeLine(w2, 0), 594, '|594 − 448| = 146 gana a |210 − 448| = 238');
});

// ------------------------------------------------------------------------------------------------ la alfombra

test('34 bombas con la config por defecto, una cada 40 px, desde el frente propio hasta el borde enemigo', () => {
  for (const side of [0, 1]) {
    const w = createWorld();
    const dir = side === 0 ? 1 : -1;
    const p = launchPlane(w, side).plane;
    assert.equal(p.bombsTotal, 34);
    assert.equal(p.bombsLeft, 34);
    const bombas = vuela(w, p);
    assert.equal(bombas.length, 34);
    assert.equal(p.bombsLeft, 0);
    const frente = w.field.sides[side].frontX;
    assert.equal(bombas[0].tx, frente, 'la primera cae sobre el frente propio');
    for (let i = 1; i < bombas.length; i++) {
      const d = (bombas[i].tx - bombas[i - 1].tx) * dir;
      assert.ok(Math.abs(d - 40) <= 0.5, `espaciado ${d} entre la ${i} y la ${i + 1}`);
      assert.equal(bombas[i].dropStep - bombas[i - 1].dropStep, 10, 'una cada 10 pasos');
    }
    const ultima = bombas.at(-1).tx;
    assert.ok(ultima >= 0 && ultima <= w.field.w, 'dentro del mapa');
    assert.equal(ultima, side === 0 ? 90 + 33 * 40 : 1350 - 33 * 40);
    // el avión avanza 4 px por paso: la suelta cae en el primer paso en que pasa el punto, a lo sumo 4 px después
    assert.ok(Math.abs(bombas[0].tx - bombas[0].x0 - dir * FALL_PX) <= 4, 'impacto = punto de suelta + dir·56 (±4)');
    for (const b of bombas) assert.equal(b.ty, p.y, 'cae en vertical sobre la línea');
  }
});

test('cada bomba cae FALL_STEPS pasos y tx − x0 = dir·56 en todas', () => {
  const w = createWorld();
  const p = launchPlane(w, 0).plane;
  const bombas = vuela(w, p);
  for (const b of bombas) {
    assert.equal(b.impactStep - b.dropStep, FALL_STEPS);
    assert.ok(Math.abs(b.tx - b.x0 - FALL_PX) <= 4, `${b.tx - b.x0}`); // ±1 paso del avión (4 px)
    assert.equal(b.y0, p.y);
  }
});

test('la config manda: bombSpacing 60 da menos bombas (el conteo sale de la geometría, no de una constante)', () => {
  const w = createWorld({ plane: { bombSpacing: 60 } });
  const p = launchPlane(w, 0).plane;
  assert.equal(p.bombsTotal, Math.floor((w.field.w - w.field.sides[0].frontX) / 60) + 1);
  assert.equal(vuela(w, p).length, p.bombsTotal);
});

test('el daño es bombDmg 300 con radio 24: mata soldados de un golpe y pega solo a quien está a ≤ 24 px del impacto', () => {
  const w = createWorld();
  assert.equal(w.cfg.plane.bombDmg, 300);
  assert.equal(w.cfg.plane.bombRadius, 24);
  assert.equal(w.cfg.plane.bombSpacing, 40);
  // el impacto de la bomba 14 cae en (610, 450); los demás, a 40 px a cada lado
  const centro = quieta(w, 1, 'tanque', 610, 450, { hp: 5000 });
  const dentro = quieta(w, 1, 'tanque', 610, 473, { hp: 5000 }); // a 23 px
  const fuera = quieta(w, 1, 'tanque', 610, 476, { hp: 5000 }); // a 26 px de todos los impactos
  const p = launchPlane(w, 0).plane;
  assert.equal(p.y, 450);
  vuela(w, p);
  run(w, FALL_STEPS + 2);
  assert.equal(centro.hp, 5000 - 300, 'un solo golpe de 300');
  assert.equal(dentro.hp, 5000 - 300, 'a 23 px: dentro del radio');
  assert.equal(fuera.hp, 5000, 'a 26 px: fuera');
  const soldado = createWorld();
  const s = quieta(soldado, 1, 'soldado', 610, 450);
  vuela(soldado, launchPlane(soldado, 0).plane);
  run(soldado, FALL_STEPS + 2);
  assert.equal(s.alive, false, '300 mata a un soldado (60 HP) de un golpe');
});

test('nunca daña a su lado: unidades, torretas y base propias quedan intactas tras una pasada completa', () => {
  for (const side of [0, 1]) {
    const w = createWorld();
    const e = 1 - side;
    const enemigo = quieta(w, e, 'soldado', side === 0 ? 610 : 830, 450, { hp: 5000 });
    // amigos a lo largo de toda la línea, también pegados al enemigo; fuera del alcance de las torretas enemigas
    const amigos = [];
    for (let x = 260; x <= 1180; x += 20) amigos.push(quieta(w, side, 'soldado', x, 450, { hp: 5000 }));
    amigos.push(quieta(w, side, 'tanque', side === 0 ? 610 : 830, 460, { hp: 50000 }));
    const propia = w.bases[side];
    const hpBase = propia.hp;
    const torres = propia.turrets.map((t) => t.hp);
    const p = launchPlane(w, side).plane;
    assert.equal(p.y, 450);
    const bombas = vuela(w, p);
    run(w, FALL_STEPS + 2);
    assert.equal(bombas.length, 34);
    assert.ok(enemigo.hp < 5000, 'sí dañó al enemigo (la prueba mide algo)');
    for (const a of amigos) assert.equal(a.hp, a.maxHp, `un propio de ${a.kind} en x ${a.x} recibió daño`);
    assert.equal(propia.hp, hpBase);
    assert.deepEqual(
      propia.turrets.map((t) => t.hp),
      torres,
    );
  }
});

test('la base y las torretas enemigas sí reciben bombas; todo el daño a la base pasa por el cubo (CB-12)', () => {
  const w = createWorld();
  const enemigas = w.bases[1].turrets.map((t) => t.hp);
  const p = launchPlane(w, 0).plane; // y 450: pasa a 2 px de la torreta central (1340, 448)
  vuela(w, p);
  run(w, FALL_STEPS + 2);
  assert.ok(w.bases[1].turrets[1].hp < enemigas[1], 'la torreta central recibió bombas');
  const cap = w.bases[1].cap;
  assert.ok(60000 - w.bases[1].hp <= cap * (w.step / 30) + 1e-6, 'lo aplicado no supera lo que dejó entrar el cubo');
});

// ------------------------------------------------------------------------------------------------ eventos

test('bombImpact lleva hits = unidades dañadas: 0 sobre el vacío y n con n unidades en el radio', () => {
  const w = createWorld();
  quieta(w, 1, 'tanque', 610, 450, { hp: 90000 });
  quieta(w, 1, 'tanque', 622, 455, { hp: 90000 });
  quieta(w, 1, 'tanque', 610 + 60, 450 + 0, { hp: 90000 }); // fuera de los radios del impacto de 610; recibe el de 650
  const p = launchPlane(w, 0).plane;
  const impactos = [];
  let n = 0;
  while ((w.planes.includes(p) || w.bombs.length > 0) && n++ < 3000) {
    stepWorld(w);
    for (const ev of w.drain()) if (ev.type === 'bombImpact') impactos.push(ev);
  }
  assert.equal(impactos.length, 34);
  const en = (x) => impactos.find((ev) => ev.x === x);
  assert.equal(en(610).hits, 2, 'dos tanques a ≤ 24 px');
  assert.equal(en(650).hits, 1);
  assert.equal(en(90).hits, 0, 'sobre el vacío');
  for (const ev of impactos) assert.ok(Number.isInteger(ev.hits) && ev.hits >= 0);
});

test('hits cuenta unidades DAÑADAS: una con escudo de aparición (daño 0) no cuenta', () => {
  const w = createWorld();
  const a = quieta(w, 1, 'tanque', 610, 450, { hp: 90000 });
  const b = quieta(w, 1, 'tanque', 610, 455, { hp: 90000 });
  b.shieldUntil = w.step + 1000;
  const p = launchPlane(w, 0).plane;
  const hits = [];
  let n = 0;
  while ((w.planes.includes(p) || w.bombs.length > 0) && n++ < 3000) {
    stepWorld(w);
    for (const ev of w.drain()) if (ev.type === 'bombImpact' && ev.x === 610) hits.push(ev.hits);
  }
  assert.deepEqual(hits, [1]);
  assert.equal(a.hp, 90000 - 300);
  assert.equal(b.hp, 90000, 'el escudo la protege');
});

// ------------------------------------------------------------------------------------------------ crédito y ballena

test('el daño de las bombas se atribuye al dueño del regalo (XP y baja)', () => {
  const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
  const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
  const registry = createRegistry({ teams: [PE, MX] });
  const w = createWorld({}, { registry });
  for (const k of ['A', 'B']) registry.touch({ userId: k, nickname: k });
  const v = quieta(w, 1, 'soldado', 610, 450, { owner: 'B', value: 100 });
  addPaid(w, 0, 500);
  const p = launchPlane(w, 0, 'A', 500).plane;
  vuela(w, p);
  run(w, FALL_STEPS + 2);
  assert.equal(v.alive, false);
  assert.equal(registry.get('A').kills.live, 1, 'la baja es del dueño del avión');
  assert.ok(registry.get('A').xp.live > 0);
  assert.equal(registry.get('B').xp.live, 0);
  assert.equal(registry.get('B').kills.live, 0);
});

test('un avión que sale ileso pasa su valor a retirado igual que antes: sin XP y con el libro cuadrado', () => {
  const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
  const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
  const registry = createRegistry({ teams: [PE, MX] });
  const w = createWorld({}, { registry });
  registry.touch({ userId: 'P', nickname: 'P' });
  addPaid(w, 0, 500);
  const p = launchPlane(w, 0, 'P', 500).plane;
  vuela(w, p);
  assert.ok(Math.abs(w.credit.retired - 500) < 1e-9);
  assert.equal(p.value, 0);
  assert.equal(registry.get('P').xp.live, 0);
  const l = ledger(w);
  assert.ok(Math.abs(l.sum - l.paid) < 1e-6);
});

test('un combo ×99 de aviones respeta CB-12: la base enemiga no cae antes del paso 1800 y el cubo manda', () => {
  const w = createWorld({ hq: { minSeconds: 60 } }, { phase: 'battle' });
  submitGift(w, {
    owner: 'A',
    coins: 49500,
    orders: [{ kind: 'avion', team: 1, owner: 'A', count: 99, unitValue: 500, source: 'gift' }],
  });
  const cap = w.bases[1].cap;
  let lanzados = 0;
  for (let s = 0; s < 1800; s++) {
    stepWorld(w);
    assert.ok(w.bases[1].hp > 0, `la base cayó en el paso ${s}`);
    assert.ok(60000 - w.bases[1].hp <= (cap * (s + 1)) / 30 + 1e-6, `en el paso ${s} entró más que el cubo`);
    for (const ev of w.drain()) if (ev.type === 'planeLaunch') lanzados++;
  }
  assert.ok(lanzados >= 2, 'hubo aviones en el aire');
  assert.ok(w.bases[1].hp < 60000, 'la presión sí llegó a la base');
});

// ------------------------------------------------------------------------------------------------ config y azar

test('la config nueva se valida y la vieja ya no existe', () => {
  const c = resolveConfig();
  for (const k of ['bombs', 'steerEvery', 'steerSpeed', 'decisionOffset'])
    assert.ok(!(k in c.plane), `plane.${k} sigue`);
  assert.equal(c.plane.dropFrom, 'ownFront');
  assert.equal(c.plane.band, 48);
  for (const [k, v] of [
    ['bombSpacing', 0],
    ['bombSpacing', -5],
    ['bombDmg', 0],
    ['bombRadius', NaN],
    ['band', 0],
    ['dropFrom', 'luna'],
  ]) {
    assert.throws(() => resolveConfig({ plane: { [k]: v } }), /plane\./, `plane.${k} = ${v}`);
  }
});

test('sin azar: dos pasadas iguales dan las mismas bombas, con Math.random reemplazado por una función que lanza', () => {
  const alea = Math.random;
  Math.random = () => {
    throw new Error('el sim no usa Math.random');
  };
  try {
    const armar = () => {
      const w = createWorld();
      quieta(w, 1, 'soldado', 610, 450, { hp: 5000 });
      const p = launchPlane(w, 0).plane;
      return vuela(w, p).map((b) => [b.tx, b.ty, b.dropStep]);
    };
    assert.deepEqual(armar(), armar());
  } finally {
    Math.random = alea;
  }
});

// ------------------------------------------------------------------------------------------------ v2.7: una sola pasada

test('una sola intervención: una pasada y el avión desaparece; sin vuelta, sin segunda pasada y sin bombas de más', () => {
  for (const side of [0, 1]) {
    const w = createWorld();
    for (let i = 0; i < 5; i++) quieta(w, 1 - side, 'soldado', 700 + i * 10, 450, { hp: 1e9 });
    const p = launchPlane(w, side).plane;
    const total = p.bombsTotal;
    const dir = side === 0 ? 1 : -1;
    const eventos = { drop: 0, out: 0, launch: 0 };
    let xPrev = p.x;
    let pasos = 0;
    while (w.planes.length > 0 && pasos++ < 3000) {
      stepWorld(w);
      for (const ev of w.drain()) {
        if (ev.type === 'bombDrop') eventos.drop++;
        else if (ev.type === 'planeOut') eventos.out++;
        else if (ev.type === 'planeLaunch') eventos.launch++;
      }
      // nunca da la vuelta ni retrocede: su x solo avanza en su dirección
      assert.ok((p.x - xPrev) * dir > 0, 'el avión solo avanza');
      xPrev = p.x;
    }
    assert.equal(w.planes.length, 0, 'desapareció del mundo');
    assert.equal(eventos.out, 1, 'sale una sola vez');
    assert.equal(eventos.drop, total, 'suelta exactamente su alfombra');
    assert.equal(p.bombsLeft, 0, 'no le queda nada por soltar');
    // sin nada colgado: las bombas en el aire caen en FALL_STEPS y después no queda ningún avión, bomba ni golpe suyo
    run(w, FALL_STEPS + 2);
    assert.equal(w.bombs.length, 0, 'ninguna bomba en el aire');
    // 20 s más sin lanzar nada: no reaparece, no hay segunda pasada ni bombas nuevas
    let extra = 0;
    for (let i = 0; i < 600; i++) {
      stepWorld(w);
      for (const ev of w.drain()) if (ev.type === 'bombDrop' || ev.type === 'planeLaunch') extra++;
    }
    assert.equal(extra, 0, 'sin segunda intervención');
    assert.equal(w.planes.length, 0);
    assert.equal(w.bombs.length, 0);
    assert.equal(eventos.launch, 1, 'un solo lanzamiento: el de la pasada');
  }
});
