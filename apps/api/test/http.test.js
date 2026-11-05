import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, noContent, errorResponse, methodNotAllowed } from '../src/http/respond.js';
import { readBody } from '../src/http/body.js';
import { createRouter } from '../src/http/router.js';
import { API_RESPONSE_HEADERS } from '@tienda/contracts/security-headers';
import { respuestas } from '@tienda/contracts/i18n';

function cabecerasDe(res) {
  return Object.fromEntries(res.headers);
}

function conCabecerasDeLaApi(res) {
  for (const [nombre, valor] of Object.entries(API_RESPONSE_HEADERS)) {
    assert.equal(res.headers.get(nombre), valor, nombre);
  }
  assert.equal(res.headers.has('set-cookie'), false);
  assert.equal(res.headers.has('access-control-allow-origin'), false);
}

// ---- respond.js

test('respond: jsonResponse lleva el estado, el cuerpo JSON, el tipo y las cabeceras de la API', async () => {
  const res = jsonResponse(202, { ok: true, mensaje: 'hola' });
  assert.equal(res.status, 202);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  conCabecerasDeLaApi(res);
  assert.deepEqual(await res.json(), { ok: true, mensaje: 'hola' });
});

test('respond: noContent es un 204 sin cuerpo ni tipo de contenido, pero con las cabeceras de la API', async () => {
  const res = noContent();
  assert.equal(res.status, 204);
  assert.equal(res.headers.has('content-type'), false);
  conCabecerasDeLaApi(res);
  assert.equal(await res.text(), '');
});

test('respond: errorResponse usa el estado por defecto del código y el mensaje del diccionario', async () => {
  for (const [codigo, estado] of [
    ['no_encontrado', 404],
    ['demasiado_grande', 413],
    ['origen_no_permitido', 403],
    ['error_interno', 500],
    ['no_disponible', 503],
  ]) {
    const res = errorResponse(codigo);
    assert.equal(res.status, estado, codigo);
    conCabecerasDeLaApi(res);
    assert.deepEqual(await res.json(), { ok: false, error: codigo, mensaje: respuestas[codigo] });
  }
});

test('respond: errorResponse acepta otro estado (415 para solicitud_invalida) y los campos con error', async () => {
  const res = errorResponse('solicitud_invalida', { status: 415 });
  assert.equal(res.status, 415);
  assert.equal((await res.json()).error, 'solicitud_invalida');

  const campos = errorResponse('campos_invalidos', { campos: { email: 'formato' } });
  assert.equal(campos.status, 400);
  assert.deepEqual(await campos.json(), {
    ok: false,
    error: 'campos_invalidos',
    campos: { email: 'formato' },
    mensaje: respuestas.campos_invalidos,
  });
});

test('respond: methodNotAllowed es un 405 con Allow: POST, sin cuerpo y sin cookies', async () => {
  const res = methodNotAllowed();
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  conCabecerasDeLaApi(res);
  assert.equal(await res.text(), '');
});

test('respond: las cabeceras de una respuesta no se comparten entre respuestas', () => {
  const a = jsonResponse(200, {});
  a.headers.set('x-prueba', '1');
  assert.equal(cabecerasDe(jsonResponse(200, {}))['x-prueba'], undefined);
});

// ---- body.js

function pedido(cuerpo, cabeceras = {}) {
  return new Request('http://localhost/v1/x', { method: 'POST', body: cuerpo, headers: cabeceras });
}

test('body: lee un cuerpo que cabe en el tope y devuelve el texto', async () => {
  const res = await readBody(pedido('{"a":1}'), 256);
  assert.deepEqual(res, { estado: 'ok', texto: '{"a":1}' });
});

test('body: el tope cuenta bytes, no caracteres: 3 letras de 2 bytes pasan un tope de 6 y no uno de 5', async () => {
  assert.equal((await readBody(pedido('ñññ'), 6)).estado, 'ok');
  assert.equal((await readBody(pedido('ñññ'), 5)).estado, 'demasiado_grande');
});

test('body: justo en el tope pasa y un byte más es demasiado grande', async () => {
  assert.equal((await readBody(pedido('a'.repeat(256)), 256)).estado, 'ok');
  assert.equal((await readBody(pedido('a'.repeat(257)), 256)).estado, 'demasiado_grande');
});

