import { useCallback, useState } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import { userScope, useSyncedState } from '@shared/lib/synced-state';
import { LEDGER_COLUMNS_KEY, parseLedgerColumns, type LedgerColumns } from './ledger-columns';

/**
 * The Ledger's summary column settings for this user, synced across devices
 * (device cache until the database is read). Each change merges just its own
 * field, so two devices changing different fields both keep theirs. Where
 * nothing can be written (the demo, before the database is read) changes
 * apply for the visit only.
 */
export function useLedgerColumns() {
  const profile = useProfile();
  const userId = profile.data?.id ?? null;
  const synced = useSyncedState<Partial<LedgerColumns>>(
    userId ? userScope(userId) : null,
    LEDGER_COLUMNS_KEY,
    { cache: true }
  );
  const { merge, canWrite } = synced;
  const [visitOnly, setVisitOnly] = useState<Partial<LedgerColumns>>({});
  const stored = parseLedgerColumns(synced.value);
  const columns = canWrite ? stored : { ...stored, ...visitOnly };

  const update = useCallback(
    (patch: Partial<LedgerColumns>) => {
      if (!canWrite) {
        setVisitOnly((previous) => ({ ...previous, ...patch }));
        return;
      }
      void merge({ set: patch }).catch(() => {
        /* nothing changed; the next change writes again */
      });
    },
    [canWrite, merge]
  );

  return { columns, update };
}
