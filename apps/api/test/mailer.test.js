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

test('mail: el mensaje tiene asunto con la marca y un texto en español neutro con el enlace', () => {
  const enlace = confirmationLink('https://tienda.example', TOKEN);
  const { asunto, texto } = confirmationMessage(enlace);
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
  const { texto } = confirmationMessage(enlace);
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
  await mailer.sendConfirmation({ to: 'ana@example.com', link: enlace });
  const salida = lineas.join('\n');
  assert.ok(salida.includes(`Confirma tu lugar en ${BRAND.name}`));
  assert.ok(salida.includes(enlace));
  assert.doesNotMatch(salida, /ana@example\.com/, 'la consola no repite el correo de la persona');
});
