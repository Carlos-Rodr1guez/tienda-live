import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, createTextFitter, drawTabular } from '../public/js/ui/text.js';
import { WORST_NAMES } from './support/forbidden-words.js';

// Texto del lienzo: limpieza de lo que llega del público, recorte por ancho medido con caché por valor y cifras
// tabulares. Un `measureText` falso de ancho variable (el "1" angosto, el "W" ancho) hace que las cifras sean un caso real.

const ANCHO = { 1: 2, i: 2, l: 2, '.': 2, ':': 2, W: 9, M: 9 };
const medir = (s) => [...s].reduce((a, c) => a + (ANCHO[c] ?? 5), 0);

/** Contexto falso que mide con la tabla y cuenta las mediciones y los textos dibujados. */
function ctxFalso() {
  const ctx = {
    font: '',
    measures: 0,
    draws: [],
    measureText: (s) => {
      ctx.measures++;
      return { width: medir(s) };
    },
    fillText: (s, x, y) => ctx.draws.push([s, x, y]),
  };
  return ctx;
}

const PROHIBIDOS = /[\p{Cf}\p{Cc}]/u;

test('CB-16: cleanText quita bidi, ancho cero y controles, y un carácter bidi no da vuelta el resto de la línea', () => {
  const sucio = WORST_NAMES[0]; // RLO + "Ana" + ZWSP + "_23"
  assert.match(sucio, PROHIBIDOS);
  assert.equal(cleanText(sucio), 'Ana_23');
  assert.equal(cleanText('a' + String.fromCodePoint(0x2067) + 'b' + String.fromCodePoint(0x2069) + 'c'), 'abc');
  assert.equal(cleanText('x\u0007y\n\tz'), 'x y z', 'los controles y saltos son un espacio');
  for (const n of WORST_NAMES) assert.doesNotMatch(cleanText(n), PROHIBIDOS);
});

test('cleanText nunca lanza con tipos equivocados y topa el largo', () => {
  for (const v of [undefined, null, 0, Number.NaN, {}, [], () => 1, Symbol('x'), 5n, { toString: 3 }]) {
    assert.equal(typeof cleanText(v), 'string');
  }
  assert.ok(cleanText('x'.repeat(5000)).length <= 400);
  assert.equal(cleanText(Object.create(null)), '');
});

test('CB-16: fit recorta por ancho medido con "…" y nunca desborda su caja, con los nombres del peor caso', () => {
  const fit = createTextFitter({ measure: (font, t) => medir(t) });
  for (const maxW of [10, 40, 110, 300]) {
    for (const nombre of WORST_NAMES) {
      const r = fit.fit('f', nombre, maxW);
      assert.ok(r.width <= maxW || r.text === '…', `${maxW}: ${JSON.stringify(nombre)} → ${r.text} (${r.width})`);
      assert.equal(r.width, medir(r.text), 'el ancho informado es el medido');
      assert.doesNotMatch(r.text, PROHIBIDOS);
      if (r.cut) assert.ok(r.text.endsWith('…'));
    }
  }
});

test('un nombre de 1 carácter y uno de 200 caben o se recortan sin lanzar; un hueco de 0 px deja solo "…"', () => {
  const fit = createTextFitter({ measure: (f, t) => medir(t) });
  assert.deepEqual(fit.fit('f', 'x', 100), { text: 'x', width: 5, cut: false });
  const largo = fit.fit('f', 'x'.repeat(200), 100);
  assert.equal(largo.cut, true);
  assert.ok(largo.width <= 100);
  const cero = fit.fit('f', 'hola', 0);
  assert.equal(cero.text, '…');
  assert.equal(fit.fit('f', '', 50).text, '');
});

test('el recorte parte por grafemas: un emoji compuesto no se corta por la mitad', () => {
  const fit = createTextFitter({ measure: (f, t) => medir(t) });
  const familia = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
  const r = fit.fit('f', 'ab' + familia.repeat(10), 20);
  assert.doesNotMatch(r.text, /\p{Cs}/u, 'sin sustitutos sueltos');
  assert.ok(r.width <= 20);
});

test('NM-6 y D21: lo que solo cambia con eventos no se re-mide: la caché por valor responde sin medir', () => {
  let mediciones = 0;
  const fit = createTextFitter({
    measure: (f, t) => {
      mediciones++;
      return medir(t);
    },
  });
  const a = fit.fit('f', 'xX_el_mas_capo_del_live_Xx', 60);
  const veces = mediciones;
  assert.ok(veces > 0);
  for (let i = 0; i < 1000; i++) assert.equal(fit.fit('f', 'xX_el_mas_capo_del_live_Xx', 60), a);
  assert.equal(mediciones, veces, '1000 repeticiones no miden nada más');
  // otra fuente u otro ancho es otro valor: se mide de nuevo
  fit.fit('otra', 'xX_el_mas_capo_del_live_Xx', 60);
  assert.ok(mediciones > veces);
  assert.deepEqual(fit.stats().hits >= 1000, true);
});

test('la caché tiene tope: 5000 textos distintos no la hacen crecer sin límite', () => {
  const fit = createTextFitter({ measure: (f, t) => medir(t), maxEntries: 64 });
  for (let i = 0; i < 5000; i++) fit.fit('f', `donante-${i}`, 100);
  assert.ok(fit.stats().size <= 64);
});

test('cifras tabulares: la misma posición de cada cifra con "1" o con "W", y el total no cambia al cambiar la cifra', () => {
  const ctx = ctxFalso();
  drawTabular(ctx, '0:00', 10, 5, 'left', 'f');
  const base = ctx.draws.map((d) => d[1]);
  for (const t of ['1:11', '9:59', '2:35']) {
    ctx.draws.length = 0;
    drawTabular(ctx, t, 10, 5, 'left', 'f');
    // las cifras caen en las mismas celdas; el ":" también (siempre en el lugar 2)
    assert.deepEqual(
      ctx.draws.map((d) => d[1]),
      base,
      t,
    );
  }
  // alineado a la derecha: el borde derecho es siempre el mismo
  const borde = (t) => {
    ctx.draws.length = 0;
    drawTabular(ctx, t, 100, 5, 'right', 'f');
    const ult = ctx.draws.at(-1);
    return ult[1] + medir(ult[0]);
  };
  assert.ok(borde('100 %') <= 100 && borde('111 %') <= 100);
  // sin "tabular" la suma de anchos de "111" y "000" difería: con tabular el ancho total es igual
  assert.equal(
    (() => {
      ctx.draws.length = 0;
      drawTabular(ctx, '111', 0, 0, 'left', 'f');
      return ctx.draws.at(-1)[1];
    })(),
    (() => {
      ctx.draws.length = 0;
      drawTabular(ctx, '000', 0, 0, 'left', 'f');
      return ctx.draws.at(-1)[1];
    })(),
  );
});

test('drawTabular con texto vacío, enorme o de tipo equivocado no lanza', () => {
  const ctx = ctxFalso();
  drawTabular(ctx, '', 0, 0, 'left', 'f');
  drawTabular(ctx, undefined, 0, 0, 'right', 'f');
  drawTabular(ctx, '9'.repeat(500), 0, 0, 'center', 'f');
  assert.ok(ctx.draws.length <= 64, 'topa la cantidad de celdas');
});
