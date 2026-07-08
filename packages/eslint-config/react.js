import { configs as airbnb, plugins as airbnbPlugins } from 'eslint-config-airbnb-extended';
import {
  airbnbBase,
  baseRules,
  unusedImportsPlugin,
  typeAwareRules,
  namingConventions,
  testOverride,
} from './base.js';

/**
 * Shared Budgero React preset: Airbnb base + React / jsx-a11y / react-hooks rule
 * sets, with the project's relaxations applied LAST (after every Airbnb rule set,
 * so base + react relaxations actually win). App-specific plugins (react-refresh,
 * react-compiler) and the FSD `boundaries` guard stay in the app's own config.
 * Spread Prettier (`./prettier.js`) LAST in the consumer.
 */

const reactRules = {
  // React 19 automatic JSX runtime — no need to import React in scope.
  'react/react-in-jsx-scope': 'off',
  'react/jsx-uses-react': 'off',

  // React preference rules relaxed (style / deliberate patterns).
  'react/jsx-no-constructed-context-values': 'off',
  'react/require-default-props': 'off',
  'react/jsx-props-no-spreading': 'off',
  'react/no-unescaped-entities': 'off',
  'react/button-has-type': 'off',
  'react/no-array-index-key': 'off',
  'react/function-component-definition': 'off',
  'react/no-unstable-nested-components': 'off',
  'react/no-unused-prop-types': 'off',
  'react/destructuring-assignment': 'off',
  'react/prop-types': 'off',
  'react/jsx-no-bind': 'off',
  'react/no-danger': 'off',


  // react-hooks v6 experimental (compiler-aligned) rules — too noisy on RC.
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/immutability': 'off',
};

export default [
  // Airbnb base + React rule sets FIRST...
  ...airbnbBase,
  airbnbPlugins.react,
  airbnbPlugins.reactA11y,
  airbnbPlugins.reactHooks,
  ...airbnb.react.recommended,
  ...airbnb.react.typescript,

  // ...then our relaxations LAST so they win over the Airbnb rule sets.
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    plugins: {
      'unused-imports': unusedImportsPlugin,
    },
    rules: { ...baseRules, ...reactRules },
  },

  // Type-aware correctness rules (no-floating-promises), TS sources only.
  typeAwareRules,

  // Folder (kebab) + hook (camelCase) naming, shared with the base config.
  namingConventions,

  testOverride,
];
