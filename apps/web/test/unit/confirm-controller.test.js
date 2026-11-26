import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmar, respuestas } from '@tienda/contracts/i18n';
import { mountConfirm } from '../../src/lib/confirm/controller.js';

const TOKEN = 'B'.repeat(43);

/** Una página falsa: los cuatro elementos, el historial y un fetch que se puede controlar. */
function pagina({ hash = `#t=${TOKEN}`, respuestasDeRed = [] } = {}) {
  const llamadas = [];
  const reemplazos = [];
  const cola = [...respuestasDeRed];
  const elementos = {
    mensaje: {
      textContent: '',
      dataset: {},
      enfocado: 0,
      focus() {
        this.enfocado += 1;
      },
    },
    boton: {
      hidden: true,
      disabled: false,
      textContent: '',
      clics: null,
      enfocado: 0,
      focus() {
        this.enfocado += 1;
      },
      addEventListener(_, f) {
        this.clics = f;
      },
    },
    volver: { hidden: true },
  };
  const fetchFn = async (url, init) => {
    llamadas.push({ url, init, botonDeshabilitado: elementos.boton.disabled });
    const siguiente = cola.shift();
    if (siguiente instanceof Error) throw siguiente;
    return { status: siguiente ?? 200 };
  };
  const history = { replaceState: (...args) => reemplazos.push(args) };
  const controlador = mountConfirm({ hash, history, elementos, fetchFn });
  return { controlador, elementos, llamadas, reemplazos };
}

test('página: al cargar saca el token de la barra de direcciones (replaceState a /confirmar) y queda lista', () => {
  const { elementos, reemplazos, controlador } = pagina();
  assert.deepEqual(reemplazos, [[null, '', '/confirmar']]);
  assert.equal(controlador.getState().fase, 'listo');
  assert.equal(elementos.mensaje.textContent, confirmar.listo);
  assert.equal(elementos.boton.hidden, false);
  assert.equal(elementos.boton.disabled, false);
  assert.equal(elementos.boton.textContent, confirmar.boton);
  assert.equal(elementos.volver.hidden, true);
});

test('página: sin enlace no hay botón y se ofrece volver al inicio', () => {
  const { elementos, reemplazos, controlador } = pagina({ hash: '' });
  assert.equal(reemplazos.length, 1, 'igual limpia la barra');
  assert.equal(controlador.getState().fase, 'sin-enlace');
  assert.equal(elementos.mensaje.textContent, confirmar.sinEnlace);
  assert.equal(elementos.mensaje.dataset.tono, 'error');
  assert.equal(elementos.boton.hidden, true);
  assert.equal(elementos.volver.hidden, false);
});

test('página: confirmar manda POST con el token en el cuerpo, bloquea el botón mientras espera y termina confirmado', async () => {
  const { elementos, llamadas, controlador } = pagina({ respuestasDeRed: [200] });
  await controlador.confirmar();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, '/v1/waitlist/confirm');
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.body, JSON.stringify({ token: TOKEN }));
  assert.equal(llamadas[0].botonDeshabilitado, true, 'el botón ya estaba desactivado durante el pedido');
  assert.equal(controlador.getState().fase, 'confirmado');
  assert.equal(controlador.getState().token, null);
  assert.equal(elementos.mensaje.textContent, respuestas.confirmado);
  assert.equal(elementos.mensaje.dataset.tono, 'ok');
  assert.equal(elementos.boton.hidden, true);
  assert.equal(elementos.volver.hidden, false);
  assert.equal(elementos.mensaje.enfocado, 1, 'el foco pasa al resultado para quien usa lector de pantalla');
  assert.equal(elementos.boton.enfocado, 0);
});

test('página: un enlace inválido o vencido (400) muestra el error, no se reintenta y lleva el foco al mensaje', async () => {
  const { elementos, llamadas, controlador } = pagina({ respuestasDeRed: [400] });
  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'invalido');
  assert.equal(elementos.mensaje.textContent, respuestas.enlace_invalido);
  assert.equal(elementos.mensaje.dataset.tono, 'error');
  assert.equal(elementos.boton.hidden, true);
  assert.equal(elementos.volver.hidden, false);
  assert.equal(elementos.mensaje.enfocado, 1);
  assert.equal(elementos.boton.enfocado, 0, 'sin botón que reintentar, el foco va solo al mensaje');
  await controlador.confirmar();
  assert.equal(llamadas.length, 1, 'no hay segundo pedido con un enlace inválido');
});

