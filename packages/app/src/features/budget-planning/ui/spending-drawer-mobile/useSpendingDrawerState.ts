import { useMemo, useState, useEffect, useCallback } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useTransactionsByCategoryAndMonth,
  useDeleteTransaction,
} from '@entities/transaction/api/useTransactions';
import { useTransactionCellCommit } from '@features/transactions/api/useTransactionCellCommit';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useGoalsByCategories } from '@entities/goal/api/useGoals';
import { useCategories } from '@entities/category/api/useCategories';
import { toast } from 'sonner';
import { ZERO_MILLI } from '@shared/lib/currency/milli';
import {
  filterTransactionsByDate,
  calculateCumulativeData,
  calculateGoalStatus,
  resolveAccountIdForTx,
} from './spending-drawer.utils';
import { ROWS_PER_PAGE } from './constants';
import type { SelectedCategory, Transaction } from './types';

export function useSpendingDrawerState(
  selectedCategory: SelectedCategory | null,
  currentMonth: string,
  options?: { deferCalculations?: boolean }
) {
  const deferCalculations = options?.deferCalculations ?? false;
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);

  const { data: accounts } = useAccounts(selectedBudget?.ID || 0);
  const { data: categories } = useCategories(selectedBudget?.ID || 0);
  const { data: goalsData } = useGoalsByCategories(selectedCategory ? [selectedCategory.id] : []);
  const { data: transactions = [], isLoading: loading } = useTransactionsByCategoryAndMonth(
    selectedBudget?.ID || 0,
    selectedCategory?.name || '',
    currentMonth
  );

  const monthlyGoal = goalsData?.find(
    (g) => g.CategoryID === selectedCategory?.id && g.Type === 'monthly'
  )?.Target;
  const selectedCategoryData = categories?.find((c) => c.ID === selectedCategory?.id);

  const [page, setPage] = useState(0);

  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [quickViewTx, setQuickViewTx] = useState<Transaction | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [recatOpen, setRecatOpen] = useState(false);
  const [recatTx, setRecatTx] = useState<Transaction | null>(null);

  const cellCommit = useTransactionCellCommit();
  const deleteTransaction = useDeleteTransaction();

  const normalizedTransactions = useMemo(() => {
    const fallbackCategoryName = selectedCategory?.name || '';
    const fallbackCategoryId = selectedCategory?.id ?? null;

    return (transactions as Transaction[]).map((tx) => ({
      ...tx,
      Category: tx.Category || fallbackCategoryName,
      CategoryID: tx.CategoryID ?? fallbackCategoryId,
    }));
  }, [transactions, selectedCategory]);

  // Filter transactions: for current month, show only up to today
  const filteredTransactions = useMemo(() => {
    if (deferCalculations) return [];
    return filterTransactionsByDate(normalizedTransactions, currentMonth);
  }, [normalizedTransactions, currentMonth, deferCalculations]);

  const { cumulativeData, totalSpent } = useMemo(() => {
    if (deferCalculations) {
      return { cumulativeData: [], totalSpent: ZERO_MILLI };
    }
    const excludeFromBudgetPace = !!selectedCategoryData?.ExcludeFromBudgetPace;
    return calculateCumulativeData(
      filteredTransactions,
      currentMonth,
      monthlyGoal,
      excludeFromBudgetPace
    );
  }, [filteredTransactions, currentMonth, monthlyGoal, selectedCategoryData, deferCalculations]);

  const goalStatus = useMemo(
    () => calculateGoalStatus(totalSpent, monthlyGoal),
    [totalSpent, monthlyGoal]
  );

  const maxValue =
    cumulativeData.length > 0 ? Math.max(...cumulativeData.map((d) => d.cumulative)) : 100;

  const shouldShowBudgetPace =
    !!monthlyGoal && !!selectedCategoryData && !selectedCategoryData.ExcludeFromBudgetPace;

  // Reset transient list state when category or month changes.
  useEffect(() => {
    queueMicrotask(() => {
      setPage(0);
      setCollapsedDates(new Set());
    });
  }, [selectedCategory?.id, currentMonth]);

  const handleTransactionClick = useCallback((transaction: Transaction) => {
    setQuickViewTx(transaction);
    setQuickViewOpen(true);
  }, []);

  const toggleDateCollapse = useCallback((dateKey: string) => {
    setCollapsedDates((prev) => {
      const newCollapsed = new Set(prev);
      if (newCollapsed.has(dateKey)) {
        newCollapsed.delete(dateKey);
      } else {
        newCollapsed.add(dateKey);
      }
      return newCollapsed;
    });
  }, []);

  const handleQuickCommit = useCallback(
    (transactionId: number, columnId: string, newVal: string | number | Date | null) => {
      if (!quickViewTx) return;
      const account = accounts?.find((a) => a.Name === quickViewTx.Account);
      const patch = cellCommit.mutate(transactionId, columnId as DbTransactionColumn, newVal, {
        accountId: account?.ID || 0,
      });
      if (!patch) return;
      setQuickViewTx((prev) => (prev ? ({ ...prev, ...patch } as Transaction) : prev));
    },
    [quickViewTx, accounts, cellCommit]
  );

  const handleDeleteTx = useCallback(async () => {
    if (!quickViewTx) return;
    const accountId = resolveAccountIdForTx(quickViewTx, accounts);
    try {
      await deleteTransaction.mutateAsync({
        transactionId: Number(quickViewTx.ID || quickViewTx.id),
        accountId,
      });
      setConfirmDeleteOpen(false);
      setQuickViewOpen(false);
      setQuickViewTx(null);
    } catch {
      toast.error('Failed to delete');
    }
  }, [quickViewTx, accounts, deleteTransaction]);

  const handleRecategorize = useCallback(
    (categoryId: number) => {
      if (!recatTx) return;
      const accountId = resolveAccountIdForTx(recatTx, accounts);
      cellCommit.mutate(Number(recatTx.ID || recatTx.id), 'CategoryID', categoryId, { accountId });
      setRecatOpen(false);
      setRecatTx(null);
    },
    [recatTx, accounts, cellCommit]
  );

  const openRecategorize = useCallback((transaction: Transaction) => {
    setRecatTx(transaction);
    setRecatOpen(true);
  }, []);

  const openDeleteConfirm = useCallback((transaction: Transaction) => {
    setQuickViewTx(transaction);
    setConfirmDeleteOpen(true);
  }, []);

  return {
    selectedBudget,
    globalLocalizer,
    filteredTransactions,
    cumulativeData,
    totalSpent,
    goalStatus,
    maxValue,
    shouldShowBudgetPace,
    loading,

    page,
    setPage,
    rowsPerPage: ROWS_PER_PAGE,

    collapsedDates,
    toggleDateCollapse,

    quickViewOpen,
    setQuickViewOpen,
    quickViewTx,

    confirmDeleteOpen,
    setConfirmDeleteOpen,
    handleDeleteTx,
    isDeleting: deleteTransaction.isPending,

    recatOpen,
    setRecatOpen,
    recatTx,
    handleRecategorize,
    openRecategorize,
    openDeleteConfirm,

    handleTransactionClick,
    handleQuickCommit,

    isPending: cellCommit.isPending,
    pendingId: cellCommit.pendingId,
  };
}
