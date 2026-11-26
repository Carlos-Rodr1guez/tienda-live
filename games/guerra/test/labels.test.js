import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LABEL_DEFAULTS,
  createRanking,
  fitText,
  hitLabel,
  labelText,
  layoutLabels,
  resolveLabels,
  selectLabels,
} from '../public/js/render/labels.js';
import { S } from '../public/js/ui/strings.js';

// Etiquetas de donantes en el mundo (CB-16, D22): selección por densidad según el zoom k, texto, recorte por ancho
// medido y colocación sin pisar íconos. Todo puro y con un `measureText` falso: sin DOM ni lienzo.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const VIEW = { x0: 0, y0: 0, x1: 1440, y1: 810 };
let nextId = 1;
/** Una unidad de tierra de un donante, como las del sim (`owner`, `unitValue`, posición actual y previa). */
const unit = (side, owner, value, x = 100, y = 100, o = {}) => ({
  id: nextId++,
  side,
  owner,
  unitValue: value,
  kind: 'soldado',
  alive: true,
  x,
  y,
  px: x,
  py: y,
  ...o,
});
/** XP por donante como un `Map`: lo mismo que guarda el ranking a 5 Hz. */
const rankingDe = (xp) => ({ get: (k) => xp[k] ?? 0 });
const claves = (lista) => Array.from({ length: lista.length }, (_, i) => lista[i].key);
/** `n` donantes por lado, el donante `i` con XP `100 - i` (el 0 es el mejor). */
function donantes(porLado) {
  const units = [];
  const xp = {};
  for (let i = 0; i < porLado; i++) {
    for (const side of [0, 1]) {
      const key = `${side}-${i}`;
      xp[key] = 1000 - i;
      units.push(unit(side, key, 50, 100 + i, 100 + side * 300));
    }
  }
  return { units, ranking: rankingDe(xp) };
}

// ---------------------------------------------------------------------------------------------------------------
// densidad por k

test('densidad: k = 1 los 3 mejores por equipo, 1 < k < 3 los 6 mejores, k >= 3 hasta 24 por XP', () => {
  const { units, ranking } = donantes(30); // 60 unidades de donantes
  const sel = (k) => selectLabels({ units, k, view: VIEW, alpha: 1, spotlight: null, ranking });
  const k1 = sel(1);
  assert.equal(k1.length, 6);
  assert.deepEqual(claves(k1).sort(), ['0-0', '0-1', '0-2', '1-0', '1-1', '1-2']);
  assert.equal(sel(1.5).length, 12, '6 por equipo en el nivel 1,5');
  assert.equal(sel(2.25).length, 12, '6 por equipo en el nivel 2,25');
  const k3 = sel(3);
  assert.equal(k3.length, 24, 'k >= 3: todos los de la vista hasta el tope por cuadro');
  assert.equal(sel(6).length, 24);
});

test('densidad: los umbrales se comparan con tolerancia (k = 1 exacto en "Ver todo", 3 con ruido de coma flotante)', () => {
  const { units, ranking } = donantes(30);
  const sel = (k) => selectLabels({ units, k, view: VIEW, alpha: 1, spotlight: null, ranking }).length;
  assert.equal(sel(1 + 1e-9), 6, 'k apenas sobre 1 sigue siendo el mapa entero');
  assert.equal(sel(3 - 1e-9), 24, 'k apenas bajo 3 ya es el acercamiento');
  assert.equal(sel(1.2), 12);
  assert.equal(sel(2.9), 12);
});

test('densidad: el orden es XP del donante > valor de la unidad > id', () => {
  const a = unit(0, 'a', 10); // XP 5
  const b = unit(0, 'b', 10); // XP 5, mismo valor que "a": gana el id menor
  const c = unit(0, 'c', 99); // XP 5, más valor: va primero
  const d = unit(0, 'd', 1); // XP 9: el mejor
  const ranking = rankingDe({ a: 5, b: 5, c: 5, d: 9 });
  const sel = selectLabels({ units: [a, b, c, d], k: 6, view: VIEW, alpha: 1, spotlight: null, ranking });
  assert.deepEqual(claves(sel), ['d', 'c', 'a', 'b']);
});

