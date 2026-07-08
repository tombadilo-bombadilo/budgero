import { useMutation } from '@tanstack/react-query';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useLoading } from '@shared/contexts/LoadingContext';

// Query invalidation for these mutations is driven centrally by the
// MutationExecutor from each op's declared `invalidates` (see
// op-code-registry/domains/transactions.ts), so it runs identically for local
// and remote mutations. Hooks here only carry genuine UI side effects.

/**
 * Valid column names for transaction updates.
 * Matches the normalization in op-code-registry.ts
 */
export type TransactionColumnName =
  | 'Inflow'
  | 'Outflow'
  | 'Memo'
  | 'Date'
  | 'CategoryID'
  | 'LabelID'
  | 'AccountID'
  | 'InflowOriginal'
  | 'OutflowOriginal'
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
};

export function useAddTransaction() {
  const { showTransferLoading, hideTransferLoading } = useLoading();
  const runtime = useRuntime();

  return useMutation<number, Error, AddTransactionInput>({
    mutationFn: async (input) => {
      if (input.transferId) {
        showTransferLoading();
      }

      return executeSpaceMutation<number>(runtime, {
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
        },
        meta: { label: 'useAddTransaction' },
      });
    },
    // Invalidation is executor-driven (transactions.add invalidates). The hook
    // only manages the transfer loading overlay.
    onSuccess: (_newId, vars) => {
      if (vars.transferId) hideTransferLoading();
    },
    onError: (error, vars) => {
      if (vars.transferId) hideTransferLoading();
      console.error('Transaction failed:', error);
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
 * Reconcile an account - marks transactions as reconciled and updates reconciled_at timestamp
 */
export type ReconcileAccountInput = {
  accountId: number;
  reconcileDate?: string;
};

export function useReconcileAccount() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReconcileAccountInput>({
    mutationFn: async (input) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.reconcile',
        payload: {
          accountId: input.accountId,
          reconcileDate: input.reconcileDate,
        },
        meta: { label: 'useReconcileAccount' },
      });
    },
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
