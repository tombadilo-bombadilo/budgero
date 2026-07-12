import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { resetAnalytics } from '@shared/lib/analytics/analytics';
import {
  PENDING_SPACE_INVITE_DB_NAME,
  PENDING_SPACE_INVITE_KEY,
} from '@features/budget-sharing/lib/pending-space-invite';

/**
 * Component that listens to Clerk auth state changes and performs cleanup on signout
 * This should be placed at the root of your app to ensure it's always active
 */
export function ClerkSignoutHandler() {
  const { isSignedIn, isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();
  const previousSignedInRef = useRef<boolean | null>(null);
  const hasCleanedUp = useRef(false);

  const performCleanup = useCallback(async () => {
    try {
      // De-identify the PostHog session so the next visitor on this device
      // gets a fresh anonymous distinct_id instead of inheriting the previous
      // user's identity. Best-effort and synchronous — runs even if the
      // storage cleanup below throws.
      resetAnalytics();
      // Clear react-query cache first (in-session state)
      queryClient.clear();
      await queryClient.cancelQueries();
      // Then clear persistent storage
      await runStorageCleanup();
    } catch (error) {
      console.error('[ClerkSignoutHandler] Error during cleanup:', error);
      throw error;
    }
  }, [queryClient]);

  // React to auth state changes and trigger cleanup on signout
  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    // Case A: user just signed out in this session (was signed in, now isn't)
    if (previousSignedInRef.current === true && isSignedIn === false && !hasCleanedUp.current) {
      // Mark as cleaned up to prevent multiple executions
      hasCleanedUp.current = true;

      performCleanup().catch((error) => {
        console.error('[ClerkSignoutHandler] ❌ Cleanup failed:', error);
      });
    } else if (previousSignedInRef.current === false && isSignedIn === true) {
      hasCleanedUp.current = false;
    } else if (
      previousSignedInRef.current === null &&
      isLoaded &&
      isSignedIn === false &&
      !hasCleanedUp.current
    ) {
      // Case B: first page load already signed out (common when Clerk redirects after sign out)
      // Run cleanup on initial mount to ensure storage/state is cleared even if redirect happened first

      hasCleanedUp.current = true;
      performCleanup().catch(() => {
        /* cleanup error logged elsewhere */
      });
    }

    previousSignedInRef.current = isSignedIn;
  }, [isSignedIn, isLoaded, userId, performCleanup]);

  // Also listen to storage events as a backup (Clerk modifies localStorage on signout)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Clerk removes its session data from localStorage on signout
      if (e.key && e.key.includes('clerk') && e.newValue === null) {
        // Double-check if we're signed out
        if (!isSignedIn && !hasCleanedUp.current) {
          hasCleanedUp.current = true;
          void performCleanup();
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [isSignedIn, performCleanup]);

  return null;
}

// Type declarations for browser APIs and globals
declare global {
  interface Window {
    __BUDGERO_APP_STORE__?: unknown;
  }
}

/** OPFS FileSystemDirectoryHandle with iteration support */
interface OPFSDirectoryHandle {
  values(): AsyncIterable<{ name: string; kind: string }>;
  entries(): AsyncIterable<[string, unknown]>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** Navigator with optional OPFS storage API */
interface NavigatorWithStorage {
  storage?: {
    getDirectory?(): Promise<OPFSDirectoryHandle>;
  };
}

// The session-only fallback must survive the initial signed-out cleanup. The
// normal cross-tab copy is encrypted in the dedicated invite IndexedDB, which
// is likewise excluded from the database wipe below.
const PRESERVE_KEYS = [PENDING_SPACE_INVITE_KEY];

async function runStorageCleanup() {
  // 1. Clear all local/session storage, preserving the invite-pickup key.
  if (typeof window !== 'undefined') {
    const preserved: Record<string, { local?: string; session?: string }> = {};
    try {
      for (const key of PRESERVE_KEYS) {
        const local = localStorage.getItem(key);
        const session = sessionStorage.getItem(key);
        if (local !== null || session !== null) {
          preserved[key] = { local: local ?? undefined, session: session ?? undefined };
        }
      }
    } catch {
      /* no-op */
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('[runStorageCleanup] Storage clear failed:', e);
    }
    try {
      for (const [key, value] of Object.entries(preserved)) {
        if (value.local !== undefined) localStorage.setItem(key, value.local);
        if (value.session !== undefined) sessionStorage.setItem(key, value.session);
      }
    } catch {
      /* no-op */
    }
  }

  // 2. Clear OPFS
  const nav = navigator as unknown as NavigatorWithStorage;
  if (nav.storage?.getDirectory) {
    try {
      const root = await nav.storage.getDirectory();
      if (root && root.values) {
        for await (const entry of root.values()) {
          await root.removeEntry(entry.name, { recursive: true });
        }
      } else if (root && root.entries) {
        for await (const [name] of root.entries()) {
          await root.removeEntry(name, { recursive: true });
        }
      }
    } catch (e) {
      console.warn('[runStorageCleanup] OPFS clear failed:', e);
    }
  }

  // 3. Clear IndexedDB
  try {
    const databases = indexedDB.databases ? await indexedDB.databases() : [];
    for (const db of databases) {
      if (db?.name && db.name !== PENDING_SPACE_INVITE_DB_NAME) {
        await indexedDB.deleteDatabase(db.name);
      }
    }
  } catch (e) {
    console.warn('[runStorageCleanup] IndexedDB clear failed:', e);
  }

  // 4. Clear caches
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((n) => caches.delete(n)));
  } catch (e) {
    console.warn('[runStorageCleanup] Caches clear failed:', e);
  }

  // 5. Unregister service workers
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch (e) {
    console.warn('[runStorageCleanup] SW unregister failed:', e);
  }

  // 6. Clear app-specific global store
  try {
    if (typeof window !== 'undefined') {
      window.__BUDGERO_APP_STORE__ = undefined;
    }
  } catch (e) {
    console.warn('[runStorageCleanup] App store clear failed:', e);
  }
}
