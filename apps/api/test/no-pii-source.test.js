import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// WL-12 y FM-4: la API no lee ni escribe IP, agente de usuario, cookies ni datos de ubicación de Cloudflare.
// Esta prueba mira el código fuente: si alguien menciona estas cabeceras o propiedades, tiene que explicarlo acá.
const PROHIBIDOS = [
  { nombre: 'cf-connecting-ip', patron: /cf-connecting-ip/i },
  { nombre: 'x-forwarded-for', patron: /x-forwarded-for/i },
  { nombre: 'user-agent', patron: /user-agent/i },
  { nombre: 'request.cf', patron: /request\.cf\b/i },
  { nombre: 'Set-Cookie', patron: /set-cookie/i },
];

function buscar(texto) {
  return PROHIBIDOS.filter(({ patron }) => patron.test(texto)).map(({ nombre }) => nombre);
}

function archivosJs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return archivosJs(ruta);
    return e.name.endsWith('.js') ? [ruta] : [];
  });
}

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('no-pii: el buscador detecta cada término prohibido, en cualquier mayúscula y sin falsos positivos', () => {
  assert.deepEqual(buscar("req.headers.get('CF-Connecting-IP')"), ['cf-connecting-ip']);
  assert.deepEqual(buscar("h.get('X-Forwarded-For')"), ['x-forwarded-for']);
  assert.deepEqual(buscar("h.get('User-Agent')"), ['user-agent']);
  assert.deepEqual(buscar('const pais = request.cf.country'), ['request.cf']);
  assert.deepEqual(buscar("headers.append('Set-Cookie', x)"), ['Set-Cookie']);
  assert.deepEqual(buscar('const request_cfg = 1; request.cfg'), []);
  assert.deepEqual(buscar("const origen = request.headers.get('origin')"), []);
});

test('no-pii: ningún archivo de apps/api/src menciona IP, agente de usuario, request.cf ni cookies', () => {
  const archivos = archivosJs(SRC);
  assert.ok(archivos.length >= 10, `se esperaban varios archivos y hay ${archivos.length}`);
  const hallazgos = archivos.flatMap((archivo) =>
    buscar(readFileSync(archivo, 'utf8')).map((nombre) => `${path.relative(SRC, archivo)}: ${nombre}`),
  );
  assert.deepEqual(hallazgos, []);
});
