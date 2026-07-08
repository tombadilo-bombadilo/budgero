# `@budgero/app`

React 19 frontend for Budgero — a progressive web app built with Vite, TailwindCSS, and shadcn/ui.

> Part of the Budgero monorepo. **Source-available** under [FSL-1.1-ALv2](../../LICENSE).

## Architecture

The app follows [Feature-Sliced Design (FSD)](https://feature-sliced.design/):

```
src/
├── app/           # App entry, routing, startup orchestration
├── pages/         # Page components (route-level)
├── widgets/       # Composite components (dashboard cards, navigation, etc.)
├── features/      # Domain features (budget-planning, transactions, rules, etc.)
├── entities/      # Business entities (budget, account, category, etc.)
└── shared/        # Reusable infra (UI kit, hooks, utils, runtime, api clients)
```

Layer import rule: a layer may only import from layers **below** it (`app → pages → widgets → features → entities → shared`).

## Development

```bash
# From repo root
pnpm run dev:app          # Start Vite dev server (port 5173)
pnpm run dev:selfhost     # Start app + Go backend in self-host mode
pnpm run test:app         # Run tests (vitest)
pnpm run lint:app         # ESLint
pnpm run type-check:app   # TypeScript check
pnpm run build:app        # Production build
```

## Testing

- Unit/integration: `vitest` + `@testing-library/react`
- No end-to-end suite by design — unit tests + type-check + build are the regression net

## Key Tech

| Layer | Stack |
|---|---|
| Framework | React 19 + Vite |
| Styling | TailwindCSS 4 + shadcn/ui |
| State | Zustand (local) + TanStack Query (server) |
| Auth | Clerk (SaaS) / local JWT (self-host) |
| PWA | vite-plugin-pwa, Workbox |
| Charts | Recharts, DuckDB WASM |
