import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../public/js/ui/theme.js';
import { S } from '../public/js/ui/strings.js';
import { arrancar } from './support/fake-main.js';

// El cableado de 6b en main.js: el selector abre solo, el público entra por el puente y por F1 con el MISMO adaptador, el
// estado de la red va al chip, los atajos del mapa único, la moderación y las superposiciones.

const hay = (e, re) => e.textos().some((t) => re.test(t));
const llenar = (e, n = 4) => e.cuadros(n, 100);
const rellenos = (e) => {
  const out = [];
  let estilo = null;
  for (const c of e.ctx.calls) {
    if (c[0] === 'set:fillStyle') estilo = c[1];
    else if (c[0] === 'fillRect') out.push({ estilo, x: c[1], y: c[2], w: c[3], h: c[4] });
  }
  return out;
};

test('sin parámetros la página abre el SELECTOR (no arranca sola una batalla) y no hay botones de cámara', async () => {
  const e = await arrancar('', { selector: true });
  llenar(e);
  assert.ok(e.textos().includes(S.matchup.title));
  assert.ok(!hay(e, /^Ronda \d\/3$/), 'no hay batalla detrás');
  assert.equal(e.botones['cam-bar'].hidden, true);
});

test('?pair=XX-YY solo preselecciona el par: el narrador confirma con Enter, y otra vez para empezar', async () => {
  const e = await arrancar('?pair=AR-BO', { selector: true });
  llenar(e);
  assert.ok(e.textos().includes(S.matchup.title), 'sigue en el selector');
  assert.ok(!hay(e, /^Comenta 1 o/), 'todavía no está la sala');
  e.tecla('Enter');
  llenar(e);
  assert.ok(hay(e, /^Comenta 1 o Argentina/), 'la sala');
  e.tecla('Enter');
  llenar(e, 40);
  assert.ok(hay(e, /^Ronda 1\/3$/), 'empezó el partido');
});

test('teclado en el selector: flechas dentro de la lista, Tab entre listas y Enter elige el par; sin dos países no avanza', async () => {
  const e = await arrancar('', { selector: true });
  llenar(e);
  e.tecla('Enter');
  llenar(e);
  assert.ok(e.textos().includes(S.matchup.title), 'sin par, Enter no hace nada');
  e.tecla('ArrowDown');
  e.tecla('Tab');
  e.tecla('ArrowDown');
  e.tecla('ArrowDown');
  llenar(e);
  const antes = rellenos(e).filter((f) => f.estilo === COLORS.focus).length;
  assert.ok(antes >= 4, 'el foco de teclado se ve');
  e.tecla('Enter');
  llenar(e);
  assert.ok(!e.textos().includes(S.matchup.title), 'pasó a la sala');
  assert.ok(e.textos().includes(S.lobby.start), 'con el botón de avance de la sala');
});

test('puntero en el selector: el clic en una fila la elige; el hover solo se pinta con puntero fino', async () => {
  const e = await arrancar('', { selector: true });
  llenar(e);
  const fila = { clientX: 40, clientY: 136 }; // primera fila de la lista izquierda a 1080p (u = 4)
  e.puntero('pointermove', { ...fila, pointerType: 'touch' });
  llenar(e, 2);
  assert.ok(!rellenos(e).some((f) => f.estilo === COLORS.hover), 'con toque no hay hover');
  e.puntero('pointermove', { ...fila, pointerType: 'mouse' });
  llenar(e, 2);
  assert.ok(
    rellenos(e).some((f) => f.estilo === COLORS.hover),
    'con ratón sí',
  );
  e.puntero('pointerdown', { ...fila });
  e.puntero('pointerup', { ...fila });
  llenar(e, 2);
  assert.ok(
    rellenos(e).some((f) => f.estilo === COLORS.selected),
    'la fila queda elegida',
  );
});

test('el clic en el botón de avance hace lo mismo que Enter', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true });
  llenar(e);
  const ancho = 1920;
  // el botón está centrado: un clic en el centro de su fila de 1080p (y = 146 + 7 virtuales)
  e.puntero('pointerdown', { clientX: ancho / 2, clientY: (146 + 7) * 4 });
  e.puntero('pointerup', { clientX: ancho / 2, clientY: (146 + 7) * 4 });
  llenar(e);
  assert.ok(hay(e, /^Perú vs México$/) && e.textos().includes(S.lobby.start), 'pasó a la sala');
});

// ---------------------------------------------------------------------------------------------------------------
// Fuentes

