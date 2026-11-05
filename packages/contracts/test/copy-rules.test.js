import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCopy, VOSEO, GIFT_PRESSURE, CHANCE, COPY_RULES } from '../src/copy-rules.js';

const reglas = (texto) => checkCopy(texto).map((v) => `${v.regla}:${v.termino}`);

test('copy-rules: hay tres listas negras, con nombre y términos', () => {
  assert.deepEqual(Object.keys(COPY_RULES).sort(), ['azar', 'presion-regalo', 'voseo']);
  for (const lista of [VOSEO, GIFT_PRESSURE, CHANCE]) {
    assert.ok(lista.length >= 5);
    assert.ok(Object.isFrozen(lista));
  }
});

test('copy-rules/voseo: detecta las formas de vos de la especificación', () => {
  for (const palabra of ['tenés', 'podés', 'vos', 'hacé', 'querés', 'sos']) {
    assert.deepEqual(reglas(`Ya ${palabra} acceso.`), [`voseo:${palabra}`], palabra);
  }
});

test('copy-rules/voseo: detecta imperativos y reflexivos voseantes y no distingue mayúsculas', () => {
  assert.deepEqual(reglas('Anotate ahora'), ['voseo:anotate']);
  assert.deepEqual(reglas('Elegí tu categoría'), ['voseo:elegí']);
  assert.deepEqual(reglas('VOS decidís'), ['voseo:vos']);
  assert.deepEqual(reglas('Mirá cómo queda'), ['voseo:mirá']);
});

test('copy-rules/voseo: el español neutral con tú no se marca', () => {
  const neutro =
    'Tienes un LIVE y puedes anotarte. Elige tu categoría, mira el avance y escribe tu correo. ¿Quieres saber más? Eres bienvenido.';
  assert.deepEqual(checkCopy(neutro), []);
});

test('copy-rules/voseo: respeta límites de palabra (no marca vosotros, sosiego, ni "hace" sin acento)', () => {
  assert.deepEqual(checkCopy('vosotros sosiego hace calor mira esto'), []);
});

test('copy-rules/presion-regalo: detecta empujar a regalar y promesas de ganar regalando', () => {
  assert.deepEqual(reglas('Regala para ayudar a tu equipo'), ['presion-regalo:regala para']);
  assert.deepEqual(reglas('Regálale una nave'), ['presion-regalo:regálale']);
  assert.deepEqual(reglas('regalale una nave'), ['presion-regalo:regalale']);
  assert.deepEqual(reglas('Gana regalando'), ['presion-regalo:gana regalando']);
});

test('copy-rules/presion-regalo: describir lo que hace un regalo no se marca', () => {
  assert.deepEqual(checkCopy('Un regalo de 10 monedas trae un bombardero. Los regalos son opcionales.'), []);
});

test('copy-rules/azar: detecta ruleta, sorteo, premio, azar y suerte (con plurales)', () => {
  for (const [texto, termino] of [
    ['Una ruleta de regalos', 'ruleta'],
    ['Participa en el sorteo', 'sorteo'],
    ['Sorteos cada semana', 'sorteos'],
    ['Gana un premio', 'premio'],
    ['Premios para todos', 'premios'],
    ['Todo al azar', 'azar'],
    ['Con suerte llega', 'suerte'],
  ]) {
    assert.deepEqual(reglas(texto), [`azar:${termino.toLowerCase()}`], texto);
  }
});

test('copy-rules/azar: palabras parecidas no se marcan', () => {
  assert.deepEqual(checkCopy('El azafrán, la premura y el desastre'), []);
});

test('copy-rules: un mismo texto puede romper varias reglas y se informan todas', () => {
  const r = reglas('Vos podés ganar un premio si regala para tu equipo');
  assert.deepEqual(r.sort(), ['azar:premio', 'presion-regalo:regala para', 'voseo:podés', 'voseo:vos']);
});

test('copy-rules: texto vacío o que no es texto no rompe nada', () => {
  assert.deepEqual(checkCopy(''), []);
  assert.deepEqual(checkCopy(undefined), []);
});
