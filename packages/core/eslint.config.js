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

      // Timezone-shift guards. Date-only strings ("YYYY-MM-DD") parse as UTC
      // midnight in new Date(), and toISOString() reads back the UTC calendar
      // day — both shift dates by a day for users away from UTC. Use the
      // helpers in src/utils/date.ts (getLocalDateString, getUTCDateString,
      // parseDateOnlyLocal) instead; annotate deliberate UTC anchors.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.name='Date'][arguments.length=1] > TemplateLiteral.arguments",
          message:
            'new Date(`...`) parses date-only strings as UTC midnight. Use parseDateOnlyLocal, or disable with a comment for deliberate UTC anchors.',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(split|slice|substring)$/][callee.object.callee.property.name='toISOString']",
          message:
            'toISOString().split/slice gives the UTC calendar day, not the local one. Use getLocalDateString from utils/date.ts.',
        },
      ],
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
