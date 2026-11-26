import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { DEFAULT_LADDER } from '@tienda/kit/sim/ranks.js';
import { PAISES } from '../public/js/data/paises.js';
import { createMatch, importProgress } from '../public/js/sim/match.js';
import { bridgeAlert, hudModel, netChip } from '../public/js/ui/hud.js';
import {
  errorModel,
  lobbyModel,
  matchEndModel,
  matchupModel,
  pauseModel,
  roundEndModel,
  screenFor,
} from '../public/js/ui/screens.js';
import { createBanners } from '../public/js/ui/banners.js';
import { S } from '../public/js/ui/strings.js';
import { seedUnits } from '../public/js/sim/world.js';
import { WORST_NAMES, findForbidden } from './support/forbidden-words.js';

// 6.3 a 6.5: modelos de vista del HUD, las pantallas y los banners (CB-17, KIT-23, KIT-24, KIT-25, NM-1, NM-5, CB-20).
// Son funciones puras sobre el partido y el registro del kit: solo LEEN. El dibujo se prueba en `ui-draw.test.js`.

const CAMARA = { mode: 'manual', autoEnabled: true, k: 1, kShown: 1, level: 0, levels: 8 };

/** Un partido real Perú–México con un registro real, en el estado pedido. */
function partido({ empezado = true } = {}) {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const match = createMatch({ paises: PAISES, game: {}, registry });
  assert.equal(match.command({ type: 'pickPair', a: 'PE', b: 'MX' }).ok, true);
  if (empezado) assert.equal(match.command({ type: 'startMatch' }).ok, true);
  return { registry, match };
}

/** Un donante con equipo y XP de partido. */
function donante(registry, id, nombre, equipo, monedas) {
  registry.joinFromChat({ userId: id, nickname: nombre, text: String(equipo) }, 0, 1);
  if (monedas > 0) registry.addCoins(id, monedas, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// 6.3 HUD

test('CB-17: el HUD tiene un panel por equipo con nombre, % de base, puntos de ronda con forma y color del equipo', () => {
  const { match, registry } = partido();
  const h = hudModel({ match, registry, camera: CAMARA, net: null });
  assert.equal(h.visible, true);
  assert.equal(h.panels.length, 2);
  const [a, b] = h.panels;
  assert.equal(a.name, 'Perú');
  assert.equal(b.name, 'México');
  assert.equal(a.pct, 100);
  assert.equal(a.pctText, '100 %');
  assert.equal(a.color, match.pair.teams[0].color);
  assert.equal(b.color, match.pair.teams[1].color);
  // dos rondas ganan el partido: dos puntos por equipo, con la forma del lado (círculo / rombo) además del color
  assert.deepEqual(
    a.dots.map((d) => d.shape),
    ['circle', 'circle'],
  );
  assert.deepEqual(
    b.dots.map((d) => d.shape),
    ['diamond', 'diamond'],
  );
  assert.deepEqual(
    a.dots.map((d) => d.filled),
    [false, false],
  );
  match.wins = [1, 0];
  const h2 = hudModel({ match, registry, camera: CAMARA, net: null });
  assert.deepEqual(
    h2.panels[0].dots.map((d) => d.filled),
    [true, false],
  );
  assert.deepEqual(
    h2.panels[1].dots.map((d) => d.filled),
    [false, false],
  );
});

test('CB-17: el % de la base se redondea hacia arriba (1 HP es 1 %), se recorta a 0–100 y nunca es NaN', () => {
  const { match, registry } = partido();
  const b = match.world.bases[0];
  for (const [hp, esperado] of [
    [b.maxHp, 100],
    [b.maxHp / 2, 50],
    [1, 1],
    [0, 0],
    [-500, 0],
    [b.maxHp * 3, 100],
    [Number.NaN, 0],
    [Infinity, 100],
  ]) {
    b.hp = hp;
    assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).panels[0].pct, esperado, String(hp));
  }
  b.maxHp = 0;
  b.hp = 10;
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).panels[0].pct, 0, 'maxHp 0 no divide por cero');
});

test('CB-17 y CB-21: el HUD muestra «en campo» por equipo, contado de las unidades vivas del sim', () => {
  const { match, registry } = partido();
  const w = match.world;
  seedUnits(w, { side: 0, kind: 'soldado', count: 7, x: 300, y: 300, dy: 10 });
  seedUnits(w, { side: 1, kind: 'jeep', count: 4, x: 900, y: 300, dy: 10 });
  seedUnits(w, { side: 1, kind: 'soldado', count: 1, x: 900, y: 500 }).units[0].alive = false;
  const h = hudModel({ match, registry, camera: CAMARA, net: null });
  assert.equal(h.panels[0].inField, 7);
  assert.equal(h.panels[1].inField, 4);
  assert.equal(h.panels[0].departed, undefined, 'ya no hay grupos salidos por rol');
  assert.equal(h.legend, undefined, 'ya no hay leyenda Defensa / Ataque');
});