test('página: si la red falla o el servidor da error, el botón vuelve como "Intentar de nuevo" y reintenta con el mismo token', async () => {
  const { elementos, llamadas, controlador } = pagina({ respuestasDeRed: [new Error('sin red'), 503, 200] });
  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'error-red');
  assert.equal(elementos.mensaje.textContent, confirmar.errorRed);
  assert.equal(elementos.boton.hidden, false);
  assert.equal(elementos.boton.disabled, false);
  assert.equal(elementos.boton.textContent, confirmar.reintentar);
  assert.equal(elementos.mensaje.enfocado, 0, 'un error de red no manda el foco al mensaje');
  assert.equal(elementos.boton.enfocado, 1, 'el botón se deshabilitó al enviar (el foco cayó al body): se lo devuelve');

  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'error-red', '503 también deja reintentar');
  assert.equal(elementos.boton.enfocado, 2, 'y también devuelve el foco al botón');

  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'confirmado');
  assert.equal(llamadas.length, 3);
  assert.ok(llamadas.every((l) => l.init.body === JSON.stringify({ token: TOKEN })));
});

test('página: un 429 muestra el aviso de esperar (no el de conexión), deja el botón para reintentar y le devuelve el foco', async () => {
  const { elementos, llamadas, controlador } = pagina({ respuestasDeRed: [429, 200] });
  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'demasiados-intentos');
  assert.equal(elementos.mensaje.textContent, respuestas.demasiados_intentos);
  assert.equal(elementos.mensaje.dataset.tono, 'error');
  assert.equal(elementos.boton.hidden, false);
  assert.equal(elementos.boton.disabled, false);
  assert.equal(elementos.boton.textContent, confirmar.reintentar);
  assert.equal(elementos.mensaje.enfocado, 0);
  assert.equal(elementos.boton.enfocado, 1, 'el botón vuelve a estar activo y recupera el foco');
  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'confirmado');
  assert.equal(elementos.boton.enfocado, 1, 'un resultado definitivo no toca el botón (ya está oculto)');
  assert.equal(llamadas.length, 2);
});

test('página: el pedido lleva una señal de tiempo máximo', async () => {
  const { llamadas, controlador } = pagina({ respuestasDeRed: [200] });
  await controlador.confirmar();
  assert.ok(llamadas[0].init.signal instanceof AbortSignal);
});

test('página: si la conexión se cuelga, el tiempo vence, el botón vuelve como "Intentar de nuevo" y se puede reintentar', async () => {
  const llamadas = [];
  // un fetch que nunca responde, pero que obedece a la señal de aborto como el de verdad
  const fetchFn = (url, init) =>
    new Promise((_, rechazar) => {
      llamadas.push(init);
      if (llamadas.length === 2) return rechazar(new Error('segunda vez: responde mal'));
      init.signal.addEventListener('abort', () => rechazar(init.signal.reason));
    });
  const elementos = {
    mensaje: { textContent: '', dataset: {}, focus() {} },
    boton: {
      hidden: true,
      disabled: false,
      textContent: '',
      enfocado: 0,
      focus() {
        this.enfocado += 1;
      },
      addEventListener() {},
    },
    volver: { hidden: true },
  };
  const controlador = mountConfirm({
    hash: `#t=${TOKEN}`,
    history: { replaceState() {} },
    elementos,
    fetchFn,
    timeoutMs: 20,
  });
  const espera = controlador.confirmar();
  assert.equal(elementos.boton.disabled, true, 'mientras espera, el botón está bloqueado');
  assert.equal(elementos.boton.textContent, confirmar.enviando);
  await espera;
  assert.equal(controlador.getState().fase, 'error-red');
  assert.equal(elementos.boton.disabled, false);
  assert.equal(elementos.boton.textContent, confirmar.reintentar);
  assert.equal(elementos.mensaje.textContent, confirmar.errorRed);
  assert.equal(elementos.boton.enfocado, 1, 'tras el tiempo vencido el foco vuelve al botón de reintentar');
  await controlador.confirmar();
  assert.equal(llamadas.length, 2, 'el reintento sale con una señal nueva');
});

test('página: dos pulsaciones seguidas mandan un solo pedido', async () => {
  const { llamadas, controlador } = pagina({ respuestasDeRed: [200] });
  await Promise.all([controlador.confirmar(), controlador.confirmar()]);
  assert.equal(llamadas.length, 1);
  assert.equal(controlador.getState().fase, 'confirmado');
});

test('página: el botón de la página está enganchado a confirmar', async () => {
  const { elementos, llamadas } = pagina({ respuestasDeRed: [200] });
  assert.equal(typeof elementos.boton.clics, 'function');
  await elementos.boton.clics();
  assert.equal(llamadas.length, 1);
});
