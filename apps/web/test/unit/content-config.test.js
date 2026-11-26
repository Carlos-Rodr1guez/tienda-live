import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// `astro:content` es un módulo virtual de Vite: no se puede cargar desde node:test. Se revisa el texto del archivo.
const config = readFileSync(new URL('../../src/content.config.js', import.meta.url), 'utf8');

test('content.config: dos colecciones, juegos y legal, con glob y los esquemas puros', () => {
  assert.match(config, /import \{ glob \} from 'astro\/loaders'/);
  assert.match(config, /import \{ defineCollection \} from 'astro:content'/);
  assert.match(config, /createJuegoSchema/);
  assert.match(config, /createLegalSchema/);
  assert.match(config, /export const collections = \{ juegos, legal \}/);
});

test('content.config: juegos lee src/content/juegos, o la carpeta de JUEGOS_DIR (para probar fichas inválidas)', () => {
  assert.match(config, /process\.env\.JUEGOS_DIR \?\? '\.\/src\/content\/juegos'/);
  assert.match(config, /base: '\.\/src\/content\/legal'/);
  assert.match(config, /pattern: '\*\.md'/);
});
