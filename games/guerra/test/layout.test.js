import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraControls, frameEnabled, layoutFor, statusFontPx, uiScale, BAND_TOP } from '../public/js/ui/layout.js';
import { minimapRect } from '../public/js/ui/layout.js';
import { S } from '../public/js/ui/strings.js';

// 6.2: escala entera de la interfaz, regiones ancladas a los bordes y marco del narrador (CB-17, NM-10). Todo puro.

const TAMANOS = [
  [640, 360],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

const dentro = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H && r.w > 0 && r.h > 0;
const choca = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('NM-10: u = max(1, floor(min(W/480, H/270))): 480×270 virtuales a 1080p y 640×360 a 720p', () => {
  assert.equal(uiScale(1920, 1080), 4);
  assert.equal(1920 / uiScale(1920, 1080), 480);
  assert.equal(1080 / uiScale(1920, 1080), 270);
  assert.equal(uiScale(1280, 720), 2);
  assert.equal(1280 / uiScale(1280, 720), 640);
  assert.equal(uiScale(640, 360), 1);
  assert.equal(uiScale(2560, 1440), 5);
  assert.equal(uiScale(3840, 2160), 8);
  assert.equal(uiScale(1366, 768), 2);
  // ventanas raras, vacías o con números inválidos: nunca menos de 1
  for (const [w, h] of [
    [0, 0],
    [100, 50],
    [Number.NaN, 1080],
    [1920, Number.NaN],
    [-5, -5],
    [Infinity, Infinity],
  ]) {
    const u = uiScale(w, h);
    assert.ok(Number.isInteger(u) && u >= 1 && u <= 64, `${w}×${h} → ${u}`);
  }
});

test('CB-17: todas las regiones caen dentro del lienzo, a escala entera, de 640×360 a 4K', () => {
  for (const [W, H] of TAMANOS) {
    const L = layoutFor(W, H);
    const u = L.u;
    assert.equal(u, uiScale(W, H));
    for (const nombre of ['panelL', 'panelR', 'center', 'railL', 'railR', 'feed', 'minimap', 'buttons', 'frame']) {
      const r = L[nombre];
      assert.ok(dentro(r, W, H), `${W}×${H} ${nombre} ${JSON.stringify(r)}`);
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(r[k]), `${nombre}.${k} entero`);
    }
    assert.equal(L.field.y, BAND_TOP * u);
    assert.ok(L.field.y + L.field.h <= H);
    assert.ok(L.field.h > 0);
  }
});

test('NM-10: a 480×270 virtuales el marco del narrador cae en 388–476 × 196–266', () => {
  const L = layoutFor(1920, 1080);
  assert.deepEqual(L.frame, { x: 388 * 4, y: 196 * 4, w: 88 * 4, h: 70 * 4 });
  const M = layoutFor(1280, 720);
  assert.deepEqual(M.frame, { x: 1280 - 92 * 2, y: 720 - 74 * 2, w: 88 * 2, h: 70 * 2 });
});

test('NM-10: el marco no tapa texto del HUD ni el minimapa ni el feed ni los botones, a ningún tamaño', () => {
  for (const [W, H] of TAMANOS) {
    const L = layoutFor(W, H);
    for (const otro of ['panelL', 'panelR', 'center', 'railL', 'railR', 'feed', 'minimap', 'buttons']) {
      assert.ok(!choca(L.frame, L[otro]), `${W}×${H}: el marco pisa ${otro}`);
    }
  }
});

test('CB-17: las regiones del HUD no se pisan entre sí', () => {
  const nombres = ['panelL', 'panelR', 'center', 'railL', 'railR', 'feed', 'minimap', 'buttons', 'frame'];
  for (const [W, H] of TAMANOS) {
    const L = layoutFor(W, H);
    for (let i = 0; i < nombres.length; i++)
      for (let j = i + 1; j < nombres.length; j++)
        assert.ok(!choca(L[nombres[i]], L[nombres[j]]), `${W}×${H}: ${nombres[i]} pisa ${nombres[j]}`);
  }
});

test('S6: el minimapa es el de la cámara y no tapa la línea de estado ni el centro del HUD', () => {
  for (const [W, H] of TAMANOS) {
    const L = layoutFor(W, H);
    assert.deepEqual(L.minimap, minimapRect(W, H));
    assert.ok(!choca(L.minimap, L.center), `${W}×${H}`);
    assert.ok(!choca(L.minimap, L.status), `${W}×${H}`);
    assert.ok(dentro(L.status, W, H));
    // la línea de estado está dentro del panel central
    assert.ok(L.status.x >= L.center.x && L.status.x + L.status.w <= L.center.x + L.center.w);
    assert.ok(L.status.y >= L.center.y && L.status.y + L.status.h <= L.center.y + L.center.h);
  }
});

