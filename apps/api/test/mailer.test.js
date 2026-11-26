import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectMailer } from '../src/adapters/mailer.js';
import { createConsoleMailer } from '../src/adapters/mailer-console.js';
import { confirmationLink, confirmationMessage } from '../src/waitlist/mail.js';
import { readConfig } from '../src/config.js';
import { BRAND } from '@tienda/contracts/brand';

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

test('mail: el enlace es siteUrl + /confirmar#t=<token>, sin token en la consulta', () => {
  const enlace = confirmationLink('https://tienda.example', TOKEN);
  assert.equal(enlace, `https://tienda.example/confirmar#t=${TOKEN}`);
  const url = new URL(enlace);
  assert.equal(url.search, '');
  assert.equal(url.hash, `#t=${TOKEN}`);
});

const HORA = 60 * 60 * 1000;

test('mail: la vigencia del enlace dice lo que queda de verdad (2 h o más: horas; de 1 a 2 h: "1 hora"; menos: "menos de una hora")', () => {
  const enlace = confirmationLink('https://tienda.example', TOKEN);
  const frase = (ms) => confirmationMessage(enlace, ms).texto.match(/vence en (.+)\./)?.[1];
  assert.equal(frase(48 * HORA), '48 horas');
  assert.equal(frase(2.5 * HORA), '2 horas');
  assert.equal(frase(2 * HORA), '2 horas');
  assert.equal(frase(1.5 * HORA), '1 hora');
  assert.equal(frase(1 * HORA), '1 hora');
  assert.equal(frase(0.5 * HORA), 'menos de una hora');
  assert.equal(frase(1), 'menos de una hora');
});

test('mail: solo cambia la vigencia; el resto del texto es idéntico', () => {
  const enlace = confirmationLink('https://tienda.example', TOKEN);
  const a = confirmationMessage(enlace, 48 * HORA).texto;
  const b = confirmationMessage(enlace, 0.5 * HORA).texto;
  assert.equal(a.replace('48 horas', 'menos de una hora'), b);
  assert.ok(a.includes('El enlace sirve una sola vez y vence en 48 horas.'));
});

test('mail: el mensaje tiene asunto con la marca y un texto en español neutro con el enlace', () => {
  const enlace = confirmationLink('https://tienda.example', TOKEN);
  const { asunto, texto } = confirmationMessage(enlace, 48 * HORA);
  assert.equal(asunto, `Confirma tu lugar en ${BRAND.name}`);
  assert.ok(texto.includes(enlace));
  assert.match(texto, /7 días/);
  assert.match(texto, /48 horas/);
  assert.match(texto, /ignora este mensaje/);
  assert.ok(texto.includes(BRAND.name));
  assert.doesNotMatch(texto, /\{|\}/, 'sin marcadores sin rellenar');
});

test('mail: el único enlace del texto es el de confirmación; nada de píxeles ni seguimiento (WL-15)', () => {
  const enlace = confirmationLink('https://tienda.example', TOKEN);
  const { texto } = confirmationMessage(enlace, 48 * HORA);
  const urls = texto.match(/https?:\/\/\S+/g);
  assert.deepEqual(urls, [enlace]);
  assert.doesNotMatch(texto, /<img|<a\s|utm_|track|pixel/i);
});

test('mailer: selectMailer entrega el de consola solo en development y null en producción', () => {
  const sink = { log() {} };
  const enDev = selectMailer(readConfig({ ENVIRONMENT: 'development' }), { sink });
  assert.equal(typeof enDev?.sendConfirmation, 'function');
  assert.equal(selectMailer(readConfig({ ENVIRONMENT: 'production' }), { sink }), null);
  assert.equal(selectMailer(readConfig({}), { sink }), null);
});

test('mailer-console: imprime el asunto y el enlace y nada más del pedido', async () => {
  const lineas = [];
  const mailer = createConsoleMailer({ log: (linea) => lineas.push(linea) });
  const enlace = confirmationLink('http://localhost:8790', TOKEN);
  await mailer.sendConfirmation({ to: 'ana@example.com', link: enlace, validezMs: 48 * HORA });
  const salida = lineas.join('\n');
  assert.ok(salida.includes(`Confirma tu lugar en ${BRAND.name}`));
  assert.ok(salida.includes(enlace));
  assert.doesNotMatch(salida, /ana@example\.com/, 'la consola no repite el correo de la persona');
});
