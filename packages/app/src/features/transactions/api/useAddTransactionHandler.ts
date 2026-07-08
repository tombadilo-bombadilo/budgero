/**
 * Shared hook for handling add transaction logic.
 * Extracted from useTransactionTable to be used by both desktop and mobile layouts.
 */

import { useCallback } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { useAddTransaction } from '@entities/transaction/api/useTransactions';
import { useCategories } from '@entities/category/api/useCategories';

interface UseAddTransactionHandlerOptions {
  onDialogClose: () => void;
}

export function useAddTransactionHandler({ onDialogClose }: UseAddTransactionHandlerOptions) {
  const selectedAccount = useUiStore((state) => state.selectedAccount);
  const selectedBudget = useUiStore((state) => state.selectedBudget);

  const { data: categories = [] } = useCategories(
    selectedAccount?.BudgetID || selectedBudget?.ID || 0
  );

  const addTransactionMutation = useAddTransaction();

  const handleAddTransaction = useCallback(
    async (
      date: Date | null,
      category: string,
      memo: string,
      payee: string,
      outflow: number,
      inflow: number,
      accountId: number,
      labelId: number | null,
      transferId: string | null,
      keepDialogOpen?: boolean
    ): Promise<number> => {
      const categoryObject = categories.find((cat) => cat.Name === category);
      const categoryId = categoryObject?.ID || 0;

      // Don't perform optimistic update - let React Query handle the data flow
      // This prevents the data from getting out of sync

      if (!transferId) {
        transferId = '';
      }
      const transactionDate = date
        ? date.toLocaleDateString('en-CA') // -> "2025-09-26"
        : new Date().toLocaleDateString('en-CA');
      const id = await addTransactionMutation.mutateAsync({
        inflow,
        outflow,
        accountId,
        categoryId,
        labelId,
        budgetId: selectedAccount?.BudgetID || selectedBudget?.ID || 0,
        date: transactionDate,
        memo,
        payee,
        transferId,
      });

      // Only close dialog if not keeping it open for "Add Another"
      if (!keepDialogOpen) {
        onDialogClose();
      }
      return id;
    },
    [categories, selectedAccount, selectedBudget, addTransactionMutation, onDialogClose]
  );

  return {
    handleAddTransaction,
    addTransactionMutation,
    categories,
  };
}
