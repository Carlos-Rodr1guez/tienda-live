// Arnés de pruebas: arma la app con dobles (base D1 en memoria con las migraciones reales, reloj y bytes controlados,
// registro espía) y ofrece ayudas para hacer pedidos. Lo usan las pruebas de la tubería y de cada ruta.

import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { createD1Fake } from './d1-fake.js';

export const AHORA = Date.parse('2026-11-05T12:00:00.000Z');
export const ORIGEN = 'http://localhost:4400';

/** Reloj que las pruebas mueven a mano. */
export function createFakeClock(inicio = AHORA) {
  let ahora = inicio;
  return {
    now: () => ahora,
    set(ms) {
      ahora = ms;
    },
    advance(ms) {
      ahora += ms;
    },
  };
}

/** Bytes deterministas: cada llamada continúa la cuenta 0, 1, 2... para que los tokens sean predecibles. */
export function createFakeRandom() {
  let contador = 0;
  return {
    bytes(n) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) bytes[i] = contador++ % 256;
      return bytes;
    },
  };
}

/** Registro espía: guarda cada línea escrita, con su nivel. */
export function createSpyLogger() {
  const lineas = [];
  const sink = {
    log: (linea) => lineas.push({ nivel: 'info', linea }),
    warn: (linea) => lineas.push({ nivel: 'warn', linea }),
    error: (linea) => lineas.push({ nivel: 'error', linea }),
  };
  return { lineas, sink, texto: () => lineas.map((l) => l.linea).join('\n') };
}

/** Contexto de ejecución falso: junta lo que se pasa a waitUntil y deja esperarlo. */
export function createFakeCtx() {
  const pendientes = [];
  return {
    waitUntil: (promesa) => pendientes.push(promesa),
    pendientes,
    async settle() {
      await Promise.allSettled(pendientes);
    },
  };
}

/**
 * @param {{ routes: any[], jobs?: any[], env?: Record<string, unknown>, ports?: Record<string, unknown> }} opciones
 */
export async function createHarness({
  routes,
  jobs,
  env = { ENVIRONMENT: 'development', SITE_URL: ORIGEN },
  ports = {},
}) {
  const { createLogger } = await import('../../src/adapters/logger.js');
  const db = createD1Fake();
  const clock = createFakeClock();
  const random = createFakeRandom();
  const spy = createSpyLogger();
  const config = readConfig(env);
  const todosLosPuertos = { db, clock, random, logger: createLogger(spy.sink), config, ...ports };
  const app = createApp(todosLosPuertos, { routes, jobs });
  const ctx = createFakeCtx();

  /** Pedido a la app con el origen permitido por defecto. */
  function request(camino, { method = 'POST', headers = {}, body, origin = ORIGEN } = {}) {
    const cabeceras = new Headers(headers);
    if (origin !== null && !cabeceras.has('origin')) cabeceras.set('origin', origin);
    return app.fetch(new Request(`http://localhost:8790${camino}`, { method, headers: cabeceras, body }), ctx);
  }

  /** POST JSON. `cuerpo` se serializa salvo que ya sea un texto. */
  function post(camino, cuerpo, opciones = {}) {
    const headers = { 'content-type': 'application/json', ...opciones.headers };
    return request(camino, {
      ...opciones,
      method: 'POST',
      headers,
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });
  }

  return { app, ports: todosLosPuertos, db, clock, random, spy, config, ctx, request, post };
}
