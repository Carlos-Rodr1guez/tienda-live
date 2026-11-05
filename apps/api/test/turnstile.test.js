import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnstileVerifier, SITEVERIFY_URL, TIEMPO_MAXIMO_MS } from '../src/adapters/turnstile.js';
import { createLogger } from '../src/adapters/logger.js';

const LOCAL = { secret: 'secreto-de-prueba', expectedHostname: null, expectedAction: 'waitlist' };
const PROD = { secret: 'secreto-de-prueba', expectedHostname: 'tienda.example', expectedAction: 'waitlist' };

/** fetch falso: guarda lo que recibió y responde con lo que se le pida. */
function fetchFalso(respuesta) {
  const llamadas = [];
  const fn = async (url, init) => {
    llamadas.push({ url, init });
    if (respuesta instanceof Error) throw respuesta;
    return typeof respuesta === 'function' ? respuesta(url, init) : respuesta;
  };
  fn.llamadas = llamadas;
  return fn;
}

const json = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

test('turnstile: manda JSON {secret, response} por POST a siteverify, sin remoteip', async () => {
  const fetch = fetchFalso(json({ success: true }));
  const resultado = await createTurnstileVerifier(LOCAL, { fetch }).verify('token-del-widget');
  assert.deepEqual(resultado, { ok: true });
  assert.equal(fetch.llamadas.length, 1);
  const { url, init } = fetch.llamadas[0];
  assert.equal(url, SITEVERIFY_URL);
  assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { secret: 'secreto-de-prueba', response: 'token-del-widget' });
  assert.doesNotMatch(init.body, /remoteip/i);
});

test('turnstile: la llamada lleva un AbortSignal de 5 segundos por defecto', async () => {
  const fetch = fetchFalso(json({ success: true }));
  await createTurnstileVerifier(LOCAL, { fetch }).verify('t');
  const { signal } = fetch.llamadas[0].init;
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  assert.equal(TIEMPO_MAXIMO_MS, 5000);
});

test('turnstile: success false -> rechazado (token falso, vencido o ya usado)', async () => {
  const fetch = fetchFalso(json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
  assert.deepEqual(await createTurnstileVerifier(LOCAL, { fetch }).verify('t'), { ok: false, reason: 'rechazado' });
});

/** Registro espía mínimo: guarda (nivel, evento, campos) de cada línea. */
function loggerEspia() {
  const lineas = [];
  const escribir = (nivel) => (evento, campos) => lineas.push({ nivel, evento, campos });
  return { lineas, info: escribir('info'), warn: escribir('warn'), error: escribir('error') };
}

test('turnstile: success false con un error-code NUESTRO (secreto o servicio) -> no_disponible y UNA línea con los nombres', async () => {
  for (const codigo of ['missing-input-secret', 'invalid-input-secret', 'bad-request', 'internal-error']) {
    const logger = loggerEspia();
    const fetch = fetchFalso(json({ success: false, 'error-codes': [codigo] }));
    const resultado = await createTurnstileVerifier(LOCAL, { fetch, logger }).verify('token-del-visitante');
    assert.deepEqual(resultado, { ok: false, reason: 'no_disponible' }, codigo);
    assert.equal(logger.lineas.length, 1, codigo);
    assert.deepEqual(logger.lineas[0], { nivel: 'error', evento: 'turnstile.config', campos: { codigo } });
  }
});

test('turnstile: varios error-codes -> se registran juntos solo los nuestros, y mandan sobre los del visitante', async () => {
  const logger = loggerEspia();
  const cuerpo = {
    success: false,
    'error-codes': ['invalid-input-response', 'invalid-input-secret', 'internal-error'],
  };
  const resultado = await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(json(cuerpo)), logger }).verify('t');
  assert.deepEqual(resultado, { ok: false, reason: 'no_disponible' });
  assert.equal(logger.lineas.length, 1);
  assert.equal(logger.lineas[0].campos.codigo, 'invalid-input-secret,internal-error');
});

test('turnstile: success false con error-codes DEL VISITANTE o desconocidos -> sigue siendo rechazado y no registra nada', async () => {
  const casos = [
    ['missing-input-response'],
    ['invalid-input-response'],
    ['timeout-or-duplicate'],
    ['codigo-nuevo-que-no-conocemos'],
    [],
    undefined,
    'timeout-or-duplicate', // no es lista
    [42, null, { 'invalid-input-secret': true }],
  ];
  for (const codes of casos) {
    const logger = loggerEspia();
    const cuerpo = codes === undefined ? { success: false } : { success: false, 'error-codes': codes };
    const resultado = await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(json(cuerpo)), logger }).verify('t');
    assert.deepEqual(resultado, { ok: false, reason: 'rechazado' }, JSON.stringify(codes));
    assert.deepEqual(logger.lineas, [], JSON.stringify(codes));
  }
});

