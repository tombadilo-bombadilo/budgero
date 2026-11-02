import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { useDuplicateTransactions } from '@entities/transaction/api/useTransactions';
import { generateTransferId } from '@features/transactions/ui/add-transaction/add-transaction.utils';
import { isTypingTarget } from './useClearedShortcut';

/** Shift + this key duplicates the selected register rows. */
export const DUPLICATE_SHORTCUT_KEY = 'D';

type DuplicateSource = Pick<GetTransactionsByAccountRow, 'ID' | 'TransferID' | 'IsProjected'>;

/** Duplicates the given rows as new uncleared transactions, with a toast. */
export function useDuplicateSelected() {
  const { t } = useLingui();
  const duplicate = useDuplicateTransactions();
  const errorMessage = t`Could not duplicate transactions`;

  const run = useCallback(
    (rows: DuplicateSource[]) => {
      const sources = rows.filter((row) => !row.IsProjected && row.ID > 0);
      if (!sources.length || duplicate.isPending) return false;
      const transferIds: Record<string, string> = {};
      for (const row of sources) {
        const transferId = row.TransferID?.trim();
        if (transferId && !transferIds[transferId]) transferIds[transferId] = generateTransferId();
      }
      duplicate.mutate(
        { ids: sources.map((row) => row.ID), transferIds },
        {
          onSuccess: () =>
            toast.success(
              plural(sources.length, {
                one: '# transaction duplicated',
                other: '# transactions duplicated',
              })
            ),
          onError: () => toast.error(errorMessage),
        }
      );
      return true;
    },
    [duplicate, errorMessage]
  );

  return { duplicateRows: run, isPending: duplicate.isPending };
}

/** Shift+D with rows selected duplicates them. */
export function useDuplicateShortcut(selectedRowIds: number[], rows: DuplicateSource[]) {
  const { duplicateRows } = useDuplicateSelected();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key?.toUpperCase() !== DUPLICATE_SHORTCUT_KEY || !event.shiftKey) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;

      const selected = new Set(selectedRowIds);
      if (duplicateRows(rows.filter((row) => selected.has(row.ID)))) event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedRowIds, rows, duplicateRows]);
}
