import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isAppUsable, markAppUsable } from '@shared/lib/analytics/startup-timing';

/** Queries must stay idle this long, so a query that starts after another finished still counts. */
const QUIET_MS = 50;
/** Stop waiting for queries after this; the time so far is what gets reported. */
const MAX_WAIT_MS = 30_000;

/**
 * Mounts with the first page in the app shell, i.e. once its lazy chunk has
 * loaded (it sits in the same Suspense boundary). The app counts as usable
 * when that page's first queries have finished: the moment no query is
 * fetching, confirmed after a short quiet window (startup-timing.ts).
 */
export function UsableMarker() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isAppUsable()) return;
    let idleSince: number | null = null;
    let confirmTimer: number | undefined;
    const finish = (at?: number) => {
      stop();
      markAppUsable(at);
    };
    const check = () => {
      if (queryClient.isFetching() > 0) {
        idleSince = null;
        window.clearTimeout(confirmTimer);
        confirmTimer = undefined;
        return;
      }
      if (idleSince !== null) return;
      idleSince = performance.now();
      confirmTimer = window.setTimeout(() => {
        if (idleSince !== null && queryClient.isFetching() === 0) finish(idleSince);
      }, QUIET_MS);
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(check);
    // Effects run before the page's queries are observed; check once they have started.
    const firstCheck = window.setTimeout(check, 0);
    const capTimer = window.setTimeout(() => finish(), MAX_WAIT_MS);
    function stop() {
      unsubscribe();
      window.clearTimeout(firstCheck);
      window.clearTimeout(confirmTimer);
      window.clearTimeout(capTimer);
    }
    return stop;
  }, [queryClient]);

  return null;
}