test('turnstile: la línea de registro no lleva el token, el secreto ni nada que Cloudflare haya devuelto salvo los nombres', async () => {
  const logger = loggerEspia();
  const cuerpo = {
    success: false,
    'error-codes': ['invalid-input-secret', 'texto-libre-ana@example.com'],
    hostname: 'x',
  };
  await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(json(cuerpo)), logger }).verify('token-del-visitante');
  const texto = JSON.stringify(logger.lineas);
  for (const dato of ['token-del-visitante', 'secreto-de-prueba', 'ana@example.com', 'texto-libre']) {
    assert.ok(!texto.includes(dato), `el registro no debe tener ${dato}`);
  }
});

test('turnstile: con el registro real la línea sale como JSON con solo los campos permitidos (WL-12)', async () => {
  const lineas = [];
  const logger = createLogger({
    log: (l) => lineas.push(l),
    warn: (l) => lineas.push(l),
    error: (l) => lineas.push(l),
  });
  const cuerpo = { success: false, 'error-codes': ['invalid-input-secret'] };
  await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(json(cuerpo)), logger }).verify('t');
  assert.equal(lineas.length, 1);
  assert.deepEqual(JSON.parse(lineas[0]), {
    nivel: 'error',
    evento: 'turnstile.config',
    codigo: 'invalid-input-secret',
  });
});

test('turnstile: sin logger sigue funcionando (el registro es opcional)', async () => {
  const cuerpo = { success: false, 'error-codes': ['invalid-input-secret'] };
  const resultado = await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(json(cuerpo)) }).verify('t');
  assert.deepEqual(resultado, { ok: false, reason: 'no_disponible' });
});

test('turnstile: fallas de red, estado distinto de 2xx, cuerpo ilegible o sin success booleano -> no_disponible', async () => {
  const casos = [
    new TypeError('fetch failed'),
    json({ success: true }, 500),
    json({ success: false }, 429),
    new Response('<html>no es json</html>', { status: 200 }),
    json({ success: 'sí' }),
    json(null),
  ];
  for (const caso of casos) {
    const resultado = await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(caso) }).verify('t');
    assert.deepEqual(resultado, { ok: false, reason: 'no_disponible' });
  }
});

test('turnstile: si pasa el tiempo máximo se aborta y da no_disponible', async () => {
  const fetch = fetchFalso(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  );
  const inicio = Date.now();
  const resultado = await createTurnstileVerifier(LOCAL, { fetch, timeoutMs: 25 }).verify('t');
  assert.deepEqual(resultado, { ok: false, reason: 'no_disponible' });
  assert.ok(Date.now() - inicio < 2000);
});

test('turnstile: sin secreto no llama a Cloudflare y da no_disponible', async () => {
  const fetch = fetchFalso(json({ success: true }));
  for (const secret of ['', '   ']) {
    const resultado = await createTurnstileVerifier({ ...LOCAL, secret }, { fetch }).verify('t');
    assert.deepEqual(resultado, { ok: false, reason: 'no_disponible' });
  }
  assert.equal(fetch.llamadas.length, 0);
});

test('turnstile: con SITE_URL real exige el hostname y la acción esperados', async () => {
  const bueno = { success: true, hostname: 'tienda.example', action: 'waitlist' };
  assert.deepEqual(await createTurnstileVerifier(PROD, { fetch: fetchFalso(json(bueno)) }).verify('t'), { ok: true });
  for (const malo of [
    { ...bueno, hostname: 'otro.example' },
    { ...bueno, action: 'login' },
    { success: true },
    { success: true, hostname: 'tienda.example' },
  ]) {
    const resultado = await createTurnstileVerifier(PROD, { fetch: fetchFalso(json(malo)) }).verify('t');
    assert.deepEqual(resultado, { ok: false, reason: 'rechazado' }, JSON.stringify(malo));
  }
});

test('turnstile: en localhost (sin hostname esperado) no se comparan hostname ni acción (las claves de prueba devuelven otros)', async () => {
  const dePrueba = json({ success: true, hostname: 'example.com', action: 'test' });
  assert.deepEqual(await createTurnstileVerifier(LOCAL, { fetch: fetchFalso(dePrueba) }).verify('t'), { ok: true });
});
