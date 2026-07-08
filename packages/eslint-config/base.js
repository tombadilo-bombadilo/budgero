import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import tseslint from 'typescript-eslint';
import { configs as airbnb, plugins as airbnbPlugins } from 'eslint-config-airbnb-extended';

/**
 * Shared Budgero base config: Airbnb base (JS) + TypeScript, with the project's
 * pragmatic relaxations for a modern TS codebase. Framework-agnostic — used by
 * every package. The React layer lives in `./react.js`. Prettier (`./prettier.js`)
 * must be spread LAST by each consumer so it can disable formatting rules.
 *
 * The pieces are exported individually so `react.js` can compose them in the
 * right order: Airbnb rule sets FIRST, then our relaxations LAST (otherwise the
 * Airbnb React rule sets re-enable base style rules we deliberately turned off).
 *
 * `no-console` is intentionally left at Airbnb's default here: libraries
 * (core/runtime) tighten it to `error`, the app turns it `off`.
 */

// Airbnb base plugins + rule sets (framework-agnostic), no relaxations yet.
export const airbnbBase = [
  airbnbPlugins.stylistic,
  airbnbPlugins.importX,
  airbnbPlugins.node,
  airbnbPlugins.typescriptEslint,
  ...airbnb.base.recommended,
  ...airbnb.base.typescript,
];

export const unusedImportsPlugin = unusedImports;

// Project relaxations on top of Airbnb base — must be applied AFTER all Airbnb
// rule sets (base and, in react.js, react) so they win.
export const baseRules = {
  // unused-imports owns unused detection (disable the airbnb/tseslint equivalents).
  '@typescript-eslint/no-unused-vars': 'off',
  'no-unused-vars': 'off',
  'unused-imports/no-unused-imports': 'error',
  'unused-imports/no-unused-vars': [
    'warn',
    { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
  ],

  'no-debugger': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  // The few remaining `==` are intentional SQLite 0/1 boolean coercions.
  eqeqeq: 'off',
  // These autofixes break public-asset and /index path resolution.
  'import-x/no-useless-path-segments': 'off',
  'import-x/no-absolute-path': 'off',

  // Minor / intentional-pattern rules.
  'no-promise-executor-return': 'off',
  'no-return-assign': 'off',
  '@typescript-eslint/no-loop-func': 'off',
  'no-new': 'off',

  // --- Airbnb preference rules relaxed for a modern TS codebase ---
  'no-shadow': 'off',
  '@typescript-eslint/no-shadow': 'off',
  'no-bitwise': 'off',
  yoda: 'off',
  'no-plusplus': 'off',
  'one-var': 'off',
  'no-underscore-dangle': 'off',
  'no-restricted-syntax': 'off',
  'no-continue': 'off',
  'no-void': 'off',
  'func-names': 'off',
  'no-nested-ternary': 'off',
  'no-multi-assign': 'off',
  'no-param-reassign': 'off',
  'no-use-before-define': 'off',
  '@typescript-eslint/no-use-before-define': 'off',
  'consistent-return': 'off',
  'class-methods-use-this': 'off',
  '@typescript-eslint/class-methods-use-this': 'off',
  'no-unused-expressions': 'off',
  '@typescript-eslint/no-unused-expressions': 'off',
  'prefer-destructuring': 'off',
  'arrow-body-style': 'off',
  'prefer-arrow-callback': 'off',
  'func-style': 'off',

  // Import rules that conflict with our setup (named exports, TS path/extensions).
  'import-x/extensions': 'off',
  'import-x/prefer-default-export': 'off',
  'import-x/no-extraneous-dependencies': 'off',
  'import-x/no-unresolved': 'off',
  'import-x/no-named-as-default': 'off',
  'import-x/no-rename-default': 'off',

  // Type-aware rules that need full type info / are high-churn.
  '@typescript-eslint/return-await': 'off',
  '@typescript-eslint/no-unnecessary-type-assertion': 'off',

  // Preference rules relaxed (style, not correctness).
  'no-await-in-loop': 'off',
  '@typescript-eslint/naming-convention': 'off',
  'no-restricted-globals': 'off',
  '@typescript-eslint/no-unsafe-enum-comparison': 'off',
  radix: 'off',
  'default-case': 'off',
  'no-restricted-exports': 'off',
  'max-classes-per-file': 'off',
  'no-lonely-if': 'off',
  'no-alert': 'off',
  // We deliberately use bracket access to reach private members in a few places.
  'dot-notation': 'off',
  '@typescript-eslint/dot-notation': 'off',
  // interface↔type flips break Record/index-signature assignability.
  '@typescript-eslint/consistent-type-definitions': 'off',
  'no-useless-return': 'off',
};

// Type-aware correctness rules — TS sources only (needs type info, so plain
// .js/.mjs files and anything outside a tsconfig project must not match).
// `testOverride` below still switches typed linting off for test files.
export const typeAwareRules = {
  files: ['**/*.{ts,tsx}'],
  rules: {
    // Unhandled promise rejections vanish silently; make fire-and-forget
    // explicit with the `void` operator (no-void is off for this reason).
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
  },
};

// Test files often live outside the build tsconfig (e.g. node-tests/), so
// type-aware parsing (Airbnb enables `projectService`) can't resolve them.
// Drop type-checked linting + project requirement for tests — they keep
// syntactic linting but don't need full type info.
export const testOverride = {
  files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**', 'node-tests/**'],
  languageOptions: {
    parserOptions: { projectService: false, project: false },
  },
  rules: {
    ...tseslint.configs.disableTypeChecked.rules,
    // Test mocks/stubs routinely use empty + pass-through constructors.
    'no-empty-function': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    'no-useless-constructor': 'off',
    '@typescript-eslint/no-useless-constructor': 'off',
  },
};

// Universal naming enforcement: kebab-case folders (catches snake_case/typo
// drift like the old `account_managment`) and camelCase hook files (`useFoo.ts`).
// Component (.tsx PascalCase) and shadcn/ui exceptions are layered on in the app.
export const namingConventions = {
  files: ['**/*.{ts,tsx,js,mjs,cjs}'],
  ignores: ['**/__tests__/**', '**/__fixtures__/**'],
  plugins: {
    'check-file': checkFile,
  },
  rules: {
    'check-file/filename-naming-convention': [
      'error',
      // Real hooks only (`useFoo`) — not `user-*` files, and not shadcn's
      // kebab-case `use-mobile` / `use-toast` helpers in shared/hooks.
      { '**/use[A-Z]*.{ts,tsx}': 'CAMEL_CASE' },
      { ignoreMiddleExtensions: true },
    ],
    'check-file/folder-naming-convention': [
      'error',
      { 'src/**/': 'KEBAB_CASE' },
    ],
  },
};

export default [
  ...airbnbBase,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: baseRules,
  },
  typeAwareRules,
  namingConventions,
  testOverride,
];
