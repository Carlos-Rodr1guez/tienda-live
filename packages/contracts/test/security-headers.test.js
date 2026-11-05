import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_RESPONSE_HEADERS,
  HEADERS_FILE_LIMITS,
  assertHeadersFileLimits,
  buildConfirmCsp,
  buildCsp,
  buildHeaderRules,
  buildHeadersFile,
} from '../src/security-headers.js';

const directivas = (csp) =>
  Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]));
const regla = (reglas, ruta) => reglas.find((r) => r.path === ruta);
const cabecera = (r, nombre) => r.headers.find(([n]) => n === nombre)?.[1];

/** Lee el texto de un _headers de vuelta a reglas, para comprobar que lo escrito es lo que se construyó. */
function leerHeaders(texto) {
  const reglas = [];
  for (const linea of texto.split('\n')) {
    if (linea === '') continue;
    if (!linea.startsWith('  ')) reglas.push({ path: linea, headers: [] });
    else {
      const i = linea.indexOf(': ');
      reglas.at(-1).headers.push([linea.slice(2, i), linea.slice(i + 2)]);
    }
  }
  return reglas;
}

// ---- CSP de todas las páginas ----

test('csp: las directivas de la especificación R16, sin beacon', () => {
  assert.deepEqual(directivas(buildCsp()), {
    'default-src': "'self'",
    'script-src': "'self' https://challenges.cloudflare.com",
    'frame-src': 'https://challenges.cloudflare.com',
    'connect-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
  });
});

test('csp: con beacon suma solo los dos orígenes de Web Analytics, en script-src y connect-src', () => {
  const d = directivas(buildCsp({ beacon: true }));
  assert.equal(d['script-src'], "'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com");
  assert.equal(d['connect-src'], "'self' https://cloudflareinsights.com");
  assert.equal(d['frame-src'], 'https://challenges.cloudflare.com');
  assert.deepEqual(
    { ...directivas(buildCsp()), 'script-src': d['script-src'], 'connect-src': d['connect-src'] },
    d,
    'el resto de las directivas no cambia',
  );
});

test('csp: sin beacon no nombra Cloudflare Insights, y nunca permite inline ni eval ni hosts comodín', () => {
  assert.doesNotMatch(buildCsp(), /cloudflareinsights/);
  assert.doesNotMatch(buildCsp({ beacon: false }), /cloudflareinsights/);
  for (const csp of [buildCsp(), buildCsp({ beacon: true }), buildConfirmCsp()]) {
    assert.doesNotMatch(csp, /unsafe-|\*|data:|http:/);
  }
});

// ---- CSP de /confirmar ----

test('csp de /confirmar: sin Turnstile, sin marcos, sin formularios', () => {
  assert.deepEqual(directivas(buildConfirmCsp()), {
    'default-src': "'self'",
    'script-src': "'self'",
    'connect-src': "'self'",
    'frame-src': "'none'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'none'",
    'frame-ancestors': "'none'",
  });
  assert.doesNotMatch(buildConfirmCsp(), /cloudflare/);
});

// ---- tabla de cabeceras ----

