import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '@tienda/kit/sim/rng.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { damageTurret, requestBaseDamage } from '../public/js/sim/base.js';
import { launchPlane } from '../public/js/sim/plane.js';
import { fireEnergy } from '../public/js/sim/energy.js';
import { submitGift } from '../public/js/sim/queue.js';

// CB-12, CB-19, D18: la guardia anti-ballena por construcción (el cubo de la base) y el daño efectivo del paso 1.

const src = { side: 0, owner: null };
const conMin = (minSeconds) => ({ hq: { minSeconds } });

test('el cubo arranca vacío con capacidad hq.hp / minSeconds: 800/s con 60 000 y 75 s, 1000/s con 60 s', () => {
  const w = createWorld();
  assert.equal(w.bases[0].bucket, 0);
  assert.equal(w.bases[0].cap, 800);
  assert.equal(createWorld(conMin(60)).bases[1].cap, 1000);
  // se llena 26,67 por paso (800 · DT) y no pasa de la capacidad
  stepWorld(w);
  assert.ok(Math.abs(w.bases[0].bucket - 800 / 30) < 1e-9);
  for (let i = 0; i < 100; i++) stepWorld(w);
  assert.equal(w.bases[0].bucket, 800);
});

test('aplicado = min(pedido, cubo): con cubo vacío no pasa nada; con 800 permitidos, 5000 pedidos suman 800', () => {
  const w = createWorld();
  assert.equal(requestBaseDamage(w, 1, 5000, src), 0, 'el cubo arranca vacío en cada ronda');
  assert.equal(w.bases[1].hp, 60000);
  assert.equal(w.teams[0].structDamage, 0);
  w.bases[1].bucket = 800;
  assert.equal(requestBaseDamage(w, 1, 5000, src), 800);
  assert.equal(w.bases[1].hp, 59200);
  assert.equal(w.teams[0].structDamage, 800, 'daño efectivo: lo aplicado tras el cubo, no lo pedido');
  assert.equal(w.bases[1].bucket, 0);
  const evs = w.drain().filter((e) => e.type === 'baseHit');
  assert.equal(evs.at(-1).absorbed, 4200, 'lo absorbido sale para el brillo tenue de la vista');
});

test('el daño a una torreta no pasa por el cubo y suma min(dmg, hp): 900 sobre 100 de HP suman 100', () => {
  const w = createWorld();
  const t = w.bases[1].turrets[0];
  t.hp = 100;
  const bucket = w.bases[1].bucket;
  assert.equal(damageTurret(w, t, 900, src), 100);
  assert.equal(w.teams[0].structDamage, 100);
  assert.equal(w.bases[1].bucket, bucket, 'el cubo no cambia');
  assert.equal(w.bases[1].hp, 60000, 'ni la base');
});

test('todo daño a la base pasa por el cubo: disparos, salpicadura, bombas y energía', () => {
  const w = createWorld();
  const b = w.bases[1];
  b.bucket = 0;
  // una bomba y un obús al frente de la base en el paso 0 con el cubo vacío: no hacen nada
  for (const kind of ['bomb', 'shell']) {
    w.hits.push({ id: ++w.nextHitId, due: 0, kind, side: 0, owner: null, dmg: 900, splash: 24, tx: b.frontX, ty: 448 });
  }
  stepWorld(w);
  assert.equal(b.hp, 60000);
  // la energía sin grupos también va por el cubo
  fireEnergy(w, 0);
  assert.ok(60000 - b.hp <= 800 / 30 + 1e-9, 'a lo sumo lo que dejó entrar el cubo en un paso');
});

for (const min of [60, 75]) {
  test(`la base cae justo en el paso ${min * 30} con la mayor presión posible (minSeconds ${min})`, () => {
    const w = createWorld(conMin(min));
    const limite = min * 30;
    for (let s = 0; s < limite; s++) {
      requestBaseDamage(w, 1, 1e9, src); // pedido enorme antes de cada paso
      stepWorld(w);
      assert.ok(w.bases[1].hp > 0, `cayó en el paso ${s} (< ${limite})`);
      assert.equal(w.over, null);
    }
    requestBaseDamage(w, 1, 1e9, src);
    stepWorld(w);
    assert.equal(w.bases[1].hp, 0, `no cayó en el paso ${limite}`);
    assert.equal(w.over.step, limite, 'una base en 0 termina la ronda en ese paso');
    assert.equal(w.over.winner, 0);
  });
}

// ---------------------------------------------------------------------------------------------------- escenarios

/** Carga la presión de un escenario de ballena y corre hasta el paso 1799 comprobando que la base enemiga sigue viva. */
function corre(game, escenario) {
  const w = createWorld(game, { phase: 'battle' });
  escenario(w);
  for (let s = 0; s < 1800; s++) {
    stepWorld(w);
    assert.ok(w.bases[1].hp > 0, `la base cayó en el paso ${s}`);
  }
  return w;
}

