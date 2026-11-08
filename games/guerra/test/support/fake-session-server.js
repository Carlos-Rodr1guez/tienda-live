// Un `fetch` falso que habla con el almacén REAL de la sesión del kit (`createSessionStore`) sin abrir ningún puerto:
// arma un `req` y un `res` de mentira, como lo hace el servidor de Node, con dirección y Host locales. Así las pruebas de
// la página ejercitan la validación de verdad (forma, límites, 413, tipo de contenido) y no una copia de ella.

import { Readable } from 'node:stream';
import { createSessionStore } from '@tienda/kit/server';

/**
 * @param {{maxBytes?: number, config?: object, store?: ReturnType<typeof createSessionStore>}} [o]
 *   `store`: para simular una recarga de la página contra el mismo servidor
 */
export function createFakeSessionServer({ maxBytes, config = {}, store = createSessionStore({ maxBytes }) } = {}) {
  /** Cada pedido que llegó: `{method, url, status, body}`. */
  const calls = [];
  const sessionCalls = () => calls.filter((c) => c.url === '/api/session');

  async function fakeFetch(url, init = {}) {
    const method = init.method ?? 'GET';
    if (url === '/api/config') {
      calls.push({ method, url, status: 200 });
      return {
        ok: true,
        status: 200,
        json: async () => ({ serverMode: true, game: config, session: { maxBytes: store.maxBytes } }),
      };
    }
    if (url !== '/api/session') {
      calls.push({ method, url, status: 404 });
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const body = init.body === undefined ? [] : [Buffer.from(String(init.body))];
    const req = Object.assign(Readable.from(body, { objectMode: false }), {
      method,
      url,
      headers: {
        host: 'localhost:3100',
        ...(init.body === undefined ? {} : { 'content-type': init.headers?.['Content-Type'] }),
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const out = { status: 0, text: '' };
    const res = {
      writeHead(status) {
        out.status = status;
        return res;
      },
      end(text) {
        if (text !== undefined) out.text += String(text);
        return res;
      },
      on() {},
    };
    if (init.signal?.aborted) throw new DOMException('abort', 'AbortError');
    await store.handle(req, res);
    calls.push({ method, url, status: out.status, body: init.body, keepalive: init.keepalive === true });
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => JSON.parse(out.text) };
  }
  return { fetch: fakeFetch, store, calls, sessionCalls };
}
