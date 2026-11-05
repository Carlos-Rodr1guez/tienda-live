import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, ORIGEN } from './support/harness.js';
import { jsonResponse } from '../src/http/respond.js';
import { validateEvent } from '@tienda/contracts/events';
import { respuestas } from '@tienda/contracts/i18n';
import { API_RESPONSE_HEADERS } from '@tienda/contracts/security-headers';

/** Rutas de prueba: no dependen de las reales. */
function rutas() {
  const llamadas = [];
  const eco = {
    path: '/v1/eco',
    cap: 64,
    validate: validateEvent,
    handle: async (contexto) => {
      llamadas.push(contexto);
      return jsonResponse(200, { ok: true, valor: contexto.value });
    },
  };
  const grande = { ...eco, path: '/v1/grande', cap: 1024 };
  const campos = {
    path: '/v1/campos',
    cap: 64,
    validate: () => ({ ok: false, error: 'campos_invalidos', campos: { email: 'formato' } }),
    handle: async () => jsonResponse(200, { ok: true }),
  };
  const roto = {
    path: '/v1/roto',
    cap: 64,
    validate: (x) => ({ ok: true, value: x }),
    handle: async () => {
      throw new TypeError('falló con ana@example.com y el token TOKEN-SECRETO');
    },
  };
  const validadorRoto = {
    path: '/v1/validador-roto',
    cap: 64,
    validate: () => {
      throw new RangeError('boom');
    },
    handle: async () => jsonResponse(200, { ok: true }),
  };
  return { llamadas, lista: [eco, grande, campos, roto, validadorRoto] };
}

async function armar(opciones = {}) {
  const r = rutas();
  const h = await createHarness({ routes: r.lista, ...opciones });
  return { ...h, llamadas: r.llamadas };
}

function cabecerasDeLaApi(res) {
  for (const [nombre, valor] of Object.entries(API_RESPONSE_HEADERS))
    assert.equal(res.headers.get(nombre), valor, nombre);
  assert.equal(res.headers.has('set-cookie'), false, 'set-cookie');
  assert.equal(res.headers.has('access-control-allow-origin'), false, 'cors');
}

const BUENO = { name: 'form_open' };

test('pipeline: camino feliz: la ruta recibe el valor validado, los puertos y el contexto', async () => {
  const h = await armar();
  const res = await h.post('/v1/eco', BUENO);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, valor: BUENO });
  assert.equal(h.llamadas.length, 1);
  assert.deepEqual(h.llamadas[0].value, BUENO);
  assert.equal(h.llamadas[0].ports.db, h.ports.db);
  assert.equal(h.llamadas[0].ctx, h.ctx);
  assert.ok(h.llamadas[0].request instanceof Request);
});

test('pipeline: ruta desconocida -> 404 no_encontrado con las cabeceras de la API', async () => {
  const h = await armar();
  for (const [camino, method] of [
    ['/v1/nada', 'POST'],
    ['/v1/nada', 'GET'],
    ['/', 'GET'],
    ['/v1/eco/', 'POST'],
    ['/v1', 'POST'],
  ]) {
    const res = await h.request(camino, { method });
    assert.equal(res.status, 404, `${method} ${camino}`);
    assert.deepEqual(await res.json(), { ok: false, error: 'no_encontrado', mensaje: respuestas.no_encontrado });
    cabecerasDeLaApi(res);
  }
});

test('pipeline: método que no es POST -> 405 con Allow: POST, sin mutar nada', async () => {
  const h = await armar();
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const res = await h.request('/v1/eco', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST', method);
    cabecerasDeLaApi(res);
  }
  assert.equal(h.llamadas.length, 0);
});

test('pipeline: el método se revisa antes que el origen (un GET de otro origen es 405, no 403)', async () => {
  const h = await armar();
  const res = await h.request('/v1/eco', { method: 'GET', origin: 'https://malo.example' });
  assert.equal(res.status, 405);
});

test('pipeline: origen ausente, ajeno o "null" -> 403 origen_no_permitido y la ruta no corre', async () => {
  const h = await armar();
  for (const origin of [null, 'https://malo.example', 'null', 'http://localhost:4401', 'http://localhost:4400/']) {
    const res = await h.post('/v1/eco', BUENO, { origin });
    assert.equal(res.status, 403, String(origin));
    assert.equal((await res.json()).error, 'origen_no_permitido', String(origin));
    cabecerasDeLaApi(res);
  }
  assert.equal(h.llamadas.length, 0);
});

test('pipeline: los orígenes permitidos pasan (en desarrollo: sitio, :4400 y :8790)', async () => {
  const h = await armar();
  for (const origin of ['http://localhost:4400', 'http://localhost:8790']) {
    assert.equal((await h.post('/v1/eco', BUENO, { origin })).status, 200, origin);
  }
});

