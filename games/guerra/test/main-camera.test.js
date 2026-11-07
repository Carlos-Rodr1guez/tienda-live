import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeCanvasFactory, createFakeCtx } from './support/fake-canvas.js';

// Lote 5c: el cableado de `main.js` con un DOM falso (sin navegador). La cámara se lee del panel F2 que el propio juego
// dibuja: cada línea es un par de `fillText` (etiqueta y valor). `main.js` es provisional hasta el lote 6.

const GJ = fileURLToPath(new URL('../public/js/', import.meta.url));
const FRAME_MS = 1000 / 60;

/** Un DOM falso y un `import` nuevo de main.js para la URL dada. */
async function arrancar(search, { reducido = false } = {}) {
  const { createCanvas } = createFakeCanvasFactory();
  const ctx = createFakeCtx({ record: true });
  const oyentes = { window: new Map(), canvas: new Map() };
  /** Opciones con que se registró cada oyente del lienzo (p. ej. `{passive: false}` de la rueda). */
  const opciones = {};
  const agregar = (mapa) => (type, fn, opts) => {
    if (!mapa.has(type)) mapa.set(type, []);
    mapa.get(type).push(fn);
    if (mapa === oyentes.canvas) opciones[type] = opts;
  };
  const lanzar = (mapa, type, e = {}) => {
    const ev = { preventDefault() {}, isTrusted: true, ...e };
    for (const fn of mapa.get(type) ?? []) fn(ev);
    return ev;
  };
  const canvas = {
    width: 1920,
    height: 1080,
    clientWidth: 1920,
    clientHeight: 1080,
    getContext: () => ctx,
    addEventListener: agregar(oyentes.canvas),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const botones = {};
  /** @type {any} */
  const entorno = {};
  const boton = (id) => {
    const clicks = [];
    const oyentesDelBoton = {};
    const b = {
      id,
      textContent: '',
      disabled: false,
      clicks,
      on: oyentesDelBoton,
      addEventListener: (type, fn) => {
        if (type === 'click') clicks.push(fn);
        (oyentesDelBoton[type] ??= []).push(fn);
      },
      setAttribute() {},
    };
    botones[id] = b;
    return b;
  };
  for (const id of ['cam-bar', 'cam-all', 'cam-in', 'cam-out', 'cam-auto']) boton(id);
  let raf = null;
  Object.assign(globalThis, {
    window: globalThis,
    location: { search },
    document: {
      getElementById: (id) => (id === 'game' ? canvas : (botones[id] ?? null)),
      createElement: () => createCanvas(1, 1),
    },
    matchMedia: () => ({ matches: reducido, addEventListener() {} }),
    ResizeObserver: class {
      constructor(cb) {
        entorno.alCambiarTamano = cb;
      }
      observe() {}
    },
    requestAnimationFrame: (cb) => {
      raf = cb;
      return 1;
    },
    addEventListener: agregar(oyentes.window),
    fetch: async () => ({ ok: false }),
  });
  globalThis.devicePixelRatio = 1;
  await import(`../public/js/main.js?caso=${search}&n=${Math.random()}`);
  let ts = 0;
  Object.assign(entorno, {
    canvas,
    ctx,
    botones,
    opciones,
    /** Da `n` cuadros de `ms` milisegundos. */
    cuadros(n = 1, ms = FRAME_MS) {
      for (let i = 0; i < n; i++) {
        ts += ms;
        ctx.reset();
        const cb = raf;
        raf = null;
        cb(ts);
      }
    },
    tecla: (key, extra = {}) => lanzar(oyentes.window, 'keydown', { key, ...extra }),
    soltar: (key) => lanzar(oyentes.window, 'keyup', { key }),
    blur: () => lanzar(oyentes.window, 'blur'),
    lienzo: (type, e) => lanzar(oyentes.canvas, type, e),
    clic: (id) => botones[id].clicks.forEach((fn) => fn({ preventDefault() {} })),
    /** Lo que dibujó el último cuadro: textos y, con F2 abierto, el panel como etiqueta -> valor. */
    textos: () => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]),
    f2() {
      const t = entorno.textos();
      const out = {};
      // el panel empieza en su primera línea y sigue en pares etiqueta/valor
      for (let i = t.indexOf('cuadros por segundo'); i >= 0 && i + 1 < t.length; i += 2) out[t[i]] = t[i + 1];
      return out;
    },
  });
  // los primeros cuadros dan el primer paso del sim: el `intro` empieza la ronda con el mapa entero
  entorno.cuadros(6);
  return entorno;
}

