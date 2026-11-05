import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SITE_LOCAL_POR_DEFECTO,
  assertBuildEnv,
  buildEnvGuard,
  checkBuildEnv,
  readEnv,
  siteParaAstro,
} from '../../integrations/env.js';

// Las carpetas temporales van dentro del repo (gitignored), nunca en la carpeta temporal del sistema (C:).
const ESTADO = fileURLToPath(new URL('../../../../.dev-state/pruebas-web', import.meta.url));

function proyectoTemporal(archivoEnv) {
  mkdirSync(ESTADO, { recursive: true });
  const raiz = mkdtempSync(path.join(ESTADO, 'env-'));
  if (archivoEnv !== undefined) writeFileSync(path.join(raiz, '.env'), archivoEnv);
  return raiz;
}

/** Ejecuta `fn` con estas variables de proceso (undefined = borrada) y las restaura al terminar. */
async function conProceso(variables, fn) {
  const antes = {};
  for (const [k, v] of Object.entries(variables)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const VALIDAS = { SITE_URL: 'https://ejemplo.test', PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAreal' };

// ---- siteParaAstro: el `site` que Astro ve, ya validado (F6) ----

test('siteParaAstro: un SITE_URL mal formado nunca llega a Astro (su error genérico taparía el de la guarda)', () => {
  assert.equal(siteParaAstro('ejemplo.com'), SITE_LOCAL_POR_DEFECTO);
  for (const malo of [undefined, '', '   ', 'https://ejemplo.com/ruta', 'ftp://ejemplo.com', 'https://u:p@ejemplo.com'])
    assert.equal(siteParaAstro(malo), SITE_LOCAL_POR_DEFECTO, String(malo));
  assert.equal(SITE_LOCAL_POR_DEFECTO, 'http://localhost:8790');
});

test('siteParaAstro: un origen válido pasa tal cual (normalizado, sin barra final)', () => {
  assert.equal(siteParaAstro('https://ejemplo.com'), 'https://ejemplo.com');
  assert.equal(siteParaAstro('  https://ejemplo.com/ '), 'https://ejemplo.com');
  assert.equal(siteParaAstro('http://localhost:8790'), 'http://localhost:8790');
});

test('siteParaAstro + la guarda: "ejemplo.com" usa el valor local para Astro, pero checkBuildEnv lo sigue marcando inválido', () => {
  const r = checkBuildEnv({ SITE_URL: 'ejemplo.com', PUBLIC_TURNSTILE_SITE_KEY: 'clave' });
  assert.equal(r.ok, false);
  assert.match(r.errores.join('\n'), /SITE_URL no es válida \("ejemplo\.com"\)/);
});

// ---- checkBuildEnv: la lógica de la guarda, pura ----

test('checkBuildEnv: con las dos variables explícitas pasa y entrega el origen y la clave', () => {
  const r = checkBuildEnv(VALIDAS);
  assert.deepEqual(r, { ok: true, site: 'https://ejemplo.test', siteKey: '0x4AAAAAAAreal' });
});

test('checkBuildEnv: un localhost explícito es válido (la CI y la vista previa local lo usan)', () => {
  const r = checkBuildEnv({ SITE_URL: 'http://localhost:8790', PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' });
  assert.deepEqual(r, { ok: true, site: 'http://localhost:8790', siteKey: '1x00000000000000000000AA' });
});

test('checkBuildEnv: normaliza la barra final y los espacios', () => {
  const r = checkBuildEnv({ SITE_URL: '  https://ejemplo.test/  ', PUBLIC_TURNSTILE_SITE_KEY: '  clave  ' });
  assert.deepEqual(r, { ok: true, site: 'https://ejemplo.test', siteKey: 'clave' });
});

test('checkBuildEnv: sin SITE_URL falla y nombra la variable', () => {
  for (const falta of [undefined, '', '   ']) {
    const r = checkBuildEnv({ ...VALIDAS, SITE_URL: falta });
    assert.equal(r.ok, false);
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /SITE_URL/);
  }
});

test('checkBuildEnv: sin la clave de Turnstile falla y nombra la variable', () => {
  for (const falta of [undefined, '', '   ']) {
    const r = checkBuildEnv({ ...VALIDAS, PUBLIC_TURNSTILE_SITE_KEY: falta });
    assert.equal(r.ok, false);
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /PUBLIC_TURNSTILE_SITE_KEY/);
  }
});

test('checkBuildEnv: sin ninguna de las dos devuelve un error por variable', () => {
  const r = checkBuildEnv({});
  assert.equal(r.ok, false);
  assert.equal(r.errores.length, 2);
  assert.match(r.errores[0], /SITE_URL/);
  assert.match(r.errores[1], /PUBLIC_TURNSTILE_SITE_KEY/);
});

test('checkBuildEnv: SITE_URL tiene que ser un origen http(s) absoluto, sin ruta, parámetros ni credenciales', () => {
  for (const malo of [
    'localhost:8790',
    'ejemplo.test',
    '/ruta',
    'ftp://ejemplo.test',
    'javascript:alert(1)',
    'https://ejemplo.test/app',
    'https://ejemplo.test/?a=1',
    'https://ejemplo.test/#x',
    'https://usuario:clave@ejemplo.test',
  ]) {
    const r = checkBuildEnv({ ...VALIDAS, SITE_URL: malo });
    assert.equal(r.ok, false, malo);
    assert.match(r.errores[0], /SITE_URL/, malo);
    assert.match(r.errores[0], /origen/, malo);
  }
});

test('assertBuildEnv: devuelve lo comprobado, o lanza un error en español con el nombre de cada variable', () => {
  assert.equal(assertBuildEnv(VALIDAS).site, 'https://ejemplo.test');
  assert.throws(
    () => assertBuildEnv({}),
    (e) => {
      assert.match(e.message, /SITE_URL/);
      assert.match(e.message, /PUBLIC_TURNSTILE_SITE_KEY/);
      assert.match(e.message, /construcción/);
      assert.match(e.message, /\.env/);
      return true;
    },
  );
});

// ---- readEnv: una sola fuente (proceso + .env), como import.meta.env ----

test('readEnv: lee un valor que solo está en el .env del proyecto', async () => {
  const raiz = proyectoTemporal('PUBLIC_CF_BEACON_TOKEN=solo-en-dotenv\n');
  try {
    await conProceso({ PUBLIC_CF_BEACON_TOKEN: undefined }, () => {
      assert.equal(readEnv({ mode: 'production', root: raiz }).PUBLIC_CF_BEACON_TOKEN, 'solo-en-dotenv');
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('readEnv: el entorno real del proceso gana sobre el .env (igual que import.meta.env)', async () => {
  const raiz = proyectoTemporal('SITE_URL=https://del-dotenv.test\n');
  try {
    await conProceso({ SITE_URL: 'https://del-proceso.test' }, () => {
      assert.equal(readEnv({ mode: 'production', root: raiz }).SITE_URL, 'https://del-proceso.test');
    });
    await conProceso({ SITE_URL: undefined }, () => {
      assert.equal(readEnv({ mode: 'production', root: raiz }).SITE_URL, 'https://del-dotenv.test');
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

// ---- buildEnvGuard: la integración que corta la construcción ----

test('guarda: se llama entorno-de-construccion y escucha astro:config:setup', () => {
  const g = buildEnvGuard();
  assert.equal(g.name, 'entorno-de-construccion');
  assert.equal(typeof g.hooks['astro:config:setup'], 'function');
});

test('guarda: astro build sin las variables se detiene con un error que las nombra', async () => {
  const raiz = proyectoTemporal();
  try {
    await conProceso({ SITE_URL: undefined, PUBLIC_TURNSTILE_SITE_KEY: undefined }, async () => {
      const g = buildEnvGuard();
      await assert.rejects(
        async () =>
          g.hooks['astro:config:setup']({
            command: 'build',
            config: { root: pathToFileURL(raiz + path.sep) },
            updateConfig: () => assert.fail('no debe seguir'),
          }),
        /SITE_URL[\s\S]*PUBLIC_TURNSTILE_SITE_KEY/,
      );
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('guarda: astro build con las variables solo en el .env pasa y fija el sitio', async () => {
  const raiz = proyectoTemporal('SITE_URL=https://del-dotenv.test\nPUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAAdotenv\n');
  try {
    await conProceso({ SITE_URL: undefined, PUBLIC_TURNSTILE_SITE_KEY: undefined }, async () => {
      const cambios = [];
      await buildEnvGuard().hooks['astro:config:setup']({
        command: 'build',
        config: { root: pathToFileURL(raiz + path.sep) },
        updateConfig: (c) => cambios.push(c),
      });
      assert.deepEqual(cambios, [{ site: 'https://del-dotenv.test' }]);
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('guarda: astro dev y astro sync no exigen nada (conservan los valores por defecto locales)', async () => {
  const raiz = proyectoTemporal();
  try {
    await conProceso({ SITE_URL: undefined, PUBLIC_TURNSTILE_SITE_KEY: undefined }, async () => {
      for (const command of ['dev', 'sync', 'preview']) {
        await buildEnvGuard().hooks['astro:config:setup']({
          command,
          config: { root: pathToFileURL(raiz + path.sep) },
          updateConfig: () => assert.fail(`${command} no cambia la configuración`),
        });
      }
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('astro.config: la guarda de entorno va registrada', async () => {
  const config = (await import('../../astro.config.mjs?guarda')).default;
  assert.ok(
    config.integrations.some((i) => i.name === 'entorno-de-construccion'),
    'falta registrar la guarda en astro.config.mjs',
  );
});

test('WaitlistForm: en producción sin clave de Turnstile la construcción se detiene (no se cuela la clave de prueba)', () => {
  const fuente = readFileSync(new URL('../../src/components/WaitlistForm.astro', import.meta.url), 'utf8');
  assert.match(fuente, /import\.meta\.env\.PROD[\s\S]{0,80}throw new Error\([^)]*PUBLIC_TURNSTILE_SITE_KEY/);
});
