import { useEffect, useRef } from 'react';
import { reconcileSyncedPreference, type SyncedPreference } from './synced-preferences';
import { userScope } from './synced-state';
import { useSyncedState } from './useSyncedState';

/** Runs the load step for one preference whenever the open workspace's value is (re)read. */
export function useSyncedPreference<T>(userId: string | null, pref: SyncedPreference<T>): void {
  const state = useSyncedState<unknown>(userId ? userScope(userId) : null, pref.key);
  const { loaded, available, value, canWrite, set } = state;
  // One write in flight at most (effects can run twice before it lands).
  const writing = useRef(false);

  useEffect(() => {
    if (!loaded || !available) return;
    const write = async (next: T) => {
      if (!canWrite || writing.current) return false;
      writing.current = true;
      try {
        return await set(next);
      } finally {
        writing.current = false;
      }
    };
    void reconcileSyncedPreference(pref, { available, value }, write).catch(() => {
      /* the cache stays as it is; the next read tries again */
    });
  }, [loaded, available, value, canWrite, set, pref]);
}
