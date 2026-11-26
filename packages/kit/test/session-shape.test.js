import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_LIMITS,
  isSessionKey,
  isSessionUser,
  jsonStringBytes,
  readSessionUser,
  sessionUserBytes,
} from '@tienda/kit/sim/session-shape.js';

// KIT-28: la forma de un usuario de la copia vive en UN módulo puro que usan el servidor (para rechazar) y la página
// (para filtrar ANTES de enviar). Y la cuenta exacta de bytes UTF-8 de su JSON, sin serializarlo (C3).

const enc = new TextEncoder();
const bytes = (s) => enc.encode(s).length;
const user = (key = 'a', extra = {}) => ({
  key,
  name: 'N' + key,
  team: 1,
  lastSwitch: -1e9,
  coins: { live: 1, match: 1 },
  value: { live: 0, match: 0 },
  xp: { live: 1, match: 1 },
  kills: { live: 0, match: 0 },
  firstXpAt: 3,
  ...extra,
});

test('los límites son los del servidor y el registro', () => {
  assert.deepEqual(SESSION_LIMITS, {
    version: 1,
    maxUsers: 20000,
    maxKey: 512,
    maxName: 512,
    maxTeam: 64,
    maxCount: 1e12,
  });
  assert.ok(Object.isFrozen(SESSION_LIMITS));
});

test('readSessionUser: un usuario válido vuelve copiado en orden canónico, solo con los campos conocidos', () => {
  const sucio = { ...user('a'), evil: 1, avatar: 'http://x', xp: { live: 1, match: 1, otro: 9 } };
  const limpio = readSessionUser(sucio);
  assert.deepEqual(limpio, user('a'));
  assert.deepEqual(Object.keys(limpio), [
    'key',
    'name',
    'team',
    'lastSwitch',
    'coins',
    'value',
    'xp',
    'kills',
    'firstXpAt',
  ]);
  assert.notEqual(limpio.xp, sucio.xp);
  limpio.xp.live = 99;
  assert.equal(sucio.xp.live, 1);
});

test('readSessionUser: rechaza cada forma inválida con null', () => {
  const malos = [
    null,
    undefined,
    'x',
    5,
    [],
    user(''),
    user(7),
    user('k'.repeat(513), { name: 'n' }),
    user('a', { name: 5 }),
    user('a', { name: 'n'.repeat(513) }),
    user('a', { team: 'uno' }),
    user('a', { team: 0 }),
    user('a', { team: 65 }),
    user('a', { team: 1.5 }),
    user('a', { lastSwitch: Infinity }),
    user('a', { lastSwitch: 1e13 }),
    user('a', { firstXpAt: 'x' }),
    user('a', { firstXpAt: Infinity }),
    user('a', { xp: undefined }),
    user('a', { xp: { live: -1, match: 0 } }),
    user('a', { coins: { live: '1', match: 1 } }),
    user('a', { value: { live: NaN, match: 0 } }),
    user('a', { kills: { live: 1e13, match: 0 } }),
  ];
  for (const m of malos) assert.equal(readSessionUser(m), null, JSON.stringify(m));
  assert.notEqual(readSessionUser(user('a', { team: null, firstXpAt: null })), null);
  assert.notEqual(readSessionUser(user('k'.repeat(512), { name: 'n'.repeat(512) })), null);
});

test('isSessionUser decide igual que readSessionUser (sin copiar nada) y sessionUserBytes tolera campos de más', () => {
  const casos = [
    user('a'),
    { ...user('a'), evil: 1, avatar: 'x'.repeat(1000) },
    user('a', { team: null, firstXpAt: null }),
    user(''),
    user(7),
    user('a', { team: 65 }),
    user('a', { name: 'n'.repeat(513) }),
    user('a', { xp: { live: -1, match: 0 } }),
    user('a', { kills: undefined }),
    user('a', { lastSwitch: Infinity }),
    null,
    [],
    'x',
  ];
  for (const c of casos) assert.equal(isSessionUser(c), readSessionUser(c) !== null, JSON.stringify(c));
  const conExtras = { ...user('a'), evil: 'x'.repeat(50), xp: { live: 1, match: 1, otro: 9 } };
  assert.equal(sessionUserBytes(conExtras), bytes(JSON.stringify(readSessionUser(conExtras))));
  const hostil = JSON.parse(
    '{"key":"p","name":"P","team":1,"lastSwitch":0,"__proto__":{"key":"zzz"},"coins":{"live":1,"match":1},"value":{"live":0,"match":0},"xp":{"live":1,"match":1},"kills":{"live":0,"match":0},"firstXpAt":null}',
  );
  assert.equal(isSessionUser(hostil), true);
});

