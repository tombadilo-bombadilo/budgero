import { MasterPasswordManager } from '@shared/lib/crypto';

import type { QueryClient } from '@tanstack/react-query';

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

/**
 * Clears all cookies from the browser.
 */
function clearCookies(): void {
  try {
    if (typeof document === 'undefined') return;
    const cookieEntries = document.cookie ? document.cookie.split(';') : [];
    if (!cookieEntries.length) return;

    const expires = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const domains = new Set<string>();
    const paths = ['/'];

    if (hostname) {
      domains.add(hostname);
      const parts = hostname.split('.').filter(Boolean);
      for (let i = 0; i < parts.length - 1; i += 1) {
        const domain = parts.slice(i).join('.');
        domains.add(domain);
        domains.add(`.${domain}`);
      }
    }

    try {
      if (typeof window !== 'undefined') {
        const segments = window.location.pathname.split('/').filter(Boolean);
        let currentPath = '';
        segments.forEach((segment) => {
          currentPath += `/${segment}`;
          paths.push(currentPath);
        });
      }
    } catch {
      /* no-op: path extraction best effort */
    }

    cookieEntries.forEach((cookie) => {
      const separatorIndex = cookie.indexOf('=');
      const name = (separatorIndex > -1 ? cookie.slice(0, separatorIndex) : cookie).trim();
      if (!name) return;
      paths.forEach((path) => {
        document.cookie = `${name}=; ${expires}; path=${path}`;
        domains.forEach((domain) => {
          document.cookie = `${name}=; ${expires}; path=${path}; domain=${domain}`;
        });
      });
    });
  } catch (cookieError) {
    console.warn('[ServiceGuard] Failed to clear cookies during reset', cookieError);
  }
}

/**
 * Clears localStorage and sessionStorage.
 */
function clearWebStorage(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  } catch (localError) {
    console.warn('[ServiceGuard] Failed to clear localStorage during reset', localError);
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch (sessionError) {
    console.warn('[ServiceGuard] Failed to clear sessionStorage during reset', sessionError);
  }
}

/**
 * Clears OPFS (Origin Private File System) storage.
 */
async function clearOpfsStorage(): Promise<void> {
  try {
    const nav = navigator as unknown as NavigatorWithStorage;
    if (!nav.storage?.getDirectory) return;
    const root = await nav.storage.getDirectory();
    if (root?.values) {
      for await (const entry of root.values()) {
        await root.removeEntry(entry.name, { recursive: true });
      }
    } else if (root?.entries) {
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true });
      }
    }
  } catch (opfsError) {
    console.warn('[ServiceGuard] Failed to clear OPFS storage', opfsError);
  }
}

/**
 * Resets all local state including password, storage, and runtime.
 */
async function resetLocalState(
  runtime: { destroy: () => void },
  queryClient: QueryClient
): Promise<void> {
  MasterPasswordManager.clear();

  clearWebStorage();
  clearCookies();

  await clearOpfsStorage();

  try {
    runtime.destroy();
  } catch (destroyError) {
    console.warn('[ServiceGuard] Failed to destroy runtime during reset', destroyError);
  }

  try {
    await queryClient.cancelQueries();
    queryClient.clear();
  } catch (queryError) {
    console.warn('[ServiceGuard] Failed to clear query cache during reset', queryError);
  }

  window.setTimeout(() => {
    window.location.reload();
  }, 100);
}

/**
 * Handles the full account reset process including server-side cleanup.
 */
export async function handleAccountReset(
  runtime: { destroy: () => void },
  queryClient: QueryClient
): Promise<void> {
  const { authApi, pushApi } = await import('@shared/api/api-client');
  await authApi.resetMasterPassword();

  // Best-effort server cleanup: revoke Push API token and clear push queue/messages
  try {
    await pushApi.clearQueue({ all: true });
  } catch (err) {
    console.warn('[ServiceGuard] Failed to clear push queue during reset', err);
  }
  try {
    await pushApi.revokeToken();
  } catch (err) {
    console.warn('[ServiceGuard] Failed to revoke push API token during reset', err);
  }

  await resetLocalState(runtime, queryClient);
}
