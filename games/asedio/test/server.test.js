import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createNormalizer, userOf } from '../server/normalize.js';
import { cleanUsername } from '../server/tiktok.js';
import { startServer, ROOT } from '../server/app.js';
import { packageDir } from '../server/package-dir.js';

const quiet = { info() {}, warn() {}, error() {} };

test('usuario: formato nuevo (proto v3) y antiguo', () => {
  const v3 = userOf({ user: { id: '77', displayId: 'ana_23', nickname: 'Ana', avatarThumb: { urlList: ['https://x/a.jpg'] } } });
  assert.deepEqual(v3, { userId: '77', uniqueId: 'ana_23', nickname: 'Ana', avatar: 'https://x/a.jpg' });
  const legacy = userOf({ uniqueId: 'beto', nickname: 'Beto', userId: 9, profilePictureUrl: 'p.jpg' });
  assert.equal(legacy.userId, '9');
  assert.equal(legacy.avatar, 'p.jpg');
});

test('racha de rosas: cada actualización suma solo lo nuevo', () => {
  const n = createNormalizer();
  const base = { user: { id: '1', displayId: 'a', nickname: 'A' }, giftId: '5655', gift: { name: 'Rose', diamondCount: 1, type: 1 } };
  const counts = [
    n.gift({ ...base, repeatCount: 1, repeatEnd: 0 }),
    n.gift({ ...base, repeatCount: 2, repeatEnd: 0 }),
    n.gift({ ...base, repeatCount: 5, repeatEnd: 0 }),
    n.gift({ ...base, repeatCount: 5, repeatEnd: 1 }),
  ].map((r) => (r[0] ? r[0].count : 0));
  assert.deepEqual(counts, [1, 1, 3, 0]);
  // una racha nueva vuelve a empezar desde cero
  assert.equal(n.gift({ ...base, repeatCount: 1, repeatEnd: 0 })[0].count, 1);
});

test('regalo sin racha y datos del regalo', () => {
  const n = createNormalizer();
  const [e] = n.gift({ user: { id: '2', nickname: 'B' }, giftId: '5827', gift: { name: 'Galaxy', diamondCount: 1000, type: 2 }, repeatCount: 1, repeatEnd: 1 });
  assert.equal(e.type, 'gift');
  assert.equal(e.giftName, 'Galaxy');
  assert.equal(e.coins, 1000);
  assert.equal(e.count, 1);
});

test('chat y likes', () => {
  const n = createNormalizer();
  assert.equal(n.chat({ user: { id: '3' }, content: '2' }).text, '2');
  assert.equal(n.chat({ uniqueId: 'x', comment: 'hola' }).text, 'hola');
  assert.equal(n.like({ user: { id: '3' }, count: 15 }).count, 15);
});

test('limpieza del usuario de TikTok', () => {
  assert.equal(cleanUsername('@silver'), 'silver');
  assert.equal(cleanUsername('https://www.tiktok.com/@silver/live'), 'silver');
  assert.equal(cleanUsername('tu_usuario_de_tiktok'), '');
});

test('encuentra three aunque npm lo haya subido a la raíz del monorepo', () => {
  const dir = packageDir('three', path.join(ROOT, 'public', 'js'));
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name, 'three');
});

test('servidor: sirve el juego, la config y reenvía eventos por WebSocket', async () => {
  const app = await startServer({ port: 0, tiktok: false, log: quiet, config: { game: { round: { seconds: 60 } } } });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /ASEDIO/);

    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.equal(cfg.serverMode, true);
    assert.equal(cfg.game.round.seconds, 60);

    assert.equal((await fetch(`${base}/vendor/three/build/three.module.js`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${base}/js/main.js`)).status, 200);
    assert.equal((await fetch(`${base}/models/soldado.glb`, { method: 'HEAD' })).status, 404);
    assert.notEqual((await fetch(`${base}/..%2fconfig.json`)).status, 200);

    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const got = new Promise((r) => ws.once('message', (m) => r(JSON.parse(String(m)))));
    const res = await fetch(`${base}/api/simulate`, { method: 'POST', body: JSON.stringify({ type: 'gift', nickname: 'Ana', coins: 1, count: 3 }) });
    assert.equal(res.status, 204);
    const evt = await got;
    assert.equal(evt.type, 'gift');
    assert.equal(evt.count, 3);
    ws.close();
  } finally {
    await app.close();
  }
});