test('readSessionUser lee solo propiedades propias: __proto__ y constructor del JSON no cuelan nada', () => {
  const texto =
    '{"key":"p","name":"P","team":1,"lastSwitch":0,"__proto__":{"polluted":1},"constructor":{"x":1},"coins":{"live":1,"match":1,"__proto__":{"polluted":2}},"value":{"live":0,"match":0},"xp":{"live":1,"match":1},"kills":{"live":0,"match":0},"firstXpAt":null}';
  const limpio = readSessionUser(JSON.parse(texto));
  assert.equal({}.polluted, undefined);
  assert.equal(limpio.polluted, undefined);
  assert.equal(limpio.coins.polluted, undefined);
  assert.deepEqual(Object.keys(limpio).length, 9);
});

test('isSessionKey: texto de 1 a 512 unidades', () => {
  assert.equal(isSessionKey('a'), true);
  assert.equal(isSessionKey('a'.repeat(512)), true);
  assert.equal(isSessionKey(''), false);
  assert.equal(isSessionKey('a'.repeat(513)), false);
  assert.equal(isSessionKey(5), false);
});

// ---------------------------------------------------------------------------------------------------------------
// bytes exactos

/** Generador determinista (mulberry32) para que la prueba de propiedad se repita igual. */
function azar(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fragmentos que complican el JSON: comillas, barras, controles, DEL, 2/3/4 bytes y sustitutos sueltos. */
const PIEZAS = [
  'a',
  'Z',
  ' ',
  '"',
  '\\',
  '/',
  String.fromCharCode(0),
  String.fromCharCode(8),
  String.fromCharCode(9),
  String.fromCharCode(10),
  String.fromCharCode(12),
  String.fromCharCode(13),
  String.fromCharCode(0x1f),
  String.fromCharCode(0x7f),
  String.fromCharCode(0x80),
  'é',
  'ñ',
  '田',
  '語',
  String.fromCodePoint(0x1f600),
  String.fromCodePoint(0x10ffff),
  String.fromCharCode(0xd800),
  String.fromCharCode(0xdc00),
  String.fromCharCode(0xdbff),
  String.fromCharCode(0xdfff),
  String.fromCharCode(0xd83d) + 'x',
  ' ',
  ' ',
  '﻿',
];
const texto = (r, max) => {
  let s = '';
  const n = Math.floor(r() * max);
  for (let i = 0; i < n; i++) s += PIEZAS[Math.floor(r() * PIEZAS.length)];
  return s;
};
const numero = (r) => {
  const k = Math.floor(r() * 8);
  if (k === 0) return 0;
  if (k === 1) return Math.floor(r() * 1000);
  if (k === 2) return Math.floor(r() * 1e12);
  if (k === 3) return -Math.floor(r() * 1e9);
  if (k === 4) return r() * 1000;
  if (k === 5) return -r() * 1e-7;
  if (k === 6) return 1e12;
  return -0;
};

test('jsonStringBytes coincide con TextEncoder(JSON.stringify(s)) en 5000 textos con comillas, controles, emoji y sustitutos sueltos', () => {
  const r = azar(12345);
  for (let i = 0; i < 5000; i++) {
    const s = texto(r, 30);
    assert.equal(jsonStringBytes(s), bytes(JSON.stringify(s)), JSON.stringify(s));
  }
  for (const s of PIEZAS) assert.equal(jsonStringBytes(s), bytes(JSON.stringify(s)), JSON.stringify(s));
  assert.equal(jsonStringBytes(''), 2);
});

test('sessionUserBytes coincide con TextEncoder(JSON.stringify(usuario)) en 5000 usuarios generados', () => {
  const r = azar(777);
  for (let i = 0; i < 5000; i++) {
    const u = {
      key: texto(r, 20) || 'k',
      name: texto(r, 40),
      team: r() < 0.3 ? null : 1 + Math.floor(r() * 64),
      lastSwitch: r() < 0.5 ? -1e9 : numero(r),
      coins: { live: Math.abs(numero(r)), match: Math.abs(numero(r)) },
      value: { live: Math.abs(numero(r)), match: Math.abs(numero(r)) },
      xp: { live: Math.abs(numero(r)), match: Math.abs(numero(r)) },
      kills: { live: Math.abs(numero(r)), match: Math.abs(numero(r)) },
      firstXpAt: r() < 0.4 ? null : numero(r),
    };
    const limpio = readSessionUser(u);
    assert.notEqual(limpio, null, JSON.stringify(u));
    assert.equal(sessionUserBytes(limpio), bytes(JSON.stringify(limpio)), JSON.stringify(limpio));
  }
});

test('sessionUserBytes: los casos de cada borde', () => {
  for (const u of [
    user('a'),
    user('a', { team: null, firstXpAt: null }),
    user('a', { team: 64, firstXpAt: -12.5, lastSwitch: 1e12 }),
    user('"\\', { name: 'x'.repeat(512) }),
    user(String.fromCodePoint(0x1f600).repeat(100), { name: String.fromCharCode(0xd800) + '田' }),
    user('a', { coins: { live: 1e12, match: 0.1 } }),
  ]) {
    const limpio = readSessionUser(u);
    assert.equal(sessionUserBytes(limpio), bytes(JSON.stringify(limpio)));
  }
});
