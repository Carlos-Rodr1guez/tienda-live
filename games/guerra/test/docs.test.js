import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBlocklist } from '@tienda/kit/sim/names.js';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { foldForMatch } from '@tienda/kit/sim/words.js';
import { PAISES } from '../public/js/data/paises.js';
import { NOMBRES_VETADOS } from '../public/js/data/nombres-vetados.js';
import { FONT_FACES, FONT_TIMEOUT_MS, loadFonts } from '../public/js/fonts.js';
import { Sfx } from '../public/js/audio.js';
import { findForbidden } from './support/forbidden-words.js';

// Fuentes locales (6.9), sonido (6.10), semilla de términos vetados (6.11 y 6.12) y documentos (6.13).

const GP = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(GP, 'public');
const leer = (...p) => fs.readFileSync(path.join(GP, ...p), 'utf8');

// ---------------------------------------------------------------------------------------------------------------
// 6.9 Fuentes

test('DOC-2: los archivos de las fuentes y sus licencias existen y ninguna referencia sale a Google Fonts', () => {
  for (const f of ['pixelify-sans-600.woff2', 'silkscreen-700.woff2', 'OFL-pixelify-sans.txt', 'OFL-silkscreen.txt'])
    assert.ok(fs.existsSync(path.join(PUBLIC, 'fonts', f)), f);
  const todo = [];
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : todo.push(path.join(d, e.name))));
  walk(PUBLIC);
  for (const f of todo.filter((x) => /\.(js|html|css)$/.test(x)))
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /fonts\.googleapis\.com|fonts\.gstatic\.com/, f);
});

function fuentesFalsas({ fallan = [], lentas = [] } = {}) {
  const log = { creadas: [], add: [], load: [], pendientes: [] };
  class FontFace {
    constructor(family, source, desc) {
      this.family = family;
      this.source = source;
      this.desc = desc;
      log.creadas.push(this);
    }
    load() {
      if (fallan.includes(this.family)) return Promise.reject(new Error('404'));
      if (lentas.includes(this.family)) return new Promise((ok) => log.pendientes.push(() => ok(this)));
      return Promise.resolve(this);
    }
  }
  const fonts = { add: (f) => log.add.push(f.family), load: async (spec) => log.load.push(spec) };
  return { FontFace, fonts, log };
}
const reloj = () => {
  const t = [];
  return { setTimer: (fn, ms) => t.push({ fn, ms }) && t.length, clearTimer: () => {}, t };
};

test('fuentes: carga con FontFace y document.fonts.load, avisa para invalidar los anchos y no pide nada a terceros', async () => {
  const { FontFace, fonts, log } = fuentesFalsas();
  const avisos = [];
  const r = await loadFonts({ FontFace, fonts, ...reloj(), onLoaded: (n) => avisos.push(n) });
  assert.deepEqual(r, { loaded: ['Pixelify Sans', 'Silkscreen'], failed: [], timedOut: false });
  assert.deepEqual(log.add, ['Pixelify Sans', 'Silkscreen']);
  assert.equal(log.load.length, 2);
  assert.match(log.load[0], /600 .*Pixelify Sans/);
  assert.match(log.load[1], /700 .*Silkscreen/);
  for (const f of log.creadas) assert.match(f.source, /^url\(\/fonts\/[\w-]+\.woff2\)$/);
  assert.deepEqual(
    log.creadas.map((f) => f.desc.weight),
    ['600', '700'],
  );
  assert.ok(avisos.length >= 1, 'ui.invalidate() se dispara al cargar');
  assert.deepEqual(
    FONT_FACES.map((f) => f.file),
    ['/fonts/pixelify-sans-600.woff2', '/fonts/silkscreen-700.woff2'],
  );
});

test('fuentes: tope de 1,5 s; si no cargan el juego sigue con la del sistema y avisa cuando lleguen', async () => {
  assert.equal(FONT_TIMEOUT_MS, 1500);
  const { FontFace, fonts, log } = fuentesFalsas({ lentas: ['Silkscreen'] });
  const c = reloj();
  const avisos = [];
  const p = loadFonts({ FontFace, fonts, ...c, onLoaded: (n) => avisos.push(n) });
  await new Promise((r) => setImmediate(r));
  assert.equal(c.t[0].ms, 1500);
  c.t[0].fn();
  const r = await p;
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.loaded, ['Pixelify Sans']);
  const antes = avisos.length;
  log.pendientes.forEach((f) => f());
  await new Promise((r2) => setImmediate(r2));
  assert.ok(avisos.length > antes, 'la que llega tarde también invalida');
});

