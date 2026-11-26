import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_QUERY,
  FLEXIBLE_MIN_WIDTH,
  SCRIPT_SRC,
  TEST_SITE_KEY,
  chooseSize,
  createTurnstile,
  resolveSiteKey,
} from '../../src/lib/turnstile.js';

/** Una ranura de mentira que mide `ancho` píxeles (como getBoundingClientRect de la ranura real). */
const ranura = (ancho) => ({ getBoundingClientRect: () => ({ width: ancho }) });

/** Un documento y una ventana de mentira: guardan los <script> que se agregan y dejan resolver su carga a mano. */
function entorno({ ancho = 1024 } = {}) {
  const scripts = [];
  const llamadas = [];
  const win = {
    matchMedia: (consulta) => ({ matches: consulta === COMPACT_QUERY && ancho <= 379 }),
    turnstile: undefined,
  };
  const doc = {
    createElement: (etiqueta) => ({ etiqueta }),
    head: { appendChild: (el) => scripts.push(el) },
  };
  const cargar = () => {
    win.turnstile = {
      render: (contenedor, opciones) => {
        llamadas.push({ contenedor, opciones });
        return `widget-${llamadas.length}`;
      },
      reset: (id) => llamadas.push({ reset: id }),
    };
    scripts.at(-1).onload();
  };
  return { win, doc, scripts, llamadas, cargar };
}

test('chooseSize: compact si la ranura mide menos de 300px y flexible desde ahí (flexible necesita 300px como mínimo)', () => {
  assert.equal(FLEXIBLE_MIN_WIDTH, 300);
  // la ranura es 80px más angosta que la pantalla (márgenes del contenedor y relleno de la tarjeta)
  assert.equal(chooseSize({ slot: ranura(280) }), 'compact', 'ranura de 280px (pantalla de 360px)');
  assert.equal(chooseSize({ slot: ranura(295) }), 'compact', 'ranura de 295px (pantalla de 375px)');
  assert.equal(chooseSize({ slot: ranura(299.5) }), 'compact');
  assert.equal(chooseSize({ slot: ranura(300) }), 'flexible');
  assert.equal(chooseSize({ slot: ranura(560) }), 'flexible');
});

test('chooseSize: si la ranura no se puede medir, decide la pantalla (compact por debajo de 380px) o flexible sin matchMedia', () => {
  assert.equal(COMPACT_QUERY, '(max-width: 379px)');
  const sinMedida = [undefined, {}, { getBoundingClientRect: () => ({ width: 0 }) }, ranura(Number.NaN)];
  for (const slot of sinMedida) {
    assert.equal(chooseSize({ slot, matchMedia: entorno({ ancho: 360 }).win.matchMedia }), 'compact');
    assert.equal(chooseSize({ slot, matchMedia: entorno({ ancho: 375 }).win.matchMedia }), 'compact');
    assert.equal(chooseSize({ slot, matchMedia: entorno({ ancho: 380 }).win.matchMedia }), 'flexible');
    assert.equal(chooseSize({ slot, matchMedia: undefined }), 'flexible', 'sin matchMedia se asume pantalla ancha');
  }
  assert.equal(chooseSize({}), 'flexible');
});

test('chooseSize: lo medido manda sobre la pantalla', () => {
  const pantallaAngosta = entorno({ ancho: 320 }).win.matchMedia;
  assert.equal(chooseSize({ slot: ranura(320), matchMedia: pantallaAngosta }), 'flexible');
  const pantallaAncha = entorno({ ancho: 1280 }).win.matchMedia;
  assert.equal(chooseSize({ slot: ranura(280), matchMedia: pantallaAncha }), 'compact');
});

test('resolveSiteKey: usa la clave del sitio y, si falta o está vacía, la clave de pruebas de Cloudflare', () => {
  assert.equal(TEST_SITE_KEY, '1x00000000000000000000AA');
  assert.equal(resolveSiteKey('0x4AAAAAAAreal'), '0x4AAAAAAAreal');
  assert.equal(resolveSiteKey('  0x4AAAAAAAreal  '), '0x4AAAAAAAreal');
  for (const vacia of [undefined, '', '   ', null]) assert.equal(resolveSiteKey(vacia), TEST_SITE_KEY);
});

