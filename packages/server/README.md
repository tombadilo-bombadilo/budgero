# `@budgero/server`

Go backend for Budgero — a single binary API server built with Echo, SQLite (modernc), and sqlc.

> Part of the Budgero monorepo. **Source-available** under [FSL-1.1-ALv2](../../LICENSE).

## Architecture

Clean/hexagonal architecture with explicit layer boundaries:

```
internal/
├── adapter/
│   ├── driven/     # External dependencies (SQLite, Clerk, LemonSqueezy, MailerLite)
│   └── driving/    # HTTP handlers, middleware, WebSocket routes
├── application/    # Use cases (services orchestrating domain logic)
├── domain/         # Core business entities and rules
├── pkg/            # Shared utilities (crypto, etc.)
├── port/           # Interfaces (driven repositories, driving handlers)
└── testkit/        # Test fixtures and helpers
```

## Entry Points

| Command | Purpose |
|---|---|
| `./cmd/saas` | SaaS mode (Clerk, subscriptions, cloud features) |
| `./cmd/selfhost` | Self-host mode (local auth, no cloud dependencies) |
| `./cmd/shared` | Shared server bootstrapping |

## Development

```bash
# From repo root
pnpm run dev:server       # Hot reload with Air
cd packages/server && go test ./...   # Run all tests
pnpm run test:server      # From root
cd packages/server && go run ./cmd/saas   # Run SaaS mode
cd packages/server && go run ./cmd/selfhost serve   # Run self-host mode
```

## Database

- **Engine**: SQLite (modernc.org/sqlite) with WAL mode
- **Schema**: Managed via `packages/core` migrations (shared with frontend)
- **Migrations**: Automatic on server startup, append-only and idempotent
- **User DBs**: Isolated per-user SQLite files in `data/user_db/`

## CLI

The self-host binary doubles as a CLI:

```bash
./budgero serve              # Start server
./budgero admin create-user  # Create admin user
./budgero daemon start       # Background daemon mode
./budgero --help             # Full command list
```

See [Self-Host CLI Guide](../../docs/selfhost-cli.md) for full details.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: 3001) |
| `DB_PATH` | No | SQLite path (default: `data/budgero.db`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` |
| `SELF_HOSTABLE` | For self-host | Enables local JWT auth |
| `CLERK_SECRET_KEY` | For SaaS | Clerk API key |
| `LEMONSQUEEZY_*` | For SaaS | Payment processing |
| `CURRENCYLAYER_API_KEY` | No | Multi-currency conversion |

See [Build Flags Reference](../../docs/build-flags.md) for all runtime flags.