const K = 'cámara k (objetivo / mostrado)';
const MODO = 'cámara';
const AUTO = 'cámara automática';
const kMostrado = (f2) => Number(f2[K].split(' / ')[1]);
const kObjetivo = (f2) => Number(f2[K].split(' / ')[0]);

test('la cámara arranca en el mapa entero, manual, y el panel F2 la muestra', async () => {
  const e = await arrancar('?f2');
  e.cuadros(2);
  const f2 = e.f2();
  assert.equal(f2[K], '1.000 / 1.000');
  assert.equal(f2[MODO], 'CÁMARA MANUAL · manual');
  assert.equal(f2[AUTO], 'encendida');
  assert.ok(
    e.textos().includes('CÁMARA MANUAL'),
    'el estado de la cámara se ve en pantalla durante la batalla o la preparación',
  );
});

test('teclas de cámara: + y − (×1,25 al nivel vecino), V, 1 y 2, flechas, A y R', async () => {
  const e = await arrancar('?f2');
  e.cuadros(2);
  // con el foco en un campo de texto (el panel F1) las teclas no tocan la cámara
  e.tecla('+', { target: { tagName: 'INPUT' } });
  e.tecla('+', { target: { tagName: 'TEXTAREA' } });
  e.tecla('+', { target: { isContentEditable: true } });
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1);
  e.tecla('+');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.5, 'del mapa entero al primer nivel (s = 2 en 1080p)');
  assert.equal(kMostrado(e.f2()), 1.5);
  e.tecla('=');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 2.25);
  e.tecla('-');
  e.tecla('_');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1);
  // base izquierda y derecha
  e.tecla('1');
  e.cuadros(90);
  assert.ok(kObjetivo(e.f2()) > 1 && kObjetivo(e.f2()) <= 2.25);
  const foco = () => Number(e.f2()['foco de la cámara (px de mundo)'].split(', ')[0]);
  assert.ok(foco() < 720, 'la 1 va a la base izquierda');
  e.tecla('2');
  e.cuadros(90);
  assert.ok(foco() > 720, 'la 2 va a la base derecha');
  e.tecla('v');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1);
  // Ver todo con la V mayúscula también, y sin tocar nada cuando se mantiene pulsada
  e.tecla('+');
  e.cuadros(90);
  e.tecla('V');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1);
  // flechas: se mueven mientras se sostienen y se frenan al soltar
  e.tecla('+');
  e.cuadros(90);
  const antes = e.f2()['foco de la cámara (px de mundo)'];
  e.tecla('ArrowRight');
  e.cuadros(30);
  e.soltar('ArrowRight');
  e.cuadros(30);
  assert.notEqual(e.f2()['foco de la cámara (px de mundo)'], antes);
  // A alterna la automática y avisa
  e.tecla('a');
  e.cuadros(1);
  assert.equal(e.f2()[AUTO], 'apagada');
  assert.ok(e.textos().includes('Cámara automática: desactivada'));
  e.tecla('A');
  e.cuadros(1);
  assert.equal(e.f2()[AUTO], 'encendida');
  assert.ok(e.textos().includes('Cámara automática: activada'));
  // R enciende el movimiento reducido y, con la automática prendida, la apaga con su aviso
  e.cuadros(200); // antes vencen los avisos de A (2,5 s)
  e.tecla('r');
  e.cuadros(1);
  assert.equal(e.f2()[AUTO], 'apagada');
  assert.ok(e.textos().includes('Movimiento reducido: activado'));
  assert.ok(e.textos().includes('Cámara automática: desactivada'), 'R en pleno LIVE apaga también la automática');
  e.cuadros(1);
  e.tecla('r'); // desactivar el movimiento reducido deja A como estaba (apagada)
  e.cuadros(2);
  assert.equal(e.f2()[AUTO], 'apagada');
  // las teclas con Ctrl, Alt o Meta son del navegador y no se tocan
  e.tecla('v');
  e.cuadros(60);
  e.tecla('+', { ctrlKey: true });
  e.cuadros(60);
  assert.equal(kObjetivo(e.f2()), 1);
});