test('reglas: /* lleva la CSP y las otras seis cabeceras de la tabla', () => {
  const todas = regla(buildHeaderRules(), '/*');
  assert.deepEqual(
    todas.headers.map(([n]) => n),
    [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Frame-Options',
      'Cross-Origin-Opener-Policy',
      'Strict-Transport-Security',
    ],
  );
  assert.equal(cabecera(todas, 'Content-Security-Policy'), buildCsp());
  assert.equal(cabecera(todas, 'X-Content-Type-Options'), 'nosniff');
  assert.equal(cabecera(todas, 'Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(cabecera(todas, 'X-Frame-Options'), 'DENY');
  assert.equal(cabecera(todas, 'Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(cabecera(todas, 'Strict-Transport-Security'), 'max-age=31536000');
});

test('reglas: Permissions-Policy niega cámara, micrófono y geolocalización', () => {
  const pp = cabecera(regla(buildHeaderRules(), '/*'), 'Permissions-Policy');
  assert.equal(pp, 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});

test('reglas: /confirmar suma una segunda CSP, no-referrer y noindex', () => {
  const r = regla(buildHeaderRules(), '/confirmar');
  assert.deepEqual(
    r.headers.map(([n, v]) => [n, v]),
    [
      ['Content-Security-Policy', buildConfirmCsp()],
      ['Referrer-Policy', 'no-referrer'],
      ['X-Robots-Tag', 'noindex'],
    ],
  );
});

test('reglas: /_astro/* se cachea un año como inmutable', () => {
  const r = regla(buildHeaderRules(), '/_astro/*');
  assert.deepEqual(r.headers, [['Cache-Control', 'public, max-age=31536000, immutable']]);
});

test('reglas: son exactamente tres, en ese orden, y el beacon solo cambia la CSP de /*', () => {
  const sin = buildHeaderRules();
  const con = buildHeaderRules({ beacon: true });
  assert.deepEqual(
    sin.map((r) => r.path),
    ['/*', '/confirmar', '/_astro/*'],
  );
  assert.notDeepEqual(regla(con, '/*'), regla(sin, '/*'));
  assert.equal(cabecera(regla(con, '/*'), 'Content-Security-Policy'), buildCsp({ beacon: true }));
  assert.deepEqual(regla(con, '/confirmar'), regla(sin, '/confirmar'), '/confirmar nunca lleva el beacon');
  assert.deepEqual(regla(con, '/_astro/*'), regla(sin, '/_astro/*'));
});

// ---- archivo _headers ----

test('_headers: el texto escrito es exactamente la tabla de reglas', () => {
  assert.deepEqual(leerHeaders(buildHeadersFile()), buildHeaderRules());
  assert.deepEqual(leerHeaders(buildHeadersFile({ beacon: true })), buildHeaderRules({ beacon: true }));
});

test('_headers: con y sin beacon difiere solo en lo que debe', () => {
  assert.doesNotMatch(buildHeadersFile(), /cloudflareinsights/);
  assert.match(buildHeadersFile({ beacon: true }), /static\.cloudflareinsights\.com/);
  assert.equal(buildHeadersFile(), buildHeadersFile({ beacon: false }));
});

test('_headers: cumple los límites de Cloudflare (hasta 100 reglas, 2000 caracteres por línea)', () => {
  assert.deepEqual({ ...HEADERS_FILE_LIMITS }, { maxRules: 100, maxLineLength: 2000 });
  for (const beacon of [false, true]) {
    const texto = buildHeadersFile({ beacon });
    assert.ok(texto.split('\n').every((l) => l.length <= 2000));
    assert.ok(texto.split('\n').filter((l) => l !== '' && !l.startsWith('  ')).length <= 100);
    assert.doesNotThrow(() => assertHeadersFileLimits(texto));
  }
});

test('_headers: assertHeadersFileLimits rechaza 101 reglas y una línea de 2001 caracteres, y acepta 100 y 2000', () => {
  const reglas = (n) => Array.from({ length: n }, (_, i) => `/r${i}\n  X-A: 1\n`).join('');
  assert.doesNotThrow(() => assertHeadersFileLimits(reglas(100)));
  assert.throws(() => assertHeadersFileLimits(reglas(101)), /101 reglas/);
  const linea = (largo) => `/x\n  ${'a'.repeat(largo - 2)}\n`;
  assert.doesNotThrow(() => assertHeadersFileLimits(linea(2000)));
  assert.throws(() => assertHeadersFileLimits(linea(2001)), /2001 caracteres/);
});

// ---- cabeceras de las respuestas de /v1 ----

test('API: las cabeceras de toda respuesta de /v1 son las de la tabla y no hay Set-Cookie ni CORS', () => {
  assert.deepEqual(
    { ...API_RESPONSE_HEADERS },
    {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000',
    },
  );
  assert.ok(Object.isFrozen(API_RESPONSE_HEADERS));
  const nombres = Object.keys(API_RESPONSE_HEADERS).map((n) => n.toLowerCase());
  assert.ok(!nombres.includes('set-cookie'));
  assert.ok(!nombres.some((n) => n.startsWith('access-control-')));
});

test('API: /v1 lleva el mismo HSTS que las páginas (las respuestas del Worker no pasan por _headers)', () => {
  const paginas = cabecera(regla(buildHeaderRules(), '/*'), 'Strict-Transport-Security');
  assert.equal(API_RESPONSE_HEADERS['Strict-Transport-Security'], paginas);
  assert.match(paginas, /^max-age=\d{8,}$/);
});
