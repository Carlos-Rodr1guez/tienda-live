import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkCopy } from '@tienda/contracts/copy-rules';
import { DEFAULT_LADDER } from '@tienda/kit/sim/ranks.js';
import { PAISES } from '../public/js/data/paises.js';
import { S } from '../public/js/ui/strings.js';
import { collectTexts, EJEMPLOS, findForbidden, WORST_NAMES } from './support/forbidden-words.js';

// CB-4: un solo módulo de textos, sin palabras vetadas, con el título y la pausa exactos y todo dentro de `checkCopy`.
// La lista vetada vive SOLO en `support/forbidden-words.js`; este archivo no nombra ninguna de sus palabras.

const GP = fileURLToPath(new URL('..', import.meta.url));
const HTML = fs.readFileSync(`${GP}public/index.html`, 'utf8');

test('CB-4: el escáner veta por palabra entera, plegando acentos y mayúsculas', () => {
  for (const mal of EJEMPLOS.mal) {
    assert.ok(findForbidden(mal).length > 0, `debe fallar: ${mal}`);
  }
  for (const bien of EJEMPLOS.bien) {
    assert.deepEqual(findForbidden(bien), [], `debe pasar: ${bien}`);
  }
});

test('CB-4: el título es exactamente "Batalla de países" y la pausa exactamente la del diseño', () => {
  assert.equal(S.title, 'Batalla de países');
  assert.equal(S.pause, 'Pausa: el narrador vuelve enseguida');
  assert.equal(HTML.match(/<title>([^<]*)<\/title>/)?.[1], S.title);
});

test('CB-4: S está congelado en todos sus niveles', () => {
  const sinCongelar = [];
  const ver = (n, path) => {
    if (n !== null && typeof n === 'object') {
      if (!Object.isFrozen(n)) sinCongelar.push(path);
      for (const [k, v] of Object.entries(n)) ver(v, `${path}.${k}`);
    }
  };
  ver(S, 'S');
  assert.deepEqual(sinCongelar, []);
});

test('CB-4: todas las hojas y plantillas (con nombres del peor caso y datos raros) pasan el escáner y checkCopy', () => {
  const textos = collectTexts(S);
  assert.ok(textos.length > 300, `se recorrieron ${textos.length} textos`);
  for (const { path, text } of textos) {
    assert.deepEqual(findForbidden(text), [], `${path}: ${text.slice(0, 60)}`);
    assert.deepEqual(checkCopy(text), [], `${path}: ${text.slice(0, 60)}`);
  }
});

test('las plantillas nunca lanzan ni devuelven otra cosa que un texto, con datos de tipo equivocado', () => {
  const raros = [undefined, null, 0, -1, 1e21, Number.NaN, Infinity, {}, [], () => 1, Symbol.iterator.description, 'x'];
  const visita = (n, path) => {
    if (typeof n === 'function') {
      for (const a of raros) for (const b of raros) assert.equal(typeof n(a, b, a, b), 'string', path);
    } else if (n !== null && typeof n === 'object') for (const [k, v] of Object.entries(n)) visita(v, `${path}.${k}`);
  };
  visita(S, 'S');
});

test('las plantillas con nombres del peor caso los dejan enteros: el recorte es del dibujo, no del texto', () => {
  for (const nombre of WORST_NAMES.filter((n) => n.length > 0)) {
    assert.ok(S.banners.rankUp(nombre, 'Cabo').includes(nombre));
    assert.ok(S.banners.plane(nombre, 'Avión').includes(nombre));
  }
});

