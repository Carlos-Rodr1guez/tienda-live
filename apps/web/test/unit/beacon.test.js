import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEACON_SRC, beaconAttributes, injectBeacon } from '../../src/lib/beacon.js';

/** Un documento mínimo: lo justo para ver qué script se agrega y dónde. */
function documentoFalso({ analytics = 'on' } = {}) {
  const agregados = [];
  return {
    agregados,
    documentElement: { dataset: { analytics } },
    createElement(etiqueta) {
      const atributos = {};
      return {
        etiqueta,
        atributos,
        setAttribute(nombre, valor) {
          atributos[nombre] = valor;
        },
      };
    },
    head: { append: (nodo) => agregados.push(nodo) },
  };
}

test('beacon: los atributos del script salen del token (src de Cloudflare, defer y data-cf-beacon con el token)', () => {
  assert.equal(BEACON_SRC, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.deepEqual(beaconAttributes('abc123'), {
    src: BEACON_SRC,
    defer: '',
    'data-cf-beacon': '{"token":"abc123"}',
  });
});

test('beacon: sin token, vacío o que no es texto no hay beacon', () => {
  for (const malo of [undefined, null, '', '   ', 42, {}]) assert.equal(beaconAttributes(malo), null, String(malo));
});

test('beacon: con token y analítica encendida agrega un solo script al <head>', () => {
  const doc = documentoFalso();
  assert.equal(injectBeacon({ token: 'abc123', doc, pathname: '/' }), true);
  assert.equal(doc.agregados.length, 1);
  assert.equal(doc.agregados[0].etiqueta, 'script');
  assert.equal(doc.agregados[0].atributos.src, BEACON_SRC);
  assert.equal(doc.agregados[0].atributos['data-cf-beacon'], '{"token":"abc123"}');
});

test('beacon: no se agrega sin token, con la analítica apagada en la página ni en /confirmar', () => {
  const sinToken = documentoFalso();
  assert.equal(injectBeacon({ token: undefined, doc: sinToken, pathname: '/' }), false);
  assert.equal(sinToken.agregados.length, 0);

  const apagada = documentoFalso({ analytics: 'off' });
  assert.equal(injectBeacon({ token: 'abc123', doc: apagada, pathname: '/404' }), false);
  assert.equal(apagada.agregados.length, 0);

  for (const ruta of ['/confirmar', '/confirmar.html']) {
    const doc = documentoFalso();
    assert.equal(injectBeacon({ token: 'abc123', doc, pathname: ruta }), false, ruta);
    assert.equal(doc.agregados.length, 0, ruta);
  }
});
