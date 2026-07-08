# Budgero

Budgero is a local-first personal budgeting application: envelope-style budgets,
transaction tracking, goals, recurring payments, rules, multi-currency support, and
financial analytics. Data lives in SQLite on the client (browser, via WASM) and syncs
end-to-end encrypted through a Go backend.

This repository is a **read-only public mirror** of Budgero's internal repository.
Contributions are not accepted at this time — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Budgero is **source-available**, not OSI open source. It is licensed under the
[Functional Source License, v1.1, Apache 2.0 future](LICENSE) (`FSL-1.1-Apache-2.0`):

- You may read, modify, run, and self-host the software.
- You may not offer it as a competing commercial or hosted service.
- Each release converts to Apache 2.0 two years after publication.

Version 1.5.0 marks the beginning of the source-available era.

## Repository layout

| Package | Description |
|---|---|
| `packages/app` | React frontend (Vite, TailwindCSS, PWA) |
| `packages/core` | Shared TypeScript domain logic: SQLite schema, migrations, services |
| `packages/runtime` | Local-first runtime: sync transport, mutation execution, encryption |
| `packages/server` | Go API server (Echo, SQLite) |
| `packages/website` | Marketing and documentation site (Next.js) |
| `packages/sdk-python` | Python SDK for the Push API |
| `packages/eslint-config` | Shared ESLint configuration |

Each package has its own README with details.

## Builds

Budgero ships in exactly two flavors:

- **Cloud (SaaS)** — the hosted service at [budgero.app](https://budgero.app), built
  with `app.Dockerfile` (Clerk authentication, subscriptions).
- **Self-host** — a single binary with the frontend embedded, or a Docker image built
  with `selfhost.Dockerfile` (local authentication, no cloud dependencies). See
  [docs/selfhost-cli.md](docs/selfhost-cli.md).

## Development setup

Prerequisites: Node.js 22+, pnpm 11+, Go 1.26+.

```bash
pnpm install
pnpm run setup:dev        # one-time setup (package builds, Air for Go hot-reload)

pnpm run dev:selfhost     # frontend + Go backend in self-host mode
pnpm run dev:website      # marketing site (port 3000)
```

The app is served at `http://localhost:5173`, the API at `http://localhost:3001`.

Self-host mode is the flavor that works out of the box. The cloud (SaaS) flavor
(`pnpm run dev:cloud`) requires a Clerk development instance of your own —
set `VITE_CLERK_PUBLISHABLE_KEY` in `packages/app/.env.local`.

## Quality gates

```bash
pnpm run type-check:all   # tsc across core, runtime, app
pnpm run lint:app         # eslint (also :core, :runtime, :server)
pnpm run test:core        # domain logic tests (also test:app, test:server)
pnpm run build:all        # full production build
pnpm run security         # osv-scanner + govulncheck
```

## Documentation

| Document | Topic |
|---|---|
| [docs/selfhost-cli.md](docs/selfhost-cli.md) | Self-host CLI reference |
| [docs/build-flags.md](docs/build-flags.md) | Build and runtime flags |
| [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md) | Code conventions |
| [docs/data-format-versioning.md](docs/data-format-versioning.md) | Sync wire-format versioning |

## Support

- Bug reports: GitHub issues
- Security vulnerabilities: see [SECURITY.md](SECURITY.md)
- Website: [budgero.app](https://budgero.app)
- Email: hello@budgero.app