/** Tropas del lado 0 ya junto a la base enemiga (en grupos de 10 soldados, 4 jeeps, 2 tanques o 1 pesado), sin nadie que las pare. */
function alFrente(w, n, kind) {
  for (let i = 0; i < n; i++) {
    seedUnits(w, {
      side: 0,
      kind,
      count: { soldado: 10, jeep: 4, tanque: 2, pesado: 1 }[kind],
      y: 242 + (i % 3) * 206,
      dy: 16,
      x: 1270 + (i % 5) * 8,
      pinned: true,
    });
  }
}

const escenarios = {
  '50 000 monedas ×1': (w) => {
    submitGift(w, {
      owner: 'A',
      coins: 50000,
      orders: [{ kind: 'pesado', team: 1, owner: 'A', count: 50, unitValue: 1000, source: 'gift' }],
    });
    alFrente(w, 50, 'pesado');
  },
  'un combo ×99 de un regalo medio': (w) => {
    submitGift(w, {
      owner: 'A',
      coins: 9900,
      orders: [{ kind: 'tanque', team: 1, owner: 'A', count: 99, unitValue: 100, source: 'gift' }],
    });
    alFrente(w, 40, 'tanque');
  },
  'el avión ×99': (w) => {
    submitGift(w, {
      owner: 'A',
      coins: 49500,
      orders: [{ kind: 'avion', team: 1, owner: 'A', count: 99, unitValue: 500, source: 'gift' }],
    });
  },
  'una mezcla de 50 000 en un segundo': (w) => {
    submitGift(w, {
      owner: 'A',
      coins: 50000,
      orders: [
        { kind: 'avion', team: 1, owner: 'A', count: 20, unitValue: 500, source: 'gift' },
        { kind: 'pesado', team: 1, owner: 'A', count: 20, unitValue: 1000, source: 'gift' },
        { kind: 'tanque', team: 1, owner: 'A', count: 99, unitValue: 100, source: 'gift' },
        { kind: 'jeep', team: 1, owner: 'A', count: 99, unitValue: 10, source: 'gift' },
      ],
    });
    alFrente(w, 20, 'pesado');
    alFrente(w, 20, 'tanque');
    alFrente(w, 20, 'jeep');
    for (let i = 0; i < 10; i++) fireEnergy(w, 0);
  },
};

for (const min of [75, 60]) {
  for (const [nombre, esc] of Object.entries(escenarios)) {
    test(`ballena (${nombre}, minSeconds ${min}): la base enemiga sigue viva hasta el paso 1799`, () => {
      const w = corre(conMin(min), (m) => {
        esc(m);
        if (nombre === 'el avión ×99' || nombre.startsWith('una mezcla')) launchPlane(m, 0, 'A', 500);
      });
      assert.ok(w.bases[1].hp < 60000, 'la presión sí llegó a la base');
    });
  }
}

test('energía ×10 en 60 s sin grupos: 6000 pedidos restan como máximo 3600 y la base queda viva', () => {
  const w = createWorld(conMin(60), { phase: 'battle' });
  for (let i = 0; i < 10; i++) {
    fireEnergy(w, 0);
    for (let s = 0; s < 180; s++) stepWorld(w);
  }
  assert.ok(60000 - w.bases[1].hp <= 3600 + 1e-9);
  assert.ok(w.bases[1].hp > 0);
});

test('200 mezclas con un RNG de test: la base enemiga sigue viva tras cada paso hasta el 1799', () => {
  const kinds = ['soldado', 'jeep', 'tanque', 'pesado', 'avion'];
  const valor = { soldado: 1, jeep: 10, tanque: 100, pesado: 1000, avion: 500 };
  for (let corrida = 0; corrida < 200; corrida++) {
    const rng = mulberry32(corrida + 1);
    const w = createWorld(conMin(60), { phase: 'battle' });
    const alFrenteDe = 1 + Math.floor(rng() * 6);
    for (let i = 0; i < alFrenteDe; i++) alFrente(w, 1, kinds[Math.floor(rng() * 4)]);
    for (let s = 0; s < 1800; s++) {
      if (rng() < 0.05) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        const count = 1 + Math.floor(rng() * 99);
        submitGift(w, {
          owner: 'A',
          coins: count * valor[kind],
          orders: [{ kind, team: 1, owner: 'A', count, unitValue: valor[kind], source: 'gift' }],
        });
      }
      if (rng() < 0.02) fireEnergy(w, 0);
      stepWorld(w);
      assert.ok(w.bases[1].hp > 0, `corrida ${corrida}: cayó en el paso ${s}`);
    }
  }
});

test('caer justo en el paso 1800 (t = 60,0 s) pasa: el límite es "no antes de 60 s"', () => {
  const w = createWorld(conMin(60));
  for (let s = 0; s < 1800; s++) {
    requestBaseDamage(w, 1, 1e9, src);
    stepWorld(w);
  }
  requestBaseDamage(w, 1, 1e9, src);
  stepWorld(w);
  assert.equal(w.over.step, 1800);
  assert.equal(w.time, 1801 / 30);
});