test('CB-17: rieles de unión, likes y energía por equipo salen del partido', () => {
  const { match, registry } = partido();
  const w = match.world;
  w.counters.addLikes(1, 150);
  const h = hudModel({ match, registry, camera: CAMARA, net: null });
  assert.equal(h.rails[0].joinPrefix, S.hud.joinPrefix(1));
  assert.equal(h.rails[0].joinName, 'Perú');
  assert.equal(h.rails[1].joinPrefix, S.hud.joinPrefix(2));
  assert.equal(h.rails[1].joinName, 'México');
  assert.equal(h.rails[0].likes, w.counters.likeProgress(1));
  assert.ok(h.rails[0].likes > 0);
  assert.equal(h.rails[1].likes, 0);
  assert.equal(h.rails[0].energy, w.counters.energyProgress(1));
  donante(registry, 'u1', 'Ana', 1, 0);
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).rails[0].members, 1);
});

test('NM-4 y S3: el centro muestra reloj, ronda y el ESTADO de la cámara, aparte del rótulo de los botones', () => {
  const { match, registry } = partido();
  const h = hudModel({ match, registry, camera: { ...CAMARA, mode: 'auto' }, net: null });
  assert.equal(h.center.status, S.camera.auto);
  assert.equal(h.center.round, 'Ronda 1/3');
  assert.equal(h.center.clock, '3:00', 'en la preparación el reloj muestra la ronda completa');
  assert.equal(h.controls.auto.text, S.camera.autoButton, 'el rótulo del botón es fijo');
  assert.equal(h.controls.auto.pressed, true);
  const manual = hudModel({ match, registry, camera: { ...CAMARA, autoEnabled: false }, net: null });
  assert.equal(manual.center.status, S.camera.manual);
  assert.equal(manual.controls.auto.pressed, false);
});

test('el reloj de la ronda cuenta hacia atrás en batalla y no baja de 0:00', () => {
  const { match, registry } = partido();
  match.state = 'battle';
  match.world.roundStart = 0;
  match.world.step = 30 * 61;
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).center.clock, '1:59');
  match.world.step = 30 * 500;
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).center.clock, '0:00');
});

test('CB-17: el HUD solo se ve con un par elegido y en intro, batalla y pantallas de resultados', () => {
  const { match, registry } = partido({ empezado: false });
  assert.equal(match.state, 'lobby');
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).visible, false, 'la sala tiene su pantalla');
  match.command({ type: 'startMatch' });
  for (const estado of ['intro', 'battle', 'roundEnd', 'waitingNextRound', 'matchEnd']) {
    match.state = estado;
    assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).visible, true, estado);
  }
  match.state = 'matchup';
  match.pair = null;
  const sin = hudModel({ match, registry, camera: CAMARA, net: null });
  assert.equal(sin.visible, false);
  assert.deepEqual(sin.panels, []);
});

test('CB-17: el HUD sin tropas dice "Sin tropas en el campo" y con tropas no', () => {
  const { match, registry } = partido();
  match.state = 'battle';
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).noTroops, S.hud.noTroops);
  match.world.units.push({ id: 1, side: 0, kind: 'soldado', hp: 10 });
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).noTroops, null);
  match.state = 'intro';
  match.world.units.length = 0;
  assert.equal(hudModel({ match, registry, camera: CAMARA, net: null }).noTroops, null, 'solo en batalla');
});

test('CB-17: chips de conexión por estado y puente perdido con el problema y la salida, sin palabras vetadas', () => {
  assert.equal(netChip(null), null, 'sin fuente no hay chip (6a)');
  assert.equal(netChip({ state: 'none' }), null);
  assert.deepEqual(netChip({ state: 'demo' }), { text: 'DEMO', kind: 'info' });
  assert.deepEqual(netChip({ state: 'connecting' }), { text: 'Conectando con la transmisión…', kind: 'info' });
  assert.deepEqual(netChip({ state: 'reconnecting' }), { text: 'Reconectando…', kind: 'warn' });
  assert.deepEqual(netChip({ state: 'connected', since: 1 }), { text: 'Conectado', kind: 'info' });
  assert.equal(netChip({ state: 'connected', since: 10 }), null, '"Conectado" se va a los 3 s');
  const lost = bridgeAlert({ state: 'lost' });
  assert.equal(lost.text, S.errors.bridgeLost);
  assert.match(lost.text, /conexión/);
  assert.match(lost.text, /Revisa/);
  assert.deepEqual(findForbidden(lost.text), []);
  assert.equal(bridgeAlert({ state: 'connected' }), null);
  assert.equal(bridgeAlert(null), null);
  assert.deepEqual(netChip({ state: 'lost' }), { text: S.connection.reconnecting, kind: 'warn' });
  // estado raro o de tipo equivocado: ningún chip y nada lanza
  for (const raro of [undefined, 3, 'x', {}, { state: 5 }, { state: 'otro' }]) assert.equal(netChip(raro), null);
});

