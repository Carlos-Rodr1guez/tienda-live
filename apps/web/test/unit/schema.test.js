import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJuegoSchema, createLegalSchema } from '../../src/content/schema.js';

// Una ficha como la de ASEDIO: es el caso que tiene que pasar siempre.
const asedio = {
  nombre: 'ASEDIO LIVE',
  resumen: 'Tu público elige bando y manda naves; tú defiendes la base como Comandante.',
  categoria: 'accion',
  rolStreamer: 'juega',
  idealPara: ['gaming'],
  estado: 'prototipo',
  poster: 'juegos/asedio/poster.png',
  mecanicas: ['Elige bando con un comentario', 'Cada 300 likes llegan 3 cazas'],
  regalos: [
    { monedas: '1-9', efecto: 'Un caza por moneda' },
    { monedas: '1000+', efecto: 'Un acorazado' },
  ],
  requisitos: ['Google Chrome'],
  orden: 1,
};

const concepto = {
  nombre: 'Acuario',
  resumen: 'Una escena tranquila que cambia con los regalos.',
  categoria: 'relax',
  rolStreamer: 'acompana',
  idealPara: ['charla', 'musica'],
  estado: 'concepto',
};

const campos = (resultado) => resultado.error.issues.map((i) => i.path.join('.'));
const sin = (objeto, clave) => Object.fromEntries(Object.entries(objeto).filter(([k]) => k !== clave));

test('juego: una ficha como la de ASEDIO pasa el esquema', () => {
  const r = createJuegoSchema().safeParse(asedio);
  assert.equal(r.success, true);
  assert.equal(r.data.categoria, 'accion');
  assert.equal(r.data.estado, 'prototipo');
  assert.deepEqual(r.data.regalos[1], { monedas: '1000+', efecto: 'Un acorazado' });
});

test('juego: un concepto mínimo pasa y recibe sus valores por defecto', () => {
  const r = createJuegoSchema().safeParse(concepto);
  assert.equal(r.success, true);
  assert.deepEqual(r.data.mecanicas, []);
  assert.deepEqual(r.data.regalos, []);
  assert.deepEqual(r.data.requisitos, []);
  assert.equal(r.data.orden, 999);
  assert.equal(r.data.video, undefined);
  assert.equal(r.data.poster, undefined);
});

test('juego: sin categoria o sin rolStreamer falla y nombra el campo', () => {
  const sinCategoria = createJuegoSchema().safeParse(sin(asedio, 'categoria'));
  assert.equal(sinCategoria.success, false);
  assert.deepEqual(campos(sinCategoria), ['categoria']);

  const sinRol = createJuegoSchema().safeParse(sin(asedio, 'rolStreamer'));
  assert.equal(sinRol.success, false);
  assert.deepEqual(campos(sinRol), ['rolStreamer']);
});

test('juego: una categoría, un rol o un estado fuera de contracts falla', () => {
  for (const [campo, valor] of [
    ['categoria', 'estrategia'],
    ['rolStreamer', 'mira'],
    ['estado', 'alfa'],
  ]) {
    const r = createJuegoSchema().safeParse({ ...asedio, [campo]: valor });
    assert.equal(r.success, false, campo);
    assert.deepEqual(campos(r), [campo]);
  }
});

test('juego: los cuatro estados y las cuatro categorías de contracts son válidos', () => {
  for (const estado of ['concepto', 'prototipo', 'beta', 'venta']) {
    assert.equal(createJuegoSchema().safeParse({ ...asedio, estado }).success, true, estado);
  }
  for (const categoria of ['accion', 'publico', 'relax', 'metas']) {
    assert.equal(createJuegoSchema().safeParse({ ...asedio, categoria }).success, true, categoria);
  }
});

test('juego: un campo desconocido se rechaza (esquema estricto)', () => {
  const r = createJuegoSchema().safeParse({ ...asedio, extra: 'x' });
  assert.equal(r.success, false);
  assert.equal(r.error.issues[0].code, 'unrecognized_keys');
  assert.deepEqual(r.error.issues[0].keys, ['extra']);
});

test('juego: un estado distinto de concepto exige mecánicas y póster', () => {
  const sinMecanicas = createJuegoSchema().safeParse({ ...asedio, mecanicas: [] });
  assert.equal(sinMecanicas.success, false);
  assert.deepEqual(campos(sinMecanicas), ['mecanicas']);

  const sinPoster = createJuegoSchema().safeParse(sin(asedio, 'poster'));
  assert.equal(sinPoster.success, false);
  assert.deepEqual(campos(sinPoster), ['poster']);

  // el mismo contenido en estado concepto no los necesita
  assert.equal(createJuegoSchema().safeParse({ ...concepto, mecanicas: [] }).success, true);
});

test('juego: el video es opcional y, si viene, es /videos/<nombre>.mp4 o .webm', () => {
  assert.equal(createJuegoSchema().safeParse({ ...asedio, video: '/videos/asedio.mp4' }).success, true);
  assert.equal(createJuegoSchema().safeParse({ ...asedio, video: '/videos/asedio-2.webm' }).success, true);
  for (const malo of ['/videos/Asedio.mp4', '/otro/asedio.mp4', '/videos/asedio.mov', 'videos/asedio.mp4']) {
    const r = createJuegoSchema().safeParse({ ...asedio, video: malo });
    assert.equal(r.success, false, malo);
    assert.deepEqual(campos(r), ['video']);
  }
});

