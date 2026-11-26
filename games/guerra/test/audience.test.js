import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { PAISES } from '../public/js/data/paises.js';
import { GOLDEN } from '../public/js/data/golden.js';
import { UNIT_KINDS, buildRouter, createAudience, createFlow } from '../public/js/audience.js';
import { createNet, netStateOf } from '../public/js/net-status.js';
import { bridgeAlert, netChip } from '../public/js/ui/hud.js';
import { S } from '../public/js/ui/strings.js';

// Adaptador del público (lote 6b): traduce un evento normalizado del kit en los comandos que ya entiende el partido, con
// la misma forma que arma `tools/golden.mjs`. Frontera de confianza: valida tipo y rango de cada campo, ignora sin lanzar
// lo desconocido y nunca deja pasar texto del chat más que como el comando `chat` (NM-11, KIT-9, KIT-11, CB-13).

const registro = () => createRegistry({ teams: [PAISES[0], PAISES[1]] });
const montar = (game = {}) => {
  const registry = registro();
  const { router } = buildRouter(game);
  return { registry, audience: createAudience({ registry, router }) };
};
const usuario = (id, nick = 'Ana') => ({ userId: id, uniqueId: id, nickname: nick, avatar: '' });
const regalo = (id, coins, extra = {}) => ({
  type: 'gift',
  ...usuario(id),
  giftId: 'g1',
  giftName: 'Rose',
  coins,
  count: 1,
  image: '',
  ...extra,
});
const gente = (id, text) => ({ type: 'chat', ...usuario(id), text });
const unirse = (a, id, team) => a.registry.joinFromChat(gente(id, String(team)), 0, 0);

test('el router se arma UNA vez con las nueve unidades del juego y los tiers por defecto', () => {
  assert.deepEqual(UNIT_KINDS, [
    'soldado',
    'francotirador',
    'jeep',
    'blindado',
    'tanque',
    'lanzacohetes',
    'avion',
    'pesado',
    'lobo',
  ]);
  const { router, warnings } = buildRouter({});
  assert.deepEqual(warnings, []);
  assert.equal(router.tiers.length, 9);
  assert.throws(() =>
    buildRouter({
      tiers: [
        { minCoins: 5, unit: 'soldado', coinsPerUnit: 1 },
        { minCoins: 5, unit: 'jeep', coinsPerUnit: 1 },
      ],
    }),
  );
});

test('regalo: el equipo sale del registro y el comando es el de golden.mjs (gift con owner, coins y orders)', () => {
  const { registry, audience } = montar();
  unirse({ registry }, 'u1', 2);
  const r = audience.translate(regalo('u1', 29));
  assert.equal(r.cmd.type, 'gift');
  assert.equal(r.cmd.owner, 'u1');
  assert.equal(r.cmd.coins, 29);
  assert.deepEqual(r.cmd.orders, [{ kind: 'jeep', team: 2, owner: 'u1', count: 2, unitValue: 14.5, source: 'gift' }]);
  assert.equal(r.meta.kind, 'gift');
  assert.equal(r.meta.team, 2);
  assert.equal(r.meta.giftName, 'Rose');
});

test('regalo de alguien sin equipo: el registro le da uno (balance, sin azar) y queda en el feed como unión automática', () => {
  const { registry, audience } = montar();
  const r = audience.translate(regalo('nuevo', 5));
  assert.ok(r.cmd.orders[0].team === 1 || r.cmd.orders[0].team === 2);
  assert.equal(registry.get('nuevo').team, r.cmd.orders[0].team);
  assert.ok(registry.drain().some((e) => e.type === 'join' && e.auto === true));
});

test('los tiers: 1 moneda soldado, 29 monedas 2 jeeps, 100 tanque, 500 avión, 1000 pesado; big y trimmed salen del router', () => {
  const { audience } = montar();
  const k = (c) => audience.translate(regalo('u', c));
  assert.equal(k(1).cmd.orders[0].kind, 'soldado');
  const jeeps = k(29).cmd.orders[0];
  assert.deepEqual([jeeps.kind, jeeps.count], ['jeep', 2], '29 monedas: 2 jeeps');
  assert.equal(k(100).cmd.orders[0].kind, 'tanque');
  assert.equal(k(100).meta.big, true);
  assert.equal(k(500).cmd.orders[0].kind, 'avion');
  assert.equal(k(1000).cmd.orders[0].kind, 'pesado');
  assert.equal(k(1).meta.big, false);
  assert.equal(k(1).meta.trimmed, 0);
  const muchos = audience.translate(regalo('u', 5, { count: 999 }));
  assert.ok(muchos.meta.trimmed > 0, 'más de lo que permite el tope por evento');
  const suma = muchos.cmd.orders.reduce((s, o) => s + o.count * o.unitValue, 0);
  assert.ok(Math.abs(suma - muchos.cmd.coins) < 1e-6, 'lo pagado se conserva');
});

