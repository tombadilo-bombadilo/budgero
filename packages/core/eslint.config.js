import globals from 'globals';
import base from '@budgero/eslint-config/base';
import prettier from '@budgero/eslint-config/prettier';

export default [
  {
    ignores: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
  },

  ...base,

  {
    files: ['**/*.{ts,js}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Libraries must not write to stdout — use the `debug`-based logger (src/logger.ts).
      // console.warn / console.error are allowed for genuine, surfacing problems.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Test files may use console freely.
    files: ['**/*.{spec,test}.ts', 'node-tests/**', '**/__tests__/**'],
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
];