test('una etiqueta por donante, sobre su unidad viva y visible de más valor (empata el id menor)', () => {
  const barata = unit(0, 'ana', 10, 50, 50);
  const cara1 = unit(0, 'ana', 400, 200, 200);
  const cara2 = unit(0, 'ana', 400, 300, 300);
  const muerta = unit(0, 'ana', 9999, 400, 400, { alive: false });
  const fuera = unit(0, 'ana', 5000, 5000, 5000);
  const sel = selectLabels({
    units: [barata, cara2, muerta, fuera, cara1],
    k: 6,
    view: VIEW,
    alpha: 1,
    spotlight: null,
    ranking: rankingDe({ ana: 10 }),
  });
  assert.equal(sel.length, 1);
  assert.equal(sel[0].key, 'ana');
  assert.equal(sel[0].id, cara1.id, 'la de más valor; con valores iguales, la de menor id');
  assert.equal(sel[0].x, 200);
  assert.equal(sel[0].side, 0);
});

test('sin dueño usuario no hay etiqueta (unidades gratis, de base o de likes), ni para los muertos', () => {
  const units = [unit(0, null, 0), unit(1, null, 0), unit(0, undefined, 0), unit(0, 'x', 5, 10, 10, { alive: false })];
  assert.equal(selectLabels({ units, k: 6, view: VIEW, alpha: 1, spotlight: null, ranking: rankingDe({}) }).length, 0);
});

test('la posición es la interpolada con alpha, la misma que usa el sprite', () => {
  const u = unit(0, 'ana', 5, 110, 210, { px: 100, py: 200 });
  const en = (alpha) =>
    selectLabels({ units: [u], k: 6, view: VIEW, alpha, spotlight: null, ranking: rankingDe({}) })[0];
  assert.deepEqual([en(0).x, en(0).y], [100, 200]);
  assert.deepEqual([en(0.5).x, en(0.5).y], [105, 205]);
  assert.deepEqual([en(1).x, en(1).y], [110, 210]);
  const nacida = unit(1, 'bea', 5, 70, 80, { px: undefined, py: undefined });
  const e = selectLabels({ units: [nacida], k: 6, view: VIEW, alpha: 0.3, spotlight: null, ranking: rankingDe({}) })[0];
  assert.deepEqual([e.x, e.y], [70, 80], 'sin posición previa se queda donde está');
});

test('solo cuenta lo que cae en la vista', () => {
  const dentro = unit(0, 'dentro', 1, 700, 400);
  const fuera = unit(0, 'fuera', 1, 100, 400);
  const vista = { x0: 500, y0: 300, x1: 900, y1: 500 };
  const sel = selectLabels({
    units: [dentro, fuera],
    k: 6,
    view: vista,
    alpha: 1,
    spotlight: null,
    ranking: rankingDe({}),
  });
  assert.deepEqual(claves(sel), ['dentro']);
});

test('el donante en foco siempre aparece, también con k = 1 y sin XP, y sin pasar del tope', () => {
  const { units, ranking } = donantes(30);
  const foco = unit(0, 'foco', 1, 700, 700);
  units.push(foco);
  const k1 = selectLabels({ units, k: 1, view: VIEW, alpha: 1, spotlight: 'foco', ranking });
  assert.ok(claves(k1).includes('foco'));
  assert.ok(k1.length <= 7);
  const k6 = selectLabels({ units, k: 6, view: VIEW, alpha: 1, spotlight: 'foco', ranking });
  assert.ok(claves(k6).includes('foco'));
  assert.equal(k6.length, 24, 'no pasa del tope por cuadro');
  assert.equal(
    selectLabels({ units, k: 6, view: VIEW, alpha: 1, spotlight: 'nadie', ranking }).length,
    24,
    'un foco que no está en la vista no cambia nada',
  );
});