test('rueda, arrastre y doble toque sobre el lienzo; pointer-down toma el control', async () => {
  const e = await arrancar('?f2');
  e.cuadros(2);
  let sinScroll = 0;
  const rueda = (dy) =>
    e.lienzo('wheel', {
      deltaY: dy,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 960,
      clientY: 540,
      preventDefault() {
        sinScroll++;
      },
    });
  rueda(-100);
  e.cuadros(1);
  rueda(-100);
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.5, 'dos muescas de 100 cambian de nivel');
  assert.equal(sinScroll, 2, 'la rueda no hace scroll ni zoom de la página');
  assert.deepEqual(e.opciones.wheel, { passive: false }, 'sin passive: false el navegador ignora preventDefault');
  // el botón derecho o el del medio no son gestos de la cámara
  e.cuadros(60);
  const parado = e.f2()['segundos sin entrada del narrador'];
  e.lienzo('pointerdown', { pointerId: 9, clientX: 5, clientY: 5, timeStamp: 0, pointerType: 'mouse', button: 2 });
  e.cuadros(1);
  assert.notEqual(e.f2()['segundos sin entrada del narrador'], '0.0', 'el botón derecho no toma el control');
  assert.ok(Number(e.f2()['segundos sin entrada del narrador']) >= Number(parado));
  // arrastre con el mouse: umbral y 1:1
  e.tecla('+');
  e.cuadros(90);
  const antes = e.f2()['foco de la cámara (px de mundo)'];
  e.lienzo('pointerdown', { pointerId: 1, clientX: 900, clientY: 500, timeStamp: 0, pointerType: 'mouse', button: 0 });
  e.lienzo('pointermove', { pointerId: 1, clientX: 800, clientY: 480, timeStamp: 10, pointerType: 'mouse' });
  e.lienzo('pointerup', { pointerId: 1, clientX: 800, clientY: 480, timeStamp: 20, pointerType: 'mouse' });
  e.cuadros(2);
  assert.notEqual(e.f2()['foco de la cámara (px de mundo)'], antes);
  // doble toque: acerca
  e.tecla('v');
  e.cuadros(90);
  const toque = (t) => {
    e.lienzo('pointerdown', {
      pointerId: 2,
      clientX: 960,
      clientY: 540,
      timeStamp: t,
      pointerType: 'touch',
      button: 0,
    });
    e.lienzo('pointerup', { pointerId: 2, clientX: 960, clientY: 540, timeStamp: t + 30, pointerType: 'touch' });
  };
  toque(1000);
  toque(1150);
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.5);
  // el menú contextual no interfiere con los gestos
  let menu = 0;
  e.lienzo('contextmenu', {
    preventDefault() {
      menu++;
    },
  });
  assert.equal(menu, 1);
});