test('likes, follow y share: el equipo sale del registro; sin equipo no se encola nada (KIT-9)', () => {
  const { registry, audience } = montar();
  const like = { type: 'like', ...usuario('u1'), count: 40 };
  assert.equal(audience.translate(like), null);
  assert.equal(audience.translate({ type: 'follow', ...usuario('u1') }), null);
  assert.equal(audience.translate({ type: 'share', ...usuario('u1') }), null);
  unirse({ registry }, 'u1', 1);
  assert.deepEqual(audience.translate(like).cmd, { type: 'likes', team: 1, count: 40 });
  assert.deepEqual(audience.translate({ type: 'follow', ...usuario('u1') }).cmd, {
    type: 'follow',
    team: 1,
    owner: 'u1',
  });
  assert.deepEqual(audience.translate({ type: 'share', ...usuario('u1') }).cmd, {
    type: 'share',
    team: 1,
    owner: 'u1',
  });
});

test('chat: el comando es {type:"chat", evt} y evt trae solo los campos conocidos, con el texto acotado', () => {
  const { audience } = montar();
  const r = audience.translate({ ...gente('u1', 'x'.repeat(5000)), basura: 'no', image: 'no' });
  assert.equal(r.cmd.type, 'chat');
  assert.deepEqual(Object.keys(r.cmd.evt).sort(), ['avatar', 'nickname', 'text', 'type', 'uniqueId', 'userId']);
  assert.ok(r.cmd.evt.text.length <= 200);
});

test('la forma de cada comando coincide con la de golden.mjs (mismas claves por tipo)', () => {
  const { registry, audience } = montar();
  unirse({ registry }, 'u1', 1);
  const del = (tipo) => GOLDEN.log.find((e) => e.kind === 'evt' && e.payload.type === tipo).payload;
  const mios = {
    gift: audience.translate(regalo('u1', 3)).cmd,
    likes: audience.translate({ type: 'like', ...usuario('u1'), count: 5 }).cmd,
    follow: audience.translate({ type: 'follow', ...usuario('u1') }).cmd,
    share: audience.translate({ type: 'share', ...usuario('u1') }).cmd,
    chat: audience.translate(gente('u1', 'hola')).cmd,
  };
  for (const [tipo, cmd] of Object.entries(mios)) {
    assert.deepEqual(Object.keys(cmd).sort(), Object.keys(del(tipo)).sort(), tipo);
  }
  assert.deepEqual(
    Object.keys(mios.gift.orders[0]).sort(),
    Object.keys(del('gift').orders[0]).sort(),
    'las órdenes del regalo',
  );
});

test('lo desconocido o mal formado se ignora sin lanzar', () => {
  const { audience } = montar();
  const malos = [
    null,
    undefined,
    5,
    'texto',
    [],
    {},
    { type: 5 },
    { type: '__proto__' },
    { type: 'status', state: 'x' },
    { type: 'vote', userId: 'a' },
    { type: 'gift', ...usuario('a') },
    regalo('a', -5),
    regalo('a', 0),
    regalo('a', Number.NaN),
    regalo('a', Infinity),
    regalo('a', '30; drop'),
    { type: 'like', ...usuario('a'), count: Number.NaN },
    { type: 'like', ...usuario('a'), count: -3 },
  ];
  for (const m of malos)
    assert.doesNotThrow(() => assert.equal(audience.translate(m), null), String(JSON.stringify(m)));
});

test('números enormes se acotan, no se propagan: monedas, cantidades y likes', () => {
  const { registry, audience } = montar();
  unirse({ registry }, 'u1', 1);
  const g = audience.translate(regalo('u1', 1e300, { count: 1e9 }));
  assert.ok(Number.isFinite(g.cmd.coins) && g.cmd.coins <= 1e9 * 1e7);
  for (const o of g.cmd.orders) assert.ok(Number.isFinite(o.count) && Number.isFinite(o.unitValue));
  const l = audience.translate({ type: 'like', ...usuario('u1'), count: 1e12 });
  assert.ok(l.cmd.count <= 100000);
});

test('peor caso de nombres: bidi, ancho cero, emoji, CJK, 1 y 200 caracteres salen saneados del registro', () => {
  const { registry, audience } = montar();
  const nombres = ['‮Ana​_23', '😀'.repeat(24), '田中太郎さんの動画チャンネル', 'k', 'x'.repeat(200)];
  nombres.forEach((n, i) => audience.translate(regalo(`n${i}`, 5, { nickname: n })));
  assert.equal(registry.get('n0').name, 'Ana_23');
  for (let i = 0; i < nombres.length; i++) {
    const g = [...new Intl.Segmenter().segment(registry.get(`n${i}`).name)].length;
    assert.ok(g >= 1 && g <= 16, `n${i}: ${g} grafemas`);
  }
});

