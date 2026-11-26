import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { createMatch } from '../public/js/sim/match.js';
import { createWorld, seedUnits, stepWorld } from '../public/js/sim/world.js';
import { hashWorld } from '../public/js/sim/hash.js';
import { advance, createRecorder, replayLog, replayMatch } from '../public/js/sim/replay.js';
import { hashMatch } from '../public/js/sim/hash.js';
import { PAISES } from '../public/js/data/paises.js';
import { GOLDEN } from '../public/js/data/golden.js';

// CB-13, CB-18: paso fijo de 30 Hz, repetición exacta, hash estable y hash dorado. El dorado es un partido completo
// de ~500 eventos (lote 4d, tarea 4d.7); se regenera a propósito con `npm run golden -w batalla-paises`.

/** Log de prueba: unidades de los dos lados, un avión de cada uno y refuerzos a mitad de combate. */
const sembrar = (side, kind, y, count = 3, x = 300) => ({
  type: 'seedUnits',
  side,
  kind,
  count,
  x: side === 0 ? x : 1440 - x,
  y,
  dy: 20,
});
const LOG = [
  { step: 0, kind: 'cmd', payload: sembrar(0, 'soldado', 448, 10) },
  { step: 0, kind: 'cmd', payload: sembrar(1, 'soldado', 448, 10) },
  { step: 20, kind: 'cmd', payload: sembrar(0, 'jeep', 242, 4) },
  { step: 20, kind: 'cmd', payload: sembrar(1, 'jeep', 655, 4) },
  { step: 60, kind: 'cmd', payload: sembrar(0, 'tanque', 600, 2) },
  { step: 60, kind: 'cmd', payload: sembrar(1, 'tanque', 280, 2) },
  { step: 120, kind: 'cmd', payload: { type: 'launchPlane', side: 0 } },
  { step: 200, kind: 'cmd', payload: { type: 'launchPlane', side: 1 } },
  { step: 300, kind: 'cmd', payload: sembrar(0, 'pesado', 448, 1) },
  { step: 300, kind: 'cmd', payload: sembrar(1, 'pesado', 448, 1) },
];

test('el reloj es step / 30 y los ids son monótonos y no se reciclan', () => {
  const w = createWorld();
  assert.equal(w.time, 0);
  seedUnits(w, { side: 0, kind: 'soldado' });
  seedUnits(w, { side: 1, kind: 'soldado' });
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
  const nuevo = seedUnits(w, { side: 0, kind: 'jeep', count: 1 }).units[0];
  assert.ok(nuevo.id > ultimo);
});

test('un log repetido da estados y hashes iguales (deepEqual)', () => {
  const a = replayLog(LOG, { steps: 900 });
  const b = replayLog(LOG, { steps: 900 });
  const foto = (w) => ({
    step: w.step,
    units: w.units.map((u) => [u.id, u.hp, u.x, u.y, u.vx, u.vy, u.dir, u.cd]),
    marcha: w.units.map((u) => [u.id, u.phase, u.yg, u.seek === null ? 0 : u.seek.id, u.wx, u.wy]),
    bases: w.bases.map((x) => [x.hp, x.turrets.map((t) => t.hp)]),
  });
  assert.deepEqual(foto(a), foto(b));
  assert.equal(hashWorld(a), hashWorld(b));
});

const VACIO = '41b7d8b8';

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

test('inundación de 200 por lado: dos corridas con Math.random que lanza dan el mismo hash en cada 100 pasos', async () => {
  const { submitOrder } = await import('../public/js/sim/queue.js');
  const corrida = () => {
    const w = createWorld({ hq: { hp: 1e12 } });
    for (const team of [1, 2]) {
      for (const [kind, count] of [
        ['soldado', 120],
        ['jeep', 30],
        ['tanque', 40],
        ['pesado', 10],
      ]) {
        submitOrder(w, { kind, team, owner: `${kind}${team}`, count, unitValue: 0, source: 'gift' });
      }
    }
    const hashes = [];
    let vivos600 = 0;
    const alea = Math.random;
    Math.random = () => {
      throw new Error('el sim no usa Math.random');
    };
    try {
      for (let i = 1; i <= 1800; i++) {
        stepWorld(w);
        if (i % 100 === 0) hashes.push(hashWorld(w));
        if (i === 600) vivos600 = w.units.length;
      }
    } finally {
      Math.random = alea;
    }
    return { hashes, vivos600 };
  };
  const a = corrida();
  const b = corrida();
  assert.deepEqual(a.hashes, b.hashes);
  assert.equal(new Set(a.hashes.slice(0, 8)).size, 8, 'el hash cambia en cada tramo mientras hay combate');
  assert.ok(a.vivos600 > 100, `${a.vivos600} unidades vivas a los 20 s`);
});

