import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, FIELD } from '../public/js/sim/world.js';
import { ViewerRouter } from '../public/js/sim/events.js';
import { DEFAULT_CONFIG, deepMerge } from '../public/js/sim/defaults.js';
import { TEAM } from '../public/js/sim/units.js';
import { donorLabelUnits, nameCandidates } from '../public/js/render/overlay.js';

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function setup(over = {}) {
  const cfg = deepMerge(DEFAULT_CONFIG, over);
  const world = new World(cfg, seeded());
  const feed = [];
  const banners = [];
  const router = new ViewerRouter(world, cfg, { feed: (m) => feed.push(m), banner: (b) => banners.push(b) }, seeded(3));
  return { cfg, world, router, feed, banners };
}

function run(world, seconds, input = {}, until = null) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    world.update(dt, input);
    if (until && until(world)) return;
  }
}

const count = (world, team, kind) => world.units.filter((u) => u.team === team && u.kind === kind && u.alive).length;

test('deepMerge sobrescribe solo lo indicado', () => {
  const m = deepMerge(DEFAULT_CONFIG, { round: { seconds: 60 } });
  assert.equal(m.round.seconds, 60);
  assert.equal(m.round.baseHp, DEFAULT_CONFIG.round.baseHp);
  assert.equal(m.tiers.length, 4);
});

test('una rosa invoca un caza del equipo elegido', () => {
  const { world, router } = setup({ cpu: { enabled: false } });
  router.handle({ type: 'chat', userId: 'a', nickname: 'Ana', text: '2' });
  router.handle({ type: 'gift', userId: 'a', nickname: 'Ana', giftName: 'Rose', coins: 1, count: 1 });
  run(world, 0.5);
  // 1 dron por unirse + 1 caza por la rosa
  assert.equal(count(world, TEAM.INV, 'dron'), 1);
  assert.equal(count(world, TEAM.INV, 'caza'), 1);
});

test('los niveles de regalo eligen la unidad correcta', () => {
  const { router } = setup();
  assert.deepEqual(router.unitsForGift('Rose', 1), { unit: 'caza', perGift: 1 });
  assert.deepEqual(router.unitsForGift('Finger Heart', 5), { unit: 'caza', perGift: 5 });
  assert.deepEqual(router.unitsForGift('Doughnut', 30), { unit: 'bombardero', perGift: 3 });
  assert.deepEqual(router.unitsForGift('Hand Heart', 100), { unit: 'coloso', perGift: 1 });
  assert.deepEqual(router.unitsForGift('Galaxy', 1000), { unit: 'acorazado', perGift: 1 });
  assert.deepEqual(router.unitsForGift('Lion', 29999), { unit: 'acorazado', perGift: 3 });
});

test('override por nombre de regalo', () => {
  const { router } = setup({ giftOverrides: { 'Rose': { unit: 'bombardero', count: 1 } } });
  assert.deepEqual(router.unitsForGift('rose', 1), { unit: 'bombardero', perGift: 1 });
});

test('regalos grandes lanzan banner y racha multiplica', () => {
  const { world, router, banners } = setup({ cpu: { enabled: false } });
  router.handle({ type: 'gift', userId: 'b', nickname: 'Beto', giftName: 'Galaxy', coins: 1000, count: 1 });
  router.handle({ type: 'gift', userId: 'b', nickname: 'Beto', giftName: 'Rose', coins: 1, count: 5 });
  run(world, 1);
  const team = router.users.get('b').team;
  assert.equal(count(world, team, 'acorazado'), 1);
  assert.equal(count(world, team, 'caza'), 5);
  assert.equal(banners.length, 1);
  assert.equal(router.users.get('b').roundCoins, 1005);
});

test('equipo por defecto balancea', () => {
  const { router } = setup();
  router.handle({ type: 'chat', userId: 'x1', text: '1' });
  router.handle({ type: 'chat', userId: 'x2', text: '1' });
  router.handle({ type: 'gift', userId: 'x3', giftName: 'Rose', coins: 1, count: 1 });
  assert.equal(router.users.get('x3').team, TEAM.INV);
});

test('comentarios para elegir bando', () => {
  const { router } = setup();
  const team = (text) => router.teamFromText(text);
  assert.equal(team('defender'), TEAM.DEF);
  assert.equal(team('DEFENSORES'), TEAM.DEF);
  assert.equal(team('quiero defender'), TEAM.DEF);
  assert.equal(team('🛡️ defender'), TEAM.DEF);
  assert.equal(team('Invasores!!'), TEAM.INV);
  assert.equal(team('2'), TEAM.INV);
  assert.equal(team('tengo 2 gatos'), undefined);
  assert.equal(team('hola'), undefined);
  router.handle({ type: 'chat', userId: 'c1', nickname: 'Caro', text: 'yo defensores' });
  assert.equal(router.users.get('c1').team, TEAM.DEF);
});

