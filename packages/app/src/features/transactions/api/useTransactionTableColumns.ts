import { useCallback, useState } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { userScope, useSyncedState } from '@shared/lib/synced-state';
import {
  parseTransactionTableColumns,
  sameTransactionTableColumns,
  TRANSACTION_TABLE_COLUMNS_KEY,
  type TransactionTableColumns,
} from '@features/transactions/lib/table-columns';

/**
 * The desktop register's column options for the signed-in user, synced to
 * their other devices (synced state, device cache until the database is
 * read). A change shows at once and merges only its own fields; where nothing
 * can be written (demo, signed out) it is kept for the visit.
 */
export function useTransactionTableColumns() {
  const { data: profile } = useProfile();
  const userId = profile?.id ?? null;
  const synced = useSyncedState<Partial<TransactionTableColumns>>(
    userId ? userScope(userId) : null,
    TRANSACTION_TABLE_COLUMNS_KEY,
    { cache: true }
  );
  const stored = parseTransactionTableColumns(synced.value);

  // A change shows until the store moves off what it held when the change was
  // made (our write landed, or another device's); refused writes keep it.
  const [edit, setEdit] = useState<{
    base: TransactionTableColumns;
    columns: TransactionTableColumns;
  } | null>(null);
  const local = edit && sameTransactionTableColumns(edit.base, stored) ? edit : null;
  const columns = local ? local.columns : stored;

  const { merge, canWrite } = synced;
  const update = useCallback(
    (patch: Partial<TransactionTableColumns>) => {
      setEdit({ base: stored, columns: { ...columns, ...patch } });
      if (!canWrite) return;
      void merge({ set: patch }).catch(() => {
        /* the change stays for this visit */
      });
    },
    [stored, columns, merge, canWrite]
  );

  return { columns, update };
}