test('6.9: main carga las dos fuentes locales al arrancar y los anchos se vuelven a medir al llegar', async () => {
  const caras = [];
  class FontFace {
    constructor(family, source, desc) {
      Object.assign(this, { family, source, desc });
      caras.push(this);
    }
    async load() {
      return this;
    }
  }
  const e = await arrancar('', { selector: true, FontFace });
  assert.deepEqual(
    caras.map((c) => c.family),
    ['Pixelify Sans', 'Silkscreen'],
  );
  assert.deepEqual(e.fuentes.cargadas, ['Pixelify Sans', 'Silkscreen']);
  assert.equal(
    e.fuentes.oyentes.some(([t]) => t === 'loadingdone'),
    true,
    'el aviso de 6a sigue enganchado',
  );
});

// ---------------------------------------------------------------------------------------------------------------
// El público: puente, simulador y estado de la red

test('demo (sin servidor): el chip dice DEMO y no se abre ningún puente', async () => {
  const e = await arrancar('', { selector: true });
  llenar(e);
  assert.ok(e.textos().includes(S.connection.demo));
  assert.equal(e.ws.instancias.length, 0);
});

test('con servidor: el WebSocket es del mismo origen (/ws) y el chip pasa por Conectando, Conectado, Reconectando y puente perdido', async () => {
  const e = await arrancar('?ws=ws://otro-servidor/ws', { selector: true, servidor: true });
  llenar(e);
  assert.equal(e.ws.instancias.length, 1);
  assert.equal(e.ws.ultimo().url, 'ws://localhost:3100/ws', 'no hay parámetro para apuntarlo a otro servidor');
  assert.ok(e.textos().includes(S.connection.connecting));
  e.ws.abrir();
  e.ws.estado({ state: 'conectado', username: 'x' });
  llenar(e, 2);
  assert.ok(e.textos().includes(S.connection.connected));
  llenar(e, 60); // más de 3 s
  assert.ok(!e.textos().includes(S.connection.connected), '"Conectado" se va a los 3 s');
  e.ws.estado({ state: 'desconectado' });
  llenar(e, 2);
  assert.ok(e.textos().includes(S.connection.reconnecting));
  e.ws.cerrar();
  llenar(e, 2);
  assert.ok(hay(e, /Se perdió la conexión con TikTok/), 'el error de puente perdido nombra el problema y la salida');
});

test('un mensaje roto del puente se ignora sin lanzar y los eventos del público llegan al partido', async () => {
  const e = await arrancar('', { selector: true, servidor: true });
  e.ws.abrir();
  e.ws.ultimo().onmessage({ data: '{no es json' });
  e.ws.recibir({ type: 'vote', userId: 'a' });
  e.ws.recibir({ type: 'gift', userId: 'a', coins: 'mucho' });
  e.ws.recibir({ type: 'chat', userId: 'ana', uniqueId: 'ana', nickname: 'Ana', text: '1' });
  e.tecla('ArrowDown');
  e.tecla('Enter'); // sin dos países no avanza
  llenar(e, 3);
  assert.ok(e.textos().includes(S.matchup.title));
});

const COPIA_PRIMERA = {
  v: 1,
  clock: 0,
  allHidden: false,
  hidden: [],
  match: null,
  users: [
    {
      key: 'a',
      name: 'Primera',
      team: null,
      lastSwitch: -1e9,
      coins: { live: 190, match: 0 },
      value: { live: 0, match: 0 },
      xp: { live: 190, match: 0 },
      kills: { live: 0, match: 0 },
      firstXpAt: null,
    },
  ],
};

