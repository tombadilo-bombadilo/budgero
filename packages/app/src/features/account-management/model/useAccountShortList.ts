import { useCallback, useMemo } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { userScope, useSyncedState } from '@shared/lib/synced-state';
import {
  ACCOUNT_SHORT_LIST_KEY,
  parseAccountShortList,
  type StoredAccountShortList,
} from './account-short-list';

/**
 * The accounts this user pinned to the collapsed sidebar list. Personal (user
 * scope) and synced through the workspace's encrypted database, so every
 * device shows the same short list; each workspace keeps its own. Pins can't
 * be changed where synced state can't be written (the demo, offline first
 * run): `canEdit` is false there.
 */
export function useAccountShortList() {
  const profile = useProfile();
  const userId = profile.data?.id ?? null;
  const synced = useSyncedState<StoredAccountShortList>(
    userId ? userScope(userId) : null,
    ACCOUNT_SHORT_LIST_KEY,
    { cache: true }
  );
  const pinnedIds = useMemo(() => parseAccountShortList(synced.value), [synced.value]);
  const { merge, canWrite } = synced;

  const togglePinned = useCallback(
    (accountId: number) => {
      if (!canWrite) return;
      const key = String(accountId);
      void merge(pinnedIds.has(accountId) ? { remove: [key] } : { set: { [key]: true } }).catch(
        () => {
          /* nothing changed; the next click tries again */
        }
      );
    },
    [canWrite, merge, pinnedIds]
  );

  return { pinnedIds, canEdit: canWrite, togglePinned };
}