test('0, 1 y más de 1000 unidades etiquetables nunca pasan del tope; y la selección no ordena todas las unidades', () => {
  const sel = (units, k = 6) =>
    selectLabels({ units, k, view: VIEW, alpha: 1, spotlight: null, ranking: rankingDe({}) });
  assert.equal(sel([]).length, 0);
  assert.equal(sel([unit(0, 'solo', 3)]).length, 1);
  const muchas = [];
  for (let i = 0; i < 1500; i++) muchas.push(unit(i % 2, `u${i}`, i % 7, 10 + (i % 1400), 20 + (i % 790)));
  const original = Array.prototype.sort;
  let ordenes = 0;
  Array.prototype.sort = function (...a) {
    ordenes++;
    return original.apply(this, a);
  };
  try {
    assert.equal(sel(muchas).length, 24);
    assert.equal(sel(muchas, 1).length, 6);
    assert.equal(sel(muchas, 1.5).length, 12);
  } finally {
    Array.prototype.sort = original;
  }
  assert.equal(ordenes, 0, 'selección O(n) por cuadro: nada de ordenar todas las unidades');
});

test('el tope por cuadro sale de la config (maxPerFrame) y se recorta a la lista de etiquetas', () => {
  const { units, ranking } = donantes(30);
  const cfg = resolveLabels({ maxPerFrame: 10 });
  assert.equal(selectLabels({ units, k: 6, view: VIEW, alpha: 1, spotlight: null, ranking, cfg }).length, 10);
  assert.equal(resolveLabels({ maxPerFrame: 500 }).maxPerFrame, 24, 'la lista de etiquetas del render tiene 24');
  assert.equal(resolveLabels({ maxPerFrame: 0 }).maxPerFrame, 1);
  assert.deepEqual(resolveLabels(undefined), LABEL_DEFAULTS);
  assert.deepEqual(
    { ...LABEL_DEFAULTS },
    { topAtK1: 3, topMid: 6, maxPerFrame: 24, maxWidth: 110, refreshHz: 5 },
    'los valores de §8.0',
  );
});

// ---------------------------------------------------------------------------------------------------------------
// ranking a 5 Hz

test('el ranking se recalcula a lo sumo 5 veces por segundo del reloj de vista y no entre medio', () => {
  const xp = { a: 10, b: 20 };
  let lecturas = 0;
  const units = [unit(0, 'a', 1), unit(1, 'b', 1)];
  const r = createRanking({
    xpOf: (k) => {
      lecturas++;
      return xp[k];
    },
    refreshHz: 5,
  });
  assert.equal(r.update(0, units), true, 'la primera vez calcula');
  assert.equal(r.get('b'), 20);
  xp.a = 999; // el donante gana XP entre dos refrescos
  assert.equal(r.update(0.1, units), false);
  assert.equal(r.get('a'), 10, 'el orden guardado no cambia antes de 200 ms');
  assert.equal(r.update(0.199, units), false);
  assert.equal(r.update(0.2, units), true);
  assert.equal(r.get('a'), 999);
  let refrescos = 0;
  for (let t = 0.2; t < 1.2; t += 1 / 60) if (r.update(t, units)) refrescos++;
  assert.ok(refrescos <= 5 && refrescos >= 4, `en 1 s de vista, ${refrescos} refrescos`);
  assert.equal(r.get('nadie'), 0);
  assert.ok(lecturas < 20, 'solo lee la XP en los refrescos');
});

// ---------------------------------------------------------------------------------------------------------------
// texto

