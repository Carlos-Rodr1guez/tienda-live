import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normWord, tokenize, foldForMatch, cmpCodePoints, hashKey, LEET } from '@tienda/kit/sim/words.js';

// Las banderas se escriben con escapes: ningún archivo del kit contiene indicadores regionales literales.
const PE = '\u{1F1F5}\u{1F1EA}';
const MX = '\u{1F1F2}\u{1F1FD}';

test('normWord: NFKC, minúsculas, sin acentos y solo letras y dígitos (KIT-6)', () => {
  assert.equal(normWord('  México!!! '), 'mexico');
  assert.equal(normWord('PERÚ'), 'peru');
  assert.equal(normWord('２'), '2');
  assert.equal(normWord('ｐｅｒú'), 'peru');
  assert.equal(normWord('a.n_a'), 'ana');
  assert.equal(normWord(null), '');
  assert.equal(normWord(undefined), '');
  assert.equal(normWord(42), '42');
});

test('tokenize: separa por espacios y normaliza cada token', () => {
  assert.deepEqual(tokenize('quiero  PERÚ!!'), ['quiero', 'peru']);
  assert.deepEqual(tokenize('tengo 2 gatos'), ['tengo', '2', 'gatos']);
  assert.deepEqual(tokenize('２ vamos'), ['2', 'vamos']);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize('!!! ???'), []);
  assert.deepEqual(tokenize(undefined), []);
});

test('tokenize: cada bandera es el token flag:XX, aunque venga pegada (KIT-6)', () => {
  assert.deepEqual(tokenize(PE), ['flag:PE']);
  assert.deepEqual(tokenize(`${PE}${MX}`), ['flag:PE', 'flag:MX']);
  assert.deepEqual(tokenize(`vamos${PE} ya`), ['vamos', 'flag:PE', 'ya']);
  assert.deepEqual(tokenize(`${PE} vs ${MX}`), ['flag:PE', 'vs', 'flag:MX']);
  // un indicador suelto no es una bandera
  assert.deepEqual(tokenize('\u{1F1F5} hola'), ['hola']);
});

test('foldForMatch: leet antes de quitar símbolos, sin separadores y repeticiones a 1 (KIT-12)', () => {
  assert.equal(foldForMatch('a.n_a'), 'ana');
  assert.equal(foldForMatch('B4dW0rd'), 'badword');
  assert.equal(foldForMatch('$p@m'), 'spam');
  assert.equal(foldForMatch('Ñandú'), 'nandu');
  assert.equal(foldForMatch('aaa bbb'), 'ab');
  assert.equal(foldForMatch(''), '');
  assert.equal(LEET['0'], 'o');
  assert.equal(LEET['@'], 'a');
});

test('cmpCodePoints: ordena por punto de código, no por unidad UTF-16', () => {
  assert.equal(cmpCodePoints('a', 'b'), -1);
  assert.equal(cmpCodePoints('b', 'a'), 1);
  assert.equal(cmpCodePoints('abc', 'abc'), 0);
  assert.equal(cmpCodePoints('ab', 'abc'), -1);
  // U+FF5E (BMP alto) va antes que U+1F600 (par sustituto) por punto de código; por unidad UTF-16 sería al revés.
  assert.equal(cmpCodePoints('～', '\u{1F600}'), -1);
  assert.equal(cmpCodePoints('\u{1F600}', '～'), 1);
});

test('hashKey: FNV-1a de 32 bits sin signo, estable', () => {
  assert.equal(hashKey(''), 0x811c9dc5);
  assert.equal(hashKey('a'), 0xe40c292c);
  assert.equal(hashKey('foobar'), 0xbf9cf968);
  assert.equal(hashKey('Ana') === hashKey('Ana'), true);
  assert.ok(hashKey('cualquier clave 😀') >= 0);
});
