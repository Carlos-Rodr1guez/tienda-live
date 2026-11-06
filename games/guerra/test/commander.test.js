import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { applyEvent, createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import { addUnit, boxOf, createSquad, placeOffset } from '../public/js/sim/squads.js';
import { laneY } from '../public/js/sim/field.js';
import { hashWorld } from '../public/js/sim/hash.js';
import {
  corridorOrder,
  laneOrder,
  planAlta,
  postLaneOf,
  quotaQuarters,
  reachablePost,
  roleFor,
  shareQ,
  squadWeight,
} from '../public/js/sim/commander.js';
import { createFromPlan, submitOrder } from '../public/js/sim/queue.js';

// CB-21 (roles, cuota, corredor, sector, puestos, rebalanceo), NM-2 (sin votos), CB-13 (determinismo).

const INMORTAL = { hq: { hp: 1e12 } };
const mundo = (game = {}, opts = {}) => createWorld({ ...INMORTAL, ...game }, { phase: 'sandbox', ...opts });
const run = (w, n) => {
  for (let i = 0; i < n; i++) stepWorld(w);
};
/** Corre n pasos y devuelve los pasos de las conversiones del lado. */
function conversiones(w, n, side = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const paso = w.step;
    stepWorld(w);
    for (const e of w.drain()) if (e.type === 'convert' && e.side === side) out.push(paso);
  }
  return out;
}
const QUIETOS = { units: { soldado: { speed: 1 }, jeep: { speed: 1 } } }; // los grupos no avanzan: los tests miden decisiones

/** Un grupo de DEFENSA ya en su puesto. */
function defensa(w, side, kind, sector, post, n = 10, state = 'holding', pinned = true) {
  const s = w.field.sides[side];
  const lane = postLaneOf(kind);
  const p = s.sectors[sector].posts[lane][post];
  const sq = createSquad(w, {
    side,
    kind,
    role: 'defensa',
    state,
    corridor: sector,
    sector,
    post,
    postLane: lane,
    postPos: { x: p.x, y: p.y },
    x: p.x,
    y: p.y,
    pinned,
  });
  for (let i = 0; i < n; i++) {
    const o = placeOffset(w.cfg, kind, i, n, s.dir);
    addUnit(w, sq, p.x + o.x, p.y + o.y, {});
  }
  return sq;
}
/** Un grupo de ATAQUE ya salido, en una calle. */
function ataque(w, side, kind, x, corridor = 1, lane = 0, n) {
  return seedSquad(w, { side, kind, count: n ?? w.cfg.squads.size[kind], corridor, lane, x, pinned: false }).squad;
}
/** Las nueve cajas de ataque por índice: corredor i % 3, calle ⌊i / 3⌋ % 3, y otra tanda 60 px más adelante. */
const lugar = (i) => [i % 3, Math.floor(i / 3) % 3, 130 + Math.floor(i / 9) * 60];

/** Un grupo enemigo quieto e inofensivo en (x, y). */
function enemigo(w, side, kind, x, y, n = 1) {
  const sq = seedSquad(w, { side, kind, count: n, x, y, state: 'holding' }).squad;
  sq.postPos = { x, y };
  for (const u of sq.members) {
    u.cd = 1e9;
    u.hp = u.maxHp = 1e9;
  }
  return sq;
}

// ---------------------------------------------------------------------------------------------------- cuota (4c.5)

test('squadWeight: 2 para tanque y pesado, 1 para el resto; un grupo de gratis pesa 1', () => {
  assert.equal(squadWeight({ kind: 'tanque' }), 2);
  assert.equal(squadWeight({ kind: 'pesado' }), 2);
  assert.equal(squadWeight({ kind: 'soldado' }), 1);
  assert.equal(squadWeight({ kind: 'jeep' }), 1);
});

test('shareQ: (H,Z) = (0,0), (1,1), (4,4), (2,0), (9,9) dan 15, 26,25, 60, 22,5, 60; un tanque en la zona da 37,5', () => {
  assert.equal(shareQ(0, 0), 15);
  assert.equal(shareQ(1, 1), 26.25);
  assert.equal(shareQ(4, 4), 60);
  assert.equal(shareQ(2, 0), 22.5);
  assert.equal(shareQ(9, 9), 60);
  assert.equal(shareQ(2, 2), 37.5, 'un tanque pesa 2 en H y en Z');
});

