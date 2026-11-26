import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_LEVELS,
  autoCount,
  buildChat,
  buildGift,
  buildLike,
  buildSocial,
  buildUser,
  panelModel,
  pickAuto,
} from '@tienda/kit/client/simulator-events.js';
import { mulberry32 } from '@tienda/kit/sim/rng.js';

// Config del juego tal como la lee el panel: equipos, regalos del simulador y overrides.
const CONFIG = {
  teams: [
    { id: 'pe', name: 'Perú', aliases: ['peru', 'peruano'] },
    { id: 'mx', name: 'México', aliases: ['mexico'] },
  ],
  giftOverrides: { Rosa: { unit: 'tanque', count: 2 } },
  simulator: {
    gifts: [
      { name: 'Corazón', coins: 5 },
      { name: 'Avión', coins: 500, id: '9001' },
    ],
  },
};

const USER = { userId: 'sim_ana', uniqueId: 'ana', nickname: 'Ana', avatar: '' };

test('KIT-27: buildGift con coins 5 por 2 hace deepEqual al contrato LiveEvent', () => {
  const ev = buildGift(USER, { id: '77', name: 'Corazón', coins: 5, image: 'img.png' }, 2);
  assert.deepEqual(ev, {
    type: 'gift',
    userId: 'sim_ana',
    uniqueId: 'ana',
    nickname: 'Ana',
    avatar: '',
    giftId: '77',
    giftName: 'Corazón',
    coins: 5,
    count: 2,
    image: 'img.png',
  });
});

test('KIT-27: buildGift pone valores por defecto razonables y corrige cantidades raras', () => {
  const ev = buildGift(USER, { name: 'Rosa', coins: 1 });
  assert.equal(ev.count, 1);
  assert.equal(ev.image, '');
  assert.equal(typeof ev.giftId, 'string');
  assert.ok(ev.giftId.length > 0);
  for (const bad of [0, -3, Number.NaN, 'x', undefined]) {
    assert.equal(buildGift(USER, { name: 'Rosa', coins: 1 }, bad).count, 1, String(bad));
  }
  assert.equal(buildGift(USER, { name: 'Rosa', coins: 1 }, 4.9).count, 4);
  assert.equal(buildGift(USER, { name: 'Rosa', coins: 0 }).coins, 1, 'las monedas nunca bajan de 1');
});

test('KIT-27: buildChat, buildLike y buildSocial siguen el contrato', () => {
  assert.deepEqual(buildChat(USER, 'peru'), { type: 'chat', ...USER, text: 'peru' });
  assert.deepEqual(buildLike(USER, 100), { type: 'like', ...USER, count: 100 });
  assert.equal(buildLike(USER, 0).count, 1);
  assert.deepEqual(buildSocial(USER, 'follow'), { type: 'follow', ...USER });
  assert.deepEqual(buildSocial(USER, 'share'), { type: 'share', ...USER });
  assert.throws(() => buildSocial(USER, 'member2'), TypeError);
  // el texto siempre es una cadena
  assert.equal(buildChat(USER, undefined).text, '');
});

test('KIT-27: buildUser arma un usuario simulado estable y no repite campos entre usuarios distintos', () => {
  assert.deepEqual(buildUser('ana'), { userId: 'sim_ana', uniqueId: 'ana', nickname: 'ana', avatar: '' });
  assert.notEqual(buildUser('a').userId, buildUser('b').userId);
  // nombres largos, emoji y otros alfabetos pasan tal cual: el saneado es del registro (KIT-11), no del emisor
  const rare = '👨‍👩‍👧‍👦'.repeat(20) + 'Привет' + 'x'.repeat(200);
  assert.equal(buildUser(rare).nickname, rare);
});

test('KIT-27: panelModel toma equipos, palabras y regalos de la config (Perú/México, Rosa, Avión)', () => {
  const m = panelModel(CONFIG);
  assert.deepEqual(
    m.teams.map((t) => [t.team, t.label, t.word]),
    [
      [1, 'Perú', 'peru'],
      [2, 'México', 'mexico'],
    ],
  );
  const names = m.gifts.map((g) => g.name);
  assert.ok(names.includes('Rosa'));
  assert.ok(names.includes('Avión'));
  assert.ok(names.includes('Corazón'));
  assert.equal(new Set(names).size, names.length, 'sin regalos repetidos');
  assert.equal(m.gifts.find((g) => g.name === 'Avión').coins, 500);
  assert.equal(m.gifts.find((g) => g.name === 'Avión').id, '9001');
  assert.equal(m.gifts.find((g) => g.name === 'Rosa').coins, 1);
  // ordenados de menos a más monedas
  const coins = m.gifts.map((g) => g.coins);
  assert.deepEqual(
    coins,
    [...coins].sort((a, b) => a - b),
  );
});

