import { useCallback, useState } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { userScope, useSyncedState } from '@shared/lib/synced-state';
import {
  parseTransactionSort,
  sameTransactionSort,
  type TransactionSortState,
} from '@features/transactions/lib/transaction-sort';

/**
 * Synced state key (user scope): one entry per register, `account:<id>` or
 * `all:<budgetId>`, holding `{ column, direction }`. The default order has
 * no entry. Merged entry by entry, so sorting two registers on two devices
 * keeps both.
 */
export const TRANSACTION_SORT_KEY = 'transactionSort';

type StoredSorts = Record<string, unknown>;

/**
 * The register's sort, remembered per register for the signed-in user and
 * synced to their other devices (synced state). A change shows at once; it is
 * kept for the visit when the write is refused (demo, signed out).
 */
export function useTransactionSort(registerKey: string) {
  const { data: profile } = useProfile();
  const userId = profile?.id ?? null;
  const synced = useSyncedState<StoredSorts>(
    userId ? userScope(userId) : null,
    TRANSACTION_SORT_KEY,
    { cache: true }
  );
  const stored = parseTransactionSort(synced.value?.[registerKey]);

  // A change shows until the store moves off what it held when the change was
  // made (our write landed, or another device's); refused writes keep it.
  const [edit, setEdit] = useState<{
    key: string;
    base: TransactionSortState;
    sort: TransactionSortState;
  } | null>(null);
  const local = edit?.key === registerKey && sameTransactionSort(edit.base, stored) ? edit : null;
  const sort = local ? local.sort : stored;

  const { merge, canWrite } = synced;
  const setSort = useCallback(
    (next: TransactionSortState) => {
      setEdit({ key: registerKey, base: stored, sort: next });
      if (!canWrite) return;
      void merge(next ? { set: { [registerKey]: next } } : { remove: [registerKey] }).catch(() => {
        /* the change stays for this visit */
      });
    },
    [registerKey, stored, merge, canWrite]
  );

  return { sort, setSort };
}
