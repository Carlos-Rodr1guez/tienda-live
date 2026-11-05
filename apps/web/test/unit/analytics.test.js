import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, isTrackedPath } from '../../src/lib/analytics.js';

/** Un fetch falso que anota las llamadas. */
function fetchFalso(comportamiento = () => Promise.resolve({ status: 204 })) {
  const llamadas = [];
  const fn = (url, init) => {
    llamadas.push({ url, init });
    return comportamiento(url, init);
  };
  return { fn, llamadas };
}

test('analytics: track envía POST /v1/events con keepalive y el nombre del evento', async () => {
  const { fn, llamadas } = fetchFalso();
  const analytics = createAnalytics({ fetch: fn });
  assert.equal(await analytics.track('form_open'), true);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, '/v1/events');
  assert.equal(llamadas[0].init.method, 'POST');
  assert.equal(llamadas[0].init.keepalive, true);
  assert.equal(llamadas[0].init.credentials, 'omit');
  assert.equal(llamadas[0].init.headers['Content-Type'], 'application/json');
  assert.equal(llamadas[0].init.body, '{"name":"form_open"}');
});

test('analytics: cada evento se manda una sola vez por vista de página; eventos distintos no se pisan', async () => {
  const { fn, llamadas } = fetchFalso();
  const analytics = createAnalytics({ fetch: fn });
  assert.equal(await analytics.track('form_open'), true);
  assert.equal(await analytics.track('form_open'), false);
  assert.equal(await analytics.track('video_play'), true);
  assert.equal(await analytics.track('video_play'), false);
  assert.deepEqual(
    llamadas.map((l) => l.init.body),
    ['{"name":"form_open"}', '{"name":"video_play"}'],
  );
  // otra vista de página (otra instancia) vuelve a contar
  const otra = createAnalytics({ fetch: fn });
  assert.equal(await otra.track('form_open'), true);
  assert.equal(llamadas.length, 3);
});

test('analytics: un nombre fuera de la lista de contracts no se envía', async () => {
  const { fn, llamadas } = fetchFalso();
  const analytics = createAnalytics({ fetch: fn });
  for (const malo of ['otro_evento', '', undefined, 5, null]) {
    assert.equal(await analytics.track(malo), false, String(malo));
  }
  assert.equal(llamadas.length, 0);
});

test('analytics: si la red falla, o fetch lanza, no se propaga nada y no se reintenta', async () => {
  const rechazado = fetchFalso(() => Promise.reject(new TypeError('Failed to fetch')));
  const a = createAnalytics({ fetch: rechazado.fn });
  assert.equal(await a.track('form_open'), true, 'se intentó enviar');
  assert.equal(await a.track('form_open'), false, 'no se reintenta en la misma vista');
  assert.equal(rechazado.llamadas.length, 1);

  const lanza = fetchFalso(() => {
    throw new Error('boom');
  });
  const b = createAnalytics({ fetch: lanza.fn });
  await assert.doesNotReject(b.track('video_play'));
});

test('analytics: desactivado (la página /confirmar) no envía nada ni lo recuerda', async () => {
  const { fn, llamadas } = fetchFalso();
  const analytics = createAnalytics({ fetch: fn, enabled: false });
  assert.equal(await analytics.track('form_open'), false);
  assert.equal(llamadas.length, 0);
});

test('analytics: sin fetch disponible no hace nada y no falla', async () => {
  // `null` es "sin fetch"; `undefined` usaría el fetch global
  const analytics = createAnalytics({ fetch: null });
  assert.equal(await analytics.track('form_open'), false);
});

test('analytics: isTrackedPath es falso en /confirmar (con o sin .html) y verdadero en el resto', () => {
  assert.equal(isTrackedPath('/confirmar'), false);
  assert.equal(isTrackedPath('/confirmar.html'), false);
  assert.equal(isTrackedPath('/'), true);
  assert.equal(isTrackedPath('/juegos/asedio'), true);
  assert.equal(isTrackedPath('/confirmar-otra'), true);
});