test('KIT-27: panelModel sin botones de voto del chat y con el nivel "tráfico máximo"', () => {
  const m = panelModel(CONFIG);
  assert.deepEqual(Object.keys(m).sort(), ['auto', 'gifts', 'teams']);
  assert.doesNotMatch(JSON.stringify(m), /vot|"1"|Comentar/i);
  assert.deepEqual(
    m.auto.map((l) => l.id),
    ['off', 'low', 'mid', 'high', 'max'],
  );
  assert.equal(m.auto.at(-1).label, 'Tráfico máximo');
  assert.deepEqual(Object.keys(AUTO_LEVELS).sort(), ['high', 'low', 'max', 'mid']);
});

test('KIT-27: panelModel cambia con la config (no hay nombres fijos) y tolera configs vacías', () => {
  const m = panelModel({
    teams: [
      { id: 'cl', name: 'Chile', aliases: [] },
      { id: 'ar', name: 'Argentina' },
    ],
  });
  assert.deepEqual(
    m.teams.map((t) => t.label),
    ['Chile', 'Argentina'],
  );
  // sin alias la palabra de unión es el número del equipo
  assert.deepEqual(
    m.teams.map((t) => t.word),
    ['1', '2'],
  );
  assert.equal(panelModel({}).teams.length, 0);
  assert.equal(panelModel(undefined).gifts.length, 0);
  assert.doesNotMatch(JSON.stringify(m), /Perú|México|Rosa|Avión/);
  // override "id:" sin nombre no inventa un regalo
  assert.equal(panelModel({ giftOverrides: { 'id:5655': { unit: 'tanque', count: 1 } } }).gifts.length, 0);
});

test('KIT-27: nombres de equipo extremos pasan al botón sin tocarlos', () => {
  const name = 'Ñandú 🇵🇪 ' + 'x'.repeat(300);
  const m = panelModel({ teams: [{ id: 'a', name, aliases: ['ñandú'] }] });
  assert.equal(m.teams[0].label, name);
});

const AUTO_CFG = { ...panelModel(CONFIG), names: ['ana', 'luis', 'mari'] };
const run = (seed, level, n = 300) => {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push(...pickAuto(rng, { ...AUTO_CFG, level }));
  return out;
};

test('KIT-27: pickAuto es repetible con la misma semilla y distinto con otra', () => {
  assert.deepEqual(run(42, 'mid'), run(42, 'mid'));
  assert.notDeepEqual(run(42, 'mid'), run(43, 'mid'));
});

test('KIT-27: pickAuto solo produce eventos del contrato, con palabras y regalos de la config, sin bandera "simulated"', () => {
  const events = run(7, 'mid', 500);
  assert.ok(events.length >= 500);
  const types = new Set(events.map((e) => e.type));
  for (const t of types) assert.ok(['chat', 'gift', 'like', 'follow', 'share'].includes(t), t);
  for (const t of ['chat', 'gift', 'like']) assert.ok(types.has(t), `aparece ${t}`);
  const words = new Set(AUTO_CFG.teams.map((t) => t.word));
  for (const e of events) {
    assert.ok(!Object.keys(e).some((k) => /simul|fake|auto/i.test(k)), 'sin marca de simulado');
    assert.match(e.userId, /^sim_/);
    if (e.type === 'chat') assert.ok(words.has(e.text), `palabra de la config: ${e.text}`);
    if (e.type === 'gift') {
      const g = AUTO_CFG.gifts.find((x) => x.name === e.giftName);
      assert.ok(g, e.giftName);
      assert.equal(e.coins, g.coins);
      assert.ok(Number.isInteger(e.count) && e.count >= 1);
    }
  }
});

test('KIT-27: un regalo automático va precedido de la unión al equipo, de la misma persona', () => {
  const events = run(11, 'mid', 400);
  const i = events.findIndex((e) => e.type === 'gift');
  assert.ok(i > 0);
  assert.equal(events[i - 1].type, 'chat');
  assert.equal(events[i - 1].userId, events[i].userId);
});

test('KIT-27: el nivel "máximo" manda más regalos, y los caros, que el medio', () => {
  const mid = run(5, 'mid', 400);
  const max = run(5, 'max', 400);
  const gifts = (list) => list.filter((e) => e.type === 'gift');
  assert.ok(gifts(max).length > gifts(mid).length);
  assert.ok(gifts(max).some((e) => e.giftName === 'Avión'));
  assert.ok(gifts(max).some((e) => e.giftName === 'Corazón'));
});

