import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { TransactionEntry } from '@shared/lib/analytics/events';
// Use runtime services directly instead of db-ops wrappers
import { useActiveSpaceId, useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { applyOpInvalidations, resolveSpaceKey } from '@shared/lib/query-utils';
import { getTodayISO } from '@shared/lib/date-utils';
import type { MilliUnits } from '@shared/lib/currency/milli';
import { requestSchedulingGuide } from '@shared/store/useSchedulingGuideStore';
import { patchPlainAddTransactionCaches } from './plain-add-cache';

// Query invalidation for these mutations is driven centrally by the
// MutationExecutor from each op's declared `invalidates` (see
// op-code-registry/domains/transactions.ts), so it runs identically for local
// and remote mutations. Hooks here only carry genuine UI side effects.

/**
 * Valid column names for transaction updates.
 * Matches the normalization in op-code-registry.ts
 */
export type TransactionColumnName =
  | 'InflowConverted'
  | 'OutflowConverted'
  | 'Memo'
  | 'Date'
  | 'CategoryID'
  | 'LabelID'
  | 'AccountID'
  | 'InflowNative'
  | 'OutflowNative'
  | 'Payee'
  | 'ExchangeRate';

/**
 * Add a new transaction.
 */
export type AddTransactionInput = {
  inflow: number;
  outflow: number;
  accountId: number;
  categoryId: number;
  labelId?: number | null;
  budgetId: number;
  date: string;
  memo: string;
  payee?: string;
  transferId: string;
  /** Account-to-budget rate pinned on creation. */
  exchangeRateOverride?: number | null;
  /** Already seen in the bank. Defaults to uncleared. */
  cleared?: boolean;
  /** Split lines (account currency); the parent and its lines are stored as one op. */
  splits?: AddTransactionSplitLine[];
};

/** One line of a new split transaction: a category or a transfer account. */
export type AddTransactionSplitLine = {
  categoryId: number | null;
  transferAccountId: number | null;
  memo?: string;
  payee?: string;
  inflow: number;
  outflow: number;
};

export type AddTransferLegInput = Omit<AddTransactionInput, 'budgetId' | 'transferId'>;

export type AddTransferInput = {
  budgetId: number;
  transferId: string;
  source: AddTransferLegInput;
  destination: AddTransferLegInput;
};

export type AddTransferResult = {
  sourceId: number;
  destinationId: number;
};

const isPlainAdd = (input: AddTransactionInput) => !input.transferId && !input.splits?.length;

/** `entry` says where the add came from (analytics only). */
export function useAddTransaction(entry: TransactionEntry = 'other') {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();

  return useMutation<number, Error, AddTransactionInput>({
    mutationFn: async (input) => {
      const transactionId = await executeSpaceMutation<number>(runtime, {
        op: 'transactions.add',
        payload: {
          inflow: input.inflow,
          outflow: input.outflow,
          accountId: input.accountId,
          categoryId: input.categoryId,
          labelId: input.labelId ?? null,
          budgetId: input.budgetId,
          date: input.date,
          memo: input.memo,
          payee: input.payee,
          transferId: input.transferId,
          exchangeRateOverride: input.exchangeRateOverride ?? null,
          ...(input.cleared ? { cleared: true } : {}),
          ...(input.splits ? { splits: input.splits } : {}),
        },
        // Plain adds refresh active views in the background so a large account
        // register does not keep the add dialog pending. Preserve the existing
        // awaited invalidation behavior for legacy transfer calls and splits.
        meta: { label: 'useAddTransaction', skipInvalidate: isPlainAdd(input), analytics: entry },
      });

      if (isPlainAdd(input)) {
        try {
          // Read the final joined row after continuous rules have completed, so
          // the cache receives their category/label/account metadata as well.
          const row = runtime
            .services()
            .transactions.getTransactionForAccountRegister(transactionId);
          patchPlainAddTransactionCaches(
            queryClient,
            resolveSpaceKey(spaceId),
            input.budgetId,
            row,
            getTodayISO()
          );
        } catch (error) {
          // A cache failure must never turn a committed database write into a
          // failed form submission. Fall back to the normal bounded refetch.
          console.warn('Failed to patch plain transaction caches', error);
          void queryClient.invalidateQueries({ queryKey: ['transactions'] });
          void queryClient.invalidateQueries({ queryKey: ['accountTransactionPages'] });
          void queryClient.invalidateQueries({ queryKey: ['accountTransactionRange'] });
          void queryClient.invalidateQueries({ queryKey: ['accounts'] });
        }
      }

      return transactionId;
    },
    onSuccess: (_newId, vars) => {
      if (vars.date.slice(0, 10) > getTodayISO()) {
        requestSchedulingGuide('future', resolveSpaceKey(spaceId), vars.budgetId, vars.accountId);
      }
      if (isPlainAdd(vars)) {
        applyOpInvalidations(queryClient, 'transactions.add', {
          excludeRoots: [
            'transactions',
            'accountTransactionPages',
            'accountTransactionRange',
            'accountTransactionSummary',
            'accountBalanceHistory',
            'accounts',
          ],
        });
      }
    },
    onError: (error) => {
      console.error('Transaction failed:', error);
    },
  });
}

/**
 * Add both linked legs of a transfer as one mutation/undo item.
 */
export function useAddTransfer(entry: TransactionEntry = 'other') {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();

  return useMutation<AddTransferResult, Error, AddTransferInput>({
    mutationFn: async (input) => {
      return executeSpaceMutation<AddTransferResult>(runtime, {
        op: 'transactions.addTransfer',
        payload: {
          budgetId: input.budgetId,
          transferId: input.transferId,
          source: input.source,
          destination: input.destination,
        },
        // Refresh in the background (onSuccess) so the add dialog doesn't wait
        // on a full register refetch, same as plain adds.
        meta: { label: 'useAddTransfer', skipInvalidate: true, analytics: entry },
      });
    },
    onSuccess: (_result, vars) => {
      if (vars.source.date.slice(0, 10) > getTodayISO()) {
        requestSchedulingGuide(
          'future',
          resolveSpaceKey(spaceId),
          vars.budgetId,
          vars.source.accountId
        );
      }
      applyOpInvalidations(queryClient, 'transactions.addTransfer');
    },
    onError: (error) => {
      console.error('Transfer failed:', error);
    },
  });
}

export type UpdateTransferRateInput = {
  transferId: string;
  rate: number;
};

export function useUpdateTransferRate() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateTransferRateInput>({
    mutationFn: async ({ transferId, rate }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.updateTransferRate',
        payload: { transferId, rate, transferRateOverride: true },
        meta: { label: 'useUpdateTransferRate' },
      });
    },
  });
}

