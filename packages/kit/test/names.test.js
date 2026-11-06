import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANON, sanitizeName, createBlocklist } from '@tienda/kit/sim/names.js';

const graphemes = (s) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';

test('sanitizeName: quita invisibles, bidi y controles (KIT-11)', () => {
  assert.equal(sanitizeName('‮Ana​‍_23\u0007'), 'Ana_23');
  assert.equal(sanitizeName('﻿Lu⁦s⁩'), 'Lus');
});

test('sanitizeName: las banderas no se dibujan nunca', () => {
  assert.equal(sanitizeName('Lu \u{1F1F5}\u{1F1EA}\u{1F1F2}\u{1F1FD}'), 'Lu');
});

test('sanitizeName: colapsa espacios y convierte separadores de línea', () => {
  assert.equal(sanitizeName('  Ana \t\n  Paz Luz  '), 'Ana Paz Luz');
});

test('sanitizeName: el largo se cuenta en grafemas y no deja sustitutos sueltos', () => {
  const raw = FAMILY.repeat(16 + 10);
  const out = sanitizeName(raw);
  assert.equal(graphemes(out), 16);
  assert.equal(out.isWellFormed(), true);
  // el cap es configurable
  assert.equal(graphemes(sanitizeName(raw, { maxGraphemes: 5 })), 5);
  assert.equal(sanitizeName('a'.repeat(40)).length, 16);
});

test('sanitizeName: más de 3 marcas combinantes seguidas se recortan', () => {
  const out = sanitizeName('x' + '̀'.repeat(9));
  assert.equal(out, 'x' + '̀'.repeat(3));
  assert.equal(sanitizeName('x' + '̀'.repeat(9), { maxMarks: 1 }), 'x̀');
});

test('sanitizeName: vacío o inválido pasa a "anónimo"', () => {
  assert.equal(ANON, 'anónimo');
  for (const raw of ['', '   ', '​‍', '\u{1F1F5}\u{1F1EA}', null, undefined]) {
    assert.equal(sanitizeName(raw), ANON, JSON.stringify(raw));
  }
});

test('sanitizeName: un sustituto suelto se descarta (toWellFormed)', () => {
  const out = sanitizeName('Ana\uD800Paz');
  assert.equal(out.isWellFormed(), true);
  assert.equal(out, 'AnaPaz');
});

test('sanitizeName: NFKC y marcado inerte (el nombre es solo texto)', () => {
  assert.equal(sanitizeName('Ａｎａ'), 'Ana');
  assert.equal(sanitizeName('<img src=x onerror=alert(1)>'), '<img src=x onerr');
});

test('sanitizeName: usa una sola instancia de Intl.Segmenter', () => {
  const Real = Intl.Segmenter;
  let creadas = 0;
  Intl.Segmenter = new Proxy(Real, {
    construct(target, args) {
      creadas++;
      return new target(...args);
    },
  });
  try {
    for (let i = 0; i < 5; i++) sanitizeName('Ana ' + i);
  } finally {
    Intl.Segmenter = Real;
  }
  assert.equal(creadas, 0);
});

// --- lista de nombres vetados (KIT-12): solo términos de prueba, nunca la lista real ---

test('createBlocklist: pliega leet, acentos y separadores', () => {
  const bl = createBlocklist({ contains: ['badword'] });
  assert.equal(bl.isBlocked('B4dW0rd'), true);
  assert.equal(bl.isBlocked('b.a.d_w.o.r.d'), true);
  assert.equal(bl.isBlocked('xx BADWORD xx'), true);
  assert.equal(bl.isBlocked('Ana'), false);
});

test('createBlocklist: la allowlist cubre el tramo (problema de Scunthorpe)', () => {
  const bl = createBlocklist({ contains: ['ass'], allow: ['classic'] });
  assert.equal(bl.isBlocked('Classic_Joe'), false);
  assert.equal(bl.isBlocked('Ass'), true);
  assert.equal(bl.isBlocked('Classic ass'), true);
  assert.equal(bl.isBlocked('bassist'), true);
});

test('createBlocklist: modo token solo coincide con tokens enteros', () => {
  const bl = createBlocklist({ token: ['pene'] });
  assert.equal(bl.isBlocked('Pene'), true);
  assert.equal(bl.isBlocked('juan pene'), true);
  assert.equal(bl.isBlocked('penelope'), false);
  assert.equal(bl.isBlocked('Penélope Cruz'), false);
});

test('createBlocklist: semilla vacía o ausente carga sin error y no enmascara nada', () => {
  for (const terms of [undefined, null, {}, { contains: [], token: [], allow: [] }, { contains: ['', '  '] }]) {
    const bl = createBlocklist(terms);
    assert.equal(bl.isBlocked('B4dW0rd'), false);
    assert.equal(bl.isBlocked(''), false);
  }
});

test('createBlocklist: los datos llegan por argumento (la lógica no trae ninguno)', () => {
  const a = createBlocklist({ contains: ['uno'] });
  const b = createBlocklist({ contains: ['dos'] });
  assert.equal(a.isBlocked('dos'), false);
  assert.equal(b.isBlocked('dos'), true);
});
