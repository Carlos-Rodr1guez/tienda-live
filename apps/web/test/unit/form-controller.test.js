import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormController } from '../../src/lib/form/controller.js';
import { SUCCESS_FOCUS_ID } from '../../src/lib/form/model.js';
import { formulario, respuestas } from '@tienda/contracts/i18n';

const VALIDOS = {
  email: 'Persona@Ejemplo.com',
  tiktok_user: '',
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['accion'],
  followers_range: '',
  country: '',
  consent: true,
};

/** El controlador con todo de mentira: la vista anota lo que pinta, Turnstile entrega el token a mano. */
function armar({ campos = VALIDOS, respuesta = { status: 202, body: { ok: true } }, falla = false } = {}) {
  const pintados = [];
  const foco = [];
  const verificacion = [];
  const eventos = [];
  const pedidos = [];
  const widgets = { renders: 0, resets: [], manejadores: null, rechazar: false };
  const ui = {
    slot: { id: 'ranura' },
    readFields: () => campos,
    renderState: (estado) => pintados.push(estado),
    focusId: (id) => foco.push(id),
    showVerificationError: (hay) => verificacion.push(hay),
  };
  const turnstile = {
    render: async (_slot, manejadores) => {
      widgets.renders += 1;
      widgets.manejadores = manejadores;
      if (widgets.rechazar) throw new Error('no se pudo cargar la verificación');
      return `w${widgets.renders}`;
    },
    reset: (id) => widgets.resets.push(id),
  };
  const analytics = { track: (nombre) => eventos.push(nombre) };
  const fetchFn = async (url, init) => {
    pedidos.push({ url, init });
    if (falla) throw new TypeError('fetch failed');
    return { status: respuesta.status, json: async () => respuesta.body };
  };
  const controlador = createFormController({ ui, analytics, turnstile, fetchFn });
  return { controlador, pintados, foco, verificacion, eventos, pedidos, widgets, ultimo: () => pintados.at(-1) };
}

test('abrir el formulario: cuenta form_open y pinta Turnstile una sola vez, aunque se cierre y se vuelva a abrir', async () => {
  const t = armar();
  await t.controlador.onToggle(true);
  await t.controlador.onToggle(false);
  await t.controlador.onToggle(true);
  assert.deepEqual(t.eventos, ['form_open', 'form_open'], 'cada apertura avisa; analytics deduplica por vista');
  assert.equal(t.widgets.renders, 1);
  assert.deepEqual(t.verificacion, [false]);
});

test('cerrar el formulario no mide nada ni pinta Turnstile', async () => {
  const t = armar();
  await t.controlador.onToggle(false);
  assert.deepEqual(t.eventos, []);
  assert.equal(t.widgets.renders, 0);
});

test('si la verificación no carga se muestra el error con reintento, y reintentar la vuelve a pedir', async () => {
  const t = armar();
  t.widgets.rechazar = true;
  await t.controlador.onToggle(true);
  assert.deepEqual(t.verificacion, [true]);
  t.widgets.rechazar = false;
  await t.controlador.retryVerification();
  assert.deepEqual(t.verificacion, [true, false]);
  assert.equal(t.widgets.renders, 2);
});

test('enviar con campos inválidos: no hay pedido, se pintan los errores y el foco va al primer campo con error', async () => {
  const t = armar({ campos: { ...VALIDOS, email: 'no-es-un-correo', interests: [] } });
  await t.controlador.onToggle(true);
  t.widgets.manejadores.onToken('token-ok');
  await t.controlador.onSubmit();
  assert.equal(t.pedidos.length, 0);
  assert.equal(t.ultimo().fase, 'editando');
  assert.deepEqual(
    t.ultimo().errores.map((e) => e.campo),
    ['email', 'interests'],
  );
  assert.equal(t.ultimo().mensaje, respuestas.campos_invalidos);
  assert.deepEqual(t.foco, ['campo-email']);
});

