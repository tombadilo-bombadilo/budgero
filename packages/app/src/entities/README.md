# `entities/` — FSD layer

Business **nouns** — one folder per domain entity (account, transaction, budget,
category, goal, payee, label, currency, recurring, report, rule, user, warranty).
Each holds the entity's `model/` (types), `ui/` (pure display components), and
`api/` (data access).

- **Alias:** `@entities/*`
- **May import from:** `shared`.
- **Imported by:** `features`, `widgets`, `pages`, `app`.

Much domain logic already lives in `@budgero/core`; the app side here is the
`api/*` data access + entity display components.
See [Feature-Sliced Design](https://feature-sliced.design/).