/**
 * Update a transaction column.
 */
export type UpdateTransactionColumnInput = {
  transactionId: number;
  /** Column name - will be normalized by op-code-registry */
  column: TransactionColumnName | string;
  value: string | number | null;
  accountId: number;
  /** Suppress query invalidation (batch callers invalidate once at the end). */
  skipInvalidate?: boolean;
};

// Invalidation depends on the column (a memo edit cannot move balances); the
// MutationExecutor asks the op registry for this call's set, see
// updateColumnInvalidations in op-code-registry/domains/transactions.ts.
export function useUpdateTransactionColumn() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpdateTransactionColumnInput>({
    mutationFn: async ({ transactionId, column, value, skipInvalidate }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.updateColumn',
        payload: {
          id: transactionId,
          columnName: column,
          newValue: value,
        },
        meta: { label: 'useUpdateTransactionColumn', skipInvalidate },
      });
    },
  });
}

/**
 * Reconcile an account: locks cleared transactions up to the date as
 * reconciled (uncleared ones stay open) and stamps reconciled_at.
 */
export type ReconcileAccountInput = {
  accountId: number;
  reconcileDate?: string;
  /** Balance adjustment to add (cleared) and lock in the same undoable step. */
  adjustment?: {
    inflow: MilliUnits;
    outflow: MilliUnits;
    categoryId: number;
    budgetId: number;
    date: string;
    memo: string;
    payee: string;
  };
};

export function useReconcileAccount() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReconcileAccountInput>({
    mutationFn: async (input) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.reconcileCleared',
        payload: {
          accountId: input.accountId,
          reconcileDate: input.reconcileDate,
          ...(input.adjustment
            ? { adjustment: { ...input.adjustment, accountId: input.accountId } }
            : {}),
        },
        meta: { label: 'useReconcileAccount' },
      });
    },
  });
}

export type SetTransactionsClearedInput = {
  ids: number[];
  cleared: boolean;
};

/** Mark transactions cleared or uncleared; reconciled ones are left unchanged. */
export function useSetTransactionsCleared() {
  const runtime = useRuntime();
  return useMutation<{ changed: number[] }, Error, SetTransactionsClearedInput>({
    mutationFn: (input) =>
      executeSpaceMutation<{ changed: number[] }>(runtime, {
        op: 'transactions.setCleared',
        payload: { ids: input.ids, cleared: input.cleared },
        meta: { label: 'useSetTransactionsCleared' },
      }),
  });
}

export type DuplicateTransactionsInput = {
  ids: number[];
  /** New transfer ID for each copied transfer, keyed by the source transfer ID. */
  transferIds: Record<string, string>;
};

export function useDuplicateTransactions() {
  const runtime = useRuntime();
  return useMutation<{ created: number[] }, Error, DuplicateTransactionsInput>({
    mutationFn: (input) =>
      executeSpaceMutation<{ created: number[] }>(runtime, {
        op: 'transactions.duplicate',
        payload: { ids: input.ids, transferIds: input.transferIds },
        meta: { label: 'useDuplicateTransactions' },
      }),
  });
}

/**
 * Delete a transaction.
 */
export type DeleteTransactionInput = {
  transactionId: number;
  accountId: number;
  /** Suppress query invalidation (batch callers invalidate once at the end). */
  skipInvalidate?: boolean;
};

