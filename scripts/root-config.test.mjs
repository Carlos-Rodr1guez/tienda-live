// Pruebas de la configuración de la raíz del monorepo (DT-1, DT-2, DT-3, DT-5, DT-6).
// Leen los archivos tal cual están: si alguien cambia un puerto o un motor sin querer, fallan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

/** Quita los comentarios de línea y de bloque de un JSONC sin tocar las cadenas que contienen `//` (como las URL). */
function parseJsonc(text) {
  const sinComentarios = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
  return JSON.parse(sinComentarios);
}

test('motores: la raíz exige Node >=22.23.4 (Astro 7) y el juego sigue en >=20', () => {
  assert.equal(readJson('package.json').engines.node, '>=22.23.4');
  assert.equal(readJson('games/asedio/package.json').engines.node, '>=20');
  assert.equal(read('.nvmrc').trim(), '24');
});

test('README: el requisito de Node coincide con los motores', () => {
  assert.match(read('README.md'), /Node\.js 22\.23\.4 o superior/);
  assert.doesNotMatch(read('README.md'), /Node\.js 20 o superior/);
});

test('Dependabot: ignora los saltos mayores de typescript y lo explica con el ADR-009', () => {
  const yml = read('.github/dependabot.yml');
  assert.match(yml, /ignore:[\s\S]*?- dependency-name: typescript\s+update-types: \['version-update:semver-major'\]/);
  assert.match(yml, /ADR-009/);
});

test('tsconfig raíz: excluye apps/web (lo revisa astro check con TS 6) y las carpetas generadas', () => {
  const { exclude, include } = parseJsonc(read('tsconfig.json'));
  for (const carpeta of ['apps/web', '**/node_modules', '**/dist', '**/.wrangler']) {
    assert.ok(exclude.includes(carpeta), `falta ${carpeta} en exclude`);
  }
  for (const carpeta of ['apps', 'games', 'packages', 'scripts']) {
    assert.ok(include.includes(carpeta), `falta ${carpeta} en include`);
  }
});

test('typecheck raíz: corre tsc 7 y después astro check de apps/web', () => {
  const { scripts } = readJson('package.json');
  assert.equal(scripts.typecheck, 'tsc -p tsconfig.json && npm run typecheck -w @tienda/web');
});

test('scripts raíz: dev, build, preview, base de datos y embudo', () => {
  const { scripts, workspaces } = readJson('package.json');
  assert.deepEqual(workspaces, ['apps/*', 'games/*', 'packages/*']);
  assert.equal(scripts.dev, 'node scripts/dev.mjs');
  assert.equal(scripts['dev:web'], 'npm run dev -w @tienda/web');
  assert.equal(scripts['dev:api'], 'npm run dev -w @tienda/api');
  assert.equal(scripts['build:web'], 'npm run build -w @tienda/web');
  assert.equal(scripts.preview, 'npm run build:web && npm run preview -w @tienda/api');
  assert.equal(scripts['db:migrate'], 'npm run db:migrate -w @tienda/api');
  assert.equal(scripts.embudo, 'npm run embudo -w @tienda/api --');
  assert.equal(scripts.test, 'npm test --workspaces --if-present && node --test "scripts/*.test.mjs"');
});

test('puertos: web 4400, API 8790 e inspector 9290 en los scripts y en la configuración de Astro', () => {
  const api = readJson('apps/api/package.json').scripts;
  const web = readJson('apps/web/package.json').scripts;
  assert.match(api.dev, /--port 8790/);
  assert.match(api.dev, /--port 9290/);
  assert.match(api.preview, /--port 8790/);
  assert.match(api.preview, /--port 9290/);
  assert.match(api.preview, /--var SITE_URL:http:\/\/localhost:8790/);
  assert.match(web.dev, /--port 4400/);
  const astro = read('apps/web/astro.config.mjs');
  assert.match(astro, /port: 4400/);
  assert.match(astro, /strictPort: true/);
  assert.match(astro, /http:\/\/localhost:8790/);
});

test('.gitignore: cubre caches, estado local y variables de Wrangler, pero deja el ejemplo', () => {
  const lineas = read('.gitignore').split('\n');
  for (const patron of [
    '.astro/',
    '.wrangler/',
    '.dev.vars',
    '.dev.vars.*',
    '!.dev.vars.example',
    '.dev-state/',
    '.atl/',
  ]) {
    assert.ok(lineas.includes(patron), `falta ${patron}`);
  }
});

/** El texto del job `nombre` en ci.yml: desde su clave hasta el siguiente job (o el final). */
function bloqueJob(yml, nombre) {
  const inicio = yml.search(new RegExp(`^  ${nombre}:`, 'm'));
  assert.ok(inicio >= 0, `falta el job ${nombre}`);
  const resto = yml.slice(inicio + 1);
  const siguiente = resto.search(/^ {2}[a-z][\w-]*:/m);
  return siguiente < 0 ? resto : resto.slice(0, siguiente);
}

