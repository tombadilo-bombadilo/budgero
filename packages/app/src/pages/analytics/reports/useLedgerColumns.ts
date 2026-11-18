import { useCallback, useState } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { userScope, useSyncedState } from '@shared/lib/synced-state';
import { LEDGER_COLUMNS_KEY, parseLedgerColumns, type LedgerColumns } from './ledger-columns';

/**
 * The Ledger's summary column settings for this user, synced across devices
 * (device cache until the database is read). A change shows at once; where it
 * can't be written (the demo) it lasts for the visit.
 */
export function useLedgerColumns() {
  const profile = useProfile();
  const userId = profile.data?.id ?? null;
  const synced = useSyncedState<LedgerColumns>(
    userId ? userScope(userId) : null,
    LEDGER_COLUMNS_KEY,
    { cache: true }
  );
  const [local, setLocal] = useState<LedgerColumns | null>(null);
  const columns = local ?? parseLedgerColumns(synced.value);
  const { set } = synced;

  const update = useCallback(
    (patch: Partial<LedgerColumns>) => {
      const next = { ...columns, ...patch };
      setLocal(next);
      void set(next).catch(() => {
        /* kept for this visit; the next change writes again */
      });
    },
    [columns, set]
  );

  return { columns, update };
}
