import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { useEffect, useCallback, useRef } from 'react';
import { setGlobalTokenGetter } from '@shared/lib/clerk-token-manager';
import { checkApiHealth } from '@shared/api/health';
import { getConnectivityService } from '@shared/runtime/connectivity-service';

/** Extended Clerk instance with optional internal methods */
interface ClerkWithInternalMethods {
  loadClerkJS?: () => Promise<void>;
  load?: () => Promise<void>;
  reload?: () => Promise<void>;
}

export function ClerkTokenSetup({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();
  const replayingRef = useRef(false);
  const lastReloadAttempt = useRef(0);

  const fetchToken = useCallback(
    async (options?: {
      ensureClerkReady?: boolean;
      forceUserReload?: boolean;
      forceFreshToken?: boolean;
    }) => {
      try {
        const healthy = await checkApiHealth();
        if (!healthy) {
          return null;
        }

        if (options?.ensureClerkReady) {
          const needsReload = !clerk.loaded || clerk.status !== 'ready';
          if (needsReload && Date.now() - lastReloadAttempt.current > 5000) {
            lastReloadAttempt.current = Date.now();
            try {
              const clerkInternal = clerk as unknown as ClerkWithInternalMethods;
              if (typeof clerkInternal?.loadClerkJS === 'function') {
                await clerkInternal.loadClerkJS();
              } else if (typeof clerkInternal.reload === 'function') {
                await clerkInternal.reload();
              } else if (typeof clerkInternal?.load === 'function') {
                await clerkInternal.load();
              }
            } catch (error) {
              console.warn('[ClerkTokenSetup] Clerk load failed', error);
            }
          }
        }

        if (options?.forceUserReload && typeof user?.reload === 'function') {
          try {
            await user.reload();
          } catch (error) {
            console.warn('[ClerkTokenSetup] Failed to reload user', error);
          }
        }

        const token = await getToken({
          template: 'budgero_jwt',
          skipCache: options?.forceFreshToken === true,
        });
        return token ?? null;
      } catch {
        return null;
      }
    },
    [clerk, getToken, user]
  );

  useEffect(() => {
    // Set up the global token getter for non-hook contexts
    // Make it resilient to offline mode - don't let Clerk failures block initialization
    setGlobalTokenGetter(async () => {
      return fetchToken({ ensureClerkReady: false, forceFreshToken: false });
    });
  }, [fetchToken]);

  useEffect(() => {
    const cs = getConnectivityService();
    const off = cs.addListener(async (state) => {
      if (!state.apiReachable || state.clerkToken || replayingRef.current) return;
      replayingRef.current = true;
      try {
        const token = await fetchToken({
          ensureClerkReady: true,
          forceUserReload: true,
          forceFreshToken: true,
        });
        if (token) {
          // Kick the connectivity service to re-evaluate with the fresh token
          cs.refresh();
        }
      } finally {
        replayingRef.current = false;
      }
    });
    return () => off();
  }, [fetchToken]);

  return <>{children}</>;
}
