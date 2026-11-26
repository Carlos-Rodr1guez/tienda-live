import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { BRAND } from '@tienda/contracts/brand';

const DEV = { ENVIRONMENT: 'development' };

test('config: sin variables, producción FALLA CERRADA: sin sitio, sin orígenes, sin secreto y con el problema anotado', () => {
  const config = readConfig({});
  assert.equal(config.environment, 'production');
  assert.deepEqual(config.problems, ['site_url']);
  assert.equal(config.siteUrl, '');
  assert.notEqual(config.siteUrl, BRAND.siteUrlDefault, 'ya no cae en el sitio por defecto de la marca');
  assert.deepEqual(config.allowedOrigins, []);
  assert.equal(config.turnstile.secret, '');
  assert.equal(config.turnstile.expectedAction, 'waitlist');
});

test('config: solo ENVIRONMENT=development activa el modo de desarrollo (cualquier otro valor es producción)', () => {
  assert.equal(readConfig(DEV).environment, 'development');
  for (const valor of ['production', 'Development', 'dev', '', undefined, 1, null]) {
    assert.equal(readConfig({ ENVIRONMENT: valor }).environment, 'production', String(valor));
  }
});

test('config: siteUrl es el origen de SITE_URL (sin ruta, sin barra final, sin credenciales)', () => {
  const prod = (SITE_URL) => readConfig({ SITE_URL });
  assert.equal(prod('https://tienda.example/').siteUrl, 'https://tienda.example');
  assert.equal(prod('https://tienda.example/inicio?x=1#y').siteUrl, 'https://tienda.example');
  assert.equal(prod('https://u:p@tienda.example/').siteUrl, 'https://tienda.example');
  assert.deepEqual(prod('https://tienda.example/').problems, []);
  assert.equal(readConfig({ ...DEV, SITE_URL: 'http://localhost:4400' }).siteUrl, 'http://localhost:4400');
});

test('config: en desarrollo un SITE_URL vacío, ilegible o que no es http(s) sigue cayendo en el sitio por defecto', () => {
  for (const valor of ['', '   ', 'no es una url', 'javascript:alert(1)', 'ftp://tienda.example', undefined, 42]) {
    const config = readConfig({ ...DEV, SITE_URL: valor });
    assert.equal(config.siteUrl, BRAND.siteUrlDefault, String(valor));
    assert.deepEqual(config.problems, [], String(valor));
    assert.ok(config.allowedOrigins.includes(BRAND.siteUrlDefault), String(valor));
  }
});

test('config: en producción un SITE_URL vacío, ilegible, no https o local es un problema y NO cae en el sitio por defecto', () => {
  const malos = [
    '',
    '   ',
    'no es una url',
    'javascript:alert(1)',
    'ftp://tienda.example',
    undefined,
    null,
    42,
    'http://tienda.example', // sin https
    'http://localhost:8790',
    'https://localhost',
    'https://localhost:4400',
    'https://127.0.0.1',
    'https://127.0.0.1:8790',
    'https://[::1]',
    'https://[::1]:8790/',
    BRAND.siteUrlDefault,
  ];
  for (const SITE_URL of malos) {
    const config = readConfig({ ENVIRONMENT: 'production', SITE_URL, TURNSTILE_SECRET_KEY: 's3creto-real' });
    assert.deepEqual(config.problems, ['site_url'], String(SITE_URL));
    assert.equal(config.siteUrl, '', String(SITE_URL));
    assert.deepEqual(config.allowedOrigins, [], String(SITE_URL));
    assert.equal(config.turnstile.secret, '', 'sin sitio válido tampoco hay secreto utilizable');
  }
});

test('config: en producción un https con host público es válido y el resto de la configuración sigue igual', () => {
  const config = readConfig({ SITE_URL: 'https://tienda.example', TURNSTILE_SECRET_KEY: 's3creto-real' });
  assert.deepEqual(config.problems, []);
  assert.deepEqual(config.allowedOrigins, ['https://tienda.example']);
  assert.equal(config.turnstile.secret, 's3creto-real');
  assert.equal(config.turnstile.expectedHostname, 'tienda.example');
});