test('botones de la cámara: Ver todo, Acercar, Alejar y el estado de la automática', async () => {
  const e = await arrancar('?f2');
  e.cuadros(3);
  const { botones } = e;
  assert.equal(botones['cam-all'].textContent, 'Ver todo');
  assert.equal(botones['cam-in'].textContent, 'Acercar');
  assert.equal(botones['cam-out'].textContent, 'Alejar');
  assert.equal(botones['cam-auto'].textContent, 'CÁMARA MANUAL');
  assert.equal(botones['cam-out'].disabled, true, 'en el mapa entero no se puede alejar');
  assert.equal(botones['cam-all'].disabled, true);
  e.clic('cam-in'); // ×1,5 desde s = 1,333 llega a 2
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.5);
  assert.equal(botones['cam-out'].disabled, false);
  assert.equal(botones['cam-all'].disabled, false);
  e.clic('cam-in'); // ×1,5 desde s = 2 llega a 3, y desde 3 a 4,5, que está más cerca de 5 (k 3,75) que de 4
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 2.25);
  e.clic('cam-in');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 3.75, 'el factor de los botones es 1,5, no el 1,25 de las teclas');
  for (let i = 0; i < 10; i++) {
    e.clic('cam-in');
    e.cuadros(60);
  }
  assert.equal(botones['cam-in'].disabled, true, 'deshabilitado en el límite');
  e.clic('cam-out');
  e.cuadros(60);
  assert.equal(botones['cam-in'].disabled, false);
  e.clic('cam-all');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1);
  e.clic('cam-auto');
  e.cuadros(1);
  assert.equal(e.f2()[AUTO], 'apagada');
});

test('?k, ?cx y ?cy dan la vista manual inicial', async () => {
  const e = await arrancar('?f2&k=2.25&cx=100&cy=448');
  e.cuadros(2);
  assert.equal(e.f2()[K], '2.250 / 2.250');
  assert.equal(e.f2()[MODO], 'CÁMARA MANUAL · manual');
  const chico = await arrancar('?f2&k=1');
  chico.cuadros(2);
  assert.equal(chico.f2()[K], '1.000 / 1.000');
});

test('con movimiento reducido del sistema la automática arranca apagada', async () => {
  const e = await arrancar('?f2', { reducido: true });
  e.cuadros(2);
  assert.equal(e.f2()[AUTO], 'apagada');
  e.tecla('a');
  e.cuadros(1);
  assert.equal(e.f2()[AUTO], 'encendida');
});

test('en el modo ?golden se permiten las entradas de cámara (solo presentación) y la R', async () => {
  const e = await arrancar('?golden&rapido=2');
  e.cuadros(40); // el partido dorado empieza (startMatch) en el paso 70
  assert.equal(e.f2()['cámara automática'], 'encendida');
  assert.equal(e.f2()[K], '1.000 / 1.000');
  e.tecla('+');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.5);
  e.lienzo('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: false, clientX: 960, clientY: 540 });
  e.lienzo('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: false, clientX: 960, clientY: 540 });
  e.cuadros(90);
  assert.ok(kObjetivo(e.f2()) > 1.5);
  e.tecla('v');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1);
  e.tecla('r');
  e.cuadros(1);
  assert.ok(e.textos().includes('Movimiento reducido: activado'));
});

test('el minimapa aparece con k > 1 y su clic centra la vista', async () => {
  const e = await arrancar('?f2');
  e.cuadros(2);
  const dibujaMinimapa = () => e.ctx.calls.some((c) => c[0] === 'strokeRect' && c[3] > 300 && c[3] < 360);
  assert.equal(dibujaMinimapa(), false, 'oculto en el mapa entero');
  e.tecla('+');
  e.cuadros(90);
  assert.equal(dibujaMinimapa(), true, 'visible con k > 1');
  const antes = e.f2()['foco de la cámara (px de mundo)'];
  // clic en el borde izquierdo del minimapa (336×189 centrado abajo en 1080p)
  e.lienzo('pointerdown', { pointerId: 3, clientX: 800, clientY: 960, timeStamp: 0, pointerType: 'mouse', button: 0 });
  e.lienzo('pointerup', { pointerId: 3, clientX: 800, clientY: 960, timeStamp: 30, pointerType: 'mouse' });
  e.cuadros(60);
  assert.notEqual(e.f2()['foco de la cámara (px de mundo)'], antes);
});