test('fuentes: una que falla (404) no rompe nada; sin FontFace del navegador el cargador no lanza', async () => {
  const { FontFace, fonts } = fuentesFalsas({ fallan: ['Pixelify Sans'] });
  const r = await loadFonts({ FontFace, fonts, ...reloj(), onLoaded() {} });
  assert.deepEqual(r.failed, ['Pixelify Sans']);
  assert.deepEqual(r.loaded, ['Silkscreen']);
  const sin = await loadFonts({ FontFace: undefined, fonts: undefined, ...reloj(), onLoaded() {} });
  assert.deepEqual(sin.loaded, []);
  assert.equal(sin.failed.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// 6.10 Sonido

test('sonido: sin archivos de audio el módulo queda mudo y no pide nada a la red (cero 404); M alterna el silencio', async () => {
  const pedidos = [];
  const sfx = new Sfx({ fetch: async (u) => pedidos.push(u) && { ok: false }, AudioContextCtor: class {} });
  sfx.unlock();
  await sfx.load();
  assert.deepEqual(pedidos, []);
  assert.equal(sfx.play('boom'), false);
  assert.equal(sfx.muted, false);
  assert.equal(sfx.toggleMute(), true);
  assert.equal(sfx.toggleMute(), false);
  const audioEnDisco = [];
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : audioEnDisco.push(e.name)));
  walk(PUBLIC);
  assert.deepEqual(
    audioEnDisco.filter((n) => /\.(mp3|ogg|wav|m4a|flac)$/i.test(n)),
    [],
    'no hay archivos de audio (Duda 8)',
  );
});

test('sonido: la música está apagada por defecto', () => {
  assert.equal(new Sfx({}).musicOn, false);
});

// ---------------------------------------------------------------------------------------------------------------
// 6.11 y 6.12 Semilla de términos vetados

test('KIT-12: la semilla de nombres-vetados.js tiene la forma {contains, token, allow}, el registro la carga sin error y no enmascara nombres inocentes', () => {
  assert.deepEqual(Object.keys(NOMBRES_VETADOS).sort(), ['allow', 'contains', 'token']);
  for (const modo of ['contains', 'token', 'allow']) {
    assert.ok(Array.isArray(NOMBRES_VETADOS[modo]), modo);
    for (const t of NOMBRES_VETADOS[modo])
      assert.ok(typeof t === 'string' && t.trim() !== '', `${modo}: ${JSON.stringify(t)}`);
  }
  const lista = createBlocklist(NOMBRES_VETADOS);
  const r = createRegistry({ teams: [PAISES[0], PAISES[1]], blocklist: lista });
  assert.doesNotThrow(() => createBlocklist(undefined));
  assert.doesNotThrow(() => createBlocklist({}));
  // cada término de la semilla se veta a sí mismo y el registro lo enmascara (los términos reales no se nombran aquí)
  for (const t of [...NOMBRES_VETADOS.contains, ...NOMBRES_VETADOS.token]) assert.equal(lista.isBlocked(t), true, t);
  r.touch({ userId: 'v', nickname: `x${NOMBRES_VETADOS.contains[0]}x` });
  assert.equal(r.displayName('v'), 'anónimo');
  // cada palabra de allow contiene un término de contains (si no, no cubre nada)
  const cubiertos = NOMBRES_VETADOS.contains.map((t) => foldForMatch(t));
  for (const a of NOMBRES_VETADOS.allow)
    assert.ok(
      cubiertos.some((t) => foldForMatch(a).includes(t)),
      `allow sin término: ${a}`,
    );
  // nombres inocentes de riesgo (trampas de subcadena y cruces entre palabras) que la semilla real NO enmascara
  const inocentes = [
    'Diputado',
    'Diputada',
    'Computadora',
    'Computación',
    'Disputa',
    'Reputación',
    'Imputado',
    'Caputo',
    'Vergara',
    'Cachucha',
    'Maricarmen',
    'Mari Carmen',
    'Mari Contreras',
    'Mari Consuelo',
    'Mari Constanza',
    'Mari Concepción',
    'Mari Conchita',
    'Silver Gamer',
    'River Gaming',
    'Driver Games',
    'Overgame',
    'Mishi Tierna',
    'Loco por Naruto',
    'Todo por Nada',
    'Fan por Nico',
    'Penélope',
    'Esperanza',
    'Zoraida',
    'Vehículo',
    'Artículo',
    'Cálculo',
    'Controlo',
    'Torpedo',
    'Conocer',
    'Nigeria',
    'Nazira',
    'Luna Zion',
    'Bonazzi',
    'Pachu Chávez',
    'Viola Dorado',
    'Yoshi Tanaka',
    'Cris Lutz',
    'Culiacán',
    'Scunthorpe',
    'Shiitake',
    'Cuntur',
    'Retardo',
    'Mongolia',
    'Concha Tuesta',
    'xX_Esperanza_Xx',
    'Diputado2024',
    'ElVehiculoRojo',
    'MariCarmen_pe',
  ];
  for (const n of inocentes) assert.equal(lista.isBlocked(n), false, n);
  // y la prueba sirve: sin allow, esos mismos nombres sí caen
  const sinAllow = createBlocklist({ ...NOMBRES_VETADOS, allow: [] });
  assert.ok(
    inocentes.filter((n) => sinAllow.isBlocked(n)).length >= 10,
    'sin allow caen varios: la lista de allow hace falta',
  );
  for (const n of ['Diputado', 'Computadora', 'Vergara', 'Nigeria', 'Scunthorpe'])
    assert.equal(sinAllow.isBlocked(n), true, n);
  for (const n of inocentes) {
    r.touch({ userId: n, nickname: n });
    assert.equal(r.displayName(n), n, n);
  }
});

test('KIT-12: las pruebas usan términos fixture; con ellos el registro enmascara', () => {
  const lista = createBlocklist({ contains: ['badword', 'ass'], token: [], allow: ['classic'] });
  const r = createRegistry({ teams: [PAISES[0], PAISES[1]], blocklist: lista });
  r.touch({ userId: 'a', nickname: 'xbadwordx' });
  r.touch({ userId: 'b', nickname: 'classic' });
  assert.equal(r.displayName('a'), 'anónimo');
  assert.equal(r.displayName('b'), 'classic');
});

test('main.js arma createBlocklist desde el archivo de datos y se lo pasa al registro', () => {
  const main = leer('public', 'js', 'main.js');
  assert.match(main, /from '\.\/data\/nombres-vetados\.js'/);
  assert.match(main, /createBlocklist\(NOMBRES_VETADOS\)/);
  assert.match(main, /createRegistry\(\{[^}]*blocklist/s);
});

async function seed() {
  return import(pathToFileURL(path.join(GP, 'tools', 'check-seed.mjs')).href);
}
// términos distintos también una vez plegados (las cifras del leet se repiten al plegar, así que se usan letras)
const unico = (i) =>
  `termino${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghijklmnopqrstuvwxyz'[(i + 1 + Math.floor(i / 26)) % 26]}x`;
const lista = (n) => ({ contains: Array.from({ length: n }, (_, i) => unico(i)), token: [], allow: [] });

test('check-seed: cuenta de 40 a 80; 0, 39 y 81 fallan, 40 y 80 pasan', async () => {
  const { checkSeed } = await seed();
  for (const [n, ok] of [
    [0, false],
    [39, false],
    [40, true],
    [80, true],
    [81, false],
  ]) {
    const r = checkSeed(lista(n));
    assert.equal(r.count, n);
    assert.equal(r.ok, ok, `${n} términos`);
  }
  assert.equal(
    checkSeed({ contains: ['a'.repeat(40)], token: Array.from({ length: 40 }, (_, i) => `t${i}`) }).count,
    41,
  );
  assert.match(checkSeed(lista(39)).errors[0], /40/);
});

test('check-seed: un término "contains" que se pliega a menos de 4 caracteres falla con "usa el modo token" (nota 2)', async () => {
  const { checkSeed } = await seed();
  assert.equal(foldForMatch('kkk'), 'k');
  const r = checkSeed({ ...lista(40), contains: [...lista(40).contains, 'kkk'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /kkk/.test(e) && /usa el modo token/.test(e)));
  const enToken = checkSeed({ ...lista(40), token: ['kkk'] });
  assert.equal(enToken.ok, true, 'en modo token el término corto es válido');
  assert.equal(
    checkSeed({ ...lista(40), contains: [...lista(40).contains, 'abc'] }).ok,
    false,
    '3 caracteres plegados',
  );
  assert.equal(checkSeed({ ...lista(40), contains: [...lista(40).contains, 'abcd'] }).ok, true);
});

test('check-seed no forma parte de npm test', () => {
  const pkg = JSON.parse(leer('package.json'));
  assert.doesNotMatch(pkg.scripts.test, /check-seed/);
});

// ---------------------------------------------------------------------------------------------------------------
// 6.13 Documentos

test('README: lo que pide 6.13, en español neutro y sin las palabras prohibidas', () => {
  const t = leer('README.md');
  const debe = [
    [/npm install/, 'instalar'],
    [/start:batalla/, 'correr'],
    [/3100/, 'puerto'],
    [/tiers/, 'tiers'],
    [/Rosa = 2 tanques/, 'override'],
    [/"Rose"|id:5655/, 'clave real del override'],
    [/maxPerEvent|eventCaps/, 'topes'],
    [/200 por lado/, 'tope de 200'],
    [/\[40, ?300\]/, 'recorte 40 a 300'],
    [/presupuestos/i, 'presupuestos para 200'],
    [/2 a 10 min/, 'presencia'],
    [/escalera/i, 'escalera'],
    [/graphics\.reducedMotion/, 'movimiento reducido'],
    [/view\.idleSeconds/, 'idleSeconds'],
    [/view\.auto\.maxK/, 'maxK'],
    [/view\.auto\.minHalf/, 'minHalf'],
    [/puerta/i, 'despliegue: la puerta única'],
    [/abanico/i, 'despliegue: el abanico'],
    [/visión/i, 'despliegue: la visión'],
    [/base enemiga/i, 'despliegue: todas van a la base enemiga'],
    [/separación/i, 'despliegue: la separación'],
    [/alfombra/i, 'bombardero: alfombra de bombas'],
    [/tres caminos/i, 'despliegue (v2.7): los tres caminos'],
    [/una sola pasada/i, 'bombardero (v2.7): una sola pasada'],
    [/centro de la base/i, 'despliegue (v2.7): se ataca solo el centro de la base'],
    [/hangar/i, 'v2.8: la base es un hangar'],
    [/una intervención/i, 'v2.8: un regalo = una intervención'],
    [/soldado 63 px/, 'v2.8: alcance ×1,5'],
    [/tanques del mismo valor/i, 'v2.8: un avión sin lugar se vuelve tanques'],
    [/en campo/i, 'HUD: «en campo»'],
    [/francotirador/i, 'v2.8b: tipo nuevo, el francotirador'],
    [/blindado/i, 'v2.8b: tipo nuevo, el blindado'],
    [/lanzacohetes/i, 'v2.8b: tipo nuevo, el lanzacohetes'],
    [/Hombre lobo/, 'v2.8b: el héroe, el Hombre lobo'],
    [/Tabla de regalos/, 'v2.8b: la tabla de regalos por monedas'],
    [/Balance de los tipos nuevos/, 'v2.8b: la tabla de balance de igual valor'],
    [/maxWolvesPerTeam/, 'v2.8b: un lobo por lado'],
    [/loboConverted/, 'v2.8b: el evento de conversión del lobo'],
    [/3000 monedas/, 'v2.8b: el tramo del héroe'],
    [/sin votos/i, 'sin votos'],
    [/arrastre/i, 'arrastre'],
    [/rueda/i, 'rueda'],
    [/pellizco/i, 'pellizco'],
    [/doble toque/i, 'doble toque'],
    [/minimapa/i, 'minimapa'],
    [/Ver todo/, 'ver todo'],
    [/cámara automática/i, 'automática'],
    [/Shift\+N/, 'nuevo en vivo'],
    [/Alt\+Z/, 'deshacer'],
    [/LIVE Studio/, 'LIVE Studio'],
    [/16:9/, 'escena 16:9'],
    [/segundo teléfono/i, 'segundo teléfono'],
    [/1920 px/, 'prototipo a 1920 px'],
    [/una persona presente|persona presente/i, 'una persona presente'],
    [/recibir entrada/i, 'la ventana debe recibir entrada'],
    [/Electron/, 'atajos globales y Electron'],
    [/H2/, 'H2'],
    [/Normas de la comunidad/, 'páginas de TikTok'],
    [/semilla de 40 a 80 términos vetados/, 'casilla de la semilla'],
    [/- \[ \] .*semilla de 40 a 80 términos vetados/, 'casilla marcable'],
    [/dueño de la lista/i, 'quién es dueño de la blocklist'],
    [/nacionalismo/i, 'guía para narrar'],
    [/recargar/i, 'recarga restaura'],
    [/leyes de símbolos nacionales/i, 'por qué no hay banderas'],
    [/modo token/i, 'modo token'],
    [/modo contains|contains/, 'modo contains'],
    [/Intl\.Segmenter/, 'requisito de la plataforma'],
    [/F1/, 'abrir F1'],
    [/simulador/i, 'probar con el simulador'],
    [/\?pair=/, 'parámetro pair'],
  ];
  for (const [re, que] of debe) assert.match(t, re, que);
  assert.deepEqual(findForbidden(t), []);
  // DOC-2 (v2.6): ya no hay escuadras, comandante, roles ni punto de reunión
  for (const re of [/escuadra/i, /comandante/i, /DEFENSA/, /ATAQUE/, /punto de reunión/i, /\bH26\b/, /\broles?\b/i]) {
    assert.doesNotMatch(t, re, `README ya no describe ${re}`);
  }
  assert.doesNotMatch(t, new RegExp('pares? bloque' + 'ados?', 'i'), 'no menciona una lista de pares vetados');
  assert.doesNotMatch(t, /\busted(es)?\b/i, 'tuteo, no "usted"');
});

test('README: la semilla es un entregable del dueño y recargar no restaura tras reiniciar o "Nuevo en vivo"', () => {
  const t = leer('README.md');
  assert.match(t, /entregable del dueño/i);
  assert.match(t, /reiniciar el servidor|reinicias el servidor/i);
  assert.match(t, /Nuevo en vivo/);
});

test('CREDITOS: las dos fuentes OFL con nombre, autores, licencia, origen y archivo; nada que no exista', () => {
  const t = leer('CREDITOS.md');
  for (const re of [
    /Pixelify Sans/,
    /Silkscreen/,
    /The Pixelify Sans Project Authors/,
    /Stefie Justprince/,
    /The Silkscreen Project Authors/,
    /Jason Kottke/,
    /SIL Open Font License,? (versión )?1\.1/,
    /github\.com\/google\/fonts/,
    /8b0a1d0/,
    /pixelify-sans-600\.woff2/,
    /silkscreen-700\.woff2/,
    /OFL-pixelify-sans\.txt/,
    /OFL-silkscreen\.txt/,
  ])
    assert.match(t, re, String(re));
  assert.doesNotMatch(t, /\.mp3|\.ogg|\.wav|Kenney/i, 'no hay sonidos: no se listan');
  assert.deepEqual(findForbidden(t), []);
});

test('C32: check-seed rechaza duplicados (plegados) y valores que no son texto', async () => {
  const { checkSeed } = await seed();
  const base = lista(40);
  const dup = checkSeed({ ...base, token: [unico(0).toUpperCase()] });
  assert.ok(
    dup.errors.some((e) => /repite/.test(e)),
    'mismo término con otras mayúsculas',
  );
  const dup2 = checkSeed({ ...base, contains: [...base.contains, 't3rm1n0abx'] });
  assert.ok(
    dup2.errors.some((e) => /repite/.test(e)),
    'plegado leet: "terminoabx" y "t3rm1n0abx"',
  );
  for (const malo of [5, null, '', '   ', {}, ['a']]) {
    const r = checkSeed({ ...base, token: [malo] });
    assert.equal(r.ok, false, JSON.stringify(malo));
    assert.ok(r.errors.some((e) => /no es un texto/.test(e)));
  }
  assert.equal(checkSeed(base).ok, true);
});

test('C32: el README trae el ejemplo de PowerShell, desde qué carpeta corre cada comando, ?rapido, un allow válido y las unidades de los overrides', () => {
  const t = leer('README.md');
  for (const [re, que] of [
    [/\$env:PORT=4000; npm run start:batalla/, 'PowerShell'],
    [/raíz del repositorio/, 'start:batalla en la raíz'],
    [/node tools\/check-seed\.mjs.* dentro de la carpeta del juego/, 'check-seed en la carpeta del juego'],
    [/\?rapido=4. da 4 pasos del sim por cuadro/, '?rapido'],
    [
      /`soldado`, `francotirador`, `jeep`, `blindado`, `tanque`, `lanzacohetes`, `avion`, `pesado` y `lobo`/,
      'unidades válidas',
    ],
    [/allow: \["malabares"\]/, 'ejemplo de allow'],
  ])
    assert.match(t, re, que);
  // el ejemplo de allow cumple su propia regla: contiene el término que cubre, y ese término pliega a 4 o más
  assert.ok(foldForMatch('malabares').includes(foldForMatch('mala')) && foldForMatch('mala').length >= 4);
  const bloqueo = createBlocklist({ contains: ['mala'], allow: ['malabares'] });
  assert.equal(bloqueo.isBlocked('malabares'), false);
  assert.equal(bloqueo.isBlocked('malaonda'), true);
  const datos = leer('public', 'js', 'data', 'nombres-vetados.js');
  assert.match(datos, /contains: \['mala'\]/);
});