test('sesgo +20, −50 y +100 con enemigos 0 dan 35, 0 y 85; la aritmética es en cuartos de punto', () => {
  assert.equal(shareQ(0, 0, 20), 35);
  assert.equal(shareQ(0, 0, -50), 0);
  assert.equal(shareQ(0, 0, 100), 85);
  assert.equal(quotaQuarters(0, 0), 60);
  assert.ok(Number.isInteger(quotaQuarters(3, 1, 7)));
});

test('un enemigo solo en la zona durante 180 s nunca sube la cuota de 26,25', () => {
  const w = mundo();
  enemigo(w, 1, 'soldado', 300, 448);
  let max = 0;
  for (let i = 0; i < 5400; i++) {
    stepWorld(w);
    max = Math.max(max, w.cmd[0].q / 4);
  }
  assert.equal(max, 26.25);
});

test('un log con comentarios "ataque" y "defensa" deja el sesgo en 0 y los mismos grupos y roles que sin ellos', () => {
  const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
  const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };
  const corrida = (conComentarios) => {
    const registry = createRegistry({ teams: [PE, MX] });
    const w = mundo({}, { registry });
    registry.touch({ userId: 'U', nickname: 'U' });
    registry.joinFromChat({ userId: 'U', nickname: 'U', text: '1' }, 0, 1);
    for (let i = 0; i < 1500; i++) {
      if (i % 30 === 0) {
        applyEvent(w, {
          type: 'order',
          order: { kind: 'soldado', team: 1 + ((i / 30) % 2), owner: null, count: 10, unitValue: 0, source: 'gift' },
        });
      }
      if (conComentarios && i % 7 === 0) {
        applyEvent(w, { type: 'chat', evt: { userId: 'U', nickname: 'U', text: i % 2 ? 'ataque' : 'defensa' } });
      }
      stepWorld(w);
    }
    return w;
  };
  const a = corrida(false);
  const b = corrida(true);
  assert.equal(a.cfg.commander.bias, 0);
  const foto = (w) => w.squads.map((s) => [s.id, s.side, s.role, s.corridor, s.lane, s.sector, s.post]);
  assert.deepEqual(foto(a), foto(b));
});

test('roleFor: con cuota 15 de 10 grupos solo el 7.º es DEFENSA y con 30 el 4.º, 7.º y 10.º', () => {
  const secuencia = (puntos) => {
    const q = puntos * 4;
    let D = 0;
    const roles = [];
    for (let S = 0; S < 10; S++) {
      const r = roleFor({ kind: 'soldado', S, D, q, postReachable: true });
      roles.push(r);
      if (r === 'defensa') D++;
    }
    return roles.map((r, i) => (r === 'defensa' ? i + 1 : 0)).filter(Boolean);
  };
  assert.deepEqual(secuencia(15), [7]);
  assert.deepEqual(secuencia(30), [4, 7, 10]);
});

test('roleFor: tanques y pesado siempre ATAQUE; sin puesto alcanzable, ATAQUE', () => {
  for (const kind of ['tanque', 'pesado']) {
    assert.equal(roleFor({ kind, S: 100, D: 0, q: 340, postReachable: true }), 'ataque');
  }
  assert.equal(roleFor({ kind: 'jeep', S: 100, D: 0, q: 340, postReachable: false }), 'ataque');
  assert.equal(roleFor({ kind: 'jeep', S: 100, D: 0, q: 340, postReachable: true }), 'defensa');
});

// ---------------------------------------------------------------------------------------------------- corredor (4c.6)

test('corredor: pesado enemigo arriba + soldados en medio da abajo; sin enemigos, medio, arriba, abajo', () => {
  const w = mundo();
  assert.deepEqual(corridorOrder(w, 0), [1, 0, 2]);
  enemigo(w, 1, 'pesado', 900, 242);
  enemigo(w, 1, 'soldado', 900, 448);
  assert.equal(corridorOrder(w, 0)[0], 2);
});

test('laneOrder(tipo) = [propia, centro, jeep, bajo] sin repetir', () => {
  assert.deepEqual(laneOrder('soldado'), [0, 1, 2]);
  assert.deepEqual(laneOrder('jeep'), [1, 0, 2]);
  assert.deepEqual(laneOrder('tanque'), [2, 0, 1]);
  assert.deepEqual(laneOrder('pesado'), [2, 0, 1]);
});