test('la cámara automática maneja en una batalla de verdad tras 7 s sin entrada, y el narrador la frena', async () => {
  const e = await arrancar('?f2&carga&rapido=20');
  let manejo = false;
  let kMax = 1;
  // 100 ms de reloj de vista por cuadro: pasan los 7 s de inactividad y llegan las peleas
  for (let i = 0; i < 500 && !manejo; i++) {
    e.cuadros(1, 100);
    const f2 = e.f2();
    if (f2[MODO]?.startsWith('CÁMARA AUTO')) manejo = true;
    kMax = Math.max(kMax, kObjetivo(f2) || 1);
  }
  assert.equal(manejo, true, 'la automática manejó en algún momento');
  e.cuadros(40, 100);
  assert.ok(kMax >= 1, 'k válido');
  // una tecla de cámara la frena en el mismo cuadro
  e.tecla('+');
  e.cuadros(1, 16);
  assert.equal(e.f2()[MODO].startsWith('CÁMARA MANUAL'), true);
  // Espacio: la pelea más caliente, una vez (un preajuste del narrador: no deja la automática manejando)
  e.cuadros(20, 100);
  e.tecla(' ');
  e.cuadros(1, 16);
  assert.match(e.f2()[MODO], /^CÁMARA MANUAL · (preset|manual)$/);
  assert.equal(e.f2()['segundos sin entrada del narrador'], '0.0');
});

