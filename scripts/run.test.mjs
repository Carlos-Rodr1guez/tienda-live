import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs, findToolBin, ensureFreePorts, prepareFiles, buildInvocation } from './run.mjs';
import { buildDevEnv } from './dev-env.mjs';

// Las carpetas de prueba van dentro del repositorio (en .dev-state/, ignorada por git) y no en la carpeta
// temporal del sistema, que en esta máquina está en C:.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, '.dev-state');
let sandbox;

before(() => {
  mkdirSync(BASE, { recursive: true });
  sandbox = mkdtempSync(path.join(BASE, 'run-test-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

let contador = 0;
function carpeta() {
  const dir = path.join(sandbox, `caso-${++contador}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function instalarHerramienta(raiz, nombre, bin) {
  const dir = path.join(raiz, 'node_modules', nombre);
  mkdirSync(path.join(dir, 'bin'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: nombre, version: '1.0.0', bin }));
  writeFileSync(path.join(dir, 'bin', 'cli.js'), '// herramienta de prueba\n');
  return path.join(dir, 'bin', 'cli.js');
}

test('parseArgs: separa los puertos, la herramienta y sus argumentos', () => {
  assert.deepEqual(parseArgs(['--port', '8790', '--port', '9290', 'wrangler', 'dev', '--var', 'A:b']), {
    ports: [8790, 9290],
    tool: 'wrangler',
    toolArgs: ['dev', '--var', 'A:b'],
  });
  assert.deepEqual(parseArgs(['astro', 'check']), { ports: [], tool: 'astro', toolArgs: ['check'] });
});

test('parseArgs: lo que va después de la herramienta no se interpreta como puerto del lanzador', () => {
  assert.deepEqual(parseArgs(['--port', '4400', 'astro', 'dev', '--port', '1234']), {
    ports: [4400],
    tool: 'astro',
    toolArgs: ['dev', '--port', '1234'],
  });
});

test('parseArgs: falla sin herramienta o con un puerto inválido', () => {
  assert.throws(() => parseArgs([]), /herramienta/);
  assert.throws(() => parseArgs(['--port', '8790']), /herramienta/);
  assert.throws(() => parseArgs(['--port', 'abc', 'astro']), /puerto/);
  assert.throws(() => parseArgs(['--port', '70000', 'astro']), /puerto/);
  assert.throws(() => parseArgs(['--port']), /puerto/);
});

test('findToolBin: lee el bin del package.json (forma de cadena y forma de objeto)', () => {
  const raiz = carpeta();
  const a = instalarHerramienta(raiz, 'herr-cadena', 'bin/cli.js');
  const b = instalarHerramienta(raiz, 'herr-objeto', { otra: 'bin/otra.js', 'herr-objeto': 'bin/cli.js' });
  assert.equal(findToolBin('herr-cadena', raiz), a);
  assert.equal(findToolBin('herr-objeto', raiz), b);
});

test('findToolBin: busca hacia arriba desde la carpeta de trabajo, como hace Node', () => {
  const raiz = carpeta();
  const bin = instalarHerramienta(raiz, 'herr-arriba', 'bin/cli.js');
  const anidada = path.join(raiz, 'apps', 'web');
  mkdirSync(anidada, { recursive: true });
  assert.equal(findToolBin('herr-arriba', anidada), bin);
});

test('findToolBin: prefiere la copia más cercana (la de apps/web antes que la de la raíz)', () => {
  const raiz = carpeta();
  instalarHerramienta(raiz, 'herr-doble', 'bin/cli.js');
  const anidada = path.join(raiz, 'apps', 'web');
  const cercana = instalarHerramienta(anidada, 'herr-doble', 'bin/cli.js');
  assert.equal(findToolBin('herr-doble', anidada), cercana);
});

test('findToolBin: si la herramienta no está instalada, el error dice cuál y desde dónde se buscó', () => {
  const raiz = carpeta();
  assert.throws(
    () => findToolBin('herr-fantasma', raiz),
    (e) => /herr-fantasma/.test(e.message) && e.message.includes(raiz),
  );
});

function ocupar(puerto) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(puerto, '127.0.0.1', () => resolve(server));
  });
}

test('ensureFreePorts: con los puertos libres no falla', async () => {
  const server = await ocupar(0);
  const { port } = server.address();
  await new Promise((r) => server.close(r)); // ya quedó libre
  await ensureFreePorts([port]);
});

test('ensureFreePorts: un puerto ocupado falla rápido y dice cuál es', async () => {
  const server = await ocupar(0);
  const { port } = server.address();
  try {
    await assert.rejects(ensureFreePorts([port]), (e) => e.message.includes(String(port)) && /ocupado/.test(e.message));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('ensureFreePorts: revisa todos los puertos, no solo el primero', async () => {
  const libre = await ocupar(0);
  const libreNum = libre.address().port;
  await new Promise((r) => libre.close(r));
  const ocupado = await ocupar(0);
  const ocupadoNum = ocupado.address().port;
  try {
    await assert.rejects(ensureFreePorts([libreNum, ocupadoNum]), (e) => e.message.includes(String(ocupadoNum)));
  } finally {
    await new Promise((r) => ocupado.close(r));
  }
});

test('prepareFiles: crea las carpetas de estado, apps/web/dist vacía y .dev.vars desde el ejemplo', () => {
  const repo = carpeta();
  const cwd = path.join(repo, 'apps', 'api');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(cwd, '.dev.vars.example'), 'ENVIRONMENT=development\n');
  const { dirs } = buildDevEnv({ env: {}, platform: process.platform, repoRoot: repo, exists: () => false });

  prepareFiles({ dirs, repoRoot: repo, cwd });

  for (const d of [dirs.config, dirs.logs, dirs.tmp]) assert.ok(existsSync(d), d);
  assert.ok(existsSync(path.join(repo, 'apps', 'web', 'dist')));
  assert.equal(readFileSync(path.join(cwd, '.dev.vars'), 'utf8'), 'ENVIRONMENT=development\n');
});

test('prepareFiles: no pisa un .dev.vars que ya existe ni un dist que ya tiene contenido', () => {
  const repo = carpeta();
  const cwd = path.join(repo, 'apps', 'api');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(cwd, '.dev.vars.example'), 'DEL_EJEMPLO=1\n');
  writeFileSync(path.join(cwd, '.dev.vars'), 'MIO=1\n');
  mkdirSync(path.join(repo, 'apps', 'web', 'dist'), { recursive: true });
  writeFileSync(path.join(repo, 'apps', 'web', 'dist', 'index.html'), 'hola');
  const { dirs } = buildDevEnv({ env: {}, platform: process.platform, repoRoot: repo, exists: () => false });

  prepareFiles({ dirs, repoRoot: repo, cwd });

  assert.equal(readFileSync(path.join(cwd, '.dev.vars'), 'utf8'), 'MIO=1\n');
  assert.equal(readFileSync(path.join(repo, 'apps', 'web', 'dist', 'index.html'), 'utf8'), 'hola');
});

test('prepareFiles: sin .dev.vars.example en la carpeta de trabajo no crea .dev.vars', () => {
  const repo = carpeta();
  const cwd = path.join(repo, 'apps', 'web');
  mkdirSync(cwd, { recursive: true });
  const { dirs } = buildDevEnv({ env: {}, platform: process.platform, repoRoot: repo, exists: () => false });

  prepareFiles({ dirs, repoRoot: repo, cwd });

  assert.equal(existsSync(path.join(cwd, '.dev.vars')), false);
});

test('buildInvocation: lanza el JS de la herramienta con el Node actual, sin shell, con el entorno redirigido', () => {
  const repo = carpeta();
  const bin = instalarHerramienta(repo, 'herr-lanzar', 'bin/cli.js');
  const inv = buildInvocation({
    argv: ['herr-lanzar', 'dev', '--flag'],
    repoRoot: repo,
    cwd: repo,
    env: { PATH: 'p' },
    platform: process.platform,
  });
  assert.equal(inv.command, process.execPath);
  assert.deepEqual(inv.args, [bin, 'dev', '--flag']);
  assert.equal(inv.options.shell, undefined);
  assert.equal(inv.options.cwd, repo);
  assert.equal(inv.options.env.PATH, 'p');
  assert.equal(inv.options.env.ASTRO_TELEMETRY_DISABLED, '1');
  assert.ok(inv.options.env.XDG_CONFIG_HOME.endsWith('config'));
});
