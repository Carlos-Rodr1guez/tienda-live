import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar } from './support/fake-main.js';
import { createFakeSessionServer } from './support/fake-session-server.js';

// KIT-28 y NM-11 con `main.js` completo (DOM falso): la página pide la copia ANTES del primer evento, en `?golden` no
// hay tráfico de sesión, una recarga restaura rangos, ocultos y el partido, y F2 lo dice.

const ESTADO = 'sesión de la transmisión';
const FUERA = 'usuarios fuera de la copia';
const puts = (s) => s.sessionCalls().filter((c) => c.method === 'PUT');
/** Da `n` cuadros cediendo el turno a los pedidos en vuelo cada pocos cuadros (el DOM falso es síncrono). */
async function avanzar(main, n) {
  for (let hecho = 0; hecho < n; hecho += 5) {
    main.cuadros(Math.min(5, n - hecho));
    await new Promise((r) => setImmediate(r));
  }
}
const guardada = (s) => (s.store.get() === null ? null : JSON.parse(s.store.get()));

test('?golden: cero tráfico de sesión (ni GET, ni PUT, ni DELETE, ni pagehide)', async () => {
  for (const search of ['?golden', '?golden&f2&rapido=4', '?golden&donantes']) {
    const s = createFakeSessionServer();
    const main = await arrancar(search, { fetch: s.fetch });
    main.cuadros(200);
    main.evento('pagehide');
    main.cuadros(100);
    assert.deepEqual(s.sessionCalls(), [], search);
    assert.equal(s.store.get(), null);
  }
});

test('la página pide la copia (GET) antes del primer evento y F2 dice que la sesión es nueva', async () => {
  const s = createFakeSessionServer();
  const main = await arrancar('?f2', { fetch: s.fetch });
  const llamadas = s.sessionCalls();
  assert.equal(llamadas[0].method, 'GET');
  assert.equal(llamadas[0].status, 204);
  assert.equal(puts(s).length, 0, 'sin cambios no se envía nada');
  const f2 = main.f2();
  assert.match(f2[ESTADO], /vacía/);
  assert.equal(f2[FUERA], '0');
});

test('sin sesión en el servidor (404): el juego arranca como siempre, no se envía nada y F2 lo dice', async () => {
  const llamadas = [];
  const fetch = async (url, init = {}) => {
    llamadas.push([init.method ?? 'GET', url]);
    return url === '/api/session' ? { ok: false, status: 404, json: async () => ({}) } : { ok: false, status: 404 };
  };
  const main = await arrancar('?f2&donantes&rapido=8', { fetch });
  await avanzar(main, 120);
  main.evento('pagehide');
  assert.deepEqual(
    llamadas.filter(([, u]) => u === '/api/session'),
    [['GET', '/api/session']],
  );
  assert.match(main.f2()[ESTADO], /sin servidor de sesión/);
  assert.ok(
    main.textos().some((t) => /Ronda 1[/]3/.test(t)),
    'la partida arrancó sola como antes',
  );
});