test('body: un Content-Length por encima del tope corta antes de leer nada', async () => {
  let leyo = false;
  // highWaterMark 0: el flujo no pide datos por su cuenta, solo cuando alguien lee
  const cuerpo = new ReadableStream(
    {
      pull(c) {
        leyo = true;
        c.enqueue(new TextEncoder().encode('a'));
      },
    },
    { highWaterMark: 0 },
  );
  const solicitud = new Request('http://localhost/v1/x', {
    method: 'POST',
    body: cuerpo,
    duplex: 'half',
    headers: { 'content-length': '5000' },
  });
  assert.equal((await readBody(solicitud, 256)).estado, 'demasiado_grande');
  assert.equal(leyo, false);
});

test('body: un cuerpo sin Content-Length se cuenta mientras se lee y se corta al pasar el tope', async () => {
  let enviados = 0;
  const cuerpo = new ReadableStream({
    pull(c) {
      enviados += 1;
      c.enqueue(new TextEncoder().encode('a'.repeat(100)));
      if (enviados >= 1000) c.close();
    },
  });
  const solicitud = new Request('http://localhost/v1/x', { method: 'POST', body: cuerpo, duplex: 'half' });
  assert.equal(solicitud.headers.has('content-length'), false);
  const res = await readBody(solicitud, 256);
  assert.equal(res.estado, 'demasiado_grande');
  assert.ok(enviados < 10, `se leyeron ${enviados} trozos de 100 bytes: debió cortar al pasar 256`);
});

test('body: un Content-Length mentiroso (menor que el cuerpo real) no evita el tope', async () => {
  const cuerpo = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('a'.repeat(1000)));
      c.close();
    },
  });
  const solicitud = new Request('http://localhost/v1/x', {
    method: 'POST',
    body: cuerpo,
    duplex: 'half',
    headers: { 'content-length': '10' },
  });
  assert.equal((await readBody(solicitud, 256)).estado, 'demasiado_grande');
});

test('body: sin cuerpo da texto vacío', async () => {
  const solicitud = new Request('http://localhost/v1/x', { method: 'POST' });
  assert.deepEqual(await readBody(solicitud, 256), { estado: 'ok', texto: '' });
});

test('body: bytes que no son UTF-8 válido son ilegibles', async () => {
  const solicitud = pedido(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]));
  assert.equal((await readBody(solicitud, 256)).estado, 'ilegible');
});

test('body: un cuerpo en varios trozos se junta en orden', async () => {
  const trozos = ['{"na', 'me":"', 'form_open"}'];
  const cuerpo = new ReadableStream({
    start(c) {
      for (const t of trozos) c.enqueue(new TextEncoder().encode(t));
      c.close();
    },
  });
  const solicitud = new Request('http://localhost/v1/x', { method: 'POST', body: cuerpo, duplex: 'half' });
  assert.deepEqual(await readBody(solicitud, 256), { estado: 'ok', texto: '{"name":"form_open"}' });
});

// ---- router.js

test('router: encuentra la ruta por camino exacto y devuelve null si no existe', () => {
  const a = { path: '/v1/a' };
  const b = { path: '/v1/b' };
  const router = createRouter([a, b]);
  assert.equal(router.match('/v1/a'), a);
  assert.equal(router.match('/v1/b'), b);
  assert.equal(router.match('/v1/c'), null);
});

test('router: no hace coincidir variantes (barra final, mayúsculas, prefijos)', () => {
  const router = createRouter([{ path: '/v1/events' }]);
  for (const camino of ['/v1/events/', '/V1/events', '/v1/event', '/v1/events/x', '/', '']) {
    assert.equal(router.match(camino), null, camino);
  }
});

test('router: un camino repetido es un error de programación', () => {
  assert.throws(() => createRouter([{ path: '/v1/a' }, { path: '/v1/a' }]), /\/v1\/a/);
});

test('router: no confunde nombres heredados de Object con rutas', () => {
  const router = createRouter([{ path: '/v1/a' }]);
  for (const camino of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(router.match(camino), null, camino);
  }
});
