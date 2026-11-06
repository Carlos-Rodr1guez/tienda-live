import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { createBlocklist, ANON } from '@tienda/kit/sim/names.js';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { hashKey } from '@tienda/kit/sim/words.js';

// Banderas por escape: ningún archivo del kit lleva indicadores regionales literales.
const FLAG = (iso) => [...iso].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru', 'peruano'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico', 'mexicano'] };
const CL = { id: 'cl', name: 'Chile', iso: 'CL', aliases: ['chileno'], firstOnly: ['chile'] };
const CR = { id: 'cr', name: 'Costa Rica', iso: 'CR', aliases: ['costarica'] };
const SV = { id: 'sv', name: 'El Salvador', iso: 'SV', aliases: ['elsalvador'] };

const make = (extra = {}) => createRegistry({ teams: [PE, MX], ...extra });
const chat = (id, text, extra = {}) => ({ type: 'chat', userId: id, nickname: 'U' + id, text, ...extra });

test('KIT-5: tres equipos caen en su posición y teamSizes tiene largo 3', () => {
  const r = createRegistry({ teams: [PE, MX, CL] });
  const joined = ['3', '1', '2'].map((n) => r.joinFromChat(chat('u' + n, n), 0, 1).team);
  assert.deepEqual(joined, [3, 1, 2]);
  assert.deepEqual(r.teamSizes(), [1, 1, 1]);
});