test('contenido: "CABO ana_23"; oculto "CABO anónimo"; con N solo el rango', () => {
  assert.equal(labelText({ rank: 'Cabo', name: 'ana_23' }), 'CABO ana_23');
  assert.equal(labelText({ rank: 'Cabo', name: 'ana_23', hidden: true }), 'CABO anónimo');
  assert.equal(labelText({ rank: 'Cabo', name: 'ana_23', onlyRank: true }), 'CABO');
  assert.equal(labelText({ rank: 'Cabo', name: 'ana_23', hidden: true, onlyRank: true }), 'CABO');
  assert.equal(labelText({ rank: 'Capitán', name: 'x' }), 'CAPITÁN x', 'mayúsculas con tildes');
  assert.equal(S.anon, 'anónimo');
});

/** `measureText` falso: 5 px por letra latina, 10 por CJK y 12 por emoji, igual que una fuente real con respaldo. */
const medir = (t) => {
  let w = 0;
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    w += cp >= 0x1f000 ? 12 : cp >= 0x2e80 && cp !== 0x2026 ? 10 : 5;
  }
  return w;
};

test('nombres del peor caso: caben en 110 px, recortados por grafema con "…", sin lanzar', () => {
  const casos = [
    'xX_el_mas_capo_del_live_Xx',
    '😀'.repeat(24),
    '👨‍👩‍👧‍👦'.repeat(24), // un grafema de 11 unidades UTF-16 cada uno
    '田中太郎さんの動画チャンネル名前',
    'ana_23',
    '',
    'a',
  ];
  for (const nombre of casos) {
    const r = fitText({ prefix: 'CABO ', name: nombre, maxWidth: 110, measure: medir });
    assert.ok(r.width <= 110, `${nombre}: ${r.width}`);
    assert.equal(r.width, medir(r.text));
    assert.ok(r.text.startsWith('CABO'), 'el rango nunca se recorta');
    const completo = `CABO ${nombre}`.trimEnd();
    if (r.cut) {
      assert.ok(r.text.endsWith('…'), `${nombre}: recortado termina en "…"`);
      assert.ok(medir(completo) > 110, `${nombre}: solo se recorta si no cabía`);
    } else assert.equal(r.text, completo, `${nombre}: si cabe, el texto completo`);
  }
  const largo = fitText({ prefix: 'CABO ', name: 'xX_el_mas_capo_del_live_Xx', maxWidth: 110, measure: medir });
  assert.equal(largo.cut, true);
  assert.equal(largo.text, 'CABO xX_el_mas_capo_d…', 'recorta lo justo: 22 letras de 5 px entran en 110 px');
  const corto = fitText({ prefix: 'CABO ', name: 'ana_23', maxWidth: 110, measure: medir });
  assert.equal(corto.text, 'CABO ana_23');
  assert.equal(corto.cut, false);
  // un grafema compuesto jamás se parte a la mitad
  const familia = fitText({ prefix: 'CABO ', name: '👨‍👩‍👧‍👦'.repeat(24), maxWidth: 110, measure: medir });
  assert.match(familia.text.replace('CABO ', '').replace('…', ''), /^(?:👨‍👩‍👧‍👦)*$/u);
  // el ancho cero o negativo no lanza
  assert.doesNotThrow(() => fitText({ prefix: 'CABO ', name: 'ana', maxWidth: 0, measure: medir }));
  // una sola instancia de Intl.Segmenter en el módulo (nota 1 del coordinador)
  const src = fs.readFileSync(path.join(GJ, 'render', 'labels.js'), 'utf8');
  assert.equal(src.match(/new Intl\.Segmenter/g)?.length, 1);
});

test('recorte a 0 grafemas: "CABO…", sin espacio antes de los puntos suspensivos', () => {
  const r = fitText({ prefix: 'CABO ', name: 'abcdef', maxWidth: 30, measure: medir });
  assert.equal(r.text, 'CABO…');
  assert.equal(r.cut, true);
  assert.equal(r.width, 25);
  assert.equal(fitText({ prefix: 'CABO ', name: 'abcdef', maxWidth: 35, measure: medir }).text, 'CABO a…');
});