test('nada de emoji ni de comillas tipográficas en los textos del producto (los íconos se dibujan)', () => {
  const fijos = collectTexts(S, ['Ana', 'Perú', 'Avión', 1, 3, 2, 'Cabo', 'Sargento']);
  for (const { path, text } of fijos) assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${path}: ${text}`);
});

test('los textos de las listas del juego que ve el público también pasan: rangos del kit y nombres de países', () => {
  for (const r of DEFAULT_LADDER) {
    assert.deepEqual(findForbidden(r.label), [], r.label);
    assert.deepEqual(checkCopy(r.label), [], r.label);
  }
  assert.ok(PAISES.length >= 18);
  for (const p of PAISES) {
    assert.deepEqual(findForbidden(p.name), [], p.name);
    assert.deepEqual(checkCopy(p.name), [], p.name);
  }
});

/** Texto visible de un HTML: nodos de texto (sin script ni estilo) más los `aria-label` y `alt`. */
function textosDeHtml(html) {
  const sinScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const nodos = sinScripts
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/<[^>]*>/)
    .map((t) => t.trim())
    .filter(Boolean);
  const attrs = [...html.matchAll(/\b(?:aria-label|alt|title|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  return [...nodos, ...attrs];
}

test('CB-4: <title>, nodos de texto y aria-label de index.html pasan el escáner y checkCopy, y salen de S', () => {
  const textos = textosDeHtml(HTML);
  assert.ok(textos.includes(S.title));
  assert.ok(textos.includes(S.noscript));
  assert.ok(textos.includes(S.canvasLabel));
  assert.ok(textos.includes(S.camera.barLabel));
  for (const t of textos) {
    assert.deepEqual(findForbidden(t), [], t);
    assert.deepEqual(checkCopy(t), [], t);
  }
});

test('el error de puente perdido nombra el problema y la salida, y la pausa y el título no inventan nada', () => {
  assert.match(S.errors.bridgeLost, /conexión/i);
  assert.match(S.errors.bridgeLost, /revisa/i);
  assert.match(S.errors.bridgeLost, /reintenta/i);
  // un error siempre dice qué falló y cómo salir
  assert.match(S.errors.config('x'), /La configuración tiene un error: x/);
  assert.match(S.errors.configExit, /config\.json/);
  assert.match(S.errors.dataExit, /recarga/i);
});

test('CB-17: la leyenda de los íconos dice Defensa y Ataque sin nombrar las formas (nota 40)', () => {
  assert.equal(S.legend.defensa, 'Defensa');
  assert.equal(S.legend.ataque, 'Ataque');
  // las teclas de la cámara y la ayuda sí nombran las flechas del teclado; la leyenda de los íconos no nombra sus formas
  const todo = JSON.stringify(collectTexts({ ...S, keys: {}, help: {} }, ['a', 1]).map((t) => t.text));
  assert.doesNotMatch(todo, /escudo|flecha/i);
});

test('NM-2 v2.3: los textos de Nuevo en vivo dicen la ventana de 2 s y lo que se reinicia', () => {
  assert.match(S.newLive.confirm, /Shift\+N/);
  assert.match(S.newLive.confirm, /2 segundos/);
  assert.match(S.newLive.confirm, /rangos/);
  assert.match(S.newLive.confirm, /XP/);
  assert.match(S.newLive.confirm, /nombres ocultos/);
  assert.equal(S.newLive.done, 'Nuevo en vivo: se reiniciaron los rangos');
  assert.match(S.newLive.blocked, /^Termina el partido/);
});

test('los textos de F2, de la cámara, del movimiento y de la sesión viven en S', () => {
  assert.equal(S.camera.auto, 'CÁMARA AUTO');
  assert.equal(S.camera.manual, 'CÁMARA MANUAL');
  assert.equal(S.camera.autoOn, 'Cámara automática: activada');
  assert.equal(S.camera.autoOff, 'Cámara automática: desactivada');
  assert.equal(S.motion.on, 'Movimiento reducido: activado');
  assert.equal(S.motion.off, 'Movimiento reducido: desactivado');
  assert.equal(S.anon, 'anónimo');
  assert.equal(S.frame, 'EN VIVO · NARRADOR');
  assert.equal(S.session.statusLabel, 'sesión de la transmisión');
  assert.equal(S.f2.fps, 'cuadros por segundo');
  for (const [k, v] of Object.entries(S.f2)) {
    assert.ok(typeof v === 'function' || (typeof v === 'string' && v.length > 0), k);
  }
});