test('render: carga api.js una sola vez (modo explícito) aunque se pida dos veces, y pinta el widget con los datos del formulario', async () => {
  const e = entorno({ ancho: 320 });
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '' });
  const contenedor = { id: 'ranura', ...ranura(280) };
  const handlers = { onToken: () => {}, onExpire: () => {}, onError: () => {} };

  const a = t.render(contenedor, handlers);
  const b = t.render(contenedor, handlers);
  assert.equal(e.scripts.length, 1, 'un solo <script>');
  assert.equal(e.scripts[0].src, SCRIPT_SRC);
  assert.match(SCRIPT_SRC, /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit$/);
  assert.equal(e.scripts[0].async, true);
  assert.equal(e.scripts[0].defer, true);
  e.cargar();
  assert.deepEqual(await Promise.all([a, b]), ['widget-1', 'widget-2']);

  const { opciones } = e.llamadas[0];
  assert.equal(opciones.sitekey, TEST_SITE_KEY);
  assert.equal(opciones.action, 'waitlist');
  assert.equal(opciones.theme, 'dark');
  assert.equal(opciones.size, 'compact');
  assert.equal(opciones['response-field'], false);
  assert.equal(opciones.callback, handlers.onToken);
  assert.equal(opciones['expired-callback'], handlers.onExpire);
  assert.equal(opciones['error-callback'], handlers.onError);
  assert.equal(e.llamadas[0].contenedor, contenedor);
});

test('render: ya cargado no vuelve a pedir api.js, y con la ranura ancha usa flexible', async () => {
  const e = entorno({ ancho: 1280 });
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '0x4AAAAAAAreal' });
  const primero = t.render(ranura(560), { onToken() {}, onExpire() {}, onError() {} });
  e.cargar();
  await primero;
  await t.render(ranura(560), { onToken() {}, onExpire() {}, onError() {} });
  assert.equal(e.scripts.length, 1);
  assert.equal(e.llamadas[0].opciones.size, 'flexible');
  assert.equal(e.llamadas[0].opciones.sitekey, '0x4AAAAAAAreal');
});

test('render: el tamaño sale de la ranura medida al pintar, no de la pantalla (320 a 379px de pantalla son compact)', async () => {
  for (const [anchoRanura, esperado] of [
    [240, 'compact'],
    [280, 'compact'],
    [295, 'compact'],
    [300, 'flexible'],
    [310, 'flexible'],
  ]) {
    const e = entorno({ ancho: 1280 }); // una pantalla ancha no cambia lo medido
    const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '' });
    const p = t.render(ranura(anchoRanura), { onToken() {}, onExpire() {}, onError() {} });
    e.cargar();
    await p;
    assert.equal(e.llamadas[0].opciones.size, esperado, `ranura de ${anchoRanura}px`);
  }
});

test('render: si api.js carga pero window.turnstile no existe, falla, olvida la carga y el reintento la vuelve a pedir', async () => {
  const e = entorno();
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '' });
  const intento1 = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  e.scripts[0].onload(); // carga "bien" pero no deja window.turnstile
  await assert.rejects(intento1, /verificación/);
  assert.equal(e.scripts.length, 1);

  const intento2 = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  assert.equal(e.scripts.length, 2, 'el reintento pide api.js de nuevo (no queda atascado en la carga fallida)');
  e.cargar();
  assert.equal(await intento2, 'widget-1');
  // ya cargado bien: otro render no agrega más scripts
  await t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  assert.equal(e.scripts.length, 2);
});

test('render: varios intentos fallidos seguidos no apilan scripts viejos', async () => {
  const e = entorno();
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '' });
  const quitados = [];
  e.doc.createElement = (etiqueta) => ({ etiqueta, remove: () => quitados.push(etiqueta) });
  const intento = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  e.scripts[0].onload();
  await assert.rejects(intento, /verificación/);
  assert.deepEqual(quitados, ['script'], 'el script que no dejó nada se quita del documento');
});

test('render: si api.js no carga, falla; un reintento vuelve a pedirlo (no queda atascado en el primer error)', async () => {
  const e = entorno();
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '' });
  const intento1 = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  e.scripts[0].onerror();
  await assert.rejects(intento1, /verificación/);

  const intento2 = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  assert.equal(e.scripts.length, 2, 'el reintento agrega un script nuevo');
  e.cargar();
  assert.equal(await intento2, 'widget-1');
});

test('reset: reinicia el widget para pedir otro token (después de un envío fallido el token ya no sirve)', async () => {
  const e = entorno();
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '' });
  const p = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  e.cargar();
  const id = await p;
  t.reset(id);
  assert.deepEqual(e.llamadas.at(-1), { reset: id });
  assert.doesNotThrow(() => t.reset(null), 'sin widget no hace nada');
});