test('ráfagas: 3000 eventos repetidos y 5000 usuarios distintos no lanzan ni se pierden en el adaptador', () => {
  const { registry, audience } = montar();
  let n = 0;
  for (let i = 0; i < 3000; i++) if (audience.translate(regalo('u1', 5))) n++;
  for (let i = 0; i < 5000; i++) if (audience.translate(regalo(`m${i}`, 1))) n++;
  assert.equal(n, 8000);
  assert.equal(registry.users().length, 5001);
});

// ---------------------------------------------------------------------------------------------------------------
// Flujo: los eventos esperan al GET de la sesión (nota 48) y los efectos de vista salen del resultado

function flujo(extra = {}) {
  const { registry, audience } = montar();
  const log = [];
  const planes = [];
  const match = {
    world: {
      step: 7,
      field: {
        sides: [
          { exitX: 100, gates: [100, 400, 700] },
          { exitX: 1340, gates: [100, 400, 700] },
        ],
      },
    },
    pair: { teams: [{ name: 'Perú' }, { name: 'México' }] },
    command(c) {
      log.push(c);
      return { ok: true, orders: 2, queued: 1 };
    },
  };
  const grandes = [];
  const notas = [];
  const rig = { bigGift: (g, step) => grandes.push({ g, step }) };
  const banners = { note: (n) => notas.push(n) };
  const flow = createFlow({ audience, match, rig, banners, ...extra });
  return { flow, registry, log, grandes, notas, planes };
}

test('nota 48: los eventos que llegan antes del GET se aplican después, en orden y sin perder ninguno', () => {
  const { flow, log } = flujo();
  flow.push(gente('u1', '1'));
  flow.push(regalo('u1', 5));
  flow.push({ type: 'like', ...usuario('u1'), count: 10 });
  assert.equal(log.length, 0, 'nada se aplica mientras la sesión no resolvió');
  assert.equal(flow.pending(), 3);
  flow.ready();
  assert.deepEqual(
    log.map((c) => c.type),
    ['chat', 'gift', 'likes'],
  );
  assert.equal(flow.pending(), 0);
  flow.push(regalo('u1', 1));
  assert.equal(log.length, 4, 'ya con la sesión resuelta, se aplican al llegar');
  flow.ready();
  assert.equal(log.length, 4, 'ready() es idempotente');
});

test('la cola antes del GET tiene tope: al pasarse sale el más viejo y se cuenta', () => {
  const { flow, log } = flujo({ maxQueued: 3 });
  for (let i = 0; i < 5; i++) flow.push(regalo('u1', i + 1));
  assert.equal(flow.dropped(), 2);
  flow.ready();
  assert.deepEqual(
    log.map((c) => c.coins),
    [3, 4, 5],
  );
});

test('regalo grande: rig.bigGift con el nombre del regalo, en la unidad de la base; el avión no duplica el banner', () => {
  const { flow, grandes } = flujo();
  flow.ready();
  flow.push(regalo('u1', 100, { giftName: 'Hand Hearts' }));
  assert.equal(grandes.length, 1);
  assert.equal(grandes[0].step, 7);
  assert.equal(grandes[0].g.giftName, 'Hand Hearts');
  assert.equal(grandes[0].g.big, true);
  assert.equal(grandes[0].g.owner, 'u1');
  assert.ok(Number.isFinite(grandes[0].g.x) && Number.isFinite(grandes[0].g.y));
  flow.push(regalo('u2', 5));
  assert.equal(grandes.length, 1, 'un regalo chico no es un momento');
  flow.push(regalo('u3', 600, { giftName: 'Avión' }));
  assert.equal(grandes.length, 1, 'el avión da su banner al despegar, no aquí');
  const items = flow.nameBanners([
    { kind: 'plane', owner: 'u3' },
    { kind: 'plane', owner: 'otro' },
    { kind: 'gift', owner: 'u1' },
  ]);
  assert.equal(items[0].giftName, 'Avión');
  assert.equal(items[1].giftName, undefined);
  assert.equal(items[2].giftName, undefined);
});

test('regalo recortado: aviso en el feed con "máx. por regalo"; likes con refuerzos: aviso de refuerzos', () => {
  const { flow, notas, registry } = flujo();
  flow.ready();
  flow.push(regalo('u1', 5, { count: 999 }));
  assert.ok(notas.some((n) => n.kind === 'trim' && n.key === 'u1'));
  registry.joinFromChat(gente('u1', '1'), 0, 0);
  flow.push({ type: 'like', ...usuario('u1'), count: 900 });
  const r = notas.find((n) => n.kind === 'reinforce');
  assert.equal(r.count, 8, 'D1: la cuenta son los soldados que llegan (2 órdenes de 4), no los paquetes');
  assert.equal(r.teamName, 'Perú');
});

