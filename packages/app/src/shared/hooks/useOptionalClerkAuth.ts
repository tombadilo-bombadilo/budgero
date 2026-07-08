import { useAuth as useClerkAuth } from '@clerk/clerk-react';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

export type ClerkAuth = ReturnType<typeof useClerkAuth> | null;

// Only safe to call when a ClerkProvider is present (SaaS builds).
function useClerkAuthValue(): ClerkAuth {
  return useClerkAuth();
}

// Self-host / core builds have no ClerkProvider.
function useNullClerkAuth(): ClerkAuth {
  return null;
}

/**
 * Clerk auth when a ClerkProvider is present (SaaS builds), null otherwise.
 *
 * IS_SELF_HOSTABLE_BUILD is a build-time constant, so the implementation is
 * chosen once at module load — neither variant calls a hook conditionally
 * (Rules of Hooks safe).
 */
export const useOptionalClerkAuth: () => ClerkAuth = IS_SELF_HOSTABLE_BUILD
  ? useNullClerkAuth
  : useClerkAuthValue;
