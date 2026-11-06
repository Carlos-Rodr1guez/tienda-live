// Reglas de ESLint para todo el monorepo. El formato de estilo lo decide Prettier;
// acá solo van reglas que encuentran errores.

import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // `apps/web/test/dist` son pruebas de la construcción, no una salida: se revisan como el resto
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '!apps/web/test/dist/',
    '**/coverage/',
    '**/.astro/',
    '**/.wrangler/',
    '**/.dev-state/',
  ]),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    // Código que corre en el navegador
    files: ['games/*/public/**/*.js', 'apps/web/src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // El Worker de Cloudflare: tiene fetch, Request, Response y crypto, pero no es Node ni tiene DOM
    files: ['apps/api/src/**/*.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // Código compartido: corre en el Worker, en el navegador y en las pruebas de Node
    files: ['packages/*/src/**/*.js'],
    languageOptions: { globals: globals['shared-node-browser'] },
  },
  {
    // El servidor del kit corre solo en Node; el cliente del kit, solo en el navegador (más específicos que el bloque anterior)
    files: ['packages/kit/src/server/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/kit/src/client/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Código que corre en Node: servidores, pruebas, herramientas, scripts y configuración
    files: [
      'games/*/server/**',
      'games/*/test/**',
      'games/*/tools/**',
      'scripts/**',
      '*.config.js',
      'apps/*/test/**',
      'apps/*/scripts/**',
      'packages/*/test/**',
      'apps/web/astro.config.mjs',
      'apps/web/integrations/**',
      'apps/web/src/content.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
]);
