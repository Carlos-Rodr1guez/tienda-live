// Servidor local: sirve el juego, expone la configuración y reenvía los eventos
// del LIVE al navegador por WebSocket.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createTikTokBridge } from './tiktok.js';
import { packageDir } from './package-dir.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

export async function loadConfigFile(root = ROOT) {
  try {
    const raw = await readFile(path.join(root, 'config.json'), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[config] config.json no es JSON válido:', err.message);
    return {};
  }
}

function safeJoin(dir, rel) {
  const full = path.normalize(path.join(dir, rel));
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  return full;
}

export async function startServer({
  config = {},
  port = 3000,
  host = '127.0.0.1',
  root = ROOT,
  tiktok = true,
  log = console,
} = {}) {
  const mounts = [
    { prefix: '/vendor/three/', dir: packageDir('three', root) },
    { prefix: '/models/', dir: path.join(root, 'models') },
    { prefix: '/', dir: path.join(root, 'public') },
  ];

  const clients = new Set();
  let lastStatus = null;
  const broadcast = (evt) => {
    const msg = JSON.stringify(evt);
    for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
  };

  async function serveStatic(req, res, pathname) {
    for (const m of mounts) {
      if (!pathname.startsWith(m.prefix)) continue;
      let rel = pathname.slice(m.prefix.length);
      try {
        rel = decodeURIComponent(rel);
      } catch {
        res.writeHead(400).end();
        return true;
      }
      let file = safeJoin(m.dir, rel || 'index.html');
      if (!file) {
        res.writeHead(403).end();
        return true;
      }
      try {
        let st = await stat(file);
        if (st.isDirectory()) {
          file = path.join(file, 'index.html');
          st = await stat(file);
        }
        const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).pipe(res);
      } catch {
        if (m.prefix !== '/') {
          res.writeHead(404).end();
          return true;
        }
        continue;
      }
      return true;
    }
    return false;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/config') {
        let models = [];
        try {
          models = (await readdir(path.join(root, 'models')))
            .filter((f) => f.toLowerCase().endsWith('.glb'))
            .map((f) => f.slice(0, -4).toLowerCase());
        } catch {
          /* sin carpeta models */
        }
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(
          JSON.stringify({
            serverMode: true,
            tiktokUsername: bridge?.status?.username || '',
            game: config.game || {},
            models,
          }),
        );
        return;
      }
      if (p === '/api/status') {
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ tiktok: bridge?.status || null, clients: clients.size }));
        return;
      }
      if (p === '/api/simulate' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1e5) break;
        }
        const evt = JSON.parse(body || '{}');
        if (!evt || typeof evt.type !== 'string') {
          res.writeHead(400).end();
          return;
        }
        broadcast(evt);
        res.writeHead(204).end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (await serveStatic(req, res, p)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    } catch (err) {
      log.error?.('[http]', err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    clients.add(ws);
    if (lastStatus) ws.send(JSON.stringify(lastStatus));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const bridge = tiktok
    ? createTikTokBridge(config, {
        onEvent: broadcast,
        onStatus: (s) => {
          lastStatus = { type: 'status', ...s };
          broadcast(lastStatus);
        },
        log,
      })
    : null;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    server,
    port: server.address().port,
    broadcast,
    bridge,
    async close() {
      bridge?.stop();
      for (const ws of clients) ws.terminate();
      await new Promise((r) => wss.close(() => r()));
      await new Promise((r) => server.close(() => r()));
    },
  };
}
