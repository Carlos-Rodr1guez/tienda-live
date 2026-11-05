import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_QUERY,
  SCRIPT_SRC,
  TEST_SITE_KEY,
  chooseSize,
  createTurnstile,
  resolveSiteKey,
} from '../../src/lib/turnstile.js';

/** Un documento y una ventana de mentira: guardan los <script> que se agregan y dejan resolver su carga a mano. */
function entorno({ ancho = 1024 } = {}) {
  const scripts = [];
  const llamadas = [];
  const win = {
    matchMedia: (consulta) => ({ matches: consulta === COMPACT_QUERY && ancho <= 339 }),
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

test('chooseSize: compact por debajo de 340px y flexible desde ahí (flexible mide 300px como mínimo y desborda a 320px)', () => {
  assert.equal(COMPACT_QUERY, '(max-width: 339px)');
  assert.equal(chooseSize(entorno({ ancho: 320 }).win.matchMedia), 'compact');
  assert.equal(chooseSize(entorno({ ancho: 339 }).win.matchMedia), 'compact');
  assert.equal(chooseSize(entorno({ ancho: 340 }).win.matchMedia), 'flexible');
  assert.equal(chooseSize(entorno({ ancho: 1280 }).win.matchMedia), 'flexible');
  assert.equal(chooseSize(undefined), 'flexible', 'sin matchMedia se asume pantalla ancha');
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
  const contenedor = { id: 'ranura' };
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

test('render: ya cargado no vuelve a pedir api.js, y en pantalla ancha usa flexible', async () => {
  const e = entorno({ ancho: 1280 });
  const t = createTurnstile({ doc: e.doc, win: e.win, siteKey: '0x4AAAAAAAreal' });
  const primero = t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  e.cargar();
  await primero;
  await t.render({}, { onToken() {}, onExpire() {}, onError() {} });
  assert.equal(e.scripts.length, 1);
  assert.equal(e.llamadas[0].opciones.size, 'flexible');
  assert.equal(e.llamadas[0].opciones.sitekey, '0x4AAAAAAAreal');
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