test('S6: la etiqueta de estado sigue la escala u: no queda en 12 px a 1080p', () => {
  assert.equal(statusFontPx(1920, 1080), 28);
  assert.ok(statusFontPx(1920, 1080) > 12);
  assert.equal(statusFontPx(1280, 720), 14);
  assert.equal(statusFontPx(640, 360), 7);
});

test('S3: el botón de la cámara es de alternar con rótulo fijo y el estado se lee aparte', () => {
  // la automática está encendida pero todavía espera sus 7 s: el estado es MANUAL y el botón la APAGA
  const esperando = cameraControls({ mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 });
  assert.equal(esperando.status, S.camera.manual);
  assert.equal(esperando.auto.text, S.camera.autoButton);
  assert.equal(esperando.auto.pressed, true);
  // manejando la automática
  const manejando = cameraControls({ mode: 'auto', autoEnabled: true, k: 1.5, kShown: 1.5, level: 1, levels: 8 });
  assert.equal(manejando.status, S.camera.auto);
  assert.equal(manejando.auto.text, S.camera.autoButton);
  // apagada: estado manual y el botón la ENCIENDE
  const apagada = cameraControls({ mode: 'manual', autoEnabled: false, k: 1, kShown: 1, level: 0, levels: 8 });
  assert.equal(apagada.status, S.camera.manual);
  assert.equal(apagada.auto.text, S.camera.autoButton);
  assert.equal(apagada.auto.pressed, false, 'el estado del botón es aria-pressed, no su rótulo');
  // el texto del botón nunca es el del estado
  // el rótulo del botón no cambia con el estado: es el mismo en los tres casos (el estado solo cambia aria-pressed)
  assert.equal(new Set([esperando, manejando, apagada].map((c) => c.auto.text)).size, 1);
});

test('CB-17: los botones de cámara se deshabilitan en el límite (ver todo en k = 1, alejar en k = 1, acercar en el tope)', () => {
  const entero = cameraControls({ mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 });
  assert.equal(entero.viewAll.disabled, true);
  assert.equal(entero.zoomOut.disabled, true);
  assert.equal(entero.zoomIn.disabled, false);
  const medio = cameraControls({ mode: 'manual', autoEnabled: true, k: 2.25, kShown: 2.25, level: 2, levels: 8 });
  assert.equal(medio.viewAll.disabled, false);
  assert.equal(medio.zoomOut.disabled, false);
  const tope = cameraControls({ mode: 'manual', autoEnabled: true, k: 6, kShown: 6, level: 7, levels: 8 });
  assert.equal(tope.zoomIn.disabled, true);
  // en plena transición hacia k = 1 "Ver todo" todavía está activo
  const camino = cameraControls({ mode: 'manual', autoEnabled: true, k: 1, kShown: 1.4, level: 0, levels: 8 });
  assert.equal(camino.viewAll.disabled, false);
  assert.equal(entero.viewAll.text, S.camera.viewAll);
  assert.equal(entero.zoomIn.text, S.camera.zoomIn);
  assert.equal(entero.zoomOut.text, S.camera.zoomOut);
});

test('NM-10: sin config `camera` el marco está activo por defecto; solo `enabled: false` lo apaga', () => {
  assert.equal(frameEnabled(undefined), true);
  assert.equal(frameEnabled({}), true);
  assert.equal(frameEnabled({ enabled: true }), true);
  assert.equal(frameEnabled({ enabled: false }), false);
  assert.equal(frameEnabled(null), true);
  assert.equal(frameEnabled({ enabled: 'no' }), true, 'solo el booleano false lo apaga');
  assert.equal(layoutFor(1920, 1080, { frame: false }).frame, null);
  assert.notEqual(layoutFor(1920, 1080).frame, null);
});

test('el layout es puro: mismas entradas, mismas regiones, y una ventana enorme o minúscula no lanza', () => {
  assert.deepEqual(layoutFor(1920, 1080), layoutFor(1920, 1080));
  for (const [W, H] of [
    [1, 1],
    [10, 10000],
    [10000, 10],
    [0, 0],
    [Number.NaN, Number.NaN],
  ]) {
    const L = layoutFor(W, H);
    assert.ok(Number.isInteger(L.u) && L.u >= 1);
  }
});
