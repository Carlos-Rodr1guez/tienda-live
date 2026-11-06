import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { PAISES } from '../public/js/data/paises.js';
import { PALETA } from '../public/js/data/paleta.js';
import {
  MACHADO,
  THRESHOLDS,
  contrast,
  deltaE2000,
  distances,
  hexToLab,
  luminance,
  pairKey,
  pickColors,
  simulateRgb01,
  hexToRgb01,
} from '../public/js/sim/colors.js';

// CB-3: matemática de color (CIEDE2000 y simulación de daltonismo) y elección de color por par.
const hex = (id) => PALETA.colors.find((c) => c.id === id).hex;
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} esperado ${expected}, salió ${actual}`);
const byId = Object.fromEntries(PAISES.map((c) => [c.id, c]));
const PARES = PAISES.flatMap((a, i) => PAISES.slice(i + 1).map((b) => [a, b]));

test('CIEDE2000: pares de Sharma, Wu y Dalal (2005)', () => {
  const casos = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], // par 1
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615], // par 2
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412], // par 3
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065], // par 7
    [[50, 2.5, 0], [73, 25, -18], 27.1492], // par 9
    [[50, 2.5, 0], [61, -5, 29], 22.8977], // par 10
    [[50, 2.5, 0], [56, -27, -3], 31.903], // par 11
    [[50, 2.5, 0], [58, 24, 15], 19.4535], // par 12
  ];
  for (const [a, b, esperado] of casos) {
    near(deltaE2000(a, b), esperado, 5e-4, `${a} vs ${b}`);
    near(deltaE2000(b, a), esperado, 5e-4, `${b} vs ${a} (simétrica)`);
  }
  assert.equal(deltaE2000([40, 10, 10], [40, 10, 10]), 0);
});

test('hexToLab: blanco, negro y un gris conocido', () => {
  const [lb, ab, bb] = hexToLab('#FFFFFF');
  near(lb, 100, 0.01);
  near(ab, 0, 0.01);
  near(bb, 0, 0.01);
  near(hexToLab('#000000')[0], 0, 0.001);
  near(hexToLab('#777777')[0], 50, 0.2, 'L del gris medio');
});

test('Machado, Oliveira y Fernandes (2009): matrices de severidad 1,0 y grises que no cambian', () => {
  assert.deepEqual(MACHADO.protan, [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ]);
  assert.deepEqual(MACHADO.deutan, [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ]);
  assert.deepEqual(MACHADO.tritan, [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ]);
  for (const kind of ['protan', 'deutan', 'tritan']) {
    for (const row of MACHADO[kind])
      near(
        row.reduce((a, b) => a + b, 0),
        1,
        2e-5,
        `${kind}: la fila suma 1`,
      );
    // un gris sigue siendo gris
    const [r, g, b] = simulateRgb01(hexToRgb01('#808080'), kind);
    near(r, 0.502, 0.002);
    near(g, 0.502, 0.002);
    near(b, 0.502, 0.002);
  }
});

test('la simulación va en RGB lineal y se recorta a [0, 1]', () => {
  for (const kind of ['protan', 'deutan', 'tritan']) {
    for (const c of PALETA.colors) {
      for (const v of simulateRgb01(hexToRgb01(c.hex), kind)) assert.ok(v >= 0 && v <= 1, `${c.id} ${kind}: ${v}`);
    }
  }
  // el rojo puro sin recortar saldría negativo en el azul con tritanopía; el recorte lo deja en 0
  const [, , b] = simulateRgb01([1, 0, 0], 'protan');
  assert.ok(b >= 0);
  assert.throws(() => simulateRgb01([1, 0, 0], 'otra'), TypeError);
});

test('tabla de ΔE de la paleta: normal, protan, deutan y tritan (diseño §12.3)', () => {
  const tabla = [
    ['rojo', 'naranja', [24.2, 21.9, 13.8, 12.2]],
    ['rojo', 'verde', [73.0, 24.8, 9.0, 70.8]],
    ['naranja', 'oro', [25.7, 13.3, 8.2, 14.8]],
    ['naranja', 'verde', [54.9, 8.6, 13.3, 63.2]],
    ['oro', 'verde', [36.3, 13.1, 20.0, 49.8]],
    ['verde', 'celeste', [39.4, 41.1, 39.5, 9.2]],
    ['verde', 'azul', [52.9, 53.8, 51.3, 17.3]],
    ['celeste', 'azul', [25.2, 20.5, 19.7, 17.5]],
    ['celeste', 'morado', [34.0, 20.6, 15.0, 37.5]],
    ['celeste', 'blanco', [23.1, 18.0, 22.3, 24.8]],
    ['azul', 'morado', [17.9, 0.0, 5.6, 31.7]],
  ];
  for (const [a, b, [normal, protan, deutan, tritan]] of tabla) {
    const d = distances(hex(a), hex(b));
    const msg = `${a}-${b}`;
    near(d.normal, normal, 0.06, `${msg} normal`);
    near(d.protan, protan, 0.06, `${msg} protan`);
    near(d.deutan, deutan, 0.06, `${msg} deutan`);
    near(d.tritan, tritan, 0.06, `${msg} tritan`);
  }
  assert.deepEqual(THRESHOLDS, { normal: 25, protan: 20, deutan: 20, tritan: 20 });
});

test('contraste: INK sobre cada color de la paleta (diseño §12.3)', () => {
  const ink = {
    rojo: 4.9,
    naranja: 8.23,
    oro: 11.77,
    verde: 8.05,
    celeste: 10.07,
    azul: 4.99,
    morado: 5.67,
    blanco: 17.06,
  };
  for (const [id, esperado] of Object.entries(ink)) near(contrast(PALETA.ink, hex(id)), esperado, 0.01, id);
  near(luminance('#FFFFFF'), 1, 1e-9);
  near(luminance('#000000'), 0, 1e-9);
  near(contrast('#000000', '#FFFFFF'), 21, 1e-9);
});

// ---------- elección de color por par (CB-3) ----------

const todos = PARES.flatMap(([a, b]) => [
  [a, b],
  [b, a],
]);

test('CB-3: los 231 pares, en los dos órdenes, pasan ΔE >= 25 y >= 20 en las tres simulaciones', () => {
  assert.equal(todos.length, 462);
  for (const [a, b] of todos) {
    const r = pickColors(a, b);
    const d = distances(hex(r.colors[a.id]), hex(r.colors[b.id]));
    for (const k of ['normal', 'protan', 'deutan', 'tritan']) {
      assert.ok(d[k] >= THRESHOLDS[k], `${a.id}-${b.id} ${k}: ${d[k].toFixed(1)}`);
    }
    assert.notEqual(r.colors[a.id], r.colors[b.id]);
  }
});

test('CB-3: pick(A,B) y pick(B,A) dan el mismo color a cada país (sin sesgo a la izquierda)', () => {
  for (const [a, b] of PARES) {
    const ab = pickColors(a, b);
    const ba = pickColors(b, a);
    assert.deepEqual(ab.colors, ba.colors, `${a.id}-${b.id}`);
    assert.equal(ab.min, ba.min);
  }
  // un par donde el primer candidato de los dos choca: AR y UY piden celeste
  const r = pickColors(byId.UY, byId.AR);
  assert.deepEqual(r.colors, { AR: 'oro', UY: 'celeste' });
});

test('CB-3: ningún par queda sin combinación ni usa el respaldo, y lo calculado coincide con el diseño', () => {
  let noPrimero = 0;
  let minimo = Infinity;
  const combos = {};
  const pares24 = [];
  for (const [a, b] of PARES) {
    const r = pickColors(a, b);
    assert.equal(r.fallback, false, `${a.id}-${b.id} usó el respaldo`);
    if (r.colors[a.id] !== a.colors[0] || r.colors[b.id] !== b.colors[0]) noPrimero++;
    minimo = Math.min(minimo, r.min);
    const key = [r.colors[a.id], r.colors[b.id]].sort().join('-');
    combos[key] = (combos[key] ?? 0) + 1;
    if (Math.abs(r.min - 21.9) < 0.06) pares24.push(`${a.id}-${b.id}`);
  }
  assert.equal(noPrimero, 123);
  near(minimo, 21.9, 0.06, 'ΔE mínimo global');
  assert.equal(pares24.length, 24);
  for (const par of ['BO-CO', 'CO-PE', 'EC-GQ']) assert.ok(pares24.includes(par), par);
  assert.deepEqual(combos, {
    'azul-rojo': 109,
    'celeste-rojo': 39,
    'azul-oro': 27,
    'oro-rojo': 24,
    'celeste-oro': 11,
    'azul-blanco': 10,
    'blanco-verde': 5,
    'morado-verde': 4,
    'blanco-rojo': 2,
  });
});

test('CB-3: Perú contra México nunca termina en rojo contra verde', () => {
  const r = pickColors(byId.PE, byId.MX);
  assert.deepEqual(r.colors, { MX: 'verde', PE: 'blanco' });
  near(r.min, 27.5, 0.06);
  const rojoVerde = new Set(['rojo', 'verde']);
  assert.ok(!rojoVerde.has(r.colors.PE) || !rojoVerde.has(r.colors.MX));
});

test('CB-3: resultados del diseño con Estados Unidos y Guinea Ecuatorial', () => {
  const casos = [
    ['US', 'MX', 'azul', 'rojo', 43.3],
    ['US', 'CU', 'rojo', 'azul', 43.3],
    ['US', 'PR', 'azul', 'rojo', 43.3],
    ['US', 'AR', 'rojo', 'celeste', 43.9],
    ['US', 'GT', 'rojo', 'celeste', 43.9],
    ['US', 'UY', 'rojo', 'celeste', 43.9],
    ['US', 'CO', 'azul', 'oro', 54.6],
    ['US', 'EC', 'azul', 'oro', 54.6],
    ['US', 'VE', 'azul', 'oro', 54.6],
    ['GQ', 'MX', 'verde', 'blanco', 27.5],
    ['GQ', 'PE', 'verde', 'blanco', 27.5],
    ['GQ', 'VE', 'verde', 'morado', 35.0],
    ['GQ', 'BO', 'azul', 'rojo', 43.3],
    ['GQ', 'CO', 'rojo', 'oro', 21.9],
    ['GQ', 'EC', 'rojo', 'oro', 21.9],
    ['GQ', 'CL', 'azul', 'rojo', 43.3],
    ['GQ', 'ES', 'azul', 'rojo', 43.3],
  ];
  for (const [x, y, cx, cy, min] of casos) {
    const r = pickColors(byId[x], byId[y]);
    assert.deepEqual([r.colors[x], r.colors[y]], [cx, cy], `${x}-${y}`);
    near(r.min, min, 0.06, `${x}-${y} ΔE`);
  }
});

test('CB-3: control con los 20 países de la lista previa (ejemplos del diseño)', () => {
  const casos = [
    ['MX', 'PE', ['blanco', 'verde'], 27.5],
    ['CL', 'PE', ['azul', 'rojo'], 43.3],
    ['AR', 'UY', ['celeste', 'oro'], 47.8],
    ['CO', 'VE', ['azul', 'oro'], 54.6],
    ['ES', 'MX', ['blanco', 'rojo'], 35.8],
    ['BO', 'PE', ['blanco', 'verde'], 27.5],
  ];
  for (const [x, y, colores, min] of casos) {
    const r = pickColors(byId[x], byId[y]);
    assert.deepEqual([r.colors[x], r.colors[y]].sort(), colores, `${x}-${y}`);
    near(r.min, min, 0.06, `${x}-${y} ΔE`);
  }
});

test('CB-3: cada color de equipo conserva 3:1 contra cada color transitable y el techo de luminancia', () => {
  for (const t of PALETA.terrain) {
    assert.ok(luminance(t.hex) <= PALETA.terrainMaxLuminance, `${t.id} ${t.hex}: L ${luminance(t.hex)}`);
    for (const c of PALETA.colors)
      assert.ok(contrast(c.hex, t.hex) >= 3, `${c.id} sobre ${t.id}: ${contrast(c.hex, t.hex)}`);
  }
  // valores conocidos del diseño
  const sobre = (c, t) => contrast(hex(c), PALETA.terrain.find((x) => x.id === t).hex);
  near(sobre('rojo', 'fondo'), 3.27, 0.01);
  near(sobre('azul', 'fondo'), 3.33, 0.01);
  near(sobre('morado', 'fondo'), 3.78, 0.01);
  near(sobre('rojo', 'parche'), 3.04, 0.01);
  near(sobre('azul', 'huella'), 3.07, 0.01);
  near(sobre('rojo', 'mancha'), 3.04, 0.01);
  // los retonos del diseño
  assert.equal(PALETA.terrain.find((x) => x.id === 'parche').hex, '#2E393A');
  assert.equal(PALETA.terrain.find((x) => x.id === 'huella').hex, '#3B3544');
});

test('CB-3: el texto de los chips (INK) conserva 4,5:1 sobre cada color y la paleta usa los hex del diseño', () => {
  assert.equal(PALETA.ink, '#0B0F17');
  for (const c of PALETA.colors) assert.ok(contrast(PALETA.ink, c.hex) >= 4.5, c.id);
  assert.deepEqual(
    PALETA.colors.map((c) => [c.id, c.hex]),
    [
      ['rojo', '#E5484D'],
      ['naranja', '#FF8B3D'],
      ['oro', '#F5C518'],
      ['verde', '#2FBF71'],
      ['celeste', '#5BC8F5'],
      ['azul', '#3B7BFF'],
      ['morado', '#A86BFF'],
      ['blanco', '#EEF2F7'],
    ],
  );
});

test('CB-3: pairColors["A-B"] con ids ordenados pasa por el mismo test y no depende del orden', () => {
  assert.equal(pairKey('PE', 'MX'), 'MX-PE');
  assert.equal(pairKey('MX', 'PE'), 'MX-PE');
  // un override válido: MX azul y PE oro (en el orden de los ids ordenados)
  const pairColors = { 'MX-PE': ['azul', 'oro'] };
  for (const [a, b] of [
    [byId.PE, byId.MX],
    [byId.MX, byId.PE],
  ]) {
    const r = pickColors(a, b, { pairColors });
    assert.deepEqual(r.colors, { MX: 'azul', PE: 'oro' });
    assert.equal(r.override, true);
  }
  // uno que no pasa los umbrales (rojo contra verde en deutan) es un error de datos
  assert.throws(() => pickColors(byId.PE, byId.MX, { pairColors: { 'MX-PE': ['verde', 'rojo'] } }), ConfigError);
  // colores repetidos, color desconocido o forma mala
  assert.throws(() => pickColors(byId.PE, byId.MX, { pairColors: { 'MX-PE': ['azul', 'azul'] } }), ConfigError);
  assert.throws(() => pickColors(byId.PE, byId.MX, { pairColors: { 'MX-PE': ['azul', 'turquesa'] } }), ConfigError);
  assert.throws(() => pickColors(byId.PE, byId.MX, { pairColors: { 'MX-PE': 'azul' } }), ConfigError);
  // un override de otro par no toca este
  assert.equal(pickColors(byId.PE, byId.MX, { pairColors: { 'AR-UY': ['oro', 'celeste'] } }).override, false);
});

test('CB-3: un par sin combinación posible es un error de datos (nunca se retira) y el respaldo se usa antes de fallar', () => {
  const x = { id: 'XA', colors: ['rojo', 'naranja'] };
  const y = { id: 'XB', colors: ['rojo', 'naranja'] };
  // con solo esos candidatos ninguna combinación pasa; el respaldo con el resto de la paleta sí
  const r = pickColors(x, y);
  assert.equal(r.fallback, true);
  assert.notEqual(r.colors.XA, r.colors.XB);
  const d = distances(hex(r.colors.XA), hex(r.colors.XB));
  assert.ok(d.normal >= 25 && d.protan >= 20 && d.deutan >= 20 && d.tritan >= 20);
  // un mismo país contra sí mismo no tiene solución
  assert.throws(
    () => pickColors({ id: 'XA', colors: ['rojo'] }, { id: 'XB', colors: ['rojo'] }, { palette: [PALETA.colors[0]] }),
    ConfigError,
  );
});