test('20 fps y 144 fps de cuadros simulados dan el mismo estado: depende de los pasos, no de los cuadros', () => {
  const objetivo = 420;
  const correr = (fps) => {
    const w = createWorld();
    let paso = 0;
    for (const e of LOG) if (e.step === 0) seedUnits(w, e.payload);
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
  marcha: m.world.units.map((u) => [u.id, u.phase, u.yg, u.seek === null ? 0 : u.seek.id]),
  bases: m.world.bases.map((b) => [b.hp, b.turrets.map((t) => t.hp)]),
  users: m.registry
    .users()
    .map((u) => [u.key, u.team, u.rank, u.xp, u.coins, u.value, u.kills])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
});

test('hash dorado: el log versionado corrido en Node da el hash versionado', () => {
  assert.equal(GOLDEN.version, 6); // v2.9: vida × 0,6 (tanque y lobo × 0,4), bombas de radio 38,4 y 5 soldados por moneda
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
  assert.deepEqual(
    [...regalos].sort(),
    ['avion', 'blindado', 'francotirador', 'jeep', 'lanzacohetes', 'lobo', 'pesado', 'soldado', 'tanque'],
    'los nueve tipos de regalo (v2.8b)',
  );
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

test('repetir el log dorado dos veces da estados y hashes iguales, fase, altura de destino y blanco de visión incluidos', () => {
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

test('la presentación no altera el sim: un log con temblor, cámara lenta y destellos y otro sin ellos dan el mismo estado (CB-20)', async () => {
  const { createScene } = await import('../public/js/render/scene.js');
  const { createFx } = await import('../public/js/render/fx.js');
  const { createMotion } = await import('../public/js/render/motion.js');
  const { SPRITES } = await import('../public/js/data/sprites.js');
  const vista = { temblores: 0, lentas: 0, grandes: 0, estados: new Set() };
  const conEfectos = (systemReduced) => {
    const fx = createFx({ seed: 'efectos:determinismo', motion: createMotion({ graphics: {}, systemReduced }) });
    fx.setView({ W: 1920, H: 1080, s: 8 }); // k = 6: los destellos grandes entran en juego
    const sc = createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES, fx });
    const out = { x: 0, y: 0 };
    return jugar(GOLDEN.log, {
      onStep: (m) => {
        sc.consume(m.world.drain(), m.world);
        sc.fx.update(1 / 30, m.world);
        sc.fx.shakeOffset(out);
        if (out.x !== 0 || out.y !== 0) vista.temblores++;
        if (m.state === 'roundEnd' && !vista.estados.has(m.round)) {
          vista.estados.add(m.round);
          sc.fx.beginSlowMotion();
        }
        if (sc.fx.timeScale() < 1) vista.lentas++;
        vista.grandes = sc.fx.stats.largeGranted;
      },
    });
  };
  const base = dorado();
  const a = conEfectos(false);
  assert.ok(
    vista.temblores > 0 && vista.lentas > 0 && vista.grandes > 0,
    'la vista sí hizo temblor, cámara lenta y destellos',
  );
  assert.equal(hashMatch(a), GOLDEN.hash);
  assert.deepEqual(foto(a), foto(base));
  const b = conEfectos(true); // con movimiento reducido también
  assert.equal(hashMatch(b), GOLDEN.hash);
  assert.deepEqual(foto(b), foto(base));
});

test('la presentación de la cámara no altera el sim: cámara al azar, automática, R y momentos dan los mismos ganadores, bases, XP, rangos y marcha (NM-2, 5c.6)', async () => {
  const { createCameraRig } = await import('../public/js/camera/rig.js');
  const { createGestures } = await import('../public/js/camera/gestures.js');
  const { minimapVisible } = await import('../public/js/camera/minimap.js');
  const { minimapRect } = await import('../public/js/ui/layout.js');
  const { createMotion } = await import('../public/js/render/motion.js');

  // la cámara recibe el mundo en solo lectura: cualquier escritura del lado de la vista lanza
  const cache = new WeakMap();
  const soloLectura = (o) => {
    if (o === null || typeof o !== 'object') return o;
    if (cache.has(o)) return cache.get(o);
    const prohibido = () => {
      throw new Error('la vista escribió en un objeto del sim');
    };
    const p = new Proxy(o, {
      get: (t, k, r) => {
        const v = Reflect.get(t, k, r);
        // lo congelado no se puede escribir de todos modos (y el proxy no puede devolver otro objeto por él)
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        return d && d.configurable === false && d.writable === false ? v : soloLectura(v);
      },
      set: prohibido,
      deleteProperty: prohibido,
      defineProperty: prohibido,
      setPrototypeOf: prohibido,
    });
    cache.set(o, p);
    return p;
  };

  // PUNTO DE EXTENSIÓN (lote 6): los comandos de presentación que aún no existen se suman a la tabla de `switch` de más
  // abajo, junto a los de cámara: marcador (G), top 3 parcial (T), foco en un donante (S y Shift+S; ya existe
  // `controller.follow(getPoint)`), ocultar donante (Alt+clic) y todos los nombres (N), marco (C), ayuda (H) y Shift+N.
  // Todos son estado de vista: el log debe seguir dando el mismo hash y las mismas fotos.
  const vista = { auto: 0, comandos: 0, reducido: 0, momentos: 0, rondas: 0, cambiosDeK: 0 };
  const conCamara = (seed) => {
    const motion = createMotion({ graphics: {}, systemReduced: false });
    const rig = createCameraRig({ canvas: { w: 1920, h: 1080 }, view: { idleSeconds: 2 }, graphics: {}, motion });
    const c = rig.controller;
    const g = createGestures({
      controller: c,
      minimap: () => (minimapVisible(c.state.k) ? minimapRect(1920, 1080) : null),
    });
    const rnd = mulberry32(seedFrom(seed));
    let estado = '';
    let puntero = 0;
    let kAntes = 1;
    return jugar(GOLDEN.log, {
      onStep: (m) => {
        const w = soloLectura(m.world);
        rig.consume(m.world.drain(), w);
        if (m.state !== estado) {
          estado = m.state;
          if (estado === 'intro') {
            rig.newRound();
            vista.rondas++;
          }
        }
        if (rnd() < 0.02) {
          vista.comandos++;
          const x = rnd() * 1920;
          const y = rnd() * 1080;
          const t = m.tick * 33;
          switch (Math.floor(rnd() * 15)) {
            case 0:
              c.zoomToLevel(Math.floor(rnd() * 8), rnd(), rnd());
              break;
            case 1:
              c.panBy((rnd() - 0.5) * 600, (rnd() - 0.5) * 400);
              break;
            case 2:
              c.centerOn(rnd() * 1440, rnd() * 810);
              break;
            case 3:
              c.viewAll();
              break;
            case 4:
              c.focusBase(rnd() < 0.5 ? 0 : 1);
              break;
            case 5:
              c.follow(() => ({ x: rnd() * 1440, y: rnd() * 810 }));
              break;
            case 6:
              c.stopFollow();
              break;
            case 7:
              c.input('wheel', { dy: (rnd() - 0.5) * 400, deltaMode: 0, ctrl: rnd() < 0.2, x, y });
              break;
            case 8:
              c.input('factor', { f: 0.6 + rnd() * 1.2, x, y });
              break;
            case 9:
              c.input('keys', { x: Math.floor(rnd() * 3) - 1, y: Math.floor(rnd() * 3) - 1 });
              break;
            case 10:
              c.toggleAuto();
              break;
            case 11:
              motion.toggle(); // R
              vista.reducido++;
              break;
            case 12:
              vista.momentos++;
              rig.bigGift({ coins: 500 + Math.floor(rnd() * 500), x: rnd() * 1440, y: rnd() * 810 }, m.world.step);
              break;
            case 13: {
              const id = ++puntero;
              g.down({ id, x, y, t });
              g.move({ id, x: x + 80, y: y + 40, t: t + 10 });
              g.up({ id, x: x + 80, y: y + 40, t: t + 20 });
              break;
            }
            default: {
              const id = ++puntero;
              g.down({ id, x, y, t });
              g.up({ id, x, y, t: t + 30 });
              g.down({ id, x, y, t: t + 120 });
              g.up({ id, x, y, t: t + 150 });
              break;
            }
          }
        }
        rig.update(1 / 30, w, m.state === 'battle');
        if (c.state.mode === 'auto') vista.auto++;
        if (c.state.k !== kAntes) vista.cambiosDeK++;
        kAntes = c.state.k;
      },
    });
  };
  const base = dorado();
  for (const seed of ['camara-uno', 'camara-dos']) {
    const a = conCamara(seed);
    assert.equal(hashMatch(a), GOLDEN.hash);
    assert.deepEqual(foto(a), foto(base));
    assert.deepEqual(a.wins, base.wins);
    assert.deepEqual(a.results, base.results);
  }
  // la vista sí hizo de todo: comandos, la automática manejando, zoom, R, momentos y cambios de ronda
  assert.ok(vista.comandos > 100, `${vista.comandos} comandos`);
  assert.ok(vista.auto > 0, 'la automática manejó');
  assert.ok(vista.cambiosDeK > 10, 'hubo zoom');
  assert.ok(vista.reducido > 0 && vista.momentos > 0 && vista.rondas >= 2);
});

test('la moderación y los paneles no alteran el sim: ocultar donantes, Alt+Z, N, seguir, marcador, top 3 y ayuda dan el mismo mundo en cada paso, el mismo hash y las mismas fotos (S7, NM-2, NM-11)', async () => {
  const { createModeration } = await import('../public/js/ui/moderation.js');
  const { createSpotlight } = await import('../public/js/ui/spotlight.js');
  const { helpModel, scoreboardModel, top3Model } = await import('../public/js/ui/overlays.js');
  const hecho = { ocultar: 0, deshacer: 0, nombres: 0, seguir: 0, paneles: 0 };
  /** El mundo de cada paso (`hashWorld`: reglas, sin el registro) y lo que la presentación hizo por el camino. */
  const correr = (seed, conPresentacion) => {
    const rnd = mulberry32(seedFrom(seed));
    const serie = [];
    let elegido = [];
    let mod = null;
    let seg = null;
    const m = jugar(GOLDEN.log, {
      onStep: (p) => {
        p.world.drain(); // el único vaciado de la bandeja, como en la página
        serie.push(hashWorld(p.world));
        if (!conPresentacion) return;
        mod ??= createModeration({ registry: p.registry, rects: () => elegido });
        seg ??= createSpotlight({
          registry: p.registry,
          units: () => p.world.units,
          camera: { follow() {}, stopFollow() {} },
        });
        if (rnd() >= 0.03) return;
        const users = p.registry.users();
        elegido = users.length ? [{ key: users[Math.floor(rnd() * users.length)].key, x: 0, y: 0, w: 10, h: 10 }] : [];
        switch (Math.floor(rnd() * 9)) {
          case 0:
          case 1:
            hecho.ocultar += mod.hideAt({ x: 1, y: 1 }) === null ? 0 : 1;
            break;
          case 2:
            hecho.deshacer += mod.undo() === 'undone' ? 1 : 0;
            break;
          case 3:
            hecho.nombres++;
            mod.toggleNames();
            break;
          case 4:
            hecho.seguir += seg.next() === null ? 0 : 1;
            break;
          case 5:
            seg.stop();
            break;
          case 6:
            if (p.pair) scoreboardModel({ match: p, registry: p.registry });
            hecho.paneles++;
            break;
          case 7:
            top3Model({ match: p, registry: p.registry });
            hecho.paneles++;
            break;
          default:
            helpModel();
        }
      },
    });
    return { m, serie };
  };
  const base = correr('base', false);
  assert.equal(hashMatch(base.m), GOLDEN.hash);
  for (const seed of ['moderacion-uno', 'moderacion-dos']) {
    const { m, serie } = correr(seed, true);
    assert.deepEqual(serie, base.serie, `${seed}: el mundo es idéntico en cada uno de los ${serie.length} pasos`);
    assert.deepEqual(foto(m), foto(base.m), seed);
    assert.deepEqual(m.wins, base.m.wins);
    assert.deepEqual(m.results, base.m.results);
    // `hashMatch` también incluye la marca "oculto" de cada usuario (estado del registro, no una regla): con todos visibles
    // otra vez vuelve el hash dorado, y los nombres ocultos con `N` nunca lo cambian
    m.registry.setAllNamesHidden(true);
    for (const u of m.registry.users()) m.registry.unhide(u.key);
    assert.equal(hashMatch(m), GOLDEN.hash, seed);
  }
  assert.ok(hecho.ocultar > 3 && hecho.nombres > 3 && hecho.seguir > 0 && hecho.paneles > 3, JSON.stringify(hecho));
});
