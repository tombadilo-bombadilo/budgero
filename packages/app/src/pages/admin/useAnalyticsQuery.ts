import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { toDateInputValue } from './admin-analytics.utils';

/**
 * Shared fetch/date-range machine for the admin analytics sections.
 *
 * Owns the from/to inputs (defaulting to the last `defaultDaysBack` days),
 * the loading/data state, and a one-shot initial load with the mount-time
 * inputs. Subsequent loads happen via the returned `fetchData` (wired to the
 * section's Apply/Refresh button, which reads the live state).
 */
export function useAnalyticsQuery<T, Args extends unknown[]>({
  defaultDaysBack,
  errorMessage,
  initialArgs,
  fetcher,
}: {
  /** Days before today used for the initial "from" value. */
  defaultDaysBack: number;
  /** Logged to the console and shown as a toast when the fetch fails. */
  errorMessage: string;
  /** Extra fetcher args for the initial load (the section's default filters). */
  initialArgs: Args;
  fetcher: (from: string, to: string, ...args: Args) => Promise<T>;
}) {
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - defaultDaysBack);
    return toDateInputValue(d);
  });
  const [to, setTo] = useState<string>(() => toDateInputValue(new Date()));
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  // Callers pass inline closures; track the latest one without destabilizing
  // fetchData (which would re-trigger the initial-load effect).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetchData = useCallback(
    async (f: string, t: string, ...args: Args): Promise<void> => {
      setLoading(true);
      try {
        setData(await fetcherRef.current(f, t, ...args));
      } catch (err) {
        console.error(errorMessage, err);
        toast.error(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [errorMessage]
  );

  // Load once on mount with the initial defaults.
  const initialLoad = useState(() => ({ from, to, args: initialArgs }))[0];
  useEffect(() => {
    void fetchData(initialLoad.from, initialLoad.to, ...initialLoad.args);
  }, [fetchData, initialLoad]);

  return { from, setFrom, to, setTo, data, loading, fetchData };
}