/** Pone un grupo de ATAQUE nuevo con el plan del comandante y lo deja salir lejos de la puerta. */
function altaAtaque(w, side, kind) {
  const plan = planAlta(w, side, kind);
  assert.ok(plan, 'hay lugar');
  const sq = createFromPlan(w, side, kind, plan);
  const n = w.cfg.squads.size[kind];
  for (let i = 0; i < n; i++) {
    const o = placeOffset(w.cfg, kind, i, n, w.field.sides[side].dir);
    addUnit(w, sq, plan.x + o.x, plan.y + o.y, {});
  }
  return { sq, plan };
}

test('13 grupos seguidos con un pesado enemigo en medio se reparten: ningún corredor supera al menor por más de 1', () => {
  const w = mundo({ commander: { bias: -100 } }); // sin DEFENSA: todos van a ATAQUE
  enemigo(w, 1, 'pesado', 900, 448);
  for (let i = 0; i < 13; i++) {
    const { sq } = altaAtaque(w, 0, 'soldado');
    sq.state = 'advance';
    sq.anchor.x = 700 + i; // sale de la puerta: la caja de espera queda libre
    for (const u of sq.members) u.x = sq.anchor.x;
  }
  const costo = [0, 2 * 0, 0];
  costo[1] += 2; // el pesado enemigo pesa 2
  for (const s of w.squads) if (s.side === 0) costo[s.corridor] += 1;
  assert.ok(Math.max(...costo) - Math.min(...costo) <= 1, `costos ${costo}`);
});

test('lugar de espera: salta la calle ocupada, prueba [propia, centro, jeep, bajo] y después el corredor siguiente', () => {
  const w = mundo({ commander: { bias: -100 } });
  const vistos = [];
  for (let i = 0; i < 9; i++) {
    const { plan } = altaAtaque(w, 0, 'soldado');
    vistos.push([plan.corridor, plan.lane]);
  }
  // sin enemigos y con la misma cuota: medio, arriba, abajo por costo; en cada corredor, centro > jeep > bajo
  assert.deepEqual(vistos.slice(0, 3), [
    [1, 0],
    [0, 0],
    [2, 0],
  ]);
  assert.equal(new Set(vistos.map((v) => v.join())).size, 9, 'las nueve cajas distintas');
  assert.equal(planAlta(w, 0, 'pesado'), null, 'sin lugar libre para ATAQUE');
});

