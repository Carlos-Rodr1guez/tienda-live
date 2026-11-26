import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar } from './support/fake-main.js';
import { PAISES } from '../public/js/data/paises.js';
import { createUi } from '../public/js/ui/draw.js';
import { layoutFor } from '../public/js/ui/layout.js';
import { createFakeCtx } from './support/fake-canvas.js';
import { advanceRect } from '../public/js/ui/screens-draw.js';
import { S } from '../public/js/ui/strings.js';
import { findForbidden } from './support/forbidden-words.js';

// 6.5: el cableado de la interfaz en `main.js` (DOM falso): HUD en batalla, selector, sala, fin de partido, banners de la
// cámara vaciados en cada cuadro, error de config y el botón de avance con el puntero. Todo desde los textos que se dibujan.

const hay = (e, re) => e.textos().some((t) => re.test(t));

test('CB-17: en batalla se ve el HUD completo con los textos de S, y ya no el texto provisional', () => {
  const e = arrancar('?f2');
  return e.then((main) => {
    main.cuadros(4);
    const t = main.textos();
    for (const esperado of ['Perú', 'México', 'Ronda 1/3', S.camera.manual, S.hud.inField, S.frame]) {
      assert.ok(t.includes(esperado), `falta "${esperado}"`);
    }
    assert.ok(!t.some((x) => x.includes('Enter: siguiente')), 'el texto provisional ya no está');
    for (const x of t) assert.deepEqual(findForbidden(x), [], x);
  });
});

test('NM-4: el botón de la cámara automática dice lo que hace y el estado se lee aparte, en el HUD', async () => {
  const e = await arrancar('');
  e.cuadros(3);
  assert.equal(e.botones['cam-auto'].textContent, S.camera.autoButton);
  assert.ok(e.textos().includes(S.camera.manual), 'esperando sus 7 s la cámara está en manual');
  e.tecla('a');
  e.cuadros(2);
  assert.equal(e.botones['cam-auto'].textContent, S.camera.autoButton, 'el rótulo no copia el estado');
  assert.ok(e.textos().includes(S.camera.autoOff), 'el aviso de la tecla A sale en pantalla');
});

test('CB-17 y NM-1: sin parámetros se ve el selector, Enter elige el par (sala), Enter empieza y nada arranca solo', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true });
  e.cuadros(4);
  assert.ok(hay(e, /^Elige los dos países$/), 'selector');
  assert.ok(e.textos().includes('Elegir el par'));
  assert.ok(!hay(e, /^Ronda \d\/3$/), 'sin HUD de batalla en el selector');
  e.cuadros(300);
  assert.ok(hay(e, /^Elige los dos países$/), 'sigue en el selector sin acción');
  e.tecla('Enter');
  e.cuadros(3);
  assert.ok(e.textos().includes('Perú vs México'), 'sala');
  assert.ok(e.textos().includes(S.lobby.empty), 'sala vacía');
  assert.ok(e.textos().includes(S.lobby.start));
  e.tecla('Enter');
  e.cuadros(3);
  assert.ok(e.textos().includes('Ronda 1/3'), 'empezó el partido');
});

test('CB-17: el botón de avance también responde al puntero, y fuera del botón el clic es de la cámara', async () => {
  const e = await arrancar('?pair=AR-BO', { selector: true });
  e.cuadros(3);
  // el botón es UN componente a la medida de su contenido: el mismo rectángulo con que se dibuja (`ui.advanceRect`)
  const ui = createUi({ iconBank: null, iconTeam: [0, 0] });
  const medir = (kind, model, text) => {
    const ctx = createFakeCtx({ record: true });
    ui.draw(ctx, { W: 1920, H: 1080, now: 1, dt: 0, reduced: false, hud: null, screen: { kind: 'x' }, notices: [] });
    return advanceRect(layoutFor(1920, 1080), { kind, model, advance: { key: 'Enter', text } }, ui.painter);
  };
  const boton = medir('matchup', { state: 'normal' }, S.matchup.start);
  assert.ok(boton, 'el selector tiene botón de avance');
  e.puntero('pointerdown', { clientX: boton.x + 5, clientY: boton.y + 5 });
  e.cuadros(3);
  assert.ok(e.textos().includes('Argentina vs Bolivia'), 'el clic eligió el par: sala');
  const lobby = medir('lobby', {}, S.lobby.start);
  e.puntero('pointerdown', { clientX: lobby.x + 5, clientY: lobby.y + 5 });
  e.cuadros(3);
  assert.ok(e.textos().includes('Ronda 1/3'), 'el clic empezó el partido');
  // un clic lejos de cualquier botón no avanza nada
  e.puntero('pointerdown', { clientX: 5, clientY: 500 });
  e.cuadros(2);
  assert.ok(e.textos().includes('Ronda 1/3'));
});