// ---------------------------------------------------------------------------------------------------------------
// Estado de la red (CB-17)

test('el estado de la red sale de lo que informa el puente: una prueba por estado', () => {
  assert.equal(netStateOf({ state: 'bridge' }), 'connecting');
  assert.equal(netStateOf({ state: 'conectando' }), 'connecting');
  assert.equal(netStateOf({ state: 'conectado', username: 'x' }), 'connected');
  assert.equal(netStateOf({ state: 'desconectado' }), 'reconnecting');
  assert.equal(netStateOf({ state: 'offline' }), 'reconnecting');
  assert.equal(netStateOf({ state: 'error', message: 'Falla de TikTok' }), 'reconnecting', 'un error que reintenta');
  assert.equal(
    netStateOf({ state: 'error', message: 'Falta instalar dependencias: ejecuta npm install.' }),
    'noDeps',
    'no se arregla solo',
  );
  assert.equal(netStateOf({ state: 'bridge-lost' }), 'lost');
  assert.equal(netStateOf({ state: 'sin-usuario' }), 'noUser');
  assert.equal(netStateOf({ state: 'algo-raro' }), null);
  assert.equal(netStateOf(null), null);
});

test('chip y aviso por estado: DEMO, Conectando, Conectado (3 s), Reconectando y el error de puente perdido', () => {
  const t = { now: 0 };
  const demo = createNet({ demo: true, clock: () => t.now });
  assert.equal(netChip(demo.view()).text, S.connection.demo);
  const net = createNet({ demo: false, clock: () => t.now });
  assert.equal(netChip(net.view()).text, S.connection.connecting, 'al empezar, conectando');
  net.set({ state: 'conectado' });
  assert.equal(netChip(net.view()).text, S.connection.connected);
  t.now = 4;
  assert.equal(netChip(net.view()), null, 'Conectado se va a los 3 s');
  net.set({ state: 'desconectado' });
  assert.equal(netChip(net.view()).text, S.connection.reconnecting);
  net.set({ state: 'bridge-lost' });
  assert.equal(bridgeAlert(net.view()).text, S.errors.bridgeLost);
  net.set({ state: 'algo-raro' });
  assert.equal(net.view().state, 'lost', 'un estado desconocido no cambia el anterior');
  t.now = 10;
  net.set({ state: 'bridge' });
  assert.equal(net.view().since, 0, 'cada cambio reinicia el contador');
});

test('el nombre del regalo del avión se entrega una sola vez por avión (un segundo banner del mismo dueño no lo hereda)', () => {
  const { flow } = flujo();
  flow.ready();
  flow.push(regalo('u3', 600, { giftName: 'Avión' }));
  assert.equal(flow.nameBanners([{ kind: 'plane', owner: 'u3' }])[0].giftName, 'Avión');
  assert.equal(flow.nameBanners([{ kind: 'plane', owner: 'u3' }])[0].giftName, undefined);
});

test('la cámara: un regalo es momento grande por monedas o porque el adaptador dice que es grande (big)', async () => {
  const { createHeat, createMoments } = await import('../public/js/camera/auto.js');
  const m = createMoments({ heat: createHeat(), coins: 500 });
  const ctx = { step: 1, reduced: false };
  assert.equal(m.gift({ coins: 100, x: 1, y: 1 }, ctx), null, 'chico: no es momento');
  assert.deepEqual(m.gift({ coins: 100, big: true, x: 1, y: 1, giftName: 'Hand Hearts' }, ctx), {
    banner: true,
    camera: true,
  });
  assert.equal(m.gift({ coins: 900, x: 1, y: 1 }, ctx).banner, true);
  const items = m.drainBanners();
  assert.equal(items.length, 2);
  assert.equal(items[0].giftName, 'Hand Hearts');
  assert.equal(m.drainBanners().length, 0, 'se vacían una vez');
});

test('C6: los errores que no se arreglan solos dicen qué falló y cómo arreglarlo, sin "Reconectando…"', () => {
  const net = createNet({ demo: false, clock: () => 0 });
  net.set({ state: 'error', message: 'Falta instalar dependencias: ejecuta npm install.' });
  assert.equal(netChip(net.view()).text, S.connection.noConnection);
  assert.match(bridgeAlert(net.view()).text, /npm install/);
  net.set({ state: 'sin-usuario' });
  assert.equal(netChip(net.view()).text, S.connection.noUser);
  assert.match(bridgeAlert(net.view()).text, /config\.json/);
  assert.notEqual(netChip(net.view()).text, S.connection.reconnecting);
});
