import globals from 'globals';
import base from '@budgero/eslint-config/base';
import prettier from '@budgero/eslint-config/prettier';

export default [
  {
    ignores: ['dist', 'node_modules', 'coverage', '*.config.js', '*.config.ts'],
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
      // Library: never write to stdout directly — go through the runtime logger.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Type-aware rules only on build source (tests live outside the tsconfig
    // project; the base config disables typed linting for them).
    files: ['src/**/*.ts'],
    ignores: ['**/*.{test,spec}.ts', '**/__tests__/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The sync engine is promise-heavy; an unhandled promise here means a
      // dropped mutation or lost catch-up. Make floating promises an error.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  {
    // The runtime logger is the one sanctioned place that writes to the console.
    files: ['src/logging/**'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.{spec,test}.ts', '**/__tests__/**'],
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
];