test('enviar sin haber superado la verificación: no hay pedido y se pide completar la verificación', async () => {
  const t = armar();
  await t.controlador.onToggle(true);
  await t.controlador.onSubmit();
  assert.equal(t.pedidos.length, 0);
  assert.equal(t.ultimo().fase, 'error');
  assert.equal(t.ultimo().mensaje, respuestas.verificacion_fallida);
});

test('un token vencido se descarta: enviar después de expirar pide la verificación otra vez', async () => {
  const t = armar();
  await t.controlador.onToggle(true);
  t.widgets.manejadores.onToken('token-ok');
  t.widgets.manejadores.onExpire();
  await t.controlador.onSubmit();
  assert.equal(t.pedidos.length, 0);
  assert.equal(t.ultimo().mensaje, respuestas.verificacion_fallida);
});

test('envío correcto: pasa por "enviando" con el botón bloqueado, manda el cuerpo de la API y deja el foco en el título de éxito', async () => {
  const t = armar();
  await t.controlador.onToggle(true);
  t.widgets.manejadores.onToken('token-ok');
  const envio = t.controlador.onSubmit();
  // un segundo clic mientras envía no manda otro pedido
  const repetido = t.controlador.onSubmit();
  await Promise.all([envio, repetido]);

  assert.equal(t.pedidos.length, 1);
  assert.equal(t.pedidos[0].url, '/v1/waitlist');
  assert.equal(t.pedidos[0].init.method, 'POST');
  assert.equal(t.pedidos[0].init.credentials, 'omit');
  const cuerpo = JSON.parse(t.pedidos[0].init.body);
  assert.equal(cuerpo.email, 'persona@ejemplo.com');
  assert.equal(cuerpo.turnstile_token, 'token-ok');
  assert.equal(cuerpo.consent_version, 'v1');
  assert.deepEqual(cuerpo.interests, ['accion']);

  assert.ok(
    t.pintados.some((p) => p.fase === 'enviando'),
    'se pintó el estado enviando',
  );
  assert.equal(t.ultimo().fase, 'exito');
  assert.equal(t.ultimo().mensaje, respuestas.exito);
  assert.deepEqual(t.foco, [SUCCESS_FOCUS_ID]);
  // el token se gastó: el widget se reinicia para otro intento
  assert.deepEqual(t.widgets.resets, ['w1']);
});

test('la API rechaza campos: se pintan sus errores, el foco va al primero y el envío se puede repetir', async () => {
  const t = armar({
    respuesta: {
      status: 400,
      body: { ok: false, error: 'campos_invalidos', campos: { country: 'opcion', email: 'formato' } },
    },
  });
  await t.controlador.onToggle(true);
  t.widgets.manejadores.onToken('token-ok');
  await t.controlador.onSubmit();
  assert.equal(t.ultimo().fase, 'error');
  assert.deepEqual(
    t.ultimo().errores.map((e) => e.campo),
    ['email', 'country'],
  );
  assert.deepEqual(t.foco, ['campo-email']);
  assert.deepEqual(t.widgets.resets, ['w1']);
});

test('sin conexión: mensaje de red, botón disponible de nuevo y Turnstile reiniciado', async () => {
  const t = armar({ falla: true });
  await t.controlador.onToggle(true);
  t.widgets.manejadores.onToken('token-ok');
  await t.controlador.onSubmit();
  assert.equal(t.ultimo().fase, 'error');
  assert.equal(t.ultimo().mensaje, formulario.errorRed);
  assert.deepEqual(t.widgets.resets, ['w1']);
});

test('una respuesta que no es JSON se trata como error del servidor sin romper el formulario', async () => {
  const t = armar({ respuesta: { status: 500, body: undefined } });
  await t.controlador.onToggle(true);
  t.widgets.manejadores.onToken('token-ok');
  await t.controlador.onSubmit();
  assert.equal(t.ultimo().fase, 'error');
  assert.equal(t.ultimo().mensaje, respuestas.error_interno);
});

test('el estado inicial se pinta al montar: el botón queda habilitado y sin errores', () => {
  const t = armar();
  t.controlador.mount();
  assert.equal(t.ultimo().fase, 'editando');
  assert.deepEqual(t.ultimo().errores, []);
});