test('KIT-27: autoWeight baja el peso de un regalo en los niveles medio y alto, no en "máximo" ni en los botones manuales', () => {
  const gifts = [
    { name: 'Rosa', coins: 1 },
    { name: 'A', coins: 5 },
    { name: 'B', coins: 30 },
    { name: 'Avión', coins: 500, autoWeight: 0.2 },
    { name: 'Gran', coins: 1000 },
  ];
  const model = panelModel({ teams: CONFIG.teams, simulator: { gifts } });
  assert.equal(model.gifts.find((g) => g.name === 'Avión').autoWeight, 0.2, 'el modelo lo conserva');
  const cuenta = (level, g) => {
    const rng = mulberry32(9);
    let n = 0;
    for (let i = 0; i < 6000; i++)
      for (const e of pickAuto(rng, { ...model, names: ['ana'], level }))
        if (e.type === 'gift' && e.giftName === g) n++;
    return n;
  };
  const sin = (level) => {
    const m = panelModel({
      teams: CONFIG.teams,
      simulator: { gifts: gifts.map((g) => ({ name: g.name, coins: g.coins })) },
    });
    const rng = mulberry32(9);
    let n = 0;
    for (let i = 0; i < 6000; i++)
      for (const e of pickAuto(rng, { ...m, names: ['ana'], level }))
        if (e.type === 'gift' && e.giftName === 'Avión') n++;
    return n;
  };
  for (const level of ['mid', 'high']) assert.ok(cuenta(level, 'Avión') < sin(level) * 0.5, `${level}: pesa menos`);
  assert.equal(cuenta('max', 'Avión'), sin('max'), '"máximo" no cambia');
  assert.ok(cuenta('mid', 'Avión') > 0, 'sigue saliendo alguno');
});

test('KIT-27: pickAuto sin regalos ni equipos no lanza y devuelve solo lo posible', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 100; i++) {
    const out = pickAuto(rng, { teams: [], gifts: [], level: 'mid' });
    for (const e of out) assert.ok(['like', 'follow', 'share'].includes(e.type), e.type);
  }
  assert.deepEqual(pickAuto(mulberry32(1), undefined).length > 0, true);
});

test('KIT-27: autoCount da lo esperado por nivel, repetible y 0 para "off"', () => {
  const total = (level) => {
    const rng = mulberry32(3);
    let n = 0;
    for (let i = 0; i < 1000; i++) n += autoCount(rng, level);
    return n;
  };
  assert.equal(total('off'), 0);
  assert.equal(total('desconocido'), 0);
  assert.ok(total('low') < total('mid') && total('mid') < total('high') && total('high') < total('max'));
  assert.equal(total('mid'), total('mid'));
  assert.ok(total('max') >= 3000, 'el máximo da varios eventos por vuelta');
});

test('KIT-27: autoWeight también reparte entre los dos regalos más caros (el "grande"), y sin pesos sigue siendo el más caro', () => {
  const regalos = (heroe) => [
    { name: 'Rosa', coins: 1 },
    { name: 'A', coins: 5 },
    { name: 'Gran', coins: 1000, ...(heroe ? { autoWeight: 0.4 } : {}) },
    { name: 'Héroe', coins: 3000, ...(heroe ? { autoWeight: 0.05 } : {}) },
  ];
  const cuentaGrandes = (heroe, level) => {
    const m = panelModel({ teams: CONFIG.teams, simulator: { gifts: regalos(heroe) } });
    const rng = mulberry32(5);
    const n = { Gran: 0, Héroe: 0 };
    for (let i = 0; i < 20000; i++)
      for (const e of pickAuto(rng, { ...m, names: ['ana'], level }))
        if (e.type === 'gift' && e.giftName in n && e.coins >= 1000) n[e.giftName]++;
    return n;
  };
  const con = cuentaGrandes(true, 'mid');
  assert.ok(con.Héroe > 0 && con.Héroe < con.Gran * 0.2, `con pesos el héroe sale poco: ${JSON.stringify(con)}`);
  // sin pesos, el "grande" (5 % de los eventos) es siempre el más caro: el héroe sale mucho más que con pesos
  const sin = cuentaGrandes(false, 'mid');
  assert.ok(sin.Héroe > con.Héroe * 3, `sin pesos: ${JSON.stringify(sin)}`);
  const max = cuentaGrandes(true, 'max');
  assert.ok(max.Héroe > con.Héroe * 3, `"máximo" no usa pesos: ${JSON.stringify(max)}`);
});
