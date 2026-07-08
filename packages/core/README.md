# `@budgero/core`

Shared TypeScript **domain logic** for Budgero: the SQLite schema + migrations, the SQL-backed
service layer, and the business calculations. It is **isomorphic** — the same code runs on the
server (Node) and in the browser (via `sql.js`/WASM) — so budgeting logic behaves identically
local-first and server-side.

> Part of the Budgero monorepo. **Source-available** under [FSL-1.1-ALv2](../../LICENSE) — not
> OSI "open source". See the root README for the full picture.

## Architecture

```
src/
├── database/          # storage layer
│   ├── interface.ts        # SqlDatabase abstraction (get/all/run/exec)
│   ├── migrations.ts       # ordered, idempotent schema migrations
│   ├── node-sqljs-adapter.ts   # Node adapter (sql.js)
│   └── web-adapter.ts          # browser adapter (sql.js / WASM)
├── services/          # one folder per domain
│   ├── transactions/  budgets/  monthly-budgets/  categories/  accounts/
│   ├── goals/  recurring/  rules/  currency/  analytics/  reports/
│   ├── import/ (CSV/PDF/YNAB)  export/  custom-dashboards/  chat/  ...
│   └── service-manager.ts  # ServiceManager wires a DB into all services
├── types/             # shared domain types
├── logger.ts          # namespaced debug logger (see below)
├── index.ts           # Node entry (public API)
└── browser.ts         # browser entry
```

A consumer obtains a `SqlDatabase` (Node or web adapter), runs migrations, then constructs a
`ServiceManager` to access the typed services (`services.transactions`, `services.budgets`, …).

## Entry points

| Import | Use |
|---|---|
| `@budgero/core` | Node entry (default) |
| `@budgero/core/browser` | browser/WASM entry |
| `@budgero/core/types` | types only |

## Logging

This is a library, so it never writes to stdout unconditionally. Diagnostics go through
[`debug`](https://www.npmjs.com/package/debug) via `src/logger.ts` — **silent by default**,
opt-in with the `DEBUG` env var:

```bash
DEBUG=budgero:core:* node ...           # all core diagnostics
DEBUG=budgero:core:services:currency npm test   # one namespace
```

`console.warn` / `console.error` are reserved for genuine, surfacing problems (enforced by
`no-console` in eslint).

## Develop

```bash
pnpm --filter @budgero/core build       # tsc -> dist/
pnpm --filter @budgero/core test:node   # vitest run
pnpm --filter @budgero/core lint        # eslint
```

Migrations are **append-only and idempotent**: add a new numbered migration; never edit a
shipped one (existing databases have already run it).