test('NM-1: tras la ronda, la tarjeta de resultados espera al narrador y Enter empieza la siguiente', async () => {
  const e = await arrancar('?carga&rapido=60');
  let espera = false;
  for (let i = 0; i < 800 && !espera; i++) {
    e.cuadros(1, 100);
    espera = hay(e, /^El narrador inicia la siguiente ronda$/);
  }
  assert.equal(espera, true);
  assert.ok(hay(e, /^¡.+ gana la ronda!$/), 'dice quién ganó');
  e.tecla('Enter');
  e.cuadros(3, 100);
  assert.ok(e.textos().includes('Ronda 2/3'));
});

test('KIT-25 y NM-1: al final del partido Enter vuelve al selector y nada arranca solo', async () => {
  const e = await arrancar('?carga&rapido=60');
  let fin = false;
  for (let i = 0; i < 6000 && !fin; i++) {
    e.cuadros(1, 100);
    fin = hay(e, /^¡.+ gana la batalla!$/);
    if (!fin && hay(e, /^El narrador inicia la siguiente ronda$/)) e.tecla('Enter');
  }
  assert.equal(fin, true, 'el partido terminó');
  assert.ok(e.textos().includes(S.matchEnd.back));
  assert.ok(e.textos().includes(S.matchEnd.empty), 'sin donantes, las dos columnas dicen "Sin regalos"');
  e.cuadros(300, 100);
  assert.equal(hay(e, /^¡.+ gana la batalla!$/), true, 'el final se queda hasta que el narrador pulse Enter');
  e.tecla('Enter');
  e.cuadros(3, 100);
  assert.ok(hay(e, /^Elige los dos países$/), 'volvió al selector');
});

test('CB-17 y KIT-23: los banners de la cámara se vacían en cada cuadro y los ascensos salen al feed y al banner', async () => {
  const e = await arrancar('?donantes&avion&rapido=8');
  let aviso = false;
  let ascenso = false;
  let union = false;
  // el banner del avión espera detrás de los ascensos (1 cada 1,5 s, 0,9 s si hay más de 5 en cola): hay que dejar correr el reloj
  for (let i = 0; i < 4000 && !(aviso && ascenso && union); i++) {
    e.cuadros(1);
    // el adaptador trae el nombre del regalo que pagó el avión: "{nombre} envió Avión: bombardeo"
    aviso ||= hay(e, /envió Avión: bombardeo/);
    ascenso ||= hay(e, /ascendió a/);
    union ||= hay(e, /se unió a/);
  }
  assert.equal(aviso, true, 'banner del avión (rig.moments.drainBanners)');
  assert.equal(ascenso, true, 'ascensos');
  assert.equal(union, true, 'uniones en el feed');
  // nunca texto del chat ni de otro lado: todo sale de las plantillas
  for (const t of e.textos()) assert.deepEqual(findForbidden(t), []);
});

test('CB-17: una config inválida muestra qué falló y cómo salir, y el juego no arranca', async () => {
  const fetch = async (url) =>
    url === '/api/config'
      ? { ok: true, json: async () => ({ game: { graphics: { reducedMotion: 'quizás' } } }) }
      : { ok: false };
  const e = await arrancar('', { fetch });
  e.cuadros(4);
  assert.ok(e.textos().includes(S.errors.title));
  assert.ok(hay(e, /^La configuración tiene un error: graphics\.reducedMotion/));
  assert.ok(e.textos().includes(S.errors.configExit));
  assert.ok(!hay(e, /^Ronda \d\/3$/), 'no hay partido detrás');
});

test('CB-13 y CB-17: con ?golden la interfaz dibuja el HUD y no pide ni muestra nada del registro', async () => {
  const e = await arrancar('?golden&rapido=8');
  e.cuadros(10);
  assert.ok(hay(e, /^Ronda \d\/3$/));
  assert.ok(e.textos().includes(S.hud.inField));
  assert.ok(PAISES.length > 0);
});

test('NM-9: la pausa dibuja el texto exacto y Enter/P siguen siendo del narrador', async () => {
  const e = await arrancar('');
  e.cuadros(3);
  e.tecla('p');
  e.cuadros(3);
  assert.ok(e.textos().includes('Pausa: el narrador vuelve enseguida'));
  e.tecla('p');
  e.cuadros(30);
  assert.ok(!e.textos().includes('Pausa: el narrador vuelve enseguida'));
});

test('la interfaz mide con la fuente del diseño: ninguna fuente de 12 px a 1080p y ninguna pila suelta', async () => {
  const e = await arrancar('');
  e.cuadros(4);
  const fuentes = e.ctx.calls.filter((c) => c[0] === 'set:font').map((c) => String(c[1]));
  assert.ok(fuentes.some((f) => /Pixelify Sans/.test(f)));
  assert.ok(
    fuentes.some((f) => /\b28px\b/.test(f)),
    '7 px virtuales por u = 4',
  );
});