test('pipeline: en producción solo vale el origen del sitio, no los locales', async () => {
  const h = await armar({ env: { ENVIRONMENT: 'production', SITE_URL: 'https://tienda.example' } });
  assert.equal((await h.post('/v1/eco', BUENO, { origin: 'https://tienda.example' })).status, 200);
  assert.equal((await h.post('/v1/eco', BUENO, { origin: 'http://localhost:4400' })).status, 403);
  assert.equal((await h.post('/v1/eco', BUENO, { origin: 'https://www.tienda.example' })).status, 403);
});

test('pipeline: Sec-Fetch-Site distinto de same-origin -> 403; ausente o same-origin pasa', async () => {
  const h = await armar();
  for (const valor of ['cross-site', 'same-site', 'none']) {
    const res = await h.post('/v1/eco', BUENO, { headers: { 'sec-fetch-site': valor } });
    assert.equal(res.status, 403, valor);
    assert.equal((await res.json()).error, 'origen_no_permitido', valor);
  }
  assert.equal((await h.post('/v1/eco', BUENO, { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await h.post('/v1/eco', BUENO)).status, 200);
});

test('pipeline: el origen se revisa antes que el tipo de contenido (403 antes que 415)', async () => {
  const h = await armar();
  const res = await h.request('/v1/eco', {
    headers: { 'content-type': 'text/plain' },
    body: 'x',
    origin: 'https://malo.example',
  });
  assert.equal(res.status, 403);
});

test('pipeline: tipo de contenido que no es application/json -> 415 solicitud_invalida', async () => {
  const h = await armar();
  const cuerpo = JSON.stringify(BUENO);
  for (const tipo of [
    null,
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/jsonx',
    'application/json; charset=latin1',
    'application/json; boundary=x',
  ]) {
    const headers = tipo === null ? {} : { 'content-type': tipo };
    const res = await h.request('/v1/eco', { headers, body: cuerpo });
    assert.equal(res.status, 415, String(tipo));
    assert.equal((await res.json()).error, 'solicitud_invalida', String(tipo));
  }
  assert.equal(h.llamadas.length, 0);
});

test('pipeline: application/json con o sin charset utf-8, en cualquier mayúscula, se acepta', async () => {
  const h = await armar();
  const cuerpo = JSON.stringify(BUENO);
  for (const tipo of ['application/json', 'application/json; charset=utf-8', 'Application/JSON; Charset=UTF-8']) {
    const res = await h.request('/v1/eco', { headers: { 'content-type': tipo }, body: cuerpo });
    assert.equal(res.status, 200, tipo);
  }
});

test('pipeline: Content-Length por encima del tope de la ruta -> 413 demasiado_grande sin leer el cuerpo', async () => {
  const h = await armar();
  // En el Worker real, Content-Length llega declarado; acá se declara a mano
  const res = await h.post('/v1/eco', JSON.stringify({ name: 'x'.repeat(200) }), {
    headers: { 'content-length': '500' },
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: 'demasiado_grande',
    mensaje: respuestas.demasiado_grande,
  });
  cabecerasDeLaApi(res);
  assert.equal(h.llamadas.length, 0);
});

test('pipeline: cuerpo en flujo sin Content-Length que pasa el tope -> 413 y se corta la lectura', async () => {
  const h = await armar();
  let trozos = 0;
  const cuerpo = new ReadableStream({
    pull(c) {
      trozos += 1;
      c.enqueue(new TextEncoder().encode('a'.repeat(50)));
      if (trozos >= 1000) c.close();
    },
  });
  const res = await h.app.fetch(
    new Request('http://localhost:8790/v1/eco', {
      method: 'POST',
      headers: { origin: ORIGEN, 'content-type': 'application/json' },
      body: cuerpo,
      duplex: 'half',
    }),
    h.ctx,
  );
  assert.equal(res.status, 413);
  assert.ok(trozos < 10, `se leyeron ${trozos} trozos`);
});

test('pipeline: cada ruta tiene su tope: el mismo cuerpo que no cabe en /v1/eco cabe en /v1/grande', async () => {
  const h = await armar();
  const cuerpo = JSON.stringify({ name: 'form_open', relleno: 'x'.repeat(200) });
  assert.equal((await h.post('/v1/eco', cuerpo)).status, 413);
  // pasa el tope; el validador lo rechaza por la clave de más, que es otro error (400)
  assert.equal((await h.post('/v1/grande', cuerpo)).status, 400);
});

test('pipeline: JSON mal formado, vacío, ilegible o que no es un objeto -> 400 solicitud_invalida', async () => {
  const h = await armar();
  for (const cuerpo of ['{', '', 'no es json', '[]', 'null', '"texto"', '42', 'true', '[{"name":"form_open"}]']) {
    const res = await h.post('/v1/eco', cuerpo);
    assert.equal(res.status, 400, JSON.stringify(cuerpo));
    assert.equal((await res.json()).error, 'solicitud_invalida', JSON.stringify(cuerpo));
  }
  const ilegible = await h.request('/v1/eco', {
    headers: { 'content-type': 'application/json' },
    body: new Uint8Array([0x7b, 0xff, 0x7d]),
  });
  assert.equal(ilegible.status, 400);
  assert.equal((await ilegible.json()).error, 'solicitud_invalida');
  assert.equal(h.llamadas.length, 0);
});

test('pipeline: el validador rechaza una clave de más o un valor inválido -> 400 solicitud_invalida', async () => {
  const h = await armar();
  for (const cuerpo of [{ name: 'otro' }, { name: 'form_open', extra: 1 }, {}, { name: 5 }]) {
    const res = await h.post('/v1/eco', cuerpo);
    assert.equal(res.status, 400, JSON.stringify(cuerpo));
    assert.equal((await res.json()).error, 'solicitud_invalida');
  }
});

test('pipeline: errores por campo -> 400 campos_invalidos con el mapa campos', async () => {
  const h = await armar();
  const res = await h.post('/v1/campos', {});
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: 'campos_invalidos',
    campos: { email: 'formato' },
    mensaje: respuestas.campos_invalidos,
  });
});