test('nota 48: los eventos que llegan antes del GET de la sesión se aplican después, en orden y sin perder ninguno', async () => {
  let soltar;
  const get = new Promise((ok) => (soltar = ok));
  const fetch = async (url, init) => {
    if (String(url) === '/api/session' && (init?.method ?? 'GET') === 'GET') {
      await get;
      // la copia guardada ya trae a Primera con 190 XP: si el evento se aplicara ANTES de restaurar, el 100 de monedas se pisaría
      return {
        status: 200,
        ok: true,
        json: async () => COPIA_PRIMERA,
        text: async () => JSON.stringify(COPIA_PRIMERA),
      };
    }
    return { ok: false };
  };
  const e = await arrancar('?f2', {
    servidor: true,
    sesion: true,
    fetch,
    game: {},
    antes: (env) => {
      const espera = async () => {
        while (!env.ws.ultimo()) await new Promise((r) => setImmediate(r));
        env.ws.abrir();
        // regalos de 100 monedas: dan Sargento a cada uno, y el ascenso queda en el feed en el orden en que se aplicaron
        for (const [id, nick] of [
          ['a', 'Primera'],
          ['b', 'Segundo'],
        ])
          env.ws.recibir({
            type: 'gift',
            userId: id,
            uniqueId: id,
            nickname: nick,
            giftId: 'g',
            giftName: 'Rose',
            coins: 100,
            count: 1,
          });
        await new Promise((r) => setTimeout(r, 20));
        soltar();
      };
      espera();
    },
  });
  e.cuadros(60, 100);
  // los regalos llegaron en el selector (sin par: la unión automática no deja línea) y cada uno ascendió a Sargento
  const de = (re) =>
    e
      .textos()
      .filter((t) => re.test(t))
      .map((t) => t.split(' ')[0]);
  assert.ok(
    de(/ ascendió a Teniente/).includes('Primera'),
    'C25: 190 de la copia + 100 del regalo = Teniente; con un ready() temprano el regalo se pisaría y no habría ascenso',
  );
  assert.deepEqual(
    de(/ ascendió a /).slice(0, 2),
    ['Primera', 'Segundo'],
    'ascensos en el orden en que llegaron (el feed, antes del banner)',
  );
  assert.ok(
    e.fetches.some((f) => f.method === 'GET' && f.url === '/api/session'),
    'sí hubo GET de la sesión',
  );
});

test('nota 48: si el GET de la sesión falla, los eventos igual se aplican', async () => {
  const fetch = async (url) => {
    if (String(url) === '/api/session') throw new Error('sin red');
    return { ok: false };
  };
  const e = await arrancar('?f2', { servidor: true, fetch, game: {} });
  e.ws.abrir();
  e.ws.recibir({ type: 'chat', userId: 'a', uniqueId: 'a', nickname: 'Primera', text: '1' });
  e.cuadros(40, 100);
  assert.ok(hay(e, /^Primera se unió a/));
});

test('F1: abre el simulador; sin servidor (demo) sus botones entran por el MISMO adaptador, sin red', async () => {
  const e = await arrancar('', { selector: true });
  assert.equal(e.panelSim.classList.contains('on'), false);
  e.tecla('F1');
  assert.equal(e.panelSim.classList.contains('on'), true);
  e.tecla('F1');
  assert.equal(e.panelSim.classList.contains('on'), false);
  // con el par elegido el panel tiene los dos equipos: "10 personas se unen" llega al feed como uniones
  e.tecla('ArrowDown');
  e.tecla('Tab');
  e.tecla('ArrowDown');
  e.tecla('ArrowDown');
  e.tecla('Enter');
  llenar(e);
  e.clicPanel('10 personas se unen');
  e.cuadros(10, 100);
  assert.ok(hay(e, /se unió a/), 'las uniones del simulador llegan al feed');
  assert.ok(
    e.fetches.every((f) => !/simulate/.test(f.url)),
    'en demo no hay POST',
  );
});

test('F1 con servidor: el simulador manda POST /api/simulate (el servidor lo reenvía por el puente)', async () => {
  const e = await arrancar('', { servidor: true });
  e.clicPanel('+100 likes');
  const post = e.fetches.find((f) => /simulate/.test(f.url));
  assert.ok(post);
  assert.equal(post.method, 'POST');
});

test('F1: teclear en el campo de nombre del panel no dispara ninguna de las teclas del título (n, c, r, h, p)', async () => {
  const e = await arrancar('?f2', { servidor: true });
  e.cuadros(5, 100);
  const antes = e.textos();
  assert.ok(antes.includes(S.frame), 'el marco está');
  for (const key of ['n', 'c', 'r', 'h', 'p']) e.tecla(key, { target: { tagName: 'INPUT' } });
  e.cuadros(3, 100);
  const t = e.textos();
  assert.ok(!t.includes(S.help.title), 'h: sin ayuda');
  assert.ok(!t.includes(S.motion.on) && !t.includes(S.motion.off), 'r: sin aviso de movimiento');
  assert.ok(t.includes(S.frame), 'c: el marco sigue');
  assert.ok(!t.includes(S.pause), 'p: sin pausa');
  assert.ok(!t.includes(S.moderation.namesHidden), 'n: sin aviso de nombres');
});

// ---------------------------------------------------------------------------------------------------------------
// Atajos del narrador cableados

