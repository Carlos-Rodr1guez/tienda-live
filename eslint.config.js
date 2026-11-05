// Reglas de ESLint para todo el monorepo. El formato de estilo lo decide Prettier;
// acá solo van reglas que encuentran errores.

import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/']),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    // Código que corre en el navegador
    files: ['games/*/public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Código que corre en Node: servidores, pruebas, herramientas y scripts
    files: ['games/*/server/**', 'games/*/test/**', 'games/*/tools/**', 'scripts/**', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
]);