test('main.js vacía la bandeja del mundo UNA sola vez por paso y la cámara solo la recibe', () => {
  const main = fs.readFileSync(path.join(GJ, 'main.js'), 'utf8');
  const sinComentarios = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(sinComentarios.match(/\.drain\(/g)?.length, 1, 'un solo drain()');
  assert.doesNotMatch(sinComentarios, /registry\.drain/);
  assert.match(sinComentarios, /rig\.consume\(/);
  for (const f of fs.readdirSync(path.join(GJ, 'camera'))) {
    const src = fs
      .readFileSync(path.join(GJ, 'camera', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(src, /\.drain\(/, `${f} no vacía bandejas`);
    assert.doesNotMatch(src, /from\s+['"]\.\.\/sim\//, `${f} no importa del sim`);
  }
});

test('cada ronda nueva empieza con el mapa entero aunque el narrador haya acercado (partido dorado, ronda 2)', async () => {
  const e = await arrancar('?golden&rapido=60');
  e.cuadros(30); // pasos 1800: ya hay batalla
  e.tecla('+');
  e.cuadros(10);
  assert.equal(kObjetivo(e.f2()), 1.5);
  // el log dorado empieza la ronda 2 en el paso 5200 (cuadro 87): el intro vuelve al mapa entero
  e.cuadros(70);
  assert.equal(kObjetivo(e.f2()), 1);
  assert.equal(kMostrado(e.f2()), 1);
});

test('al cambiar el tamaño del lienzo los niveles se recalculan; perder el foco suelta las flechas', async () => {
  const e = await arrancar('?f2');
  e.cuadros(2);
  assert.equal(e.f2()['escala s'], '1.333');
  e.canvas.clientWidth = 1280;
  e.canvas.clientHeight = 720;
  e.alCambiarTamano();
  e.cuadros(2);
  assert.equal(e.canvas.width, 1280);
  assert.equal(e.f2()['escala s'], '0.889', 'la escala de ajuste del lienzo nuevo');
  e.tecla('+');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.125, 'los niveles de 1280×720 (D23)');
  e.tecla('+');
  e.cuadros(90);
  e.tecla('+');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 3.375, 'con la vista chica hay lugar para mover la cámara');
  // flecha pulsada y la ventana pierde el foco: la cámara no se queda corriendo
  e.tecla('ArrowRight');
  e.cuadros(10);
  e.blur();
  const antes = e.f2()['foco de la cámara (px de mundo)'];
  e.cuadros(60);
  assert.equal(e.f2()['foco de la cámara (px de mundo)'], antes);
});

test('el temblor mueve la vista unos píxeles y la cámara lo suma al origen (solo vista: el hash dorado no cambia)', async () => {
  const e = await arrancar('?golden&rapido=60');
  // con el mapa entero y sin temblor, la copia del mundo a la pantalla empieza siempre en x = 0 (16:9)
  const origenes = new Set();
  for (let i = 0; i < 200; i++) {
    e.cuadros(1);
    const copia = e.ctx.calls.find((c) => c[0] === 'drawImage' && c.length === 10);
    if (copia) origenes.add(copia[6]);
  }
  assert.ok(origenes.has(0), 'sin temblor el origen es 0');
  assert.ok(
    [...origenes].some((x) => x !== 0),
    `con la caída de la base el origen se mueve (${[...origenes]})`,
  );
});

test('C3: el mouse no deja el foco en los botones de la cámara (mousedown y pointerdown se cancelan en la barra)', async () => {
  const e = await arrancar('?f2');
  for (const tipo of ['mousedown', 'pointerdown']) {
    let canceladas = 0;
    for (const fn of e.botones['cam-bar'].on[tipo] ?? []) {
      fn({
        preventDefault() {
          canceladas++;
        },
      });
    }
    assert.equal(canceladas, 1, tipo);
  }
  // el clic sigue funcionando
  e.clic('cam-in');
  e.cuadros(90);
  assert.equal(kObjetivo(e.f2()), 1.5);
});

test('C3: Enter sobre un botón con foco lo activa el navegador y NO avanza la ronda del juego', async () => {
  const e = await arrancar('?carga&rapido=60');
  let espera = false;
  for (let i = 0; i < 800 && !espera; i++) {
    e.cuadros(1, 100);
    espera = e.textos().some((t) => t.includes('esperando al narrador'));
  }
  assert.equal(espera, true, 'la ronda terminó y espera al narrador');
  e.tecla('Enter', { target: { tagName: 'BUTTON' } });
  e.cuadros(2, 100);
  assert.ok(
    e.textos().some((t) => t.includes('esperando al narrador')),
    'con el foco en un botón, Enter no avanza',
  );
  e.tecla('Enter');
  e.cuadros(2, 100);
  assert.ok(
    e.textos().some((t) => t.includes('preparación')),
    'Enter sin foco en un botón sí empieza la ronda siguiente',
  );
});

test('C6: el lienzo tiene touch-action: none en el CSS (ni scroll ni zoom de la página con los gestos)', () => {
  const css = fs.readFileSync(path.join(GJ, '..', 'css', 'style.css'), 'utf8');
  assert.match(css, /#game\s*\{[^}]*touch-action:\s*none/);
});

test('C1: la cámara automática sigue manejando cuando la ronda termina y el juego espera al narrador', async () => {
  const e = await arrancar('?f2&carga&rapido=60');
  let manejo = false;
  let enEspera = '';
  for (let i = 0; i < 800 && !enEspera; i++) {
    e.cuadros(1, 250); // el reloj de vista avanza rápido: pasan los 7 s de inactividad antes de que acabe la ronda
    const modo = e.f2()[MODO] ?? '';
    if (modo.startsWith('CÁMARA AUTO')) manejo = true;
    if (e.textos().some((t) => t.includes('esperando al narrador'))) enEspera = modo;
  }
  assert.equal(manejo, true, 'manejó durante la batalla');
  assert.ok(enEspera.startsWith('CÁMARA AUTO'), `en la espera sigue en automática (${enEspera})`);
});