test('H, G, T y F3: las superposiciones se encienden y se apagan; F2 sigue siendo el rendimiento', async () => {
  const e = await arrancar('?f2&donantes&rapido=8');
  e.cuadros(40, 100);
  e.tecla('h');
  e.cuadros(2);
  assert.ok(e.textos().includes(S.help.title));
  e.tecla('h');
  e.cuadros(2);
  assert.ok(!e.textos().includes(S.help.title));
  e.tecla('g');
  e.cuadros(2);
  assert.ok(e.textos().includes(S.overlays.scoreboard));
  e.tecla('g');
  e.cuadros(2);
  assert.ok(!e.textos().includes(S.overlays.scoreboard));
  e.tecla('t');
  e.cuadros(2);
  assert.ok(e.textos().includes(S.overlays.top3));
  e.cuadros(80, 100); // 8 s
  assert.ok(!e.textos().includes(S.overlays.top3), 'el top 3 dura 6 s');
  e.tecla('F3');
  e.cuadros(2);
  assert.ok(rellenos(e).some((f) => f.estilo === COLORS.safeZone));
  e.tecla('F3');
  e.cuadros(2);
  assert.ok(!rellenos(e).some((f) => f.estilo === COLORS.safeZone));
});

test('N enmascara los nombres en el feed y N otra vez los restaura; Shift+N no los oculta', async () => {
  const e = await arrancar('?donantes&rapido=8');
  e.cuadros(10, 100);
  // el feed muestra las últimas líneas: cada una empieza con el nombre de quien se unió o ascendió
  const nombres = () =>
    e
      .textos()
      .filter((t) => / (se unió a|ascendió a) /.test(t))
      .map((t) => t.split(' ')[0]);
  assert.ok(nombres().length > 0 && nombres().some((n) => n !== 'anónimo'), 'los nombres se ven');
  e.tecla('n');
  e.cuadros(2, 100);
  assert.ok(nombres().length > 0 && nombres().every((n) => n === 'anónimo'), 'N enmascara todos');
  e.tecla('n');
  e.cuadros(2, 100);
  assert.ok(
    nombres().some((n) => n !== 'anónimo'),
    'N otra vez los restaura',
  );
  e.tecla('n');
  e.tecla('N', { shiftKey: true });
  e.tecla('n');
  e.cuadros(2, 100);
  assert.ok(
    nombres().some((n) => n !== 'anónimo'),
    'Shift+N nunca oculta nombres (los dos N pares se anulan)',
  );
});

test('Shift+N ×2 en el selector es "Nuevo en vivo": reinicia, avisa y vacía la copia del servidor; fuera de él avisa', async () => {
  const e = await arrancar('?donantes&rapido=8');
  e.cuadros(10, 100);
  e.tecla('N', { shiftKey: true });
  e.cuadros(2, 100);
  assert.ok(e.textos().includes(S.newLive.blocked), 'en batalla no se envía nada y se avisa');
  const s = await arrancar('', { selector: true, servidor: true });
  s.tecla('N', { shiftKey: true });
  s.cuadros(2, 100);
  assert.ok(s.textos().includes(S.newLive.confirm));
  s.tecla('N', { shiftKey: true });
  s.cuadros(2, 100);
  assert.ok(s.textos().includes(S.newLive.done));
});

test('Esc ×2 en pleno partido lo termina (sin podio) y vuelve al selector', async () => {
  const e = await arrancar('');
  llenar(e);
  e.tecla('Escape');
  e.cuadros(2, 100);
  assert.ok(!e.textos().includes(S.matchup.title));
  e.tecla('Escape');
  llenar(e, 3);
  assert.ok(e.textos().includes(S.matchup.title), 'volvió al selector');
});

test('M alterna el sonido (mudo por defecto sin archivos) y avisa', async () => {
  const e = await arrancar('', { selector: true });
  e.tecla('m');
  e.cuadros(2, 100);
  assert.ok(e.textos().includes(S.audio.off) || e.textos().includes(S.audio.on));
});

test('el texto del chat nunca se dibuja ni llega a un nodo del DOM; los nombres tampoco se escriben en el DOM', async () => {
  const e = await arrancar('?donantes&rapido=8');
  e.ws.recibir({ type: 'chat', userId: 'x', uniqueId: 'x', nickname: 'Zeta', text: '1 hola mundo secreto' });
  e.cuadros(20, 100);
  assert.ok(!hay(e, /hola mundo secreto/));
  for (const [, v] of e.escrituras) assert.doesNotMatch(v, /hola mundo secreto|ana_23|Zeta/);
});

