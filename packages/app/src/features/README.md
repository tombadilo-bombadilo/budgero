# `features/` — FSD layer

User **interactions / use-cases** (verbs): add-transaction, import, assign-budget,
share-budget, apply-rules, ai-categorize, reconcile, redeem-invite, manage-labels, …
Each feature owns its components, hooks and a public `index.ts`.

- **Alias:** `@features/*`
- **May import from:** `entities`, `shared`.
- **Imported by:** `widgets`, `pages`, `app`.

See [Feature-Sliced Design](https://feature-sliced.design/).