test('pipeline: una excepción en la ruta -> 500 error_interno uniforme, sin filtrar el mensaje', async () => {
  const h = await armar();
  const res = await h.post('/v1/roto', { x: 1 });
  assert.equal(res.status, 500);
  const texto = await res.text();
  assert.deepEqual(JSON.parse(texto), { ok: false, error: 'error_interno', mensaje: respuestas.error_interno });
  assert.doesNotMatch(texto, /ana@example\.com|TOKEN-SECRETO/);
  cabecerasDeLaApi(res);
});

test('pipeline: una excepción del validador también es un 500 uniforme', async () => {
  const h = await armar();
  const res = await h.post('/v1/validador-roto', { x: 1 });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'error_interno');
});

test('pipeline: el 500 solo registra la ruta y el nombre del error, nunca el mensaje', async () => {
  const h = await armar();
  await h.post('/v1/roto', { email: 'ana@example.com' });
  assert.equal(h.spy.lineas.length, 1);
  assert.equal(h.spy.lineas[0].nivel, 'error');
  assert.deepEqual(JSON.parse(h.spy.lineas[0].linea), {
    nivel: 'error',
    evento: 'http.error',
    ruta: '/v1/roto',
    codigo: 'TypeError',
  });
  assert.doesNotMatch(h.spy.texto(), /ana@example\.com|TOKEN-SECRETO/);
});

test('pipeline: todas las respuestas de error y de éxito llevan las cabeceras de la API y ninguna pone cookies', async () => {
  const h = await armar();
  const respuestasAProbar = [
    await h.post('/v1/eco', BUENO),
    await h.post('/v1/nada', BUENO),
    await h.request('/v1/eco', { method: 'GET' }),
    await h.post('/v1/eco', BUENO, { origin: null }),
    await h.request('/v1/eco', { headers: { 'content-type': 'text/plain' }, body: 'x' }),
    await h.post('/v1/eco', 'x'.repeat(100)),
    await h.post('/v1/eco', '{'),
    await h.post('/v1/campos', {}),
    await h.post('/v1/roto', {}),
  ];
  assert.equal(respuestasAProbar.length, 9);
  for (const res of respuestasAProbar) cabecerasDeLaApi(res);
});

test('app: scheduled corre cada tarea con los puertos dentro de ctx.waitUntil', async () => {
  const vistas = [];
  const tarea = async (puertos) => {
    vistas.push(puertos);
  };
  const h = await createHarness({ routes: [], jobs: [tarea, tarea] });
  await h.app.scheduled({ cron: '17 3 * * *' }, h.ctx);
  await h.ctx.settle();
  assert.equal(h.ctx.pendientes.length, 2);
  assert.equal(vistas.length, 2);
  assert.equal(vistas[0], h.ports);
});

test('app: scheduled sin tareas no hace nada', async () => {
  const h = await createHarness({ routes: [] });
  await h.app.scheduled({ cron: '17 3 * * *' }, h.ctx);
  assert.equal(h.ctx.pendientes.length, 0);
});
