import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { createMatch } from '../public/js/sim/match.js';
import { createWorld, seedSquad, stepWorld } from '../public/js/sim/world.js';
import { hashWorld } from '../public/js/sim/hash.js';
import { advance, createRecorder, replayLog, replayMatch } from '../public/js/sim/replay.js';
import { hashMatch } from '../public/js/sim/hash.js';
import { PAISES } from '../public/js/data/paises.js';
import { GOLDEN } from '../public/js/data/golden.js';

// CB-13, CB-18: paso fijo de 30 Hz, repetición exacta, hash estable y hash dorado. El dorado es un partido completo
// de ~500 eventos (lote 4d, tarea 4d.7); se regenera a propósito con `npm run golden -w batalla-paises`.

/** Log de prueba: grupos de los dos lados, un avión de cada uno y refuerzos a mitad de combate. */
const LOG = [
  { step: 0, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'soldado', corridor: 1, lane: 0 } },
  { step: 0, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'soldado', corridor: 1, lane: 0 } },
  { step: 20, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'jeep', corridor: 0, lane: 1 } },
  { step: 20, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'jeep', corridor: 2, lane: 1 } },
  { step: 60, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'tanque', corridor: 2, lane: 2 } },
  { step: 60, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'tanque', corridor: 0, lane: 2 } },
  { step: 120, kind: 'cmd', payload: { type: 'launchPlane', side: 0 } },
  { step: 200, kind: 'cmd', payload: { type: 'launchPlane', side: 1 } },
  { step: 300, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'pesado', corridor: 1, lane: 2 } },
  { step: 300, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'pesado', corridor: 1, lane: 2 } },
];

test('el reloj es step / 30 y los ids son monótonos y no se reciclan', () => {
  const w = createWorld();
  assert.equal(w.time, 0);
  seedSquad(w, { side: 0, kind: 'soldado' });
  seedSquad(w, { side: 1, kind: 'soldado' });
  const vistos = new Set();
  let ultimo = 0;
  for (let i = 0; i < 600; i++) {
    stepWorld(w);
    for (const u of w.units) {
      assert.ok(!vistos.has(u.id) || u.id <= ultimo);
      vistos.add(u.id);
      ultimo = Math.max(ultimo, u.id);
    }
  }
  assert.equal(w.step, 600);
  assert.equal(w.time, 20);
  assert.ok(Number.isInteger(w.step));
  // los ids siguen creciendo aunque haya bajas
  const nuevo = seedSquad(w, { side: 0, kind: 'jeep', count: 1 }).squad.members[0];
  assert.ok(nuevo.id > ultimo);
});

test('un log repetido da estados y hashes iguales (deepEqual)', () => {
  const a = replayLog(LOG, { steps: 900 });
  const b = replayLog(LOG, { steps: 900 });
  const foto = (w) => ({
    step: w.step,
    units: w.units.map((u) => [u.id, u.hp, u.x, u.y, u.vx, u.vy, u.dir, u.cd]),
    squads: w.squads.map((s) => [s.id, s.state, s.anchor.x, s.anchor.y, s.members.length]),
    bases: w.bases.map((x) => [x.hp, x.turrets.map((t) => t.hp)]),
  });
  assert.deepEqual(foto(a), foto(b));
  assert.equal(hashWorld(a), hashWorld(b));
});

const VACIO = 'b374913c';

test('el hash FNV-1a es estable y sensible a un solo bit de un float', () => {
  const w = createWorld();
  assert.equal(hashWorld(w), hashWorld(createWorld()));
  assert.match(hashWorld(w), /^[0-9a-f]{8}$/);
  // valor fijo del mundo vacío: si cambia, cambió el hash o el estado inicial (hay que regenerar el dorado)
  assert.equal(hashWorld(w), VACIO);
  const h0 = hashWorld(w);
  w.bases[0].hp = 60000 - Number.EPSILON * 60000; // 1 ulp
  assert.notEqual(hashWorld(w), h0);
  w.bases[0].hp = 60000;
  assert.equal(hashWorld(w), h0);
});