test('C4: si /api/config responde bien y no trae "session", la sesión queda apagada sin hacer el GET', async () => {
  const llamadas = [];
  const fetch = async (url, init = {}) => {
    llamadas.push([init.method ?? 'GET', url]);
    if (url === '/api/config')
      return { ok: true, status: 200, json: async () => ({ serverMode: true, game: {}, models: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const main = await arrancar('?f2&donantes&rapido=8', { fetch });
  await avanzar(main, 150);
  main.evento('pagehide');
  assert.deepEqual(llamadas, [['GET', '/api/config']], 'ni GET, ni PUT, ni nada de sesión');
  assert.match(main.f2()[ESTADO], /sin servidor de sesión/);
  assert.equal(main.f2()[FUERA], '0');
  assert.ok(
    main.textos().some((t) => /Ronda 1[/]3/.test(t)),
    'el juego arranca solo como siempre',
  );
});

test('C4: si /api/config falla (no se sabe si hay sesión) se intenta el GET como siempre', async () => {
  const s = createFakeSessionServer();
  const fetch = async (url, init) => (url === '/api/config' ? { ok: false, status: 500 } : s.fetch(url, init));
  const main = await arrancar('?f2', { fetch });
  assert.equal(s.sessionCalls()[0].method, 'GET');
  assert.match(main.f2()[ESTADO], /vacía/);
});

test('C3: si armar la copia es caro (reloj de la página), los envíos se espacian y F2 lo dice', async () => {
  const s = createFakeSessionServer();
  const original = performance.now.bind(performance);
  let t = 0;
  mock.method(performance, 'now', () => (t += 20)); // cada lectura del reloj avanza 20 ms
  try {
    const main = await arrancar('?f2&donantes&rapido=8', { fetch: s.fetch });
    await avanzar(main, 400);
    const f2 = main.f2()[ESTADO];
    assert.match(f2, /cada [3-5] s/);
    assert.ok(puts(s).length >= 1);
    // con ~6,7 s de reloj de vista y esperas de 3 s o más caben pocos PUT (con 1 s serían 6 o 7)
    assert.ok(puts(s).length <= 3, `${puts(s).length} PUT`);
  } finally {
    mock.restoreAll();
  }
  assert.ok(original() > 0);
});

test('C2: con el GET caído el juego arranca solo, no guarda nada y reintenta; al volver el servidor con 204 empieza a guardar', async () => {
  const s = createFakeSessionServer();
  let cae = true;
  let intentos = 0;
  const fetch = async (url, init = {}) => {
    if (url === '/api/session') {
      intentos++;
      if (cae) throw new Error('red');
    }
    return s.fetch(url, init);
  };
  const main = await arrancar('?f2&donantes&rapido=8', { fetch });
  assert.match(main.f2()[ESTADO], /no se pudo cargar.*reintentando/);
  await avanzar(main, 400); // ~6,7 s de reloj de vista: reintentos a 1, 3 y 7 s
  assert.ok(intentos >= 3 && intentos <= 5, `${intentos} pedidos`);
  assert.equal(puts(s).length, 0, 'nada se guarda mientras no se sepa qué hay');
  cae = false;
  await avanzar(main, 900);
  assert.ok(puts(s).length >= 1, 'el 204 tardío habilita el guardado');
  assert.equal(guardada(s).users.length, 24);
});

test('si el GET no contesta, a los ~3000 ms se corta y el juego arranca vacío (no se cuelga)', async () => {
  let senal = null;
  const fetch = (url, init = {}) => {
    if (url !== '/api/session') return Promise.resolve({ ok: false });
    if (!init.signal) return new Promise(() => {}); // un PUT posterior: no importa
    senal = init.signal;
    return new Promise((_, rechazar) =>
      init.signal.addEventListener('abort', () => rechazar(new DOMException('abort', 'AbortError'))),
    );
  };
  const t0 = Date.now();
  const main = await arrancar('?f2', { fetch });
  const ms = Date.now() - t0;
  assert.equal(senal.aborted, true);
  assert.ok(ms >= 2900 && ms < 6000, `tardó ${ms} ms`);
  assert.match(main.f2()[ESTADO], /no se pudo cargar/);
  assert.ok(main.textos().some((t) => /Ronda 1[/]3/.test(t)));
});

test('copia inválida (200 con otra forma): el juego arranca vacío y F2 lo dice', async () => {
  const fetch = async (url) =>
    url === '/api/session' ? { ok: true, status: 200, json: async () => ({ v: 2, users: [] }) } : { ok: false };
  const main = await arrancar('?f2', { fetch });
  assert.match(main.f2()[ESTADO], /inválida/);
});

test('recarga en pleno LIVE: rangos, donantes y partido siguen; ?donantes no los duplica', async () => {
  const s = createFakeSessionServer();
  const uno = await arrancar('?f2&donantes&rapido=8', { fetch: s.fetch });
  await avanzar(uno, 80); // intro (5 s) y los 24 donantes sintéticos entran al empezar la batalla
  await avanzar(uno, 200); // pasa más de un segundo: la copia se envía
  assert.ok(puts(s).length >= 1, 'se envió la copia');
  assert.ok(puts(s).every((c) => c.status === 204));
  const copia = guardada(s);
  assert.equal(copia.users.length, 24);
  assert.deepEqual(copia.match.pair, ['PE', 'MX']);
  assert.equal(copia.match.started, true);
  assert.ok(copia.users.every((u) => u.xp.live > 0 && (u.team === 1 || u.team === 2)));
  const xpAntes = copia.users.map((u) => u.xp.live).sort((a, b) => a - b);

  // recarga: otra página contra el mismo servidor
  const s2 = createFakeSessionServer({ store: s.store });
  const dos = await arrancar('?f2&donantes&rapido=8', { fetch: s2.fetch, selector: true });
  assert.equal(s2.sessionCalls()[0].method, 'GET');
  assert.equal(s2.sessionCalls()[0].status, 200);
  assert.match(dos.f2()[ESTADO], /restaurada con 24 usuarios · esperando la ronda siguiente/);
  assert.ok(
    dos.textos().some((t) => /El narrador inicia la siguiente ronda/.test(t)),
    'el juego vuelve a la espera del narrador',
  );
  assert.equal(puts(s2).length, 0, 'restaurar no es un cambio');
  // el narrador sigue: Enter arranca la ronda y los donantes sintéticos (mismos userId) vuelven a regalar sin duplicarse
  dos.tecla('Enter');
  dos.donantes(); // los mismos userId vuelven a regalar por el puente
  await avanzar(dos, 300);
  assert.ok(puts(s2).length >= 1);
  const despues = JSON.parse(s2.store.get());
  assert.equal(despues.users.length, 24, 'mismos userId: no se duplican');
  assert.ok(
    despues.users
      .map((u) => u.xp.live)
      .sort((a, b) => a - b)
      .every((xp, i) => xp >= xpAntes[i]),
  );
});

test('recarga sin par: vuelve al selector (matchup) con los rangos y Enter elige el par de la URL', async () => {
  const s = createFakeSessionServer();
  const copia = {
    v: 1,
    clock: 0,
    allHidden: false,
    hidden: ['oculto'],
    match: null,
    users: [
      {
        key: 'a',
        name: 'Ana',
        team: null,
        lastSwitch: -1e9,
        coins: { live: 80, match: 0 },
        value: { live: 0, match: 0 },
        xp: { live: 80, match: 0 },
        kills: { live: 0, match: 0 },
        firstXpAt: null,
      },
    ],
  };
  await s.fetch('/api/session', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(copia),
  });
  const main = await arrancar('?f2&pair=PE-MX', { fetch: s.fetch, selector: true });
  assert.match(main.f2()[ESTADO], /restaurada con 1 usuarios · selector de pares/);
  assert.ok(main.textos().some((t) => /Elige los dos países/.test(t)));
  main.tecla('Enter');
  main.cuadros(2);
  assert.ok(
    main.textos().some((t) => /^Comenta 1 o Perú/.test(t)),
    'Enter eligió el par: sala',
  );
  main.tecla('Enter');
  main.cuadros(2);
  assert.ok(main.textos().some((t) => /Ronda 1[/]3/.test(t)));
});

test('la página recorta con el mismo maxBytes que informa el servidor (/api/config), no con uno propio', async () => {
  const MAX = 64 * 1024;
  const s = createFakeSessionServer({ maxBytes: MAX });
  // una copia guardada que ya ocupa casi todo el tope: ~63 KB de usuarios de poca XP (los donantes la hacen pasar)
  const users = Array.from({ length: 316 }, (_, i) => ({
    key: 'v' + i,
    name: 'Viejo ' + i,
    team: null,
    lastSwitch: -1e9,
    coins: { live: 1, match: 0 },
    value: { live: 0, match: 0 },
    xp: { live: 1, match: 0 },
    kills: { live: 0, match: 0 },
    firstXpAt: null,
  }));
  const copia = { v: 1, clock: 0, allHidden: false, hidden: [], match: null, users };
  const cuerpo = JSON.stringify(copia);
  assert.ok(Buffer.byteLength(cuerpo) > 58 * 1024 && Buffer.byteLength(cuerpo) < MAX);
  await s.fetch('/api/session', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: cuerpo });
  const main = await arrancar('?f2&donantes&rapido=8', { fetch: s.fetch });
  main.tecla('Enter'); // sin par guardado: elige el par de la URL (sala)
  main.tecla('Enter'); // y empieza el partido
  await avanzar(main, 400);
  const mios = puts(s);
  assert.ok(mios.length >= 1);
  // con el tope del servidor la copia se corta antes de enviarla: el servidor la acepta y quedan usuarios afuera
  assert.ok(
    mios.every((c) => c.status === 204),
    mios.map((c) => c.status).join(),
  );
  assert.ok(Buffer.byteLength(mios.at(-1).body) <= MAX);
  assert.ok(Number(main.f2()[FUERA]) > 0, 'F2 cuenta los usuarios que quedaron afuera');
  // los donantes sintéticos tienen más XP que los viejos: siguen todos adentro
  assert.equal(guardada(s).users.filter((u) => u.key.startsWith('sint-')).length, 24);
});

test('pagehide en main manda un último PUT con keepalive', async () => {
  const s = createFakeSessionServer();
  const main = await arrancar('?f2&donantes&rapido=8', { fetch: s.fetch });
  await avanzar(main, 30); // pasa la intro y entran los donantes; el primer PUT ya salió, el siguiente espera 1 s
  const antes = puts(s).length;
  assert.ok(antes >= 1);
  main.cuadros(10); // sigue habiendo cambios (XP) dentro del mismo segundo
  main.evento('pagehide'); // la página se va: un último intento con lo que haya
  await new Promise((r) => setImmediate(r));
  const ultimo = puts(s).at(-1);
  assert.equal(puts(s).length, antes + 1);
  assert.equal(ultimo.keepalive, true);
  assert.equal(JSON.parse(ultimo.body).users.length, 24);
});

test('un PUT que falla se reintenta cada segundo sin tormentas de pedidos', async () => {
  const s = createFakeSessionServer();
  let falla = true;
  let intentos = 0;
  const fetch = async (url, init = {}) => {
    if (init.method === 'PUT') {
      intentos++;
      if (falla) throw new Error('red');
    }
    return s.fetch(url, init);
  };
  const main = await arrancar('?f2&donantes&rapido=8', { fetch });
  await avanzar(main, 100); // la intro y la entrada de los donantes: primer intento
  assert.ok(intentos >= 1);
  // sin red, 5 s de cuadros del reloj de vista (60 cuadros = 1 s): como mucho un intento por segundo
  const antes = intentos;
  await avanzar(main, 300);
  const nuevos = intentos - antes;
  assert.ok(nuevos >= 3 && nuevos <= 6, `${nuevos} intentos en ~5 s`);
  assert.equal(puts(s).length, 0, 'ninguno llegó al servidor');
  assert.match(main.f2()[ESTADO], /error al guardar/);
  falla = false;
  await avanzar(main, 120);
  assert.ok(puts(s).length >= 1);
  assert.equal(guardada(s).users.length, 24);
});