test('energía por comentarios: solo cuenta con bando, en batalla y con cooldown', () => {
  const { world, router } = setup({ cpu: { enabled: false }, energy: { perCharge: 10, userCooldown: 3 } });
  router.handle({ type: 'chat', userId: 'a', text: '1' }); // en la intro: se une pero no carga
  assert.equal(router.energy[TEAM.DEF], 0);
  run(world, 4.2);
  assert.equal(world.state, 'battle');
  router.handle({ type: 'chat', userId: 'z', text: 'hola' }); // sin bando: no cuenta
  router.handle({ type: 'chat', userId: 'a', text: 'vamos' }); // con bando: cuenta
  router.handle({ type: 'chat', userId: 'a', text: 'vamos!!' }); // mismo usuario en cooldown
  assert.equal(router.energy[TEAM.DEF], 1);
  run(world, 3.1);
  router.handle({ type: 'chat', userId: 'a', text: 'otra vez' });
  router.handle({ type: 'chat', userId: 'r', text: 'invasores' });
  assert.deepEqual(router.energy, [2, 1]);
  assert.equal(router.energyProgress(TEAM.DEF), 0.2);
});

test('energía llena lanza un bombardeo de equipo sobre el grupo enemigo', () => {
  const { world, router, feed, banners } = setup({ cpu: { enabled: false }, energy: { perCharge: 3 } });
  run(world, 4.2);
  for (let i = 0; i < 6; i++) world.spawnUnit({ kind: 'coloso', team: TEAM.INV, x: -2 + i * 0.8, z: -30 });
  const hp = () => world.units.filter((u) => u.alive && u.team === TEAM.INV).reduce((s, u) => s + u.hp, 0);
  const before = hp();
  for (const id of ['a', 'b', 'c']) router.handle({ type: 'chat', userId: id, nickname: id.toUpperCase(), text: '1' });
  assert.equal(router.energy[TEAM.DEF], 0);
  assert.equal(world.strikes.length, DEFAULT_CONFIG.energy.strike.strikes); // un solo grupo, igual caen todos
  assert.ok(world.strikes.every((s) => s.team === TEAM.DEF && s.z < -20));
  assert.equal(feed.filter((f) => f.kind === 'energy').length, 1);
  assert.deepEqual([banners.at(-1).type, banners.at(-1).nickname], ['energy', 'C']);
  run(world, 2.5);
  assert.ok(before - hp() > 1000, `el bombardeo hizo poco daño: ${before - hp()}`);
});

test('el bombardeo de los invasores sin defensores cae sobre la base', () => {
  const { world } = setup({ cpu: { enabled: false } });
  run(world, 4.2);
  assert.ok(world.teamStrike(TEAM.INV));
  assert.equal(world.strikes.length, DEFAULT_CONFIG.energy.strike.strikes);
  run(world, 2.5);
  assert.equal(world.base.hp, world.base.maxHp - DEFAULT_CONFIG.energy.strike.baseDmg);
});

test('cada donante lleva su nombre fijo en su mejor nave', () => {
  const { world, router } = setup({ cpu: { enabled: false } });
  router.handle({ type: 'chat', userId: 'a', nickname: 'Ana', text: '1' }); // dron por unirse: no es donación
  router.handle({ type: 'gift', userId: 'a', nickname: 'Ana', giftName: 'Rose', coins: 1, count: 5 });
  run(world, 0.3);
  router.handle({ type: 'gift', userId: 'a', nickname: 'Ana', giftName: 'Doughnut', coins: 30, count: 1 });
  router.handle({ type: 'gift', userId: 'b', nickname: 'Beto', giftName: 'Rose', coins: 1, count: 1 });
  router.handle({ type: 'like', userId: 'l', count: 300 }); // cazas de likes: tampoco
  run(world, 0.5);
  const fixed = [...donorLabelUnits(world.units)];
  assert.deepEqual(fixed.map((u) => `${u.owner.nickname}:${u.kind}`).sort(), ['Ana:bombardero', 'Beto:caza']);
  assert.ok(world.units.some((u) => u.kind === 'dron' && u.owner?.nickname === 'Ana' && !u.gift));
  // si muere la nave con el nombre, el nombre pasa a otra del mismo donante
  const ana = fixed.find((u) => u.owner.nickname === 'Ana');
  ana.alive = false;
  const next = [...donorLabelUnits(world.units)].find((u) => u.owner.nickname === 'Ana');
  assert.ok(next && next !== ana && next.kind === 'bombardero');
});

