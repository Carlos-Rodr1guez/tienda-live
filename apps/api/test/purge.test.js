import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, AHORA } from './support/harness.js';
import { insertPending, confirmByTokenHash } from '../src/waitlist/repository.js';
import { purgeStale, RETENCION_PENDIENTES_MS } from '../src/waitlist/purge.js';
import { createApp } from '../src/app.js';

const DIA = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const perfil = (email) => ({
  email,
  tiktok_user: null,
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['accion'],
  followers_range: null,
  country: null,
  consent_version: 'v1',
});

let n = 0;
async function anotar(h, email, creadaMs) {
  n += 1;
  const tokenHash = n.toString(16).padStart(64, '0');
  await insertPending(h.db, {
    perfil: perfil(email),
    ahora: iso(creadaMs),
    tokenHash,
    tokenExpiresAt: iso(creadaMs + 2 * DIA),
    recentSends: [iso(creadaMs)],
  });
  return tokenHash;
}

const correos = (h) =>
  h.db.sqlite
    .prepare('SELECT email FROM waitlist ORDER BY email')
    .all()
    .map((f) => f.email);

test('purge: la retención de los pendientes es de 7 días', () => {
  assert.equal(RETENCION_PENDIENTES_MS, 7 * DIA);
});

test('purge: borra los pendientes de más de 7 días; los de justo 7 días y los frescos se quedan (límite exacto)', async () => {
  const h = await createHarness({ routes: [] });
  await anotar(h, 'mas-de-7@example.com', AHORA - 7 * DIA - 1);
  await anotar(h, 'justo-7@example.com', AHORA - 7 * DIA);
  await anotar(h, 'fresca@example.com', AHORA - DIA);
  const borradas = await purgeStale(h.ports);
  assert.equal(borradas, 1);
  assert.deepEqual(correos(h), ['fresca@example.com', 'justo-7@example.com']);
});

test('purge: los confirmados no se tocan por viejos que sean', async () => {
  const h = await createHarness({ routes: [] });
  const hashVieja = await anotar(h, 'confirmada@example.com', AHORA - 30 * DIA);
  assert.equal(await confirmByTokenHash(h.db, hashVieja, iso(AHORA - 29 * DIA)), true);
  await anotar(h, 'pendiente@example.com', AHORA - 30 * DIA);
  assert.equal(await purgeStale(h.ports), 1);
  assert.deepEqual(correos(h), ['confirmada@example.com']);
});

test('purge: con la tabla vacía borra 0 y no falla', async () => {
  const h = await createHarness({ routes: [] });
  assert.equal(await purgeStale(h.ports), 0);
});

test('purge: lo único que registra es la cantidad (sin correos ni fechas)', async () => {
  const h = await createHarness({ routes: [] });
  await anotar(h, 'secreta@example.com', AHORA - 8 * DIA);
  await anotar(h, 'secreta2@example.com', AHORA - 9 * DIA);
  await purgeStale(h.ports);
  assert.equal(h.spy.lineas.length, 1);
  assert.deepEqual(JSON.parse(h.spy.lineas[0].linea), { nivel: 'info', evento: 'purga', cantidad: 2 });
  assert.doesNotMatch(h.spy.texto(), /secreta|example\.com|2026-/);
});

test('purge: scheduled la ejecuta dentro de waitUntil y respeta el reloj del puerto', async () => {
  const h = await createHarness({ routes: [] });
  const app = createApp(h.ports, { routes: [], jobs: [purgeStale] });
  await anotar(h, 'vieja@example.com', AHORA - 8 * DIA);
  await app.scheduled({ cron: '17 3 * * *' }, h.ctx);
  assert.equal(h.ctx.pendientes.length, 1);
  await h.ctx.settle();
  assert.deepEqual(correos(h), []);
});
