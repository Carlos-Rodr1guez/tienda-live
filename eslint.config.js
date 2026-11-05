// Reglas de ESLint para todo el monorepo. El formato de estilo lo decide Prettier;
// acá solo van reglas que encuentran errores.

import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/', '**/.astro/', '**/.wrangler/', '**/.dev-state/']),
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
