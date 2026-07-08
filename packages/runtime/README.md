# `@budgero/runtime`

Local-first runtime for Budgero. Owns everything between the UI and the wire: space
lifecycle, mutation execution (with undo/redo and history), the WebSocket sync transport,
offline queueing, snapshot upload/download, and client-side encryption.

> Part of the Budgero monorepo. **Source-available** under [FSL-1.1-ALv2](../../LICENSE).

## Architecture

```
src/
├── coordinator/       # RuntimeCoordinator: space activation, lifecycle, dispatch
├── mutation-executor/ # Executes ops, records undo/history, invalidates queries
├── sync-transport/    # WebSocket transport: catch-up, reconnect, format gating
├── database-sync/     # Encrypted snapshot upload/download
├── offline-queue/     # Mutations queued while offline
├── crypto/            # AES-GCM mutation/blob encryption
└── sync-format.ts     # Wire-format versioning (see docs/data-format-versioning.md)
```

The app consumes this package through `AppRuntime`, a thin wrapper that adds app-level
services. All side effects (op execution, query invalidation, history) are injected as
callbacks, so the runtime has no dependency on React or the op registry.

## Develop

```bash
pnpm --filter @budgero/runtime build   # tsc -> dist/
pnpm --filter @budgero/runtime dev     # tsc --watch
pnpm --filter @budgero/runtime test    # vitest run
```
