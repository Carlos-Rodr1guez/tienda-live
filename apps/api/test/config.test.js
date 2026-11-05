import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { BRAND } from '@tienda/contracts/brand';

test('config: sin variables, producción con el sitio por defecto de la marca y sin secreto', () => {
  const config = readConfig({});
  assert.equal(config.environment, 'production');
  assert.equal(config.siteUrl, BRAND.siteUrlDefault);
  assert.deepEqual(config.allowedOrigins, [BRAND.siteUrlDefault]);
  assert.equal(config.turnstile.secret, '');
  assert.equal(config.turnstile.expectedAction, 'waitlist');
});

test('config: solo ENVIRONMENT=development activa el modo de desarrollo (cualquier otro valor es producción)', () => {
  assert.equal(readConfig({ ENVIRONMENT: 'development' }).environment, 'development');
  for (const valor of ['production', 'Development', 'dev', '', undefined, 1, null]) {
    assert.equal(readConfig({ ENVIRONMENT: valor }).environment, 'production', String(valor));
  }
});

test('config: siteUrl es el origen de SITE_URL (sin ruta, sin barra final, sin credenciales)', () => {
  assert.equal(readConfig({ SITE_URL: 'https://tienda.example/' }).siteUrl, 'https://tienda.example');
  assert.equal(readConfig({ SITE_URL: 'https://tienda.example/inicio?x=1#y' }).siteUrl, 'https://tienda.example');
  assert.equal(readConfig({ SITE_URL: 'http://localhost:4400' }).siteUrl, 'http://localhost:4400');
  assert.equal(readConfig({ SITE_URL: 'https://u:p@tienda.example/' }).siteUrl, 'https://tienda.example');
});

test('config: un SITE_URL vacío, ilegible o que no es http(s) cae en el sitio por defecto', () => {
  for (const valor of ['', '   ', 'no es una url', 'javascript:alert(1)', 'ftp://tienda.example', undefined, 42]) {
    assert.equal(readConfig({ SITE_URL: valor }).siteUrl, BRAND.siteUrlDefault, String(valor));
  }
});

test('config: en producción solo se permite el origen del sitio', () => {
  const config = readConfig({ SITE_URL: 'https://tienda.example' });
  assert.deepEqual(config.allowedOrigins, ['https://tienda.example']);
});

test('config: en desarrollo se suman los orígenes locales de la web (4400) y de la API (8790), sin repetir', () => {
  const config = readConfig({ ENVIRONMENT: 'development', SITE_URL: 'http://localhost:4400' });
  assert.deepEqual(config.allowedOrigins, ['http://localhost:4400', 'http://localhost:8790']);
  const otro = readConfig({ ENVIRONMENT: 'development', SITE_URL: 'https://tienda.example' });
  assert.deepEqual(otro.allowedOrigins, ['https://tienda.example', 'http://localhost:4400', 'http://localhost:8790']);
});

test('config: Turnstile comprueba el nombre de host solo cuando el sitio no es local', () => {
  assert.equal(readConfig({ SITE_URL: 'https://tienda.example' }).turnstile.expectedHostname, 'tienda.example');
  assert.equal(readConfig({ SITE_URL: 'http://localhost:4400' }).turnstile.expectedHostname, null);
  assert.equal(readConfig({ SITE_URL: 'http://127.0.0.1:8790' }).turnstile.expectedHostname, null);
  assert.equal(readConfig({}).turnstile.expectedHostname, null);
});

test('config: el secreto de Turnstile viene de TURNSTILE_SECRET_KEY y solo si es texto', () => {
  assert.equal(readConfig({ TURNSTILE_SECRET_KEY: 's3creto' }).turnstile.secret, 's3creto');
  assert.equal(readConfig({ TURNSTILE_SECRET_KEY: 123 }).turnstile.secret, '');
});

test('config: el resultado está congelado en todos sus niveles', () => {
  const config = readConfig({ ENVIRONMENT: 'development' });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.allowedOrigins));
  assert.ok(Object.isFrozen(config.turnstile));
});
