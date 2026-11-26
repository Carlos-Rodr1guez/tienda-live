import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildDevEnv } from './dev-env.mjs';

const WIN_REPO = 'D:\\TIKTOK\\asedio-live\\asedio-live';
const WIN_STATE = 'D:\\TIKTOK\\asedio-live\\.dev-state\\tienda-live';
const LINUX_REPO = '/home/dev/tienda-live';

test('estado por defecto: carpeta hermana del repositorio, fuera del árbol (Windows)', () => {
  const { dirs } = buildDevEnv({ env: {}, platform: 'win32', repoRoot: WIN_REPO, exists: () => false });
  assert.equal(dirs.state, WIN_STATE);
  assert.equal(dirs.config, `${WIN_STATE}\\config`);
  assert.equal(dirs.logs, `${WIN_STATE}\\logs`);
  assert.equal(dirs.tmp, `${WIN_STATE}\\tmp`);
});

test('estado por defecto en Linux: también hermana del repositorio', () => {
  const { dirs } = buildDevEnv({ env: {}, platform: 'linux', repoRoot: LINUX_REPO, exists: () => false });
  assert.equal(dirs.state, '/home/dev/.dev-state/tienda-live');
  assert.equal(dirs.tmp, '/home/dev/.dev-state/tienda-live/tmp');
});

test('TIENDA_DEV_STATE reemplaza la carpeta de estado', () => {
  const { env, dirs } = buildDevEnv({
    env: { TIENDA_DEV_STATE: 'E:\\otro\\estado' },
    platform: 'win32',
    repoRoot: WIN_REPO,
    exists: () => false,
  });
  assert.equal(dirs.state, 'E:\\otro\\estado');
  assert.equal(env.XDG_CONFIG_HOME, 'E:\\otro\\estado\\config');
  assert.equal(env.TEMP, 'E:\\otro\\estado\\tmp');
});

test('redirige la configuración, los registros y lo temporal de las herramientas a la carpeta de estado', () => {
  const { env } = buildDevEnv({ env: {}, platform: 'win32', repoRoot: WIN_REPO, exists: () => false });
  assert.equal(env.XDG_CONFIG_HOME, `${WIN_STATE}\\config`);
  assert.equal(env.WRANGLER_LOG_PATH, `${WIN_STATE}\\logs`);
  for (const nombre of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[nombre], `${WIN_STATE}\\tmp`, nombre);
});

test('apaga la telemetría y las consultas de red innecesarias', () => {
  const { env } = buildDevEnv({ env: {}, platform: 'win32', repoRoot: WIN_REPO, exists: () => false });
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
  assert.equal(env.WRANGLER_SEND_ERROR_REPORTS, 'false');
  assert.equal(env.ASTRO_TELEMETRY_DISABLED, '1');
  assert.equal(env.DO_NOT_TRACK, '1');
  assert.equal(env.CLOUDFLARE_CF_FETCH_ENABLED, 'false');
});

test('conserva el resto del entorno y no inventa variables de credenciales', () => {
  const { env } = buildDevEnv({
    env: { PATH: '/usr/bin', LANG: 'es_AR.UTF-8' },
    platform: 'linux',
    repoRoot: LINUX_REPO,
    exists: () => false,
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.LANG, 'es_AR.UTF-8');
  for (const nombre of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    assert.equal(nombre in env, false, nombre);
  }
});

test('si el dueño ya tiene un token en su entorno, pasa tal cual y no se toca', () => {
  const { env } = buildDevEnv({
    env: { CLOUDFLARE_API_TOKEN: 'del-dueno' },
    platform: 'win32',
    repoRoot: WIN_REPO,
    exists: () => false,
  });
  assert.equal(env.CLOUDFLARE_API_TOKEN, 'del-dueno');
});

test('no modifica el objeto de entorno que recibe', () => {
  const original = { PATH: 'x' };
  buildDevEnv({ env: original, platform: 'win32', repoRoot: WIN_REPO, exists: () => false });
  assert.deepEqual(original, { PATH: 'x' });
});

test('avisa si existe ~/.wrangler, porque Wrangler ignora XDG_CONFIG_HOME en ese caso', () => {
  const vistas = [];
  const { warnings } = buildDevEnv({
    env: { USERPROFILE: 'C:\\Users\\ARTHAS' },
    platform: 'win32',
    repoRoot: WIN_REPO,
    exists: (ruta) => {
      vistas.push(ruta);
      return true;
    },
  });
  assert.deepEqual(vistas, ['C:\\Users\\ARTHAS\\.wrangler']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\.wrangler/);
  assert.match(warnings[0], /XDG_CONFIG_HOME/);
});

test('sin ~/.wrangler no hay avisos', () => {
  const { warnings } = buildDevEnv({
    env: { USERPROFILE: 'C:\\Users\\ARTHAS' },
    platform: 'win32',
    repoRoot: WIN_REPO,
    exists: () => false,
  });
  assert.deepEqual(warnings, []);
});

test('con el entorno real del proceso devuelve rutas coherentes con la plataforma', () => {
  const { dirs } = buildDevEnv({ env: {}, platform: process.platform, repoRoot: path.resolve('x', 'repo') });
  assert.ok(path.isAbsolute(dirs.state));
  assert.equal(path.basename(dirs.state), 'tienda-live');
});