test('el sim no tiene RNG: Math.random que lanza no rompe nada y dos semillas cosméticas dan el mismo estado', () => {
  const corrida = (semilla) => {
    const cosmetico = mulberry32(seedFrom(semilla)); // lo usaría la vista; no entra al sim
    const alea = Math.random;
    Math.random = () => {
      throw new Error('el sim no usa Math.random');
    };
    try {
      return replayLog(LOG, {
        steps: 700,
        onStep: () => {
          cosmetico();
        },
      });
    } finally {
      Math.random = alea;
    }
  };
  const a = corrida('semilla-uno');
  const b = corrida('otra-semilla');
  assert.equal(hashWorld(a), hashWorld(b));
  assert.ok(!('rng' in a) && !('seed' in a));
});

test('20 fps y 144 fps de cuadros simulados dan el mismo estado: depende de los pasos, no de los cuadros', () => {
  const objetivo = 420;
  const correr = (fps) => {
    const w = createWorld();
    let paso = 0;
    for (const e of LOG) if (e.step === 0) seedSquad(w, e.payload);
    let acc = 0;
    let guardas = 0;
    while (w.step < objetivo && guardas++ < 100000) {
      const r = advance(acc, 1 / fps);
      acc = r.acc;
      for (let i = 0; i < r.steps && w.step < objetivo; i++) {
        stepWorld(w);
        paso++;
      }
    }
    return { w, paso };
  };
  const lento = correr(20);
  const rapido = correr(144);
  assert.equal(lento.w.step, objetivo);
  assert.equal(rapido.w.step, objetivo);
  assert.equal(hashWorld(lento.w), hashWorld(rapido.w));
});

test('advance: tope de 0,1 s por cuadro, a lo sumo 3 pasos y el resto se descarta salvo un paso', () => {
  assert.deepEqual(advance(0, 1 / 30), { steps: 1, acc: 0 });
  const largo = advance(0, 5); // un cuadro de 5 s cuenta como 0,1 s = 3 pasos
  assert.equal(largo.steps, 3);
  assert.ok(largo.acc <= 1 / 30 + 1e-12);
  assert.equal(advance(0, 1 / 144).steps, 0);
  assert.equal(advance(0.9 / 30, 1 / 30, 1).steps, 1);
});