test('peor caso: 0, 1 y 5000 donantes y equipos vacíos; el HUD no recorre a los usuarios (O(1) por cuadro)', () => {
  const { match, registry } = partido();
  let llamadas = 0;
  const espia = new Proxy(registry, {
    get(t, p) {
      if (p === 'users') llamadas++;
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const h0 = hudModel({ match, registry: espia, camera: CAMARA, net: null });
  assert.equal(h0.rails[0].members + h0.rails[1].members, 0);
  donante(registry, 'solo', 'Ana', 2, 10);
  const h1 = hudModel({ match, registry: espia, camera: CAMARA, net: null });
  assert.deepEqual([h1.rails[0].members, h1.rails[1].members], [0, 1], 'un solo equipo con gente');
  for (let i = 0; i < 5000; i++) donante(registry, `u${i}`, WORST_NAMES[i % WORST_NAMES.length] || 'x', (i % 2) + 1, 0);
  const h5 = hudModel({ match, registry: espia, camera: CAMARA, net: null });
  assert.equal(h5.rails[0].members + h5.rails[1].members, 5001);
  assert.equal(llamadas, 0, 'el HUD usa teamSizes(), no users()');
  // sin registro (?golden) el HUD sigue funcionando
  const g = hudModel({ match, registry: null, camera: CAMARA, net: null });
  assert.equal(g.rails[0].members, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 6.4 Pantallas

test('CB-17: selector con dos listas, vista previa con chips, siluetas y banderines, y "Elegir el par" deshabilitado sin dos países', () => {
  const m = matchupModel({ paises: PAISES, left: 'PE', right: 'MX', focus: 'PE' });
  assert.equal(m.state, 'normal');
  assert.equal(m.columns.length, 2);
  assert.equal(m.columns[0].rows.length, PAISES.length);
  assert.equal(m.columns[0].rows.find((r) => r.id === 'PE').selected, true);
  assert.equal(m.columns[1].rows.find((r) => r.id === 'MX').selected, true);
  assert.equal(m.columns[0].rows.find((r) => r.id === 'PE').focused, true);
  assert.equal(m.start.disabled, false);
  assert.deepEqual(
    m.preview.teams.map((t) => t.name),
    ['Perú', 'México'],
  );
  assert.deepEqual(
    m.preview.teams.map((t) => t.silhouette),
    [S.matchup.fort, S.matchup.citadel],
  );
  assert.equal(m.preview.teams[0].chip.fg, '#0B0F17');
  assert.equal(m.preview.teams[0].pennant.fill, m.preview.teams[0].chip.bg, 'banderín liso del color del equipo');
  for (const mal of [
    { left: 'PE', right: null },
    { left: null, right: null },
    { left: 'PE', right: 'PE' },
    { left: 'PE', right: 'ZZ' },
  ]) {
    const x = matchupModel({ paises: PAISES, ...mal });
    assert.equal(x.start.disabled, true, JSON.stringify(mal));
    assert.equal(x.start.hint, S.matchup.needTwo);
    assert.equal(x.preview, null);
  }
});

test('CB-17: el selector tiene sus cuatro estados: cargando, vacío, error con la salida, y normal', () => {
  assert.equal(matchupModel({ paises: null }).state, 'loading');
  assert.equal(matchupModel({ paises: null }).message, S.matchup.loading);
  assert.equal(matchupModel({ paises: [] }).state, 'empty');
  assert.equal(matchupModel({ paises: [] }).message, S.matchup.empty);
  const e = matchupModel({ paises: PAISES, error: 'falta el color' });
  assert.equal(e.state, 'error');
  assert.equal(e.columns.length, 0, 'con error no hay lista');
  assert.match(e.message, /falta el color/);
  assert.equal(e.exit, S.errors.dataExit);
  assert.equal(e.start.disabled, true);
});

test('CB-17: la sala dice "{A} vs {B}", cómo unirse y "Nadie se unió todavía" si está vacía', () => {
  const { match, registry } = partido({ empezado: false });
  const l = lobbyModel({ match, registry });
  assert.equal(l.versus, 'Perú vs México');
  assert.equal(l.join, 'Comenta 1 o Perú · 2 o México para unirte');
  assert.equal(l.empty, S.lobby.empty);
  assert.deepEqual(
    l.teams.map((t) => t.members),
    [[], []],
  );
  donante(registry, 'u1', 'Ana_23', 1, 0);
  donante(registry, 'u2', 'Luis', 1, 0);
  donante(registry, 'u3', 'Mica', 2, 0);
  const l2 = lobbyModel({ match, registry });
  assert.equal(l2.empty, null);
  assert.deepEqual(
    l2.teams.map((t) => t.count),
    [2, 1],
  );
  assert.deepEqual(l2.teams[0].members.sort(), ['Ana_23', 'Luis']);
  // un miembro oculto sale "anónimo" y no se filtra su nombre
  registry.hide('u3');
  assert.deepEqual(lobbyModel({ match, registry }).teams[1].members, [S.anon]);
  assert.equal(l.hint, S.lobby.hint);
});

test('peor caso: la sala con 5000 donantes muestra como mucho 6 por equipo y cuenta el resto', () => {
  const { match, registry } = partido({ empezado: false });
  for (let i = 0; i < 5000; i++) donante(registry, `u${i}`, `n${i}`, 1, 0);
  const l = lobbyModel({ match, registry });
  assert.equal(l.teams[0].count, 5000);
  assert.equal(l.teams[0].members.length, 6);
  assert.equal(l.teams[0].more, 4994);
  assert.equal(l.teams[1].more, 0);
});

test('KIT-24 y CB-17: fin de ronda con tarjeta MVP por país (se omite si es null) y el aviso para seguir', () => {
  const { match, registry } = partido();
  match.state = 'roundEnd';
  match.results = [{ round: 1, winner: 0, reason: 'base', step: 10 }];
  match.wins = [1, 0];
  const sin = roundEndModel({ match, registry });
  assert.equal(sin.title, '¡Perú gana la ronda!');
  assert.deepEqual(sin.mvps, [], 'sin XP no hay tarjetas');
  assert.equal(sin.next, S.roundEnd.next);
  donante(registry, 'a', 'Ana', 1, 30);
  donante(registry, 'b', 'Beto', 2, 5);
  const con = roundEndModel({ match, registry });
  assert.equal(con.mvps.length, 2);
  assert.equal(con.mvps[0].title, 'MVP de Perú');
  assert.equal(con.mvps[0].name, 'Ana');
  assert.equal(con.mvps[0].xp, S.roundEnd.xp(30));
  assert.equal(con.mvps[1].name, 'Beto');
  // solo un equipo con XP: una sola tarjeta
  registry.startRound();
  donante(registry, 'c', 'Cleo', 2, 7);
  const uno = roundEndModel({ match, registry });
  assert.deepEqual(
    uno.mvps.map((x) => x.name),
    ['Cleo'],
  );
});

test('KIT-24 y KIT-25: fin de partido con podio por país, MVP del partido y ranking por XP y no por monedas', () => {
  const { match, registry } = partido();
  match.state = 'matchEnd';
  match.winner = 1;
  match.wins = [0, 2];
  // país 2: A pagó 100 monedas; B pagó 80 y destruyó 60 de valor (80 + 30 = 110 de XP): B queda sobre A
  donante(registry, 'A', 'Aldo', 2, 100);
  donante(registry, 'B', 'Bea', 2, 80);
  registry.addDestroyed('B', 60, 2);
  donante(registry, 'C', 'Cleo', 1, 50);
  donante(registry, 'D', 'Dani', 1, 20);
  const f = matchEndModel({ match, registry });
  assert.equal(f.title, '¡México gana la batalla!');
  assert.equal(f.mvp.title, S.matchEnd.mvp);
  assert.equal(f.mvp.name, 'Bea');
  assert.deepEqual(
    f.columns.map((c) => c.title),
    ['Mejores de Perú', 'Mejores de México'],
  );
  assert.deepEqual(
    f.columns[0].rows.map((r) => [r.name, r.xp]),
    [
      ['Cleo', S.matchEnd.xp(50)],
      ['Dani', S.matchEnd.xp(20)],
    ],
  );
  assert.deepEqual(
    f.columns[1].rows.map((r) => r.name),
    ['Bea', 'Aldo'],
  );
  assert.equal(f.columns[1].rows[0].highlight, true, 'el MVP del partido va resaltado en su columna');
  assert.equal(f.columns[1].rows[1].highlight, false);
  assert.equal(
    f.columns[0].rows.some((r) => r.highlight),
    false,
  );
});

test('KIT-24: tres entradas por columna como máximo y "Sin regalos" en la columna vacía', () => {
  const { match, registry } = partido();
  match.state = 'matchEnd';
  match.winner = 0;
  for (const [id, xp] of [
    ['a', 90],
    ['b', 30],
    ['c', 25],
    ['d', 10],
  ])
    donante(registry, id, id.toUpperCase(), 2, xp);
  const f = matchEndModel({ match, registry });
  assert.deepEqual(
    f.columns[1].rows.map((r) => r.xp),
    [S.matchEnd.xp(90), S.matchEnd.xp(30), S.matchEnd.xp(25)],
  );
  assert.equal(f.columns[0].rows.length, 0);
  assert.equal(f.columns[0].empty, S.matchEnd.empty);
  assert.equal(f.columns[1].empty, null);
  // sin XP no hay resalte ni tarjeta de MVP
  const vacio = partido();
  vacio.match.state = 'matchEnd';
  vacio.match.winner = 0;
  const v = matchEndModel({ match: vacio.match, registry: vacio.registry });
  assert.equal(v.mvp, null);
  assert.deepEqual(
    v.columns.map((c) => c.empty),
    [S.matchEnd.empty, S.matchEnd.empty],
  );
});

test('KIT-13 y CB-17: el MVP oculto sale "anónimo" y con todos los nombres ocultos nadie se nombra', () => {
  const { match, registry } = partido();
  match.state = 'matchEnd';
  match.winner = 0;
  donante(registry, 'a', 'Ana', 1, 50);
  donante(registry, 'b', 'Beto', 2, 40);
  registry.hide('a');
  const f = matchEndModel({ match, registry });
  assert.equal(f.mvp.name, S.anon);
  assert.equal(f.columns[0].rows[0].name, S.anon);
  registry.setAllNamesHidden(true);
  const g = matchEndModel({ match, registry });
  assert.deepEqual([g.mvp.name, g.columns[1].rows[0].name], [S.anon, S.anon]);
  const r = roundEndModel({ match, registry });
  for (const t of r.mvps) assert.equal(t.name, S.anon);
});

test('NM-1: diez minutos de reloj sin acción dejan la pantalla igual, con acción de avance por teclado y puntero', () => {
  const { match, registry } = partido();
  donante(registry, 'a', 'Ana', 1, 30);
  match.state = 'matchEnd';
  match.winner = 0;
  const antes = JSON.stringify(screenFor(match, { registry, paises: PAISES }));
  const fake = { ...match };
  for (let i = 0; i < 10 * 60 * 30; i += 900) fake.tick = (fake.tick ?? 0) + 900;
  assert.equal(JSON.stringify(screenFor(fake, { registry, paises: PAISES })), antes);
  const s = screenFor(match, { registry, paises: PAISES });
  assert.equal(s.kind, 'matchEnd');
  assert.equal(s.advance.key, 'Enter');
  assert.equal(s.advance.text, S.matchEnd.back);
  // y con un partido de verdad en la espera de la ronda: 18 000 pasos de reloj y la pantalla no cambia ni avanza sola
  const regReal = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  const real = { registry: regReal, match: createMatch({ paises: PAISES, game: {}, registry: regReal }) };
  assert.equal(importProgress(real.match, { pair: ['PE', 'MX'], started: true, roundsDone: 1, wins: [1, 0] }).ok, true);
  assert.equal(real.match.state, 'waitingNextRound');
  const w0 = JSON.stringify(screenFor(real.match, { registry: real.registry, paises: PAISES }));
  for (let i = 0; i < 18000; i++) real.match.step();
  assert.equal(real.match.state, 'waitingNextRound', 'nada arranca solo (NM-1)');
  assert.equal(JSON.stringify(screenFor(real.match, { registry: real.registry, paises: PAISES })), w0);
  const roundEnd = screenFor(real.match, { registry: real.registry, paises: PAISES });
  assert.equal(roundEnd.kind, 'roundEnd');
  assert.equal(roundEnd.advance.key, 'Enter');
});

test('CB-20: las pantallas dicen lo mismo con y sin movimiento reducido (los modelos no lo conocen)', () => {
  const { match, registry } = partido();
  match.state = 'waitingNextRound';
  const a = screenFor(match, { registry, paises: PAISES, reduced: false });
  const b = screenFor(match, { registry, paises: PAISES, reduced: true });
  assert.deepEqual(a, b);
});

test('NM-9: la pausa muestra el texto exacto y solo mientras hay pausa', () => {
  const { match } = partido();
  assert.equal(pauseModel(match).visible, false);
  match.command({ type: 'pause', by: 'manual' });
  assert.deepEqual(pauseModel(match), { visible: true, text: 'Pausa: el narrador vuelve enseguida' });
  match.command({ type: 'resume', by: 'manual' });
  match.command({ type: 'pause', by: 'presence' });
  assert.equal(pauseModel(match).text, 'Pausa: el narrador vuelve enseguida', 'también la de presencia');
});

test('CB-17: la pantalla de error dice qué falló y cómo salir, y no hay juego detrás', () => {
  const c = errorModel({ kind: 'config', detail: 'graphics.reducedMotion solo acepta "auto"' });
  assert.equal(c.title, S.errors.title);
  assert.equal(c.detail, S.errors.config('graphics.reducedMotion solo acepta "auto"'));
  assert.equal(c.exit, S.errors.configExit);
  const d = errorModel({ kind: 'data', detail: 'falta' });
  assert.equal(d.detail, S.errors.data('falta'));
  assert.equal(d.exit, S.errors.dataExit);
  assert.equal(errorModel(undefined).exit, S.errors.dataExit);
  assert.equal(
    screenFor(partido().match, { registry: null, paises: PAISES, error: { kind: 'config', detail: 'x' } }).kind,
    'error',
  );
});

test('screenFor elige la pantalla por estado y las del HUD no tienen tarjeta', () => {
  const { match, registry } = partido({ empezado: false });
  const ctx = { registry, paises: PAISES, selection: { left: 'PE', right: 'MX', focus: 'PE' } };
  assert.equal(screenFor(match, ctx).kind, 'lobby');
  match.command({ type: 'startMatch' });
  assert.equal(screenFor(match, ctx).kind, null, 'intro: sin tarjeta');
  match.state = 'battle';
  assert.equal(screenFor(match, ctx).kind, null);
  match.state = 'roundEnd';
  assert.equal(screenFor(match, ctx).kind, 'roundEnd');
  match.state = 'waitingNextRound';
  assert.equal(screenFor(match, ctx).kind, 'roundEnd');
  match.state = 'matchEnd';
  assert.equal(screenFor(match, ctx).kind, 'matchEnd');
  match.state = 'matchup';
  match.pair = null;
  assert.equal(screenFor(match, ctx).kind, 'matchup');
});

test('peor caso: nombres bidi, de ancho cero, emoji, CJK, de 1 y de 200 caracteres pasan por los modelos sin lanzar', () => {
  const { match, registry } = partido();
  match.state = 'matchEnd';
  match.winner = 0;
  WORST_NAMES.forEach((n, i) => donante(registry, `w${i}`, n || 'x', (i % 2) + 1, 10 + i));
  const f = matchEndModel({ match, registry });
  assert.ok(f.columns.every((c) => c.rows.every((r) => typeof r.name === 'string')));
  match.results = [{ round: 1, winner: 0 }];
  assert.equal(typeof roundEndModel({ match, registry }).title, 'string');
  assert.equal(typeof lobbyModel({ match, registry }).versus, 'string');
});

// ---------------------------------------------------------------------------------------------------------------
// 6.5 Banners

/** Registro con un donante y la escalera por defecto; `banners` con el reloj en segundos de vista. */
function conBanners(cfg) {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  for (let i = 0; i < 12; i++) registry.joinFromChat({ userId: `u${i}`, nickname: `Don${i}`, text: '1' }, 0, 1);
  return { registry, banners: createBanners({ registry, ladder: DEFAULT_LADDER, cfg }) };
}

const ascenso = (key, to, team = 1) => ({ type: 'rankUp', key, team, from: to - 1, to });

/** Corre `banners` de a `dt` s y devuelve cuándo empezó cada banner (por texto). */
function correr(banners, hasta, dt = 0.05, reduced = false, desde = 0) {
  const inicios = [];
  let ultimo = null;
  for (let t = desde; t <= hasta + 1e-9; t += dt) {
    banners.update(t, reduced);
    const c = banners.current();
    if (c && c.id !== ultimo) {
      inicios.push({ t, text: c.text, id: c.id });
      ultimo = c.id;
    }
    if (!c) ultimo = null;
  }
  return inicios;
}

test('CB-17 y KIT-23: 5 ascensos en 1 s salen en secuencia a no más de 1 cada 1,5 s y no se pierde ninguno', () => {
  const { banners } = conBanners();
  banners.consume([3, 4, 5, 6, 7].map((to, i) => ascenso(`u${i}`, to)));
  const ini = correr(banners, 12);
  assert.equal(ini.length, 5, 'los cinco salieron');
  assert.deepEqual(new Set(ini.map((x) => x.text)).size, 5);
  for (let i = 1; i < ini.length; i++) assert.ok(ini[i].t - ini[i - 1].t >= 1.5 - 1e-6, `separación ${i}`);
  assert.deepEqual(ini[0].text, 'Don0 ascendió a Sargento');
});

test('CB-17: con más de 5 en cola el ritmo sube a 1 cada 0,9 s; con 5 o menos vuelve a 1,5 s', () => {
  const { banners } = conBanners();
  banners.consume(Array.from({ length: 8 }, (_, i) => ascenso(`u${i}`, 3)));
  const ini = correr(banners, 20);
  assert.equal(ini.length, 8);
  const dif = ini.slice(1).map((x, i) => Math.round((x.t - ini[i].t) * 100) / 100);
  assert.deepEqual(dif.slice(0, 2), [0.9, 0.9]);
  assert.ok(
    dif.slice(2).every((d) => d >= 1.5 - 1e-6),
    String(dif),
  );
});

test('KIT-23: banners desde Sargento; todo ascenso va al feed, también los de Recluta a Soldado', () => {
  const { banners } = conBanners();
  banners.consume([ascenso('u0', 1), ascenso('u1', 2), ascenso('u2', 3)]);
  const ini = correr(banners, 6);
  assert.equal(ini.length, 1, 'solo el de Sargento tiene banner');
  const feed = banners.feed();
  assert.equal(feed.length, 3, 'los tres están en el feed');
  assert.match(feed[2].text, /Don2 ascendió a Sargento/);
  assert.match(feed[0].text, /Don0 ascendió a Soldado/);
});

test('KIT-23: el nombre se resuelve al mostrarse: un donante ocultado antes sale "anónimo" con el rango nuevo', () => {
  const { banners, registry } = conBanners();
  banners.consume([ascenso('u0', 4)]);
  registry.hide('u0');
  const [primero] = correr(banners, 3);
  assert.equal(primero.text, 'anónimo ascendió a Teniente');
  assert.doesNotMatch(banners.feed()[0].text, /Don0/);
  registry.setAllNamesHidden(true);
  assert.doesNotMatch(banners.feed()[0].text, /Don/);
});

test('NM-5 y CB-17: banner de regalo grande y de avión con la plantilla del diseño, sin el chat ni el avatar', () => {
  const { banners } = conBanners();
  banners.gift([
    { kind: 'gift', owner: 'u1', coins: 600, x: 100, y: 100, slide: true, giftName: 'León' },
    { kind: 'plane', owner: 'u2', coins: 0, x: 100, y: 100, slide: true, giftName: 'Avión' },
    { kind: 'plane', owner: 'u3', coins: 0, x: 100, y: 100, slide: true },
  ]);
  const ini = correr(banners, 12);
  assert.deepEqual(
    ini.map((x) => x.text),
    ['Don1 envió León', 'Don2 envió Avión: bombardeo', 'Don3 lanzó un bombardeo'],
  );
  const vista = JSON.stringify(banners.current() ?? ini);
  assert.doesNotMatch(vista, /avatar|chat|hola mundo/i);
});

test('NM-5: el banner de un donante oculto muestra "anónimo" y sin avatar', () => {
  const { banners, registry } = conBanners();
  registry.hide('u1');
  banners.gift([{ kind: 'plane', owner: 'u1', coins: 0, x: 0, y: 0, slide: true, giftName: 'Avión' }]);
  banners.update(0, false);
  assert.equal(banners.current().avatar, undefined);
  assert.equal(banners.current().text, 'anónimo envió Avión: bombardeo');
  assert.doesNotMatch(JSON.stringify(banners.current()), /Don1/);
});

test('CB-20 y §10.3: la animación solo toca opacidad y transform, dura menos de 300 ms y es ease-out', () => {
  const { banners } = conBanners();
  banners.consume([ascenso('u0', 3)]);
  banners.update(0, false);
  const v0 = banners.current();
  assert.equal(v0.alpha, 0, 'arranca invisible');
  assert.deepEqual(
    Object.keys(v0)
      .filter((k) => ['alpha', 'dy', 'scale'].includes(k))
      .sort(),
    ['alpha', 'dy', 'scale'],
  );
  banners.update(0.08, false);
  const medio = banners.current();
  assert.ok(medio.alpha > 0.5, 'ease-out: a mitad de la entrada ya pasó de la mitad');
  assert.equal(medio.dy, 0, 'el banner frecuente solo cambia la opacidad');
  assert.equal(medio.scale, 1);
  banners.update(0.16, false);
  assert.equal(banners.current().alpha, 1, 'la entrada de 160 ms termina');
  // la salida (120 ms) llega a 0 antes de que termine el hueco de 1,5 s
  banners.update(1.5 - 0.12 + 0.06, false);
  const sal = banners.current();
  assert.ok(sal.alpha < 1 && sal.alpha > 0, 'saliendo');
  for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.5, 1.0, 1.4]) {
    banners.update(t, false);
    const c = banners.current();
    if (c) assert.ok(c.alpha >= 0 && c.alpha <= 1);
  }
  // la salida llega a 0 justo al terminar el hueco, y a los 1,5 s el banner ya no está
  banners.update(1.499, false);
  assert.ok(banners.current().alpha < 0.05);
  banners.update(1.5, false);
  assert.equal(banners.current(), null);
});

test('§10.3: el banner raro se desliza 12 px en 220 ms, y con movimiento reducido solo cambia la opacidad (≤ 150 ms)', () => {
  const rareza = (reduced) => {
    const { banners } = conBanners();
    banners.gift([{ kind: 'plane', owner: 'u1', coins: 0, x: 0, y: 0, slide: !reduced, giftName: 'Avión' }]);
    banners.update(0, reduced);
    const v0 = { ...banners.current() };
    banners.update(0.05, reduced);
    const v1 = { ...banners.current() };
    banners.update(0.3, reduced);
    const v2 = { ...banners.current() };
    return { v0, v1, v2 };
  };
  const normal = rareza(false);
  assert.equal(normal.v0.dy, 12, 'arranca 12 px más abajo');
  assert.ok(normal.v1.dy > 0 && normal.v1.dy < 12, 'se desliza');
  assert.equal(normal.v2.dy, 0, 'a los 220 ms ya llegó');
  assert.equal(normal.v2.alpha, 1);
  const reducido = rareza(true);
  assert.equal(reducido.v0.dy, 0);
  assert.equal(reducido.v1.dy, 0);
  assert.ok(reducido.v1.alpha > 0.5 && reducido.v1.alpha < 1, 'la opacidad sube en el primer tramo');
  assert.equal(reducido.v2.dy, 0);
  assert.equal(reducido.v2.alpha, 1, 'y la entrada ya terminó antes de 150 ms');
});

test('§10.3: Coronel y General entran con escala 0,96 → 1 en 240 ms; con movimiento reducido solo opacidad', () => {
  const prueba = (to, reduced) => {
    const { banners } = conBanners();
    banners.consume([ascenso('u0', to)]);
    banners.update(0, reduced);
    const a = { ...banners.current() };
    banners.update(0.24, reduced);
    const b = { ...banners.current() };
    return { a, b };
  };
  for (const to of [7, 8]) {
    const n = prueba(to, false);
    assert.equal(n.a.scale, 0.96);
    assert.equal(n.b.scale, 1);
    const r = prueba(to, true);
    assert.equal(r.a.scale, 1);
    assert.equal(r.b.scale, 1);
  }
  assert.equal(prueba(3, false).a.scale, 1, 'Sargento no escala');
});

test('peor caso: 10 000 ascensos no tiran el feed ni la cola, y el feed guarda solo las últimas líneas', () => {
  const { banners } = conBanners();
  banners.consume(Array.from({ length: 10000 }, (_, i) => ascenso(`u${i % 12}`, 3)));
  assert.ok(banners.feed().length <= 4);
  assert.ok(banners.pending() >= 1000);
  assert.equal(typeof banners.current(), 'object');
  // eventos raros no lanzan
  banners.consume([
    null,
    undefined,
    5,
    {},
    { type: 'rankUp' },
    { type: 'rankUp', key: 'u1', to: 'x' },
    { type: 'otro' },
  ]);
  banners.gift([null, 3, {}, { kind: 'plane' }]);
  banners.update(0, false);
});

test('peor caso: nombres del peor caso en banners y feed son texto crudo para el dibujo (que los recorta)', () => {
  const registry = createRegistry({ teams: [PAISES[0], PAISES[1]] });
  WORST_NAMES.forEach((n, i) => registry.joinFromChat({ userId: `w${i}`, nickname: n || 'x', text: '1' }, 0, 1));
  const banners = createBanners({ registry, ladder: DEFAULT_LADDER });
  banners.consume(WORST_NAMES.map((_, i) => ascenso(`w${i}`, 3)));
  const ini = correr(banners, 14);
  assert.equal(ini.length, WORST_NAMES.length);
  for (const x of ini) assert.equal(typeof x.text, 'string');
});

test('el feed muestra las uniones con el nombre del país y nunca texto del chat', () => {
  const { banners } = conBanners();
  banners.consume([{ type: 'join', key: 'u3', team: 2, switched: false, auto: false, freeUnit: true }], (t) =>
    t === 2 ? 'México' : 'Perú',
  );
  assert.equal(banners.feed()[0].text, 'Don3 se unió a México');
  assert.equal(banners.feed()[0].team, 2);
});

test('banners vacíos: sin eventos no hay banner ni feed', () => {
  const { banners } = conBanners();
  banners.update(5, false);
  assert.equal(banners.current(), null);
  assert.deepEqual(banners.feed(), []);
  assert.equal(S.feed.empty, 'Sin novedades');
});