test('los parámetros de desarrollo que se fueron (?donantes, ?avion, ?selector, ?ws) ya no cambian nada', async () => {
  const e = await arrancar('?donantes&avion&selector&ws=ws://otro/ws&pair=PE-MX', { selector: true, crudo: true });
  e.cuadros(10, 100);
  assert.ok(e.textos().includes(S.matchup.title), 'abre el selector como siempre');
  assert.equal(e.ws.instancias.length, 0, 'sin servidor no hay puente, y nada lo apunta a otro lado');
  assert.equal(e.evento('beforeunload').evitado, undefined, 'ningún donante sintético');
  e.tecla('Enter');
  e.cuadros(3, 100);
  assert.ok(hay(e, /^Comenta 1 o Perú/), '?pair solo preselecciona');
});

test('antes de descargar la página (beforeunload) se pide confirmación solo si hay usuarios en memoria', async () => {
  const sin = await arrancar('', { selector: true, servidor: true });
  assert.equal(sin.evento('beforeunload').evitado, undefined);
  const con = await arrancar('?donantes&rapido=8');
  con.cuadros(10, 100);
  assert.equal(con.evento('beforeunload').evitado, true);
});

test('NM-7 y NM-8: sin entrada del narrador el partido se pausa solo y una tecla de confianza lo reanuda; una sintética no', async () => {
  let ahora = 1000;
  mock.method(performance, 'now', () => ahora);
  try {
    const e = await arrancar('');
    e.cuadros(10, 100);
    assert.ok(!e.textos().includes(S.pause), 'al principio no hay pausa');
    ahora += 6 * 60000; // 6 min sin tocar nada (la guardia es de 5 por defecto)
    e.cuadros(3, 100);
    assert.ok(e.textos().includes(S.pause), 'la presencia pausó el partido');
    e.tecla('v', { isTrusted: false });
    e.cuadros(3, 100);
    assert.ok(e.textos().includes(S.pause), 'un keydown sintético no reinicia la guardia');
    e.tecla('v');
    e.cuadros(10, 100);
    assert.ok(!e.textos().includes(S.pause), 'una tecla real la reanuda');
  } finally {
    mock.restoreAll();
  }
});

test('N deja solo el rango en las etiquetas del mundo y S sigue a un donante con la cámara (Shift+S la suelta)', async () => {
  const e = await arrancar('?f2&donantes&rapido=20');
  for (let i = 0; i < 60; i++) e.cuadros(1, 100);
  const RANGO = /^(RECLUTA|SOLDADO|CABO|SARGENTO|TENIENTE|CAPITÁN|MAYOR|CORONEL|GENERAL)( |$)/;
  const etiquetas = () => e.textos().filter((t) => RANGO.test(t));
  assert.ok(
    etiquetas().some((t) => t.includes(' ')),
    'con nombre',
  );
  e.tecla('n');
  e.cuadros(2, 100);
  assert.ok(etiquetas().length > 0 && etiquetas().every((t) => !t.includes(' ')), 'con N solo el rango');
  e.tecla('n');
  e.cuadros(2, 100);
  assert.ok(etiquetas().some((t) => t.includes(' ')));
  e.tecla('s');
  e.cuadros(1, 100);
  assert.match(e.f2().cámara, /follow/, 'S: la cámara sigue a un donante');
  e.tecla('S', { shiftKey: true });
  e.cuadros(1, 100);
  assert.doesNotMatch(e.f2().cámara, /follow/, 'Shift+S la suelta');
});

test('Nuevo en vivo reinicia la interfaz: el ascenso que ya estaba en el feed no vuelve a verse en la sala', async () => {
  const e = await arrancar('?pair=PE-MX', { selector: true, servidor: true });
  e.ws.abrir();
  e.ws.recibir({
    type: 'gift',
    userId: 'a',
    uniqueId: 'a',
    nickname: 'Ana',
    giftId: 'g',
    giftName: 'Rose',
    coins: 100,
    count: 1,
  });
  e.cuadros(5, 100); // el ascenso entra al feed aunque todavía se esté en el selector (el feed no se dibuja ahí)
  e.tecla('N', { shiftKey: true });
  e.tecla('N', { shiftKey: true });
  e.cuadros(3, 100);
  assert.ok(e.textos().includes(S.newLive.done));
  e.tecla('Enter'); // el par preseleccionado: la sala
  e.cuadros(5, 100);
  assert.ok(hay(e, /^Comenta 1 o/), 'en la sala');
  assert.ok(e.textos().includes(S.feed.empty), 'el feed arranca limpio');
  assert.ok(!hay(e, /ascendió a/));
});
