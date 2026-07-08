import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Account } from '@budgero/core/browser';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { useUiStore } from '@shared/store/useUiStore';

/**
 * Fetch all accounts for a given budget.
 */
export function useAccounts(budgetId: number) {
  return useSpaceQuery<Account[]>({
    key: ['accounts', budgetId],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.accounts.listAccounts(budgetId),
  });
}

/**
 * Add a new account under a budget.
 */
export type AddAccountInput = {
  name: string;
  budget_id: number;
  type: string;
  currency: string;
  balance: number;
  metadata?: Record<string, unknown>;
  on_budget: boolean;
};
export function useAddAccount() {
  const runtime = useRuntime();
  return useMutation<Account, Error, AddAccountInput>({
    mutationFn: async (input) => {
      const { currency } = input;
      return executeSpaceMutation<Account>(runtime, {
        op: 'accounts.create',
        payload: {
          name: input.name,
          budgetId: input.budget_id,
          type: input.type,
          currency,
          balance: input.balance,
          metadata: input.metadata || {},
          onBudget: input.on_budget,
        },
        meta: { label: 'useAddAccount' },
      });
    },
  });
}

/**
 * Reorder accounts within a single on/off-budget group.
 * Pass the IDs of that group in the desired order; positions are reassigned
 * by index. The on-budget and off-budget groups are ordered independently.
 */
export type ReorderAccountsInput = {
  budgetId: number;
  orderedAccountIds: number[];
};
export function useReorderAccounts() {
  const runtime = useRuntime();
  return useMutation<void, Error, ReorderAccountsInput>({
    mutationFn: async ({ budgetId, orderedAccountIds }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'accounts.reorder',
        payload: { budgetId, orderedAccountIds },
        meta: { label: 'useReorderAccounts' },
      });
    },
  });
}

/**
 * Edit an existing account.
 */
interface LiabilityMetadata {
  liability?: boolean;
  debt_total?: number;
  paid_so_far?: number;
}

export type EditAccountInput = {
  id: number;
  name: string;
  type: string;
  currency: string;
  budget_id: number;
  oldCurrency?: string; // For detecting currency changes
  metadata?: Record<string, unknown>;
  onBudget?: boolean;
};
export function useEditAccount() {
  const qc = useQueryClient();
  const { setCurrencyConversion, resetCurrencyConversion } = useUiStore.getState();
  const runtime = useRuntime();

  return useMutation<void, Error, EditAccountInput>({
    mutationFn: async ({
      id,
      name,
      type,
      currency,
      budget_id,
      oldCurrency,
      metadata,
      onBudget,
    }) => {
      const isCurrencyChanging = oldCurrency && oldCurrency !== currency;

      if (isCurrencyChanging) {
        setCurrencyConversion({
          isActive: true,
          message: 'Updating account currency and recalculating transactions...',
        });
      }

      try {
        await executeSpaceMutation<void>(runtime, {
          op: 'accounts.update',
          payload: {
            id,
            name,
            type,
            currency,
            budgetId: budget_id,
            metadata: metadata || undefined,
            onBudget,
          },
          meta: { label: 'useEditAccount' },
        });

        // If liability metadata changed (original debt / paid_so_far), upsert initial transactions
        try {
          const md = metadata as LiabilityMetadata | undefined;
          const isLiability =
            md &&
            (md.liability || ['credit', 'loan', 'mortgage'].includes((type || '').toLowerCase()));
          const hasDebtOrPaid =
            md && (typeof md.debt_total === 'number' || typeof md.paid_so_far === 'number');
          if (isLiability && hasDebtOrPaid) {
            await executeSpaceMutation<void>(runtime, {
              op: 'transactions.upsertLiabilityStarts',
              payload: {
                accountId: id,
                budgetId: budget_id,
                originalDebt: typeof md.debt_total === 'number' ? md.debt_total : null,
                paidSoFar: typeof md.paid_so_far === 'number' ? md.paid_so_far : null,
                accountType: type,
              },
              meta: { label: 'useEditAccount' },
            });
          }
        } catch (e) {
          console.warn('Failed to upsert liability start transactions', e);
        }

        if (isCurrencyChanging) {
          // Invalidate all queries to refresh everything with new currency
          await qc.invalidateQueries();
        }
      } catch (error) {
        if (isCurrencyChanging) {
          setCurrencyConversion({
            error: 'Failed to update currency. Please try again.',
          });
        }
        throw error;
      } finally {
        if (isCurrencyChanging) {
          // Hide overlay after a short delay to ensure UI updates
          setTimeout(() => {
            resetCurrencyConversion();
          }, 500);
        }
      }
    },
  });
}

/**
 * Archive or unarchive an account.
 */
export type SetAccountArchivedInput = {
  id: number;
  budget_id: number;
  archived: boolean;
};
export function useSetAccountArchived() {
  const runtime = useRuntime();
  return useMutation<void, Error, SetAccountArchivedInput>({
    mutationFn: async ({ id, archived }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'accounts.setArchived',
        payload: { id, archived },
        meta: { label: 'useSetAccountArchived' },
      });
    },
  });
}

/**
 * Delete an account.
 */
export type DeleteAccountInput = {
  id: number;
  budget_id: number;
};
export function useDeleteAccount() {
  const runtime = useRuntime();
  return useMutation<void, Error, DeleteAccountInput>({
    mutationFn: async ({ id, budget_id }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'accounts.delete',
        payload: {
          id,
          budgetId: budget_id,
        },
        meta: { label: 'useDeleteAccount' },
      });
    },
  });
}
