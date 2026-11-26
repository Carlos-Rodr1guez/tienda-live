import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El README de ASEDIO tiene que seguir diciendo la verdad después de mover el servidor al kit (KIT-4, DOC-2).
const readme = readFileSync(fileURLToPath(new URL('../../../games/asedio/README.md', import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);

test('README de ASEDIO: el conector se actualiza desde el kit', () => {
  assert.match(readme, /npm update tiktok-live-connector -w @tienda\/kit/);
  assert.doesNotMatch(readme, /npm update tiktok-live-connector -w asedio-live/);
});

test('README de ASEDIO: la sección "Estructura" nombra packages/kit', () => {
  const estructura = readme.split(/^## Estructura$/m)[1]?.split(/^## /m)[0] ?? '';
  assert.match(estructura, /packages\/kit/);
});
