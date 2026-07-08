import { apiClient, ApiError } from '@shared/api/api-client';

// Re-export the single canonical ApiError so consumers importing from either
// module share one runtime class (cross-module `instanceof` stays correct).
export { ApiError };

/**
 * Returns the shared `ApiClient` singleton. Token resolution is centralized
 * via the global token getter wired app-wide by `ClerkTokenSetup` (SaaS) and
 * `AppContentSelfHost` (self-host) — the client no longer needs to resolve
 * auth per render. Kept as a hook for API stability across the ~6 call sites
 * that already destructure it as `useApiClient()`.
 */
export function useApiClient() {
  return apiClient;
}
