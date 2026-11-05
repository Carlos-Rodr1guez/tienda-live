import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { subtitulosDe } from '../../src/lib/video-files.js';

// Carpeta de pruebas dentro del repo (ignorada por git): nunca se escribe en C:
const RAIZ = fileURLToPath(new URL('../../.dev-state/pruebas-web/video-files/', import.meta.url));

test('subtitulosDe: devuelve la ruta del .vtt cuando el archivo existe en public, y falla nombrando el video cuando falta', () => {
  rmSync(RAIZ, { recursive: true, force: true });
  mkdirSync(join(RAIZ, 'videos'), { recursive: true });
  writeFileSync(join(RAIZ, 'videos', 'demo.vtt'), 'WEBVTT\n');
  try {
    assert.equal(subtitulosDe('/videos/demo.mp4', RAIZ), '/videos/demo.vtt');
    assert.equal(subtitulosDe('/videos/demo.webm', RAIZ), '/videos/demo.vtt');
    assert.throws(() => subtitulosDe('/videos/otro.mp4', RAIZ), /otro\.mp4/);
    assert.throws(() => subtitulosDe('/fuera/demo.mp4', RAIZ), /video/);
  } finally {
    rmSync(RAIZ, { recursive: true, force: true });
  }
});
