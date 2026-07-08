import { useUpdateTransactionColumn } from '@entities/transaction/api/useTransactions';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';

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

  if (columnId === 'Inflow' || columnId === 'Outflow') {
    const value = Number(newVal ?? 0);
    const patch: Record<string, string | number | Date | null> = {};
    const dbColumn: DbTransactionColumn =
      display === 'budget' ? columnId : (`${columnId}Original` as DbTransactionColumn);

    if (display === 'budget') {
      patch[columnId] = newVal;
    } else {
      patch[`${columnId}Original` as DbTransactionColumn] = newVal;
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

export function useTransactionCellCommit() {
  const updateColumn = useUpdateTransactionColumn();

  function mutate(
    transactionId: number,
    columnId: DbTransactionColumn,
    newVal: string | number | Date | null,
    options: CellCommitOptions
  ): Record<string, string | number | Date | null> | null {
    const result = computeCellCommit(columnId, newVal, options);
    if (!result) return null;

    updateColumn.mutate({
      transactionId,
      column: result.column,
      value: result.value,
      accountId: result.accountId,
      skipInvalidate: options.skipInvalidate,
    });

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
