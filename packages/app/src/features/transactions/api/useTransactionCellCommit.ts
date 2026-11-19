import { t } from '@lingui/core/macro';
import { toastError } from '@shared/lib/errors';
import { getRuntime } from '@shared/runtime/global';
import { useUpdateTransactionColumn } from '@entities/transaction/api/useTransactions';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';
import {
  columnEditUnlocksReconciled,
  confirmReconciledEdit,
} from '../ui/reconciled-edit/reconciled-edit-confirm';

export interface CellCommitOptions {
  accountId: number;
  transactionCurrencyDisplay?: 'budget' | 'account';
  /** Suppress query invalidation (batch callers invalidate once at the end). */
  skipInvalidate?: boolean;
}

export interface CellCommitResult {
  column: DbTransactionColumn;
  value: string | number | null;
  accountId: number;
  optimisticPatch: Record<string, string | number | Date | null>;
}

function computeCellCommit(
  columnId: DbTransactionColumn,
  newVal: string | number | Date | null,
  options: CellCommitOptions
): CellCommitResult | null {
  const display = options.transactionCurrencyDisplay ?? 'budget';

  if (columnId === 'CategoryID') {
    const value = newVal === null ? 0 : Number(newVal);
    return {
      column: 'CategoryID',
      value,
      accountId: options.accountId,
      optimisticPatch: { CategoryID: value },
    };
  }

  if (columnId === 'AccountID') {
    if (newVal === null) return null;
    const nextAccountId = Number(newVal);
    if (!Number.isFinite(nextAccountId) || nextAccountId <= 0) return null;
    return {
      column: 'AccountID',
      value: nextAccountId,
      accountId: nextAccountId,
      optimisticPatch: { AccountID: nextAccountId },
    };
  }

  if (columnId === 'ExchangeRate') {
    const rate = newVal === null ? null : Number(newVal);
    return {
      column: 'ExchangeRate',
      value: rate !== null && Number.isFinite(rate) ? rate : null,
      accountId: options.accountId,
      optimisticPatch: { ExchangeRate: rate },
    };
  }

  if (columnId === 'Time') {
    // 'HH:MM', or '' to clear it.
    const time = typeof newVal === 'string' ? newVal.trim() : '';
    return {
      column: 'Time',
      value: time,
      accountId: options.accountId,
      optimisticPatch: { Time: time || null },
    };
  }

  if (columnId === 'LabelID') {
    const parsed = newVal === null ? null : typeof newVal === 'number' ? newVal : Number(newVal);
    const nextLabelId = parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    return {
      column: 'LabelID',
      value: nextLabelId,
      accountId: options.accountId,
      optimisticPatch: { LabelID: nextLabelId },
    };
  }

  if (columnId === 'InflowConverted' || columnId === 'OutflowConverted') {
    const value = Number(newVal ?? 0);
    const patch: Record<string, string | number | Date | null> = {};
    const nativeColumn: DbTransactionColumn =
      columnId === 'InflowConverted' ? 'InflowNative' : 'OutflowNative';
    const dbColumn: DbTransactionColumn = display === 'budget' ? columnId : nativeColumn;

    if (display === 'budget') {
      patch[columnId] = newVal;
    } else {
      patch[nativeColumn] = newVal;
    }

    return {
      column: dbColumn,
      value,
      accountId: options.accountId,
      optimisticPatch: patch,
    };
  }

  return {
    column: columnId,
    value: newVal === null ? '' : String(newVal),
    accountId: options.accountId,
    optimisticPatch: { [columnId]: newVal },
  };
}

/** Whether this commit changes a reconciled row's bank amount (so the user is asked first). */
function unlocksReconciled(transactionId: number, result: CellCommitResult): boolean {
  try {
    const services = getRuntime()?.services();
    return columnEditUnlocksReconciled(services, transactionId, result.column, result.value);
  } catch {
    return false; // no runtime yet: nothing to check against
  }
}

export function useTransactionCellCommit() {
  const updateColumn = useUpdateTransactionColumn();

  /**
   * Commit a cell edit. Returns the optimistic patch, or null when nothing is
   * saved yet: an edit that would unlock a reconciled row first asks
   * (confirmReconciledEdit) and is saved only if the user goes ahead.
   */
  function mutate(
    transactionId: number,
    columnId: DbTransactionColumn,
    newVal: string | number | Date | null,
    options: CellCommitOptions
  ): Record<string, string | number | Date | null> | null {
    const result = computeCellCommit(columnId, newVal, options);
    if (!result) return null;

    const save = () =>
      updateColumn.mutate(
        {
          transactionId,
          column: result.column,
          value: result.value,
          accountId: result.accountId,
          skipInvalidate: options.skipInvalidate,
        },
        // A refused move (e.g. into an account a split line transfers to) says why.
        result.column === 'AccountID'
          ? { onError: (error) => toastError(t`Could not move the transaction`, error) }
          : undefined
      );

    if (unlocksReconciled(transactionId, result)) {
      void confirmReconciledEdit('row').then((confirmed) => {
        if (confirmed) save();
      });
      return null;
    }
    save();
    return result.optimisticPatch;
  }

  async function mutateAsync(
    transactionId: number,
    columnId: DbTransactionColumn,
    newVal: string | number | Date | null,
    options: CellCommitOptions
  ): Promise<void> {
    const result = computeCellCommit(columnId, newVal, options);
    if (!result) return;
    if (unlocksReconciled(transactionId, result) && !(await confirmReconciledEdit('row'))) return;

    await updateColumn.mutateAsync({
      transactionId,
      column: result.column,
      value: result.value,
      accountId: result.accountId,
      skipInvalidate: options.skipInvalidate,
    });
  }

  return {
    mutate,
    mutateAsync,
    isPending: updateColumn.isPending,
    pendingId: updateColumn.variables?.transactionId,
  };
}