export function useDeleteTransaction() {
  const runtime = useRuntime();
  return useMutation<void, Error, DeleteTransactionInput>({
    mutationFn: async ({ transactionId, skipInvalidate }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.delete',
        payload: {
          id: transactionId,
        },
        meta: { label: 'useDeleteTransaction', skipInvalidate },
      });
    },
  });
}

/**
 * Delete multiple transactions in one mutation and persistence cycle.
 */
export type DeleteTransactionsInput = {
  transactionIds: number[];
};

export function useDeleteTransactions() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const transactionRoots = new Set([
    'transactions',
    'allTransactions',
    'allTransactionsDetailed',
    'allTransactionsAnalytics',
    'uncategorizedTransactions',
    'allAccountsMonthlyTransactions',
  ]);

  type TransactionSnapshot = { key: QueryKey; data: unknown };

  return useMutation<void, Error, DeleteTransactionsInput, { snapshots: TransactionSnapshot[] }>({
    mutationFn: async ({ transactionIds }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.deleteBatch',
        payload: {
          ids: transactionIds,
        },
        meta: { label: 'useDeleteTransactions', skipInvalidate: true },
      });
    },
    onMutate: async ({ transactionIds }) => {
      const matchesTransactionRoot = (query: { queryKey: readonly unknown[] }) =>
        transactionRoots.has(String(query.queryKey[0] ?? ''));
      await queryClient.cancelQueries({ predicate: matchesTransactionRoot });

      const cachedQueries = queryClient.getQueriesData({ predicate: matchesTransactionRoot });
      const snapshots = cachedQueries.map(([key, data]) => ({ key, data }));
      const selectedIds = new Set(transactionIds);
      const transferIds = new Set<string>();

      for (const [, data] of cachedQueries) {
        if (!Array.isArray(data)) continue;
        for (const row of data) {
          if (
            row &&
            typeof row === 'object' &&
            selectedIds.has(Number((row as { ID?: unknown }).ID))
          ) {
            const transferId = (row as { TransferID?: unknown }).TransferID;
            if (typeof transferId === 'string' && transferId) transferIds.add(transferId);
          }
        }
      }

      for (const [key, data] of cachedQueries) {
        if (!Array.isArray(data)) continue;
        queryClient.setQueryData(
          key,
          data.filter((row) => {
            if (!row || typeof row !== 'object') return true;
            const candidate = row as { ID?: unknown; TransferID?: unknown };
            if (selectedIds.has(Number(candidate.ID))) return false;
            return !(
              typeof candidate.TransferID === 'string' && transferIds.has(candidate.TransferID)
            );
          })
        );
      }

      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      }
    },
    onSuccess: () => {
      applyOpInvalidations(queryClient, 'transactions.deleteBatch');
    },
  });
}

/**
 * Move a transaction to a new category.
 */
export type MoveTransactionToNewCategoryInput = {
  transactionId: number;
  newCategoryId: number;
  accountId: number;
  /** Suppress query invalidation (batch callers invalidate once at the end). */
  skipInvalidate?: boolean;
};

export function useMoveTransactionToNewCategory() {
  const runtime = useRuntime();
  return useMutation<void, Error, MoveTransactionToNewCategoryInput>({
    mutationFn: async ({ transactionId, newCategoryId, skipInvalidate }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.moveToNewCategory',
        payload: {
          transactionId,
          newCategoryId,
        },
        meta: { label: 'useMoveTransactionToNewCategory', skipInvalidate },
      });
    },
  });
}

/**
 * Move a transaction to a new account.
 */
export type MoveTransactionToNewAccountInput = {
  transactionId: number;
  newAccountId: number;
  /** Suppress query invalidation (batch callers invalidate once at the end). */
  skipInvalidate?: boolean;
};

export function useMoveTransactionToNewAccount() {
  const runtime = useRuntime();
  return useMutation<void, Error, MoveTransactionToNewAccountInput>({
    mutationFn: async ({ transactionId, newAccountId, skipInvalidate }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.moveToNewAccount',
        payload: {
          transactionId,
          newAccountId,
        },
        meta: { label: 'useMoveTransactionToNewAccount', skipInvalidate },
      });
    },
  });
}

/** One row of a batch edit (omitted fields stay as they are). */
export type BatchEditTransactionsInput = {
  edits: { id: number; accountId?: number; categoryId?: number; payee?: string }[];
};

/** Account / category / payee for many rows: one op, one write, one undo step. */
export function useBatchEditTransactions() {
  const runtime = useRuntime();
  return useMutation<void, Error, BatchEditTransactionsInput>({
    mutationFn: async ({ edits }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.batchEdit',
        payload: { edits },
        meta: { label: 'useBatchEditTransactions' },
      });
    },
  });
}

/**
 * Reassign multiple transactions to a new category.
 */
export type ReassignTransactionsInput = {
  newCategoryId: number;
  oldCategoryId: number;
  budgetId: number;
};

export function useReassignTransactions() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReassignTransactionsInput>({
    mutationFn: async ({ newCategoryId, oldCategoryId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.reassign',
        payload: {
          newCategoryId,
          oldCategoryId,
        },
        meta: { label: 'useReassignTransactions' },
      });
    },
  });
}
