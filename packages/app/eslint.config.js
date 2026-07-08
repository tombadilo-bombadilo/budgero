import globals from 'globals';
import reactRefresh from 'eslint-plugin-react-refresh';
import reactCompiler from 'eslint-plugin-react-compiler';
import boundaries from 'eslint-plugin-boundaries';
import react from '@budgero/eslint-config/react';
import prettier from '@budgero/eslint-config/prettier';

// Helpers for the FSD layer rules (boundaries v6 object-based selectors).
const layer = (type) => [{ type }];
const below = (...types) => types.map((type) => ({ to: { type } }));

export default [
  {
    ignores: [
      'dist',
      'dev-dist',
      'public/**',
      'tests/**',
      '**/*.d.ts',
      '**/*.generated.ts',
      'scripts/**',
      'vitest.setup.ts',
      '*.config.js',
      '*.config.ts',
    ],
  },

  // Shared Budgero React preset (Airbnb base + TS + React, with project relaxations).
  ...react,

  // App-specific: Vite/React-Compiler plugins, FSD boundaries, and settings.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-refresh': reactRefresh,
      'react-compiler': reactCompiler,
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
      // Feature-Sliced Design layers (see docs/fsd-migration-plan.md).
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'pages', pattern: 'src/pages' },
        { type: 'widgets', pattern: 'src/widgets' },
        { type: 'features', pattern: 'src/features' },
        { type: 'entities', pattern: 'src/entities' },
        { type: 'shared', pattern: 'src/shared' },
      ],
      'boundaries/ignore': ['**/*.{test,spec}.{ts,tsx}'],
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-compiler/react-compiler': 'error',

      // FSD layer guard.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: layer('app'), allow: below('app', 'pages', 'widgets', 'features', 'entities', 'shared') },
            { from: layer('pages'), allow: below('pages', 'widgets', 'features', 'entities', 'shared') },
            { from: layer('widgets'), allow: below('widgets', 'features', 'entities', 'shared') },
            { from: layer('features'), allow: below('features', 'entities', 'shared') },
            { from: layer('entities'), allow: below('entities', 'shared') },
            { from: layer('shared'), allow: below('shared') },
          ],
        },
      ],

      // The app may write to the console (it's the top-level binary, not a library).
      'no-console': 'off',

      // Core must be consumed through its public entry points only. The bare
      // '@budgero/core' specifier resolves to the Node entry (types) but the
      // browser bundle at runtime, and 'src/*' deep imports bypass the package
      // contract entirely — both are banned in favor of '@budgero/core/browser'.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@budgero/core',
              message: "Import from '@budgero/core/browser' — the bare entry resolves to the Node build.",
            },
          ],
          patterns: [
            {
              group: ['@budgero/core/src', '@budgero/core/src/*'],
              message: "Deep imports into core internals are forbidden — use '@budgero/core/browser'.",
            },
          ],
        },
      ],
    },
  },

  // Delegate ALL formatting to Prettier (must be last).
  prettier,
];