test('CB-16: ningún archivo de public/js ni index.html usa sumideros de HTML ni innerText', () => {
  const archivos = [path.join(GJ, '..', 'index.html')];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (p.endsWith('.js')) archivos.push(p);
    }
  };
  recorrer(GJ);
  assert.ok(archivos.length > 20);
  for (const f of archivos)
    assert.doesNotMatch(
      fs.readFileSync(f, 'utf8'),
      /innerHTML|outerHTML|insertAdjacentHTML|innerText|document\.write/,
      path.relative(GJ, f),
    );
});

test('el código de etiquetas no asigna nombres a innerHTML, textContent, innerText ni crea elementos DOM', () => {
  for (const f of ['labels.js', 'labels-layer.js']) {
    const ruta = path.join(GJ, 'render', f);
    if (!fs.existsSync(ruta)) continue;
    const src = fs
      .readFileSync(ruta, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(
      src,
      /innerHTML|outerHTML|textContent|innerText|insertAdjacentHTML|createElement|document\./,
      f,
    );
  }
  // el escáner reconoce las formas peligrosas
  for (const s of ['el.textContent = n', 'el.innerText = n', 'document.createElement("div")', 'x.innerHTML = n']) {
    assert.match(s, /innerHTML|textContent|innerText|createElement|document\./);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// colocación y clics

/** Un ítem a colocar: centrado en `cx` con su borde inferior en `bottom` (px de dispositivo). */
const item = (key, cx, bottom, w = 60, h = 10) => ({ key, cx, bottom, w, h });
const OPTS = { W: 1920, H: 1080, bandTop: 160, obstacles: [], maxRaises: 8, gap: 2 };

test('layout: una pastilla suelta queda centrada sobre su ancla, con el borde inferior en el ancla', () => {
  const { rects, dropped } = layoutLabels([item('a', 500, 400)], OPTS);
  assert.equal(dropped, 0);
  assert.deepEqual(rects[0], { key: 'a', x: 470, y: 390, w: 60, h: 10 });
});

test('layout: si pisa otra de mayor prioridad sube; hasta 8 veces; lo que no entra se descarta', () => {
  const dos = layoutLabels([item('a', 500, 400), item('b', 510, 400)], OPTS);
  assert.equal(dos.rects.length, 2);
  assert.equal(dos.rects[0].y, 390, 'la de mayor prioridad (primera) no se mueve');
  assert.ok(dos.rects[1].y < 390, 'la segunda sube');
  const solapan = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  assert.equal(solapan(dos.rects[0], dos.rects[1]), false);
  // 12 apiladas en el mismo lugar: solo entran la original y 8 subidas
  const pila = Array.from({ length: 12 }, (_, i) => item(`p${i}`, 800, 1000));
  const r = layoutLabels(pila, OPTS);
  assert.equal(r.rects.length, 9, '1 + 8 subidas');
  assert.equal(r.dropped, 3);
  for (let i = 0; i < r.rects.length; i++)
    for (let j = i + 1; j < r.rects.length; j++) assert.equal(solapan(r.rects[i], r.rects[j]), false);
});

test('layout: sube también para no pisar el ícono de un grupo (obstáculos)', () => {
  const icono = { x: 480, y: 380, w: 30, h: 24 };
  const { rects } = layoutLabels([item('a', 500, 400)], { ...OPTS, obstacles: [icono] });
  const p = rects[0];
  assert.equal(p.x < icono.x + icono.w && icono.x < p.x + p.w && p.y < icono.y + icono.h && icono.y < p.y + p.h, false);
  assert.ok(p.y < 380 - 5, 'quedó por encima del ícono');
  // ninguna etiqueta pisa el rectángulo proyectado de un ícono, en un caso con muchos
  const iconos = Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 70, y: 600, w: 30, h: 24 }));
  const items = Array.from({ length: 24 }, (_, i) => item(`l${i}`, 110 + (i % 8) * 70, 620 + (i % 3) * 4, 40, 10));
  const r = layoutLabels(items, { ...OPTS, obstacles: iconos });
  for (const p2 of r.rects)
    for (const o of iconos)
      assert.equal(p2.x < o.x + o.w && o.x < p2.x + p2.w && p2.y < o.y + o.h && o.y < p2.y + p2.h, false, p2.key);
});

test('layout: nunca pasa por encima de la banda superior del HUD (y = 40 virtuales por u) y entra en el lienzo', () => {
  const u = 4;
  const band = 40 * u;
  const { rects, dropped } = layoutLabels([item('alta', 500, band + 4)], { ...OPTS, bandTop: band });
  assert.equal(rects.length, 0, 'D22: nunca baja una pastilla hasta el borde de la banda; si no entra, se descarta');
  assert.equal(dropped, 1, 'y cuenta en las descartadas');
  // justo en el borde de la banda sí entra, sin moverse
  const justo = layoutLabels([item('justo', 500, band + 10)], { ...OPTS, bandTop: band });
  assert.deepEqual(justo.rects[0], { key: 'justo', x: 470, y: band, w: 60, h: 10 });
  assert.equal(justo.dropped, 0);
  // un solo píxel dentro de la banda ya se descarta
  const unPx = layoutLabels([item('unpx', 500, band + 9)], { ...OPTS, bandTop: band });
  assert.deepEqual([unPx.rects.length, unPx.dropped], [0, 1]);
  // y si al subir para evitar a otra cruzaría la banda, se descarta
  const r2 = layoutLabels([item('a', 500, band + 14), item('b', 500, band + 14)], { ...OPTS, bandTop: band });
  assert.equal(r2.rects.length, 1);
  assert.equal(r2.dropped, 1);
  // los bordes del lienzo: la pastilla se corre para quedar entera
  const bordes = layoutLabels([item('i', 5, 400), item('d', 1915, 400)], OPTS).rects;
  assert.equal(bordes[0].x, 0);
  assert.equal(bordes[1].x, 1920 - 60);
});

test('layout: sin elementos, o con elementos que no entran, devuelve vacío sin lanzar', () => {
  assert.deepEqual(layoutLabels([], OPTS), { rects: [], dropped: 0 });
  const r = layoutLabels([item('a', 500, 10)], OPTS);
  assert.equal(r.rects.length + r.dropped, 1);
});

test('vista: una unidad justo fuera de cada borde no cuenta y justo dentro sí', () => {
  const vista = { x0: 500, y0: 300, x1: 900, y1: 500 };
  const sel = (x, y) =>
    selectLabels({
      units: [unit(0, 'a', 1, x, y)],
      k: 6,
      view: vista,
      alpha: 1,
      spotlight: null,
      ranking: rankingDe({}),
    }).length;
  assert.equal(sel(500, 400), 1);
  assert.equal(sel(900, 400), 1);
  assert.equal(sel(700, 300), 1);
  assert.equal(sel(700, 500), 1);
  assert.equal(sel(499.9, 400), 0, 'borde izquierdo');
  assert.equal(sel(900.1, 400), 0, 'borde derecho');
  assert.equal(sel(700, 299.9), 0, 'borde superior');
  assert.equal(sel(700, 500.1), 0, 'borde inferior');
});

test('el donante en foco va primero (la mejor prioridad para la colocación)', () => {
  const { units, ranking } = donantes(30);
  units.push(unit(1, 'foco', 1, 700, 700));
  for (const k of [1, 6]) {
    const sel = selectLabels({ units, k, view: VIEW, alpha: 1, spotlight: 'foco', ranking });
    assert.equal(sel[0].key, 'foco', `k = ${k}`);
    assert.equal(sel[0].spot, true);
    assert.equal(sel.filter((e) => e.spot).length, 1);
  }
});

test('el tope por cuadro también recorta los modos por equipo (4 de las 12 de k = 1,5)', () => {
  const { units, ranking } = donantes(30);
  const cfg = resolveLabels({ maxPerFrame: 4 });
  const sel = selectLabels({ units, k: 1.5, view: VIEW, alpha: 1, spotlight: null, ranking, cfg });
  assert.equal(sel.length, 4);
  assert.deepEqual(claves(sel).sort(), ['0-0', '0-1', '1-0', '1-1'], 'los 4 de más prioridad');
});

test('recorte: un texto que mide justo el ancho máximo no se corta, y uno más largo sí', () => {
  // 22 letras de 5 px = 110 px: "CABO " y 17 letras del nombre
  const justo = fitText({ prefix: 'CABO ', name: 'a'.repeat(17), maxWidth: 110, measure: medir });
  assert.equal(justo.cut, false);
  assert.equal(justo.width, 110);
  const pasado = fitText({ prefix: 'CABO ', name: 'a'.repeat(18), maxWidth: 110, measure: medir });
  assert.equal(pasado.cut, true);
  assert.equal(pasado.text, `CABO ${'a'.repeat(16)}…`);
  assert.equal(pasado.width, 110, 'el recorte usa todo el ancho que hay');
});

test('layout: la que sube queda a un alto y un hueco de la que pisaba; con la config por defecto son 8 subidas', () => {
  const dos = layoutLabels([item('a', 500, 400), item('b', 500, 400)], OPTS);
  assert.equal(dos.rects[1].y, dos.rects[0].y - 10 - 2);
  const sinSubidas = { W: OPTS.W, H: OPTS.H, bandTop: OPTS.bandTop, obstacles: [], gap: 2 };
  const pila = Array.from({ length: 12 }, (_, i) => item(`p${i}`, 800, 1000));
  const r = layoutLabels(pila, sinSubidas);
  assert.equal(r.rects.length, 9, 'por defecto: la original y 8 subidas');
  assert.equal(r.dropped, 3);
  assert.equal(layoutLabels(pila, { ...OPTS, maxRaises: 0 }).rects.length, 1, 'sin subidas solo entra la primera');
});

test('layout: el borde inferior del lienzo la corre hacia arriba, y dos pastillas que solo se tocan no chocan', () => {
  const r = layoutLabels([item('abajo', 500, 1090)], OPTS).rects[0];
  assert.equal(r.y + r.h, 1080);
  // tocarse por el borde (vertical u horizontal) no es pisarse
  const v = layoutLabels([item('a', 500, 400), item('b', 500, 390)], OPTS).rects;
  assert.deepEqual([v[0].y, v[1].y], [390, 380]);
  const h = layoutLabels([item('a', 500, 400), item('b', 560, 400)], OPTS).rects;
  assert.deepEqual([h[0].y, h[1].y], [390, 390]);
});

test('hitLabel: el borde derecho no está dentro', () => {
  assert.equal(hitLabel([{ key: 'a', x: 100, y: 100, w: 50, h: 10 }], { x: 150, y: 100 }), null);
});

test('hitLabel: devuelve la clave de la pastilla bajo el punto, o null (bordes: izquierdo incluido, derecho no)', () => {
  const rects = [
    { key: 'a', x: 100, y: 100, w: 50, h: 10 },
    { key: 'b', x: 200, y: 100, w: 50, h: 10 },
  ];
  assert.equal(hitLabel(rects, { x: 100, y: 100 }), 'a');
  assert.equal(hitLabel(rects, { x: 149, y: 109 }), 'a');
  assert.equal(hitLabel(rects, { x: 150, y: 105 }), null);
  assert.equal(hitLabel(rects, { x: 225, y: 105 }), 'b');
  assert.equal(hitLabel(rects, { x: 225, y: 110 }), null);
  assert.equal(hitLabel(rects, { x: 0, y: 0 }), null);
  assert.equal(hitLabel([], { x: 10, y: 10 }), null);
});
