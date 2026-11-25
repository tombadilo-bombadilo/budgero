import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** When the last chunk-failure reload happened (sessionStorage), so a broken chunk can't loop. */
const RELOAD_KEY = 'budgero:chunk-reload-at';
const RELOAD_GAP_MS = 30_000;

/**
 * A route chunk failed to load: almost always a deploy that replaced the
 * chunk under a tab still running the old index.html (no service worker yet,
 * or one that was cleared). A reload picks up the new build. Returns false
 * when a reload already happened moments ago, so the error boundary shows
 * instead of a reload loop (offline with a chunk missing from the cache).
 */
function reloadOnce(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

// Same constraint as React.lazy: page props are checked where the page is used.
export type LazyPage<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  /** Start loading the chunk now (e.g. the first screen, during startup). */
  preload: () => Promise<unknown>;
};

/**
 * React.lazy for a route page, loaded once and shared by preload() and
 * render. A failed load reloads the page once (see reloadOnce); after that
 * the error reaches the route's error boundary.
 */
export function lazyPage<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>
): LazyPage<T> {
  let pending: Promise<{ default: T }> | null = null;
  const loadOnce = () => {
    pending ??= load().catch((error: unknown) => {
      pending = null; // the next attempt fetches again
      throw error;
    });
    return pending;
  };
  const page = lazy(() =>
    loadOnce().catch((error: unknown) => {
      if (reloadOnce()) return new Promise<never>(() => {});
      throw error;
    })
  ) as LazyPage<T>;
  // A failed preload stays quiet: rendering the page tries again.
  page.preload = () => loadOnce().catch(() => undefined);
  return page;
}