test('KIT-5: el equipo 0 o mayor que N no existe', () => {
  const r = make();
  assert.equal(r.joinFromChat(chat('a', '0'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('b', '3'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('c', '02'), 0, 1), null);
});

test('KIT-7: un alias compartido entre equipos lanza ConfigError con el alias', () => {
  const a = { id: 'a', name: 'A', aliases: ['guinea'] };
  const b = { id: 'b', name: 'B', aliases: ['Guinea'] };
  assert.throws(
    () => createRegistry({ teams: [a, b] }),
    (e) => e instanceof ConfigError && e.message === 'alias "guinea" repetido entre equipos',
  );
  // también entre un alias firstOnly y uno normal
  assert.throws(
    () => createRegistry({ teams: [a, { id: 'c', name: 'C', aliases: [], firstOnly: ['guínea'] }] }),
    ConfigError,
  );
});

test('KIT-7: un alias numérico suelto, menos de 2 equipos o equipos mal formados se rechazan', () => {
  assert.throws(() => createRegistry({ teams: [PE, { id: 'x', name: 'X', aliases: ['2'] }] }), ConfigError);
  assert.throws(() => createRegistry({ teams: [PE, { id: 'x', name: 'X', aliases: ['２'] }] }), ConfigError);
  assert.throws(() => createRegistry({ teams: [PE] }), ConfigError);
  assert.throws(() => createRegistry({ teams: [] }), ConfigError);
  assert.throws(() => createRegistry({}), ConfigError);
  assert.throws(() => createRegistry({ teams: [PE, { ...PE }] }), ConfigError);
  assert.throws(() => createRegistry({ teams: [PE, { id: 'x', name: 'X', aliases: ['!!!'] }] }), ConfigError);
});

test('KIT-6: número, nombre, acentos y mayúsculas', () => {
  const r = make();
  const got = [
    r.joinFromChat(chat('a', '1'), 0, 1),
    r.joinFromChat(chat('b', 'PERÚ'), 0, 1),
    r.joinFromChat(chat('c', '  México!!! '), 0, 1),
    r.joinFromChat(chat('d', '2 vamos'), 0, 1),
    r.joinFromChat(chat('e', '２'), 0, 1),
  ].map((e) => e.team);
  assert.deepEqual(got, [1, 1, 2, 2, 2]);
  assert.deepEqual(r.joinFromChat(chat('z', 'quiero perú'), 0, 1), {
    type: 'join',
    key: 'z',
    team: 1,
    switched: false,
    auto: false,
    freeUnit: true,
  });
});

test('KIT-6: un número en posición tardía no une y no crea soldado ni usuario', () => {
  const r = make();
  assert.equal(r.joinFromChat(chat('a', 'tengo 2 gatos'), 0, 1), null);
  assert.equal(r.get('a'), undefined);
  assert.equal(r.users().length, 0);
  assert.deepEqual(r.drain(), []);
});

test('KIT-6: una bandera une, la de un país que no juega no hace nada', () => {
  const r = make();
  assert.equal(r.joinFromChat(chat('a', FLAG('PE')), 0, 1).team, 1);
  assert.equal(r.joinFromChat(chat('b', FLAG('CL')), 0, 1), null);
  assert.equal(r.joinFromChat(chat('c', `vamos ${FLAG('MX')}`), 0, 1).team, 2);
  assert.equal(r.joinFromChat(chat('d', `${FLAG('PE')}${FLAG('MX')}`), 0, 1).team, 1);
  assert.equal(r.get('b'), undefined);
});

test('KIT-6: un alias firstOnly une solo como primer token', () => {
  const r = createRegistry({ teams: [MX, CL] });
  assert.equal(r.joinFromChat(chat('a', 'me encanta el chile'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('b', 'chile con carne'), 0, 1).team, 2);
  assert.equal(r.joinFromChat(chat('c', 'vamos chileno'), 0, 1).team, 2);
});

test('KIT-6: gana el primer token ("peru vs mexico")', () => {
  const r = make();
  assert.equal(r.joinFromChat(chat('a', 'peru vs mexico'), 0, 1).team, 1);
  assert.equal(r.joinFromChat(chat('b', 'mexico vs peru'), 0, 1).team, 2);
});

test('KIT-6: la concatenación de dos tokens une en cualquier posición', () => {
  const r = createRegistry({ teams: [CR, SV] });
  assert.equal(r.joinFromChat(chat('a', 'costa rica'), 0, 1).team, 1);
  assert.equal(r.joinFromChat(chat('b', 'el salvador'), 0, 1).team, 2);
  assert.equal(r.joinFromChat(chat('c', 'vamos costa rica ya'), 0, 1).team, 1);
  assert.equal(r.joinFromChat(chat('d', 'quiero el salvador'), 0, 1).team, 2);
});

test('KIT-6: el token se compara entero, nunca como subcadena', () => {
  const r = make();
  assert.equal(r.joinFromChat(chat('a', 'peruanisimos'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('b', 'imperu'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('c', 'mexicanos'), 0, 1), null);
  assert.equal(r.joinFromChat(chat('d', 'peruano'), 0, 1).team, 1);
});

test('KIT-10: la clave cae a userId, uniqueId, nickname y "anon"', () => {
  const r = make();
  assert.equal(r.touch({ userId: 'id1', uniqueId: 'u', nickname: 'n' }).key, 'id1');
  assert.equal(r.touch({ uniqueId: 'u', nickname: 'n' }).key, 'u');
  const u = r.touch({ nickname: 'Solo Nick' });
  assert.equal(u.key, 'Solo Nick');
  assert.equal(r.touch({ nickname: 'Solo Nick' }), u);
  assert.equal(r.touch({}).key, 'anon');
});

test('KIT-11: todo evento se sanea al entrar', () => {
  const r = make();
  const u = r.touch({ userId: 'a', nickname: '‮Ana​‍_23\u0007' });
  assert.equal(u.name, 'Ana_23');
  assert.equal(r.displayName('a'), 'Ana_23');
  r.touch({ userId: 'a', nickname: 'Lu \u{1F1F5}\u{1F1EA}' });
  assert.equal(r.displayName('a'), 'Lu');
  assert.equal(r.touch({ userId: 'b' }).name, ANON);
  assert.equal(r.touch({ userId: 'c', nickname: 'x'.repeat(60) }).name.length, 16);
  assert.equal(r.touch({ userId: 'd', nickname: 'x', avatar: 42 }).avatar, '');
});

test('KIT-12: nombre vetado se muestra "anónimo" pero conserva el crédito bajo la clave real', () => {
  const r = make({ blocklist: createBlocklist({ contains: ['badword'] }) });
  r.touch({ userId: 'u9', nickname: 'B4dW0rd', avatar: 'https://x/a.png' });
  r.addCoins('u9', 100, 5);
  assert.equal(r.displayName('u9'), ANON);
  assert.equal(r.avatarOf('u9'), '');
  assert.equal(r.get('u9').coins.live, 100);
  assert.equal(r.get('u9').blocked, true);
  r.touch({ userId: 'ok', nickname: 'Ana', avatar: 'https://x/b.png' });
  assert.equal(r.displayName('ok'), 'Ana');
  assert.equal(r.avatarOf('ok'), 'https://x/b.png');
  // si el nombre pasa a uno limpio, se levanta la máscara
  r.touch({ userId: 'u9', nickname: 'Luz' });
  assert.equal(r.displayName('u9'), 'Luz');
});

test('KIT-12: sin lista de nombres vetados nada se enmascara', () => {
  const r = make({ blocklist: null });
  r.touch({ userId: 'a', nickname: 'B4dW0rd' });
  assert.equal(r.displayName('a'), 'B4dW0rd');
  assert.equal(make({ blocklist: createBlocklist(undefined) }).touch({ userId: 'a', nickname: 'x' }).blocked, false);
});

test('KIT-10: monedas LIVE/partido/ronda, bajas y valor destruido; sin pasos negativos', () => {
  const r = make();
  r.touch({ userId: 'a', nickname: 'A' });
  r.addCoins('a', 50, 1);
  r.addCoins('a', -20, 2);
  r.addCoins('a', NaN, 2);
  r.addDestroyed('a', 12.5, 3);
  r.addKill('a');
  r.addKill('a');
  r.addCoins('desconocido', 5, 1);
  const u = r.get('a');
  assert.deepEqual(u.coins, { live: 50, match: 50, round: 50 });
  assert.deepEqual(u.value, { live: 12.5, match: 12.5, round: 12.5 });
  assert.deepEqual(u.kills, { live: 2, match: 2, round: 2 });
  assert.equal(r.get('desconocido'), undefined);
  r.startRound(2);
  assert.deepEqual(r.get('a').coins, { live: 50, match: 50, round: 0 });
  r.addCoins('a', 10, 4);
  r.startMatch();
  assert.deepEqual(r.get('a').coins, { live: 60, match: 0, round: 0 });
  assert.deepEqual(r.get('a').value, { live: 12.5, match: 0, round: 0 });
});

test('KIT-8: el cambio se bloquea a t=110 y se acepta a t=116 con cooldown de 15 s', () => {
  const r = make({ switchCooldownSeconds: 15 });
  assert.equal(r.joinFromChat(chat('a', 'peru'), 100, 1).team, 1);
  assert.equal(r.joinFromChat(chat('a', 'mexico'), 110, 1), null);
  assert.equal(r.get('a').team, 1);
  const ev = r.joinFromChat(chat('a', 'mexico'), 116, 1);
  assert.deepEqual(ev, { type: 'join', key: 'a', team: 2, switched: true, auto: false, freeUnit: false });
  assert.deepEqual(r.teamSizes(), [0, 1]);
  // el primer ingreso no tiene cooldown
  assert.equal(r.joinFromChat(chat('b', 'peru'), 0.5, 1).team, 1);
});

test('KIT-8: allowSwitch:false impide cambiar de equipo', () => {
  const r = make({ allowSwitch: false });
  assert.equal(r.joinFromChat(chat('a', 'peru'), 0, 1).team, 1);
  assert.equal(r.joinFromChat(chat('a', 'mexico'), 1000, 1), null);
  assert.equal(r.get('a').team, 1);
});

test('KIT-8: pedir el mismo equipo no da unidad gratis dos veces en la misma ronda', () => {
  const r = make();
  r.joinFromChat(chat('a', 'peru'), 0, 1);
  assert.equal(r.joinFromChat(chat('a', 'peru'), 5, 1), null);
  const ev = r.joinFromChat(chat('a', 'peru'), 90, 2);
  assert.deepEqual(ev, { type: 'join', key: 'a', team: 1, switched: false, auto: false, freeUnit: true });
});

test('KIT-9: balance manda al equipo con menos miembros', () => {
  const r = make();
  for (const [id, t] of [
    ['a', 'peru'],
    ['b', 'peru'],
    ['c', 'peru'],
    ['d', 'mexico'],
    ['e', 'mexico'],
  ]) {
    r.joinFromChat(chat(id, t), 0, 1);
  }
  assert.deepEqual(r.teamSizes(), [3, 2]);
  const donor = r.touch({ userId: 'donor', nickname: 'Don' });
  assert.equal(r.ensureTeam(donor), 2);
  assert.equal(donor.team, 2);
  assert.deepEqual(r.teamSizes(), [3, 3]);
  // quien ya tiene equipo lo conserva
  assert.equal(r.ensureTeam(donor), 2);
});

test('KIT-9: el empate se resuelve con hashKey(clave) % empatados, repetible y sin RNG', () => {
  const claves = ['u1', 'u2', 'Ana', 'Luis', 'x', 'y', 'zeta', '\u{1F600}'];
  const run = () => {
    const r = make();
    return claves.map((k) => r.ensureTeam(r.touch({ userId: k, nickname: k })));
  };
  assert.deepEqual(run(), run());
  // la primera asignación sale de un empate 0-0: depende solo de la clave
  for (const k of claves) {
    const r = make();
    assert.equal(r.ensureTeam(r.touch({ userId: k })), (hashKey(k) % 2) + 1);
  }
  const r = createRegistry({ teams: [PE, MX, CL] });
  assert.equal(r.ensureTeam(r.touch({ userId: 'k' })), (hashKey('k') % 3) + 1);
  // con 3 equipos y un empate parcial, solo compiten los empatados
  const r3 = createRegistry({ teams: [PE, MX, CL] });
  r3.joinFromChat(chat('p', 'peru'), 0, 1);
  const t = r3.ensureTeam(r3.touch({ userId: 'q' }));
  assert.equal(t, [2, 3][hashKey('q') % 2]);
});

test('KIT-9: política con un equipo fijo', () => {
  const r = make({ policy: 'mx' });
  assert.equal(r.ensureTeam(r.touch({ userId: 'a' })), 2);
  assert.equal(r.ensureTeam(r.touch({ userId: 'b' })), 2);
  assert.throws(() => make({ policy: 'nadie' }), ConfigError);
});

test('KIT-9: la asignación automática deja un join con auto:true', () => {
  const r = make();
  r.ensureTeam(r.touch({ userId: 'a' }));
  const [ev] = r.drain();
  assert.equal(ev.type, 'join');
  assert.equal(ev.auto, true);
  assert.equal(ev.freeUnit, false);
});

test('KIT-13: hide pone "anónimo" en el nombre y en el avatar, sin tocar el crédito', () => {
  const r = make();
  r.touch({ userId: 'd', nickname: 'Donante', avatar: 'https://x/d.png' });
  r.addCoins('d', 77, 1);
  r.hide('d');
  assert.equal(r.displayName('d'), ANON);
  assert.equal(r.avatarOf('d'), '');
  assert.equal(r.get('d').coins.live, 77);
  // ocultar antes de que el usuario exista también vale
  r.hide('futuro');
  r.touch({ userId: 'futuro', nickname: 'Luego' });
  assert.equal(r.displayName('futuro'), ANON);
  // un evento nuevo no revela el nombre real
  r.touch({ userId: 'd', nickname: 'Donante' });
  assert.equal(r.displayName('d'), ANON);
});

test('KIT-13: setAllNamesHidden oculta todo y al volver a false restaura los nombres saneados', () => {
  const r = make();
  r.touch({ userId: 'a', nickname: '​Ana', avatar: 'https://x/a.png' });
  r.touch({ userId: 'b', nickname: 'Bea' });
  assert.equal(r.allNamesHidden(), false);
  r.setAllNamesHidden(true);
  assert.equal(r.allNamesHidden(), true);
  assert.equal(r.displayName('a'), ANON);
  assert.equal(r.displayName('b'), ANON);
  assert.equal(r.avatarOf('a'), '');
  r.setAllNamesHidden(false);
  assert.equal(r.displayName('a'), 'Ana');
  assert.equal(r.avatarOf('a'), 'https://x/a.png');
  assert.equal(r.displayName('nadie'), ANON);
});

test('KIT-13: ninguna lista de ocultos se expone', () => {
  const r = make();
  r.hide('a');
  const api = Object.keys(r);
  assert.ok(!api.some((k) => /hidden(List|Keys|Set)|listHidden/i.test(k)), api.join());
  assert.equal(typeof r.hidden, 'undefined');
  assert.ok(!JSON.stringify(r.users()).includes('"a"'));
});

test('KIT-13: ninguna escritura a disco (fs espiado) y drain entrega los join', () => {
  const espiados = [];
  for (const [obj, names] of [
    [fs, ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'write', 'writeSync']],
    [fs.promises, ['writeFile', 'appendFile']],
  ]) {
    for (const n of names) espiados.push(mock.method(obj, n, () => {}));
  }
  let llamadas;
  try {
    const r = make({ blocklist: createBlocklist({ contains: ['badword'] }) });
    r.joinFromChat(chat('a', 'peru'), 0, 1);
    r.joinFromChat(chat('b', 'mexico'), 0, 1);
    r.touch({ userId: 'c', nickname: 'B4dW0rd' });
    r.addCoins('a', 10, 1);
    r.hide('a');
    r.setAllNamesHidden(true);
    r.startRound(2);
    r.startMatch();
    const joins = r.drain();
    assert.deepEqual(
      joins.map((e) => [e.type, e.key, e.team]),
      [
        ['join', 'a', 1],
        ['join', 'b', 2],
      ],
    );
    assert.deepEqual(r.drain(), []);
  } finally {
    llamadas = espiados.reduce((n, m) => n + m.mock.callCount(), 0);
    mock.restoreAll();
  }
  assert.equal(llamadas, 0);
});

test('KIT-13: los eventos de drain llevan la clave y nunca el nombre', () => {
  const r = make();
  r.joinFromChat(chat('a', 'peru', { nickname: 'Nombre Real' }), 0, 1);
  const [ev] = r.drain();
  assert.ok(!JSON.stringify(ev).includes('Nombre Real'));
  assert.deepEqual(Object.keys(ev).sort(), ['auto', 'freeUnit', 'key', 'switched', 'team', 'type']);
});
