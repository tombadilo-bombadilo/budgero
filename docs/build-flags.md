# Budgero Build & Runtime Flags

This reference tracks the feature flags and environment toggles that change how Budgero is built or behaves at runtime. Values prefixed with `VITE_` are baked into the frontend bundle at build time, while the Go backend and helper CLIs read from standard environment variables.

---

## Frontend (Vite) flags

### `VITE_SELF_HOSTABLE`
- **Set by**: `scripts/dev-selfhost.mjs`, CI when building the standalone binary.
- **Consumed via**: `IS_SELF_HOSTABLE_BUILD` (`packages/app/src/shared/lib/env.ts`).
- **Key usages**:
  - Auth flow uses self-host auth instead of Clerk (`packages/app/src/app/AdminAuthGuard.tsx`, `packages/app/src/app/router.tsx`).
  - Navigation hides SaaS-only routes (account/subscription) (`packages/app/src/app/layout/desktop-shell/DesktopShell.tsx`, `packages/app/src/widgets/navigation/MobileBottomNav.tsx`).
  - Connectivity probes skip Clerk token checks (`packages/app/src/shared/runtime/connectivity-service.ts`).
  - Workspace gate and settings unlock all features without subscription prompts (`packages/app/src/pages/settings/WorkspaceSettingsPage.tsx`).
  - OPFS filenames receive a `_self_host` suffix and server snapshots are always attempted before falling back to cached data (`packages/app/src/shared/runtime/app-runtime.ts`).
- **Purpose**: Removes SaaS-specific UX (subscriptions, Clerk auth) so the same frontend can be bundled with the self-host API.

### `VITE_API_BASE_URL`
- **Set by**: `.env.local`, deployment configs.
- **Key usages**: HTTP clients and health checks target this base (`packages/app/src/shared/api/api-client.ts`, `packages/app/src/shared/hooks/useApiClient.ts`, `packages/app/src/shared/api/health.ts`).
- **Purpose**: Points the SPA at the desired Budgero API (local dev, staging, production, etc.).

### `VITE_CLERK_PUBLISHABLE_KEY`
- **Key usage**: Injected into ClerkProvider inside `packages/app/src/main.tsx`.
- **Purpose**: Enables Clerk authentication for SaaS builds; absent for self-host/core flavors.

### `VITE_E2E_SKIP_SERVER`
- **Set by**: Playwright fixtures or localStorage key `budgero_e2e_skip_server`.
- **Key usages**:
  - `AppRuntime` can skip snapshot downloads to keep tests deterministic (`packages/app/src/shared/runtime/app-runtime.ts`).
  - Snapshot uploads are suppressed when also paired with `VITE_E2E_DISABLE_UPLOAD`.
- **Purpose**: Makes browser E2E tests run without depending on live API responses.

### `VITE_E2E_DISABLE_UPLOAD`
- **Key usage**: Stops snapshot-store from writing blobs back to the server during tests (`packages/app/src/shared/runtime/`).
- **Purpose**: Keeps shared QA tenants clean.

### Other Vite flags
- `VITE_API_URL` / `VITE_APP_ENV` / `VITE_WEBAUTHN_API_BASE_URL`: documented in `packages/app/README.md` for completeness, but the SPA currently relies on `VITE_API_BASE_URL`. Keep them in sync if you introduce alternative tooling.

---

## Backend & CLI flags

### `SELF_HOSTABLE`
- **Set by**:
  - `scripts/dev-selfhost.mjs` before spawning the Go server.
  - `packages/server/cmd/shared/server.go:29` forces it to `"true"` when the `budgero` binary is used.
- **Key usages**:
  - Hides SaaS settings in admin handlers and auth middleware (`packages/server/internal/adapter/driving/http/handler/admin.go`).
  - Enables local JWT issuance (`packages/server/internal/adapter/driving/http/middleware/selfhost_jwt.go`).
  - Frontend expects this flag to be mirrored as `VITE_SELF_HOSTABLE`.
  - Points the SQLite database at `data/budgero_self_host.db` unless `DB_PATH` overrides the location.
- **Purpose**: Enables all self-host overrides on the API tier (no Lemon Squeezy, no Clerk validation, local JWT tokens, etc.).

### `SELF_HOST_JWT_SECRET` / `SELF_HOST_JWT_TTL_HOURS`
- **Key usages**: `packages/server/internal/adapter/driving/http/middleware/selfhost_jwt.go` reads/generates the signing secret and TTL for locally issued tokens. When unset, the CLI now generates a random value and exports it to the process env.
- **Purpose**: Required for self-host auth to exchange passwords for JWTs without Clerk.

### `SELFHOST_CLI_STATE_PATH`
- **Key usage**: Overrides where `budgero daemon` stores its process registry (`packages/server/cmd/selfhost/daemon.go`).
- **Purpose**: Lets operators relocate daemon metadata (e.g., when running under systemd).

### `OFFLINE_ECDSA_PRIV_PEM` / `OFFLINE_ENTITLEMENT_DEV`
- **Set by**: `packages/server/dev.js` before starting `air`.
- **Purpose**: Provision a development-only ES256 signing key and entitlement bypass so the app can test offline unlock flows without production credentials.

### Other notable server envs
- Subscription & payment (`LEMONSQUEEZY_*`), newsletter (`MAILERLITE_*`), Clerk (`CLERK_SECRET_KEY`), and URL/port (`APP_URL`, `PORT`) variables are documented in `packages/server/README.md`. While not "flags" in the feature-toggle sense, they gate integrations and should be considered when packaging alternative flavors.

---

## Mapping build scripts to flags

| Script | What it sets | Notes |
| --- | --- | --- |
| `pnpm run dev:cloud` | None (SaaS defaults) | Runs Clerk + SaaS backend locally (Vite bound to 0.0.0.0 for LAN/phone testing). |
| `pnpm run dev:selfhost` | `SELF_HOSTABLE`, `VITE_SELF_HOSTABLE`, `SELF_HOST_JWT_SECRET` | Starts the Go server in self-host mode plus Vite without Clerk; mirrors production self-host mode. |

When introducing a new flavor, ensure the frontend `VITE_*` flag and backend env var stay in sync. For example, self-host builds rely on both `VITE_SELF_HOSTABLE` (to change the UI/router) and `SELF_HOSTABLE` (to make the API issue local JWTs). Splitting them leads to master-password failures or stale OPFS data, as the runtime now stores per-flag OPFS files with a suffix (`packages/app/src/shared/runtime/app-runtime.ts`).

---

## Tips for adding new flags

1. **Define platform constants in one place.** Follow the `IS_SELF_HOSTABLE_BUILD` pattern (`packages/app/src/shared/lib/env.ts`) so components import a single boolean rather than re-reading `import.meta.env`.
2. **Plumb through dev scripts.** Update `scripts/dev-*.mjs` and relevant `package.json` scripts so contributors get the right experience without extra exports.
3. **Document the backend counterpart.** If the frontend flag expects different API responses, ensure the Go server reads a matching env var (or sets one automatically like `cmd/shared/server.go` does).
4. **Name OPFS artifacts per flavor.** Re-use `getSpaceDatabasePath` and the `_sas`/`_self_host` suffixing so cached data never bleeds between builds.

Keeping these flags in sync prevents subtle issues (wrong auth guard, stale OPFS cache, duplicate Air processes). Refer back to this document whenever you add a new flavor or troubleshoot why a build behaves differently.
