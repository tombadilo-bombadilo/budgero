# Budgero style guide

Conventions for code across the monorepo. Most are **enforced by ESLint**; the rest are
documented expectations. When in doubt, match the surrounding code.

> Tooling lives in **`@budgero/eslint-config`** (`packages/eslint-config`) — one shared base.
> Formatting is owned entirely by **Prettier** (`.prettierrc.json`); ESLint never argues about
> whitespace.

| Legend | Meaning |
|---|---|
| 🔒 | Enforced by lint (CI fails) |
| 📝 | Convention (not auto-enforced) |

## Linting

One source of truth, three entry points:

| Export | Used by | Ruleset |
|---|---|---|
| `@budgero/eslint-config/base` | `core`, `runtime` | Airbnb base + TypeScript + project relaxations |
| `@budgero/eslint-config/react` | `app` | base + Airbnb React / jsx-a11y / react-hooks |
| `@budgero/eslint-config/prettier` | all | `eslint-config-prettier` (spread **last**) |

Each package's `eslint.config.js` spreads the shared config, then adds only package-specific
bits (the app adds the FSD `boundaries` guard + Vite/React-Compiler plugins). Run:

```bash
pnpm run lint:core   # also :runtime, :app, :server  (zero warnings)
```

## Architecture — Feature-Sliced Design

`packages/app` follows [FSD](https://feature-sliced.design/). Layers, high → low:

```
app → pages → widgets → features → entities → shared
```

A layer may import **only from layers below it** (enforced by `boundaries/dependencies`).
Within a slice, the standard segments are `ui/`, `api/`, `model/`, `lib/` — add a segment only
when there's something to put in it (don't create empty `model/` dirs).

**Business logic belongs in `@budgero/core`**, not the app. The app adds state (React Query
hooks), UI, and wiring on top of core's services. Parsing, calculations, and domain rules go in
core so they're isomorphic and unit-tested.

## Naming

### Folders 🔒 — `kebab-case`

`budget-planning/`, `command-palette/`, `op-code-registry/`. Never `snake_case` or `PascalCase`.
(`__tests__/` and `__fixtures__/` are exempt.)

### Files

| Kind | Convention | |
|---|---|---|
| React hooks | `useThing.ts` — **camelCase** | 🔒 (`use[A-Z]*`) |
| React components | `ThingCard.tsx` — **PascalCase** | 📝 |
| Modules / utils / services | **kebab-case** (`account-calcs.ts`, `pdf-table.ts`) or **camelCase** for a single concept/type module (`types.ts`, `useless.ts`) | 📝 — never `snake_case`/`PascalCase` |
| Tests | co-located `Thing.test.ts` / core `thing.node.spec.ts` | 📝 |

Documented exceptions to PascalCase components: framework entry/config files
(`main.tsx`, `router.tsx`, `screens.tsx`) and **shadcn/ui primitives** in `src/shared/ui/`
(`button.tsx`, `dialog.tsx`) keep their lowercase/kebab names. shadcn's `use-mobile` /
`use-toast` hooks in `src/shared/hooks/` likewise keep kebab names.

### Symbols 📝

- `PascalCase` — components, types/interfaces, classes, enums.
- `camelCase` — functions, variables, hooks.
- `UPPER_SNAKE_CASE` — module-level constants.
- No Hungarian prefixes; no `I`-prefixed interfaces.

## Logging 🔒

Libraries (`core`, `runtime`) must not write to stdout — `no-console: error`. Route diagnostics
through the package logger (`core/src/logger.ts`, `runtime/src/logging`), which is silent by
default (`DEBUG=budgero:*`). `console.warn` / `console.error` are allowed for genuine surfacing
problems. The **app** may use `console` freely (it's the top-level binary, not a library).

## TypeScript & comments 📝

- Prefer `T[]` over `Array<T>` (🔒), `import type` for type-only imports, and explicit return
  types on exported functions where it aids readers.
- Default to **no comments**. Add one only when the *why* is non-obvious (a constraint, a
  workaround, a surprising invariant). Don't narrate *what* the code does.

## Tests

- **core** — `node-tests/**/*.node.spec.ts` (Node + sql.js), plus co-located `src/**/__tests__`.
- **app / runtime** — co-located `*.test.ts(x)` (vitest, jsdom for the app).
- Type-aware linting is disabled for test files (they live outside the build tsconfig).
- No end-to-end suite by design — the unit/integration suites + type-check + build are the
  regression net.
