import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANON, sanitizeName } from '@tienda/kit/sim/names.js';

// KIT-11 y KIT-28 (C1): un apodo legítimo puede ser UN grafema enorme (un pulgar con 2000 modificadores de piel). El tope
// por grafemas no lo ve; el tope por unidades UTF-16 sí. Sin esto, la copia de sesión tendría un usuario que el servidor
// rechaza y el respaldo quedaría muerto toda la transmisión.

const MAX_UNITS = 64;
const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s) => [...SEG.segment(s)].length;

/** Los cuatro nombres del revisor (los dos últimos ya los quitan los controles de formato: se prueban igual). */
const CASOS = {
  'pulgar con 2000 modificadores de piel': '\u{1F44D}' + '\u{1F3FB}'.repeat(2000),
  'cadena ZWJ de 500 miembros': '\u{1F468}' + '\u200D\u{1F469}'.repeat(500),
  'secuencia de etiquetas de 1000': '\u{1F3F4}' + '\u{E0067}'.repeat(1000),
  'Prepend repetido 3000 veces': '\u0600'.repeat(3000) + 'a',
};

for (const [nombre, raw] of Object.entries(CASOS)) {
  test(`sanitizeName topa por unidades UTF-16: ${nombre}`, () => {
    const out = sanitizeName(raw);
    assert.ok(out.length <= MAX_UNITS, `${out.length} unidades`);
    assert.ok(out.length >= 1);
    assert.equal(out.isWellFormed(), true, 'sin sustitutos sueltos');
    assert.ok(graphemes(out) <= 16);
    assert.notEqual(out, '');
    assert.equal(sanitizeName(out), out, 'sanear dos veces da lo mismo');
  });
}

test('un grafema solo que pasa el tope se corta dentro, en un límite de punto de código, sin partir un par sustituto', () => {
  const gigante = '\u{1F44D}' + '\u{1F3FB}'.repeat(2000);
  assert.equal(graphemes(gigante), 1);
  const out = sanitizeName(gigante);
  // el pulgar (2 unidades) y los modificadores (2 unidades cada uno) hasta llenar 64
  assert.equal(out.length, 64);
  assert.equal([...out].length, 32);
  assert.equal(out.codePointAt(0), 0x1f44d);
  assert.ok([...out].slice(1).every((c) => c === '\u{1F3FB}'));
  // un tope impar no parte un par: el último punto de código que no cabe se descarta entero
  const impar = sanitizeName('a' + '\u{1F44D}' + '\u{1F3FB}'.repeat(2000), { maxUnits: 6 });
  assert.equal(impar.isWellFormed(), true);
  assert.ok(impar.length <= 6);
});

test('un grafema gigante de unidades sueltas (jamo coreano) se corta justo en el tope, ni una unidad más', () => {
  const jamo = 'ᄀ' + 'ᅡ'.repeat(2000);
  assert.equal(graphemes(jamo), 1);
  const out = sanitizeName(jamo);
  assert.equal(out.length, MAX_UNITS);
  assert.equal(out, jamo.normalize('NFKC').slice(0, MAX_UNITS)); // NFKC junta la consonante y la primera vocal en una sola sílaba
});

test('el corte cae en un límite de grafema cuando hay más de uno', () => {
  const raw = 'ab' + '\u{1F44D}' + '\u{1F3FB}'.repeat(2000);
  // 'a', 'b' y el grafema gigante: el gigante solo no entra en lo que queda, así que se corta en el límite anterior
  const out = sanitizeName(raw);
  assert.equal(out, 'ab');
  // pero si el gigante es el primero, se corta por dentro (es lo único que hay)
  assert.ok(sanitizeName('\u{1F44D}' + '\u{1F3FB}'.repeat(2000) + 'ab').length === 64);
});

test('los nombres normales no cambian: 16 emoji con piel (el peor caso legítimo) caben justo en 64 unidades', () => {
  const dieciseis = '\u{1F44D}\u{1F3FB}'.repeat(16);
  assert.equal(dieciseis.length, 64);
  assert.equal(sanitizeName(dieciseis), dieciseis);
  assert.equal(sanitizeName('\u{1F600}'.repeat(24)), '\u{1F600}'.repeat(16));
  assert.equal(sanitizeName('田中太郎さんの動画チャンネル'), '田中太郎さんの動画チャンネル');
  assert.equal(sanitizeName('x'.repeat(200)), 'x'.repeat(16));
  assert.equal(sanitizeName('k'), 'k');
});

test('el tope se puede pedir por opción y un tope menor a 1 no deja el nombre vacío', () => {
  assert.equal(sanitizeName('abcdefgh', { maxUnits: 3 }), 'abc');
  assert.equal(sanitizeName('abcdefgh', { maxUnits: 0 }), ANON);
  assert.equal(sanitizeName('\u{1F600}', { maxUnits: 1 }), ANON, 'ni un par sustituto cabe en 1 unidad');
});
