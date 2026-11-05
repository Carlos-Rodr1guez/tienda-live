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
  assert.equal(elementos.mensaje.enfocado, 0, 'un error de red no roba el foco: el botón sigue ahí');

  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'error-red', '503 también deja reintentar');

  await controlador.confirmar();
  assert.equal(controlador.getState().fase, 'confirmado');
  assert.equal(llamadas.length, 3);
  assert.ok(llamadas.every((l) => l.init.body === JSON.stringify({ token: TOKEN })));
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