test('todas las naves de regalo siguen con nombre; las demás lo apagan', () => {
  const { world, router } = setup({ cpu: { enabled: false } });
  router.handle({ type: 'chat', userId: 'a', nickname: 'Ana', text: '1' });
  router.handle({ type: 'gift', userId: 'a', nickname: 'Ana', giftName: 'Rose', coins: 1, count: 5 });
  router.handle({ type: 'follow', userId: 'f', nickname: 'Fede' });
  run(world, 20);
  const { owned, main } = nameCandidates(world.units, world.time);
  assert.equal(owned.length, 5); // las 5 cazas de Ana, ni el dron ni las cazas de seguir
  assert.ok(owned.every((u) => u.gift && u.owner.nickname === 'Ana'));
  assert.ok(main.has(owned[0])); // la principal va primero
});

test('likes acumulan refuerzos', () => {
  const { world, router, feed } = setup({ cpu: { enabled: false }, likes: { perReinforcement: 100, unit: 'caza', count: 3 } });
  router.handle({ type: 'like', userId: 'l', count: 250 });
  run(world, 0.5);
  assert.equal(count(world, TEAM.DEF, 'caza'), 6);
  assert.equal(feed.filter((f) => f.kind === 'likes').length, 2);
});

test('sin defensa los invasores destruyen la base', () => {
  const { world } = setup({ cpu: { enabled: false }, round: { baseHp: 3000, seconds: 200 } });
  world.commander.hp = 0; world.commander.alive = false; world.commanderRespawnAt = 1e9;
  world.turrets.length = 0;
  world.queueSpawn({ kind: 'bombardero', team: TEAM.INV }, 6);
  run(world, 90, {}, (w) => w.state === 'end');
  assert.equal(world.winner, TEAM.INV);
  assert.equal(world.base.hp, 0);
  assert.equal(world.score[TEAM.INV], 1);
});

test('si se acaba el tiempo ganan los defensores y empieza otra ronda', () => {
  const { world } = setup({ cpu: { enabled: false }, round: { seconds: 5, introSeconds: 1, intermission: 2 } });
  run(world, 6.5);
  assert.equal(world.state, 'end');
  assert.equal(world.winner, TEAM.DEF);
  run(world, 2.5);
  assert.equal(world.roundNumber, 2);
  assert.equal(world.state, 'intro');
  assert.ok(world.commander && world.commander.alive);
});

test('las oleadas CPU aparecen en batalla', () => {
  const { world } = setup({ round: { introSeconds: 0.5 } });
  run(world, 12);
  assert.ok(world.stats.spawned[TEAM.INV] >= 2);
});

test('el bombardeo del comandante elimina enemigos', () => {
  const { world } = setup({ cpu: { enabled: false } });
  for (let i = 0; i < 6; i++) world.spawnUnit({ kind: 'caza', team: TEAM.INV, x: -2 + i * 0.8, z: -10 });
  run(world, 0.1, { strike: true, aim: { x: 0, z: -10 } });
  run(world, 1.2);
  const near = world.units.filter((u) => u.team === TEAM.INV && Math.abs(u.z + 10) < 6);
  assert.equal(near.length, 0);
  assert.ok(world.strikeCooldown() > 0);
});

test('el límite por equipo encola sin perder unidades', () => {
  const { world } = setup({ cpu: { enabled: false }, limits: { maxUnitsPerTeam: 10, spawnsPerSecond: 100, maxQueue: 100 } });
  world.queueSpawn({ kind: 'caza', team: TEAM.INV }, 25);
  run(world, 0.5);
  assert.equal(world.aliveCount[TEAM.INV], 10);
  assert.equal(world.queue.length, 15);
});

test('las unidades nunca salen del campo', () => {
  const { world, router } = setup({ round: { introSeconds: 0.2 } });
  for (let i = 0; i < 40; i++) router.handle({ type: 'gift', userId: 'u' + i, giftName: 'Doughnut', coins: 30, count: 1 });
  run(world, 30, { moveX: 1 });
  for (const u of world.units) {
    assert.ok(Math.abs(u.x) <= FIELD.halfW + 1e-6, `x fuera: ${u.x}`);
    assert.ok(Number.isFinite(u.z) && Number.isFinite(u.hp));
  }
});

test('los nombres antiguos (soldado, tanque, recluta) siguen funcionando', () => {
  const { world, router } = setup({ cpu: { enabled: false }, tiers: [{ minCoins: 1, unit: 'soldado', coinsPerUnit: 1, maxPerGift: 10 }] });
  assert.deepEqual(router.unitsForGift('Rose', 1), { unit: 'caza', perGift: 1 });
  world.queueSpawn({ kind: 'tanque', team: TEAM.DEF }, 1);
  world.queueSpawn({ kind: 'recluta', team: TEAM.DEF }, 1);
  run(world, 0.3);
  assert.equal(count(world, TEAM.DEF, 'bombardero'), 1);
  assert.equal(count(world, TEAM.DEF, 'dron'), 1);
});