test('config: en producción solo se permite el origen del sitio', () => {
  const config = readConfig({ SITE_URL: 'https://tienda.example' });
  assert.deepEqual(config.allowedOrigins, ['https://tienda.example']);
});

test('config: en desarrollo se suman los orígenes locales de la web (4400) y de la API (8790), sin repetir', () => {
  const config = readConfig({ ...DEV, SITE_URL: 'http://localhost:4400' });
  assert.deepEqual(config.allowedOrigins, ['http://localhost:4400', 'http://localhost:8790']);
  const otro = readConfig({ ...DEV, SITE_URL: 'https://tienda.example' });
  assert.deepEqual(otro.allowedOrigins, ['https://tienda.example', 'http://localhost:4400', 'http://localhost:8790']);
});

test('config: Turnstile comprueba el nombre de host solo cuando el sitio no es local', () => {
  assert.equal(readConfig({ SITE_URL: 'https://tienda.example' }).turnstile.expectedHostname, 'tienda.example');
  assert.equal(readConfig({ ...DEV, SITE_URL: 'https://tienda.example' }).turnstile.expectedHostname, 'tienda.example');
  assert.equal(readConfig({ ...DEV, SITE_URL: 'http://localhost:4400' }).turnstile.expectedHostname, null);
  assert.equal(readConfig({ ...DEV, SITE_URL: 'http://127.0.0.1:8790' }).turnstile.expectedHostname, null);
  assert.equal(readConfig(DEV).turnstile.expectedHostname, null);
});

test('config: el secreto de Turnstile viene de TURNSTILE_SECRET_KEY y solo si es texto', () => {
  const sitio = { SITE_URL: 'https://tienda.example' };
  assert.equal(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: 's3creto' }).turnstile.secret, 's3creto');
  assert.equal(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: 123 }).turnstile.secret, '');
});

test('config (F5): el secreto se guarda recortado (un salto de línea final no llega a siteverify)', () => {
  const sitio = { SITE_URL: 'https://tienda.example' };
  assert.equal(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: '  s3creto\n' }).turnstile.secret, 's3creto');
  const enDev = readConfig({ ENVIRONMENT: 'development', TURNSTILE_SECRET_KEY: '\ts3creto \r\n' });
  assert.equal(enDev.turnstile.secret, 's3creto');
});

test('config: en producción las claves de PRUEBA de Turnstile cuentan como secreto ausente; en desarrollo valen', () => {
  const sitio = { SITE_URL: 'https://tienda.example' };
  const dePrueba = [
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
    '3x0000000000000000000000000000000AA',
  ];
  for (const clave of dePrueba) {
    assert.equal(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: clave }).turnstile.secret, '', clave);
    assert.equal(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: ` ${clave}\n` }).turnstile.secret, '', 'con espacios');
    assert.equal(readConfig({ ...DEV, ...sitio, TURNSTILE_SECRET_KEY: clave }).turnstile.secret, clave, 'desarrollo');
  }
  // Una clave real (cualquier otra) no se toca.
  assert.equal(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal' }).turnstile.secret, '0x4AAAAAAAreal');
  // Que la clave de prueba falte no es un problema de configuración: la ruta de inscripción responde no_disponible.
  assert.deepEqual(readConfig({ ...sitio, TURNSTILE_SECRET_KEY: dePrueba[0] }).problems, []);
});

test('config: el resultado está congelado en todos sus niveles', () => {
  for (const config of [readConfig(DEV), readConfig({}), readConfig({ SITE_URL: 'https://tienda.example' })]) {
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.allowedOrigins));
    assert.ok(Object.isFrozen(config.turnstile));
    assert.ok(Object.isFrozen(config.problems));
  }
});