test('nunca dos cajas de espera superpuestas', () => {
  const w = mundo({ commander: { bias: -100 } });
  for (let i = 0; i < 9; i++) altaAtaque(w, 0, i % 2 ? 'jeep' : 'soldado');
  const cajas = w.squads.map((s) => {
    const b = boxOf(w.cfg, s.kind, s.members.length);
    return { lo: s.anchor.x - b.rear, hi: s.anchor.x + b.front, y: s.anchor.y, hw: b.hw };
  });
  for (let i = 0; i < cajas.length; i++) {
    for (let j = i + 1; j < cajas.length; j++) {
      const a = cajas[i];
      const b = cajas[j];
      const enX = a.hi > b.lo && a.lo < b.hi;
      assert.ok(!(enX && Math.abs(a.y - b.y) < a.hw + b.hw), `cajas ${i} y ${j} superpuestas`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------- sector y puestos (4c.7)

/** Un mundo en el que el próximo soldado va a DEFENSA (hay grupos propios y el sesgo es máximo). */
function paraDefensa() {
  const w = mundo({ commander: { bias: 100 } });
  // seis grupos de ataque lejos de la puerta: S > 0 sin tocar los costos de los sectores
  for (let i = 0; i < 6; i++) ataque(w, 0, 'tanque', 600 + i * 40, i % 3, 2, 1);
  return w;
}

test('sector: costos 1, −2, 0 eligen el medio; con todos iguales, medio, arriba, abajo', () => {
  const w = paraDefensa();
  defensa(w, 0, 'jeep', 0, 3, 1); // costo +1 en el sector de arriba (un grupo propio de DEFENSA)
  enemigo(w, 1, 'soldado', 300, 448);
  enemigo(w, 1, 'soldado', 320, 448); // −2 en el medio
  const plan = planAlta(w, 0, 'soldado');
  assert.equal(plan.role, 'defensa');
  assert.equal(plan.sector, 1);
  const w2 = paraDefensa();
  assert.equal(planAlta(w2, 0, 'soldado').sector, 1, 'todos iguales: medio');
  const w3 = paraDefensa();
  defensa(w3, 0, 'soldado', 1, 3, 1);
  assert.equal(planAlta(w3, 0, 'soldado').sector, 0, 'medio ocupado: arriba antes que abajo');
});

test('una torreta propia caída del corredor de arriba gana con costos empatados', () => {
  const w = paraDefensa();
  w.bases[0].turrets[0].hp = 0;
  w.bases[0].turrets[0].on = false;
  assert.equal(planAlta(w, 0, 'soldado').sector, 0);
});

test('puestos numerados de adelante hacia atrás: 0, 1, 2 en orden; el índice más bajo libre y alcanzable', () => {
  const w = paraDefensa();
  const posts = [];
  for (let i = 0; i < 3; i++) {
    const plan = planAlta(w, 0, 'soldado');
    assert.equal(plan.sector, i === 0 ? 1 : plan.sector);
    const sq = createFromPlan(w, 0, 'soldado', plan);
    addUnit(w, sq, plan.x, plan.y, {});
    sq.state = 'toPost';
    sq.anchor.x = 700; // salió de la puerta
    posts.push([plan.sector, plan.post]);
  }
  // los tres grupos van a sectores distintos (el costo sube con cada grupo propio): puesto 0 en cada uno
  assert.deepEqual(
    posts.map((p) => p[1]),
    [0, 0, 0],
  );
  const w2 = paraDefensa();
  for (const post of [0, 1, 2]) defensa(w2, 0, 'soldado', 1, post, 1);
  assert.equal(reachablePost(w2, 0, 1, 'A'), 3);
  w2.squads.find((s) => s.post === 0).members.length = 0; // el puesto 0 queda libre pero tapado por 1 y 2
  assert.equal(reachablePost(w2, 0, 1, 'A'), 3, 'un puesto con otro ocupado entre él y la puerta no es alcanzable');
});

test('compactación: el grupo del puesto 1 avanza al 0 cuando se libera, sin cruzar ninguno ocupado', () => {
  const w = mundo(QUIETOS);
  const a = defensa(w, 0, 'soldado', 1, 0, 3);
  const b = defensa(w, 0, 'soldado', 1, 1, 3);
  const c = defensa(w, 0, 'soldado', 1, 2, 3);
  for (const u of a.members) u.alive = false;
  run(w, 20);
  assert.deepEqual([b.post, c.post], [0, 1]);
  assert.equal(b.postPos.x, w.field.sides[0].sectors[1].posts.A[0].x);
  assert.notEqual(b.state, 'holding', 'va a su nuevo puesto');
});

test('nadie cruza un puesto ocupado: dos grupos de DEFENSA a los puestos 0 y 1 llegan en orden', () => {
  const w = mundo();
  const s = w.field.sides[0];
  const p0 = s.sectors[1].posts.A[0];
  const p1 = s.sectors[1].posts.A[1];
  const mk = (post, p, x) => {
    const sq = createSquad(w, {
      side: 0,
      kind: 'soldado',
      role: 'defensa',
      state: 'toPost',
      corridor: 1,
      sector: 1,
      post,
      postLane: 'A',
      postPos: { x: p.x, y: p.y },
      x,
      y: p.y,
      pinned: true,
    });
    for (let i = 0; i < 10; i++) {
      const o = placeOffset(w.cfg, 'soldado', i, 10, 1);
      addUnit(w, sq, x + o.x, p.y + o.y, {});
    }
    return sq;
  };
  const delante = mk(0, p0, 200);
  const detras = mk(1, p1, 170);
  for (let i = 0; i < 900; i++) {
    stepWorld(w);
    assert.ok(detras.anchor.x <= delante.anchor.x + 1e-9, 'el de atrás cruzó al de adelante');
  }
  assert.equal(delante.state, 'holding');
  assert.ok(Math.abs(delante.anchor.x - p0.x) < 1);
  assert.ok(Math.abs(detras.anchor.x - p1.x) < 1.5 || detras.state === 'holding');
});

test('intercepción: la DEFENSA sale hacia el enemigo dentro de la zona, nadie sale de ella y vuelve al puesto', () => {
  const w = mundo();
  const sq = defensa(w, 0, 'soldado', 1, 0, 10);
  const zona = w.field.sides[0].defenseZone;
  const intruso = enemigo(w, 1, 'soldado', 440, 400);
  run(w, 40);
  assert.equal(sq.state, 'intercept');
  assert.ok(sq.interceptGoal.x <= zona[1] && sq.interceptGoal.x >= zona[0], 'la meta se recorta a la zona');
  let maxX = 0;
  for (let i = 0; i < 300; i++) {
    stepWorld(w);
    for (const u of sq.members) maxX = Math.max(maxX, u.x);
  }
  assert.ok(maxX <= zona[1] + 1, `un miembro salió de la zona: ${maxX}`);
  // el intruso se va: la vuelta tarda ≤ distancia/(0,9·v) + 1,5 s
  intruso.members[0].alive = false;
  run(w, 2);
  const dist = Math.hypot(sq.anchor.x - sq.postPos.x, sq.anchor.y - sq.postPos.y);
  const limite = Math.ceil((dist / (0.9 * w.stats.soldado.speed) + 1.5) * 30) + 30;
  let vuelta = -1;
  for (let i = 0; i < 2000 && vuelta < 0; i++) {
    stepWorld(w);
    if (sq.state === 'holding') vuelta = i;
  }
  assert.ok(vuelta >= 0 && vuelta <= limite, `volvió en ${vuelta} pasos (límite ${limite})`);
});

// ---------------------------------------------------------------------------------------------------- rebalanceo (4c.9)

/** 8 grupos de ataque quietos y `d` de DEFENSA en sectores y puestos distintos. */
function diez(w, d, extra = {}) {
  const n = extra.total ?? 10;
  for (let i = 0; i < n - d; i++) {
    const [c, l, x] = lugar(i);
    ataque(w, 0, 'soldado', x, c, l);
  }
  const lugares = [
    [1, 0],
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 1],
    [2, 1],
  ];
  for (let i = 0; i < d; i++) defensa(w, 0, 'soldado', ...lugares[i], 5 + i, 'holding', false);
}

test('2 de 10 con cuota 15 no arranca (|d| = 5)', () => {
  const w = mundo(QUIETOS);
  diez(w, 2);
  assert.deepEqual(conversiones(w, 900), []);
  assert.equal(w.cmd[0].rebal, 0);
});

test('1 de 10 con enemigo (cuota 26,25) convierte en t y t + 4 s (3 de 10) y se desactiva', () => {
  const w = mundo(QUIETOS);
  diez(w, 1);
  enemigo(w, 1, 'soldado', 300, 448);
  const c = conversiones(w, 900);
  assert.deepEqual(c, [0, 120]);
  assert.equal(w.squads.filter((s) => s.side === 0 && s.role === 'defensa').length, 3);
  assert.equal(w.cmd[0].rebal, 0, 'se desactivó');
});

test('1 de 10 con cuota 60 convierte cada 4 s hasta 6 de 10', () => {
  const w = mundo({ ...QUIETOS, commander: { bias: 45 } });
  diez(w, 1);
  assert.equal(w.cmd[0].q, 60);
  const c = conversiones(w, 1200);
  assert.deepEqual(c, [0, 120, 240, 360, 480]);
  assert.equal(w.squads.filter((s) => s.side === 0 && s.role === 'defensa').length, 6);
});

test('4 de 12 con cuota 15 baja a 1 de 12 en t0, +4 y +8 s', () => {
  const w = mundo(QUIETOS);
  diez(w, 4, { total: 12 });
  const c = conversiones(w, 900);
  assert.deepEqual(c, [0, 120, 240]);
  assert.equal(w.squads.filter((s) => s.side === 0 && s.role === 'defensa').length, 1);
});

test('sin candidato no convierte y SIGUE activo; convierte cuando se libera un puesto, sin volver a la banda', () => {
  const w = mundo({ ...QUIETOS, commander: { bias: 100 } });
  // DEFENSA en los puestos 0 y 1 de cada sector: los libres y alcanzables (2 y 3) quedan detrás del soldado
  const def = [];
  for (const sector of [0, 1, 2])
    for (const post of [0, 1]) def.push(defensa(w, 0, 'soldado', sector, post, 10, 'holding', false));
  for (let i = 0; i < 7; i++) {
    const [c, , x] = lugar(i);
    ataque(w, 0, i % 2 ? 'pesado' : 'tanque', x + 40, c, 2, 1);
  }
  const solo = ataque(w, 0, 'soldado', 288, 1, 0); // avanza 0,9 px/s: a los 40 s sigue entre el puesto 2 (x 282) y el 1 (x 328)
  void solo;
  assert.deepEqual(conversiones(w, 1200), [], '40 s sin candidato');
  assert.equal(w.cmd[0].rebal, -1, 'sigue activo');
  const sector1 = def.find((q) => q.sector === 1 && q.post === 1);
  for (const u of sector1.members) u.alive = false; // se libera el puesto 1 del sector medio, que queda delante del soldado
  const c = conversiones(w, 60);
  assert.equal(c.length, 1, 'convierte en el tick siguiente');
  assert.equal(solo.role, 'defensa');
  assert.equal(solo.sector, 1);
  assert.equal(solo.post, 1);
});

test('nunca dos conversiones a menos de 4 s, tampoco entre dos rebalanceos', () => {
  const w = mundo({ ...QUIETOS, commander: { bias: 45 } });
  diez(w, 1);
  const c = [];
  for (let i = 0; i < 4000; i++) {
    const paso = w.step;
    stepWorld(w);
    for (const e of w.drain()) if (e.type === 'convert' && e.side === 0) c.push(paso);
    if (i === 700) {
      // el primer rebalanceo ya terminó (6 de 10): dos tanques enemigos en la zona suben la cuota a 85 y arma otro
      assert.equal(c.length, 5);
      enemigo(w, 1, 'tanque', 300, 448);
      enemigo(w, 1, 'tanque', 320, 448);
    }
  }
  assert.ok(c.length > 5, 'el segundo rebalanceo convirtió más grupos');
  assert.ok(c[5] - c[4] >= 120, `entre dos rebalanceos: ${c[4]} y ${c[5]}`);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] - c[i - 1] >= 120, `conversiones en ${c[i - 1]} y ${c[i]}`);
});

test('el convertido a ATAQUE conserva el corredor de su sector y toma la primera calle libre: un jeep desde B va a −40', () => {
  const w = mundo(QUIETOS);
  const j = defensa(w, 0, 'jeep', 2, 0, 4, 'holding', false);
  assert.equal(j.postLane, 'B');
  run(w, 1);
  assert.equal(j.role, 'ataque');
  assert.equal(j.corridor, 2);
  assert.equal(j.state, 'converting');
  assert.equal(j.nextLane, 1, 'la calle de jeeps');
  assert.equal(j.slideY, laneY(w.field, 2, 1));
  assert.equal(j.slideY, 655 - 40);
});

test('candidato hacia DEFENSA: el ataque más cercano a su base; hacia ATAQUE: la DEFENSA salida con más miembros (empate por id menor)', () => {
  const w = mundo({ ...QUIETOS, commander: { bias: 45 } });
  const lejos = ataque(w, 0, 'soldado', 200, 0, 0);
  const cerca = ataque(w, 0, 'soldado', 140, 1, 0);
  const empate = ataque(w, 0, 'soldado', 140, 2, 0);
  run(w, 1);
  assert.equal(cerca.role, 'defensa');
  assert.equal(empate.role, 'ataque');
  assert.equal(lejos.role, 'ataque');
  const w2 = mundo(QUIETOS);
  const chico = defensa(w2, 0, 'soldado', 0, 0, 6, 'holding', false);
  const grande = defensa(w2, 0, 'soldado', 1, 0, 10, 'holding', false);
  const igual = defensa(w2, 0, 'soldado', 2, 0, 10, 'holding', false);
  assert.ok(chico.id < grande.id && grande.id < igual.id);
  run(w2, 1);
  assert.equal(grande.role, 'ataque', 'el de más miembros, con id menor en el empate');
  assert.equal(igual.role, 'defensa');
  assert.equal(chico.role, 'defensa');
});

test('tanques, pesado y grupos que forman nunca se convierten', () => {
  const w = mundo({ ...QUIETOS, commander: { bias: 45 } });
  ataque(w, 0, 'tanque', 150, 0, 2);
  ataque(w, 0, 'pesado', 160, 2, 2);
  const plan = planAlta(w, 0, 'soldado');
  const f = createFromPlan(w, 0, 'soldado', plan);
  addUnit(w, f, plan.x, plan.y, {});
  assert.deepEqual(conversiones(w, 100), []);
  assert.equal(f.state, 'forming');
});

// ---------------------------------------------------------------------------------------------------- determinismo (4c.10)

test('el mismo log corrido dos veces con un RNG de reglas que lanza da los mismos grupos, roles, calles y salidas', () => {
  const log = [];
  for (let i = 0; i < 60; i++) {
    const kind = ['soldado', 'jeep', 'tanque', 'pesado'][i % 4];
    log.push({
      step: i * 20,
      payload: {
        type: 'order',
        order: { kind, team: 1 + (i % 2), owner: null, count: 1 + (i % 7), unitValue: 0, source: 'gift' },
      },
    });
  }
  const corrida = () => {
    const alea = Math.random;
    Math.random = () => {
      throw new Error('el comandante no usa azar');
    };
    try {
      const w = mundo({}, { phase: 'battle' });
      let k = 0;
      const salidas = [];
      for (let s = 0; s < 2400; s++) {
        while (k < log.length && log[k].step <= s) applyEvent(w, log[k++].payload);
        stepWorld(w);
        for (const e of w.drain()) if (e.type === 'squadDepart') salidas.push([e.id, s]);
      }
      return { w, salidas };
    } finally {
      Math.random = alea;
    }
  };
  const a = corrida();
  const b = corrida();
  const foto = (w) =>
    w.squads.map((s) => [s.id, s.side, s.role, s.state, s.corridor, s.lane, s.sector, s.post, s.members.length]);
  assert.deepEqual(foto(a.w), foto(b.w));
  assert.deepEqual(a.salidas, b.salidas);
  assert.equal(hashWorld(a.w), hashWorld(b.w));
  assert.ok(a.salidas.length > 10);
});

test('el HUD se publica en cada tick: salidos por rol, los que forman aparte, H, Z y la cuota', () => {
  const w = mundo();
  defensa(w, 0, 'soldado', 1, 0);
  ataque(w, 0, 'tanque', 300, 0, 2);
  enemigo(w, 1, 'tanque', 300, 448);
  run(w, 1);
  assert.deepEqual(w.cmd[0].hud, { defensa: 1, ataque: 1, forming: 0, H: 2, Z: 2, q: 37.5 });
  assert.equal(w.cmd[1].hud.H, 0);
});

test('setRole, assignSquad y vote devuelven { ok: false } sin cambiar el estado', () => {
  const w = mundo({}, { phase: 'battle' });
  submitOrder(w, { kind: 'soldado', team: 1, owner: null, count: 10, unitValue: 0, source: 'gift' });
  run(w, 100);
  const antes = hashWorld(w);
  for (const type of ['setRole', 'assignSquad', 'vote', 'spawn', 'damage', 'setScore']) {
    const r = applyEvent(w, { type, side: 0, squad: 1, role: 'defensa' });
    assert.equal(r.ok, false, type);
  }
  assert.equal(hashWorld(w), antes);
});

test('en una corrida larga todas las conversiones de un lado distan ≥ 4 s', () => {
  const w = mundo({}, { phase: 'battle' });
  for (const team of [1, 2]) {
    for (const [kind, n] of [
      ['soldado', 120],
      ['jeep', 40],
      ['tanque', 10],
    ]) {
      submitOrder(w, { kind, team, owner: null, count: n, unitValue: 0, source: 'gift' });
    }
  }
  const por = [[], []];
  for (let s = 0; s < 3000; s++) {
    stepWorld(w);
    for (const e of w.drain()) if (e.type === 'convert') por[e.side].push(s);
  }
  for (const lista of por) for (let i = 1; i < lista.length; i++) assert.ok(lista[i] - lista[i - 1] >= 120);
  assert.ok(por[0].length + por[1].length > 0, 'hubo conversiones');
});