/** Los comandos `run:` de un bloque, en orden. */
const comandos = (bloque) => [...bloque.matchAll(/^\s*(?:- )?run: (.+)$/gm)].map((m) => m[1].trim());

test('CI: permisos mínimos y todas las acciones fijadas por SHA completo con la versión al lado', () => {
  const yml = read('.github/workflows/ci.yml');
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
  const usos = [...yml.matchAll(/^\s*- uses: (\S+)(.*)$/gm)];
  assert.ok(usos.length >= 4, 'se esperaban checkout y setup-node en cada uno de los dos jobs');
  for (const [, accion, resto] of usos) {
    assert.match(accion, /@[0-9a-f]{40}$/, `${accion} no está fijada por SHA`);
    assert.match(resto, /# v\d+\.\d+\.\d+/, `${accion} no lleva la versión en un comentario`);
  }
});

test('CI: el job calidad conserva sus comprobaciones', () => {
  const pasos = comandos(bloqueJob(read('.github/workflows/ci.yml'), 'calidad'));
  for (const paso of [
    'npm run lint',
    'npm run format:check',
    'npm run typecheck',
    'npm run licenses',
    'npm audit --omit=dev --audit-level=high',
    'npm run check:bundle -w @tienda/api',
    'npm run db:migrate -w @tienda/api',
  ]) {
    assert.ok(pasos.includes(paso), `calidad perdió: ${paso}`);
  }
});

test('CI: el job pruebas corre en ubuntu y windows, con 15 minutos de tope', () => {
  const bloque = bloqueJob(read('.github/workflows/ci.yml'), 'pruebas');
  assert.match(bloque, /^ {4}timeout-minutes: 15$/m);
  assert.match(bloque, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(bloque, /runs-on: \$\{\{ matrix\.os \}\}/);
});

test('CI: el job pruebas tipa, construye la web, prueba el dist y comprueba el esquema, en ese orden', () => {
  const pasos = comandos(bloqueJob(read('.github/workflows/ci.yml'), 'pruebas'));
  const orden = [
    'npm ci',
    'npm test',
    'npm run typecheck -w @tienda/web',
    'npm run build -w @tienda/web',
    'npm run test:dist -w @tienda/web',
    'npm run check:schema -w @tienda/web',
  ];
  const posiciones = orden.map((paso) => pasos.indexOf(paso));
  orden.forEach((paso, i) => assert.ok(posiciones[i] >= 0, `pruebas no corre: ${paso}`));
  assert.deepEqual(
    posiciones,
    [...posiciones].sort((a, b) => a - b),
    'los pasos están desordenados',
  );
});

test('CI: la construcción lleva el entorno que las pruebas de dist esperan', () => {
  const bloque = bloqueJob(read('.github/workflows/ci.yml'), 'pruebas');
  assert.match(bloque, /SITE_URL: http:\/\/localhost:8790$/m);
  assert.match(bloque, /PUBLIC_TURNSTILE_SITE_KEY: 1x00000000000000000000AA$/m);
  // Sin token del beacon: la construcción de CI no debe llevar analítica.
  assert.doesNotMatch(bloque, /PUBLIC_CF_BEACON_TOKEN/);
});

/**
 * Contextos que GitHub permite en `jobs.<job_id>.env` (tabla "Context availability" de la documentación de Actions).
 * `runner`, `env`, `job` y `steps` solo existen dentro de los pasos: usarlos en el env del job invalida el workflow
 * entero, y entonces no corre ningún job.
 */
const CONTEXTOS_ENV_JOB = new Set(['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs']);

/** Las líneas del `env:` propio de un job (clave a 4 espacios), no el de sus pasos. */
function envDelJob(bloque) {
  const m = bloque.match(/^ {4}env:\n((?: {6}.*(?:\n|$))*)/m);
  return m ? m[1] : '';
}

test('CI: el env de cada job solo usa contextos que GitHub permite a nivel de job', () => {
  const yml = read('.github/workflows/ci.yml');
  for (const job of ['calidad', 'pruebas']) {
    for (const [, contexto] of envDelJob(bloqueJob(yml, job)).matchAll(/\$\{\{\s*([a-z_]+)\./g)) {
      assert.ok(
        CONTEXTOS_ENV_JOB.has(contexto),
        `el env del job ${job} usa el contexto "${contexto}", que no existe a nivel de job: el workflow no arranca`,
      );
    }
  }
});

test('.gitattributes: los formatos binarios nuevos no se tocan', () => {
  const lineas = read('.gitattributes').split('\n');
  for (const ext of ['avif', 'mp4', 'webm', 'ico']) {
    assert.ok(lineas.includes(`*.${ext} binary`), `falta *.${ext}`);
  }
});