test('el registro de eventos es un anillo en memoria que conserva el orden', () => {
  const r = createRecorder(4);
  for (let i = 0; i < 6; i++) r.record(i, 'cmd', { i });
  assert.equal(r.length, 4);
  assert.deepEqual(
    r.entries().map((e) => e.step),
    [2, 3, 4, 5],
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Hash dorado definitivo (4d.7): un partido entero repetido sobre el partido real, con registro

const jugar = (log = GOLDEN.log, o = {}) =>
  replayMatch(log, { steps: GOLDEN.steps, paises: PAISES, game: GOLDEN.game, ...o });
let _dorado = null;
const dorado = () => (_dorado ??= jugar());
const foto = (m) => ({
  state: m.state,
  wins: m.wins,
  results: m.results,
  step: m.world.step,
  units: m.world.units.map((u) => [u.id, u.side, u.kind, u.hp, u.x, u.y, u.owner]),
  squads: m.world.squads.map((s) => [s.id, s.role, s.state, s.corridor, s.members.length]),
  bases: m.world.bases.map((b) => [b.hp, b.turrets.map((t) => t.hp)]),
  users: m.registry
    .users()
    .map((u) => [u.key, u.team, u.rank, u.xp, u.coins, u.value, u.kills])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
});

test('hash dorado: el log versionado corrido en Node da el hash versionado', () => {
  assert.equal(GOLDEN.version, 2);
  assert.equal(
    hashMatch(dorado()),
    GOLDEN.hash,
    'regenerar con `npm run golden -w batalla-paises` si el cambio es a propósito',
  );
});

test('el log dorado es un partido completo: ~500 eventos, todos los regalos, avión, energía, likes, uniones, una pausa y dos rondas', () => {
  const tipos = new Set(GOLDEN.log.map((e) => e.payload.type));
  for (const t of [
    'pickPair',
    'startMatch',
    'pause',
    'resume',
    'startRound',
    'gift',
    'likes',
    'follow',
    'share',
    'strike',
    'chat',
  ]) {
    assert.ok(tipos.has(t), t);
  }
  const regalos = new Set(
    GOLDEN.log.filter((e) => e.payload.type === 'gift').flatMap((e) => e.payload.orders.map((o) => o.kind)),
  );
  assert.deepEqual([...regalos].sort(), ['avion', 'jeep', 'pesado', 'soldado', 'tanque']);
  assert.ok(GOLDEN.log.length >= 450 && GOLDEN.log.length <= 650, `${GOLDEN.log.length} eventos`);
  // cada entrada va en orden de tick y el log pausa y reanuda una vez
  assert.ok(GOLDEN.log.every((e, i, l) => i === 0 || l[i - 1].step <= e.step));
  assert.equal(GOLDEN.log.filter((e) => e.payload.type === 'pause').length, 1);
  const m = dorado();
  assert.ok(m.results.length >= 2, 'dos rondas jugadas');
  assert.ok(m.registry.users().length >= 60);
  assert.ok(
    m.registry.users().some((u) => u.xp.live > 0 && u.rank > 0),
    'hubo XP y rangos',
  );
});

test('repetir el log dorado dos veces da estados y hashes iguales, grupos y roles incluidos', () => {
  const b = jugar();
  assert.deepEqual(foto(b), foto(dorado()));
  assert.equal(hashMatch(b), hashMatch(dorado()));
});

test('dos semillas cosméticas y un Math.random que lanza dan el mismo estado de reglas', () => {
  const corrida = (semilla) => {
    const cosmetico = mulberry32(seedFrom(semilla));
    const alea = Math.random;
    Math.random = () => {
      throw new Error('las reglas no usan Math.random');
    };
    try {
      return jugar(GOLDEN.log, { onStep: () => cosmetico() });
    } finally {
      Math.random = alea;
    }
  };
  const a = corrida('semilla-uno');
  const b = corrida('otra-semilla');
  assert.equal(hashMatch(a), GOLDEN.hash);
  assert.equal(hashMatch(b), GOLDEN.hash);
  assert.deepEqual(foto(a), foto(b));
  assert.ok(!('rng' in a.world) && !('seed' in a.world));
});

test('el mismo log a 20 fps y a 144 fps simulados da el mismo hash: depende de los ticks, no de los cuadros', () => {
  const porCuadros = (fps) => {
    const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
    const m = createMatch({ paises: PAISES, game: GOLDEN.game, registry });
    let i = 0;
    let tick = 0;
    let acc = 0;
    let guardas = 0;
    while (tick < GOLDEN.steps && guardas++ < 1e7) {
      const r = advance(acc, 1 / fps);
      acc = r.acc;
      for (let k = 0; k < r.steps && tick < GOLDEN.steps; k++) {
        while (i < GOLDEN.log.length && GOLDEN.log[i].step <= tick) m.command(GOLDEN.log[i++].payload);
        m.step();
        tick++;
      }
    }
    return m;
  };
  assert.equal(hashMatch(porCuadros(20)), GOLDEN.hash);
  assert.equal(hashMatch(porCuadros(144)), GOLDEN.hash);
});

test('el layout es solo vista: el sim no lo nombra y letterbox da el mismo estado que horizontal', () => {
  const raiz = fileURLToPath(new URL('../public/js/sim/', import.meta.url));
  for (const f of fs.readdirSync(raiz)) {
    const src = fs
      .readFileSync(raiz + f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /layout|letterbox/i, f);
  }
  const letterbox = jugar(GOLDEN.log, { game: { ...GOLDEN.game, layout: 'letterbox' } });
  assert.equal(hashMatch(letterbox), GOLDEN.hash);
});

test('cambiar el log o las reglas sin regenerar hace fallar el hash dorado', () => {
  const masUno = [...GOLDEN.log, { step: 400, kind: 'evt', payload: { type: 'follow', team: 1, owner: 'u0' } }];
  masUno.sort((a, b) => a.step - b.step);
  assert.notEqual(hashMatch(jugar(masUno)), GOLDEN.hash);
  const otrasReglas = jugar(GOLDEN.log, { game: { ...GOLDEN.game, turret: { dmg: 41 } } });
  assert.notEqual(hashMatch(otrasReglas), GOLDEN.hash);
  const otraConfig = jugar(GOLDEN.log, { game: { ...GOLDEN.game, units: { soldado: { range: 29 } } } });
  assert.notEqual(hashMatch(otraConfig), GOLDEN.hash);
});