test('juego: el póster es una ruta relativa a src/assets: juegos/<juego>/<archivo>', () => {
  assert.equal(createJuegoSchema().safeParse({ ...asedio, poster: 'juegos/asedio/portada.webp' }).success, true);
  assert.equal(createJuegoSchema().safeParse({ ...asedio, poster: 'juegos/asedio/portada.jpeg' }).success, true);
  for (const malo of ['/juegos/asedio/poster.png', 'juegos/asedio/poster.gif', 'asedio/poster.png', '../poster.png']) {
    const r = createJuegoSchema().safeParse({ ...asedio, poster: malo });
    assert.equal(r.success, false, malo);
    assert.deepEqual(campos(r), ['poster']);
  }
});

test('juego: topes de largo de la especificación', () => {
  const schema = createJuegoSchema();
  const intentos = [
    ['nombre', 'a'.repeat(60), 'a'.repeat(61)],
    ['resumen', 'a'.repeat(160), 'a'.repeat(161)],
    ['mecanicas', Array(8).fill('a'.repeat(140)), [...Array(8).fill('a'), 'a'.repeat(1)]],
    ['requisitos', Array(8).fill('a'.repeat(120)), [...Array(8).fill('a'), 'b']],
    ['orden', 999, 1000],
  ];
  for (const [campo, enLimite, pasado] of intentos) {
    assert.equal(schema.safeParse({ ...asedio, [campo]: enLimite }).success, true, `${campo} en el límite`);
    const r = schema.safeParse({ ...asedio, [campo]: pasado });
    assert.equal(r.success, false, `${campo} pasado`);
    assert.deepEqual(campos(r), [campo]);
  }
  // el texto de una mecánica o un requisito también tiene tope
  assert.equal(schema.safeParse({ ...asedio, mecanicas: ['a'.repeat(141)] }).success, false);
  assert.equal(schema.safeParse({ ...asedio, requisitos: ['a'.repeat(121)] }).success, false);
  assert.equal(schema.safeParse({ ...asedio, orden: -1 }).success, false);
  assert.equal(schema.safeParse({ ...asedio, orden: 1.5 }).success, false);
  assert.equal(schema.safeParse({ ...asedio, nombre: '' }).success, false);
});

test('juego: idealPara tiene de 1 a 4 tipos de LIVE distintos y de contracts', () => {
  const schema = createJuegoSchema();
  assert.equal(schema.safeParse({ ...asedio, idealPara: ['gaming', 'charla', 'musica', 'estudio'] }).success, true);
  for (const malo of [[], ['gaming', 'gaming'], ['cocina']]) {
    const r = schema.safeParse({ ...asedio, idealPara: malo });
    assert.equal(r.success, false, JSON.stringify(malo));
    // un elemento inválido se nombra como idealPara.0
    assert.match(campos(r)[0], /^idealPara(\.\d+)?$/, JSON.stringify(malo));
  }
});

test('juego: los regalos son pares {monedas, efecto} con el formato de la especificación', () => {
  const schema = createJuegoSchema();
  for (const monedas of ['5', '1-9', '100-999', '1000+']) {
    assert.equal(schema.safeParse({ ...asedio, regalos: [{ monedas, efecto: 'Algo' }] }).success, true, monedas);
  }
  for (const monedas of ['abc', '1-', '-5', '1+2', '', '1234567890123']) {
    assert.equal(schema.safeParse({ ...asedio, regalos: [{ monedas, efecto: 'Algo' }] }).success, false, monedas);
  }
  assert.equal(schema.safeParse({ ...asedio, regalos: [{ monedas: '1', efecto: '' }] }).success, false);
  assert.equal(schema.safeParse({ ...asedio, regalos: [{ monedas: '1', efecto: 'a'.repeat(121) }] }).success, false);
  assert.equal(schema.safeParse({ ...asedio, regalos: [{ monedas: '1', efecto: 'x', extra: 1 }] }).success, false);
  assert.equal(schema.safeParse({ ...asedio, regalos: Array(9).fill({ monedas: '1', efecto: 'x' }) }).success, false);
});

test('fixtures: sin-categoria.md y sin-rol.md son fichas completas salvo por el campo que les falta', () => {
  const leer = (nombre) =>
    readFileSync(new URL(`../fixtures/juegos-invalidos/${nombre}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const sinCategoria = leer('sin-categoria.md');
  const sinRol = leer('sin-rol.md');

  assert.doesNotMatch(sinCategoria, /^categoria:/m);
  assert.match(sinCategoria, /^rolStreamer:/m);
  assert.doesNotMatch(sinRol, /^rolStreamer:/m);
  assert.match(sinRol, /^categoria:/m);
  for (const texto of [sinCategoria, sinRol]) {
    for (const clave of ['nombre', 'resumen', 'idealPara', 'estado']) {
      assert.match(texto, new RegExp(`^${clave}:`, 'm'), clave);
    }
  }
});

test('legal: título, versión, fecha AAAA-MM-DD y borrador', () => {
  const schema = createLegalSchema();
  const ok = schema.safeParse({ titulo: 'Aviso legal', version: '0.1', actualizado: '2026-11-05', borrador: true });
  assert.equal(ok.success, true);
  assert.equal(ok.data.borrador, true);

  // sin "borrador" se asume que el texto es definitivo
  assert.equal(
    schema.safeParse({ titulo: 'Aviso legal', version: '1.0', actualizado: '2026-11-05' }).data.borrador,
    false,
  );

  for (const malo of [
    { titulo: '', version: '1', actualizado: '2026-11-05' },
    { titulo: 'a'.repeat(81), version: '1', actualizado: '2026-11-05' },
    { titulo: 'Aviso', version: '', actualizado: '2026-11-05' },
    { titulo: 'Aviso', version: '1', actualizado: '05/11/2026' },
    { titulo: 'Aviso', version: '1', actualizado: '2026-13-45' },
    { titulo: 'Aviso', version: '1', actualizado: '2026-11-05', extra: true },
  ]) {
    assert.equal(schema.safeParse(malo).success, false, JSON.stringify(malo));
  }
});
