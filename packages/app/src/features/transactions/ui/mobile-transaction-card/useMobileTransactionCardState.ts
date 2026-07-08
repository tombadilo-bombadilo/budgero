import { useState, useEffect, useMemo } from 'react';
import type { GetTransactionsByAccountRow, TransactionSplit } from '@budgero/core/browser';
import {
  useTransactionSplits,
  useUpsertSplits,
  useClearSplits,
  useUpdateTransactionColumn,
} from '@entities/transaction/api/useTransactions';

export interface SplitLine {
  id?: number;
  category_id: number | null;
  transfer_account_id?: number | null;
  memo: string;
  /** Positive amount in integer milliunits. */
  amount: number;
}

interface UseMobileTransactionCardStateProps {
  transaction: GetTransactionsByAccountRow;
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  forceExpand?: boolean;
  forceLoadSplits?: boolean;
}

export function useMobileTransactionCardState({
  transaction,
  getPrimaryInflow,
  getPrimaryOutflow,
  forceExpand = false,
  forceLoadSplits = false,
}: UseMobileTransactionCardStateProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editSplits, setEditSplits] = useState<SplitLine[] | null>(null);
  // Edited transaction total while in split edit mode; null = keep current total
  const [editTotal, setEditTotal] = useState<number | null>(null);

  const shouldLoadSplits =
    forceLoadSplits || transaction.Category === 'Split' || editSplits !== null;

  const { data: splits = [], isLoading: splitsLoading } = useTransactionSplits(
    shouldLoadSplits ? transaction.ID : null
  );
  const upsertSplits = useUpsertSplits();
  const clearSplits = useClearSplits();
  const updateTransactionColumn = useUpdateTransactionColumn();

  // Transfers move money between your own accounts and cannot be split.
  const isTransfer = !!transaction.TransferID && transaction.TransferID.trim() !== '';
  const canSplitTransaction =
    !isTransfer && (getPrimaryInflow(transaction) !== 0 || getPrimaryOutflow(transaction) !== 0);
  const hasExistingSplits = splits.length > 0;
  const showSplitSection =
    transaction.Category === 'Split' || editSplits !== null || hasExistingSplits;

  // Calculate the true transaction total from splits when available
  // This handles cases where viewing from spending overview only returns a filtered split amount
  const parentSplitTarget = useMemo(() => {
    // If we have splits loaded, calculate total from them (more accurate)
    if (splits.length > 0) {
      return splits.reduce((sum, s) => {
        const val = s.Inflow > 0 ? s.Inflow : s.Outflow;
        return sum + (Number(val) || 0);
      }, 0);
    }
    return getPrimaryInflow(transaction) > 0
      ? getPrimaryInflow(transaction)
      : getPrimaryOutflow(transaction);
  }, [splits, transaction, getPrimaryInflow, getPrimaryOutflow]);

  // The total the splits must add up to — editable while in edit mode
  const splitTarget = editTotal ?? parentSplitTarget;

  const draftSplitTotal =
    editSplits?.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) ?? 0;

  const isClearingSplits = Boolean(editSplits && editSplits.length === 0 && hasExistingSplits);

  const splitSaveDisabled =
    !editSplits ||
    upsertSplits.isPending ||
    clearSplits.isPending ||
    updateTransactionColumn.isPending ||
    (!isClearingSplits &&
      (editSplits.length === 0 ||
        splitTarget <= 0 ||
        // Amounts are exact integer milliunits, so the split total must match exactly.
        splitTarget !== draftSplitTotal));

  // Auto-expand when requested (e.g., deep-link navigation) - defer to avoid synchronous cascade
  useEffect(() => {
    if (forceExpand) {
      const id = requestAnimationFrame(() => setIsExpanded(true));
      return () => cancelAnimationFrame(id);
    }
  }, [forceExpand]);

  const toggleExpanded = () => setIsExpanded((prev) => !prev);

  const startEditSplits = () => {
    setEditTotal(null);
    setEditSplits([]);
  };

  const cancelEditSplits = () => {
    setEditTotal(null);
    setEditSplits(null);
  };

  const initEditSplitsFromExisting = () => {
    setEditTotal(null);
    setEditSplits(
      splits.map((s: TransactionSplit) => ({
        id: s.ID,
        category_id: s.CategoryID ?? null,
        transfer_account_id: s.TransferAccountID ?? null,
        memo: s.Memo ?? '',
        amount: s.Inflow > 0 ? s.Inflow : s.Outflow,
      }))
    );
  };

  const addSplitLine = () => {
    setEditSplits((prev) => [
      ...(prev || []),
      { id: undefined, category_id: null, memo: '', amount: 0 },
    ]);
  };

  const removeSplitLine = (idx: number) => {
    setEditSplits((prev) => (prev ?? []).filter((_, i) => i !== idx));
  };

  const updateSplitLine = (idx: number, updates: Partial<SplitLine>) => {
    setEditSplits((prev) =>
      (prev ?? []).map((line, i) => (i === idx ? { ...line, ...updates } : line))
    );
  };

  const saveSplits = async () => {
    if (!editSplits) return;

    if (editSplits.length === 0) {
      if (hasExistingSplits) {
        await clearSplits.mutateAsync({ transactionId: transaction.ID });
      }
      setEditTotal(null);
      setEditSplits(null);
      return;
    }

    const prepared = editSplits.map((l, idx) => ({
      category_id: l.category_id ?? null,
      transfer_account_id: l.transfer_account_id ?? null,
      memo: l.memo ?? '',
      amount: Number(l.amount) || 0,
      order_index: idx,
    }));

    // Determine transaction type from existing splits (more reliable than filtered transaction data)
    const isInflowType =
      splits.length > 0 ? splits.some((s) => s.Inflow > 0) : getPrimaryInflow(transaction) > 0;
    const type = isInflowType ? 'inflow' : 'outflow';

    const newTotal = editSplits.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

    // Check if parent transaction amount needs updating (e.g., when viewing from filtered spending overview)
    // The parent transaction's inflow/outflow must match the split total for backend validation.
    // Both sides are exact integer milliunits.
    const currentParentAmount = isInflowType ? transaction.Inflow || 0 : transaction.Outflow || 0;

    if (currentParentAmount !== newTotal) {
      // Update parent transaction amount before saving splits
      const column = isInflowType ? 'Inflow' : 'Outflow';
      await updateTransactionColumn.mutateAsync({
        transactionId: transaction.ID,
        column,
        value: newTotal,
        accountId:
          (transaction as GetTransactionsByAccountRow & { AccountID?: number }).AccountID ?? 0,
      });
    }

    await upsertSplits.mutateAsync({
      transactionId: transaction.ID,
      splits: prepared,
      type: type as 'inflow' | 'outflow',
    });
    setEditTotal(null);
    setEditSplits(null);
  };

  const remainingAmount = useMemo(() => {
    if (editSplits) {
      const total = editSplits.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      return splitTarget - total;
    }
    const total = splits.reduce((s, l) => {
      const val = l.Inflow > 0 ? l.Inflow : l.Outflow;
      return s + (Number(val) || 0);
    }, 0);
    return parentSplitTarget - total;
  }, [editSplits, splits, parentSplitTarget, splitTarget]);

  return {
    // Expansion state
    isExpanded,
    toggleExpanded,

    // Split data
    splits,
    splitsLoading,
    editSplits,

    // Split computed values
    canSplitTransaction,
    showSplitSection,
    parentSplitTarget,
    splitTarget,
    setSplitTarget: setEditTotal,
    isClearingSplits,
    splitSaveDisabled,
    remainingAmount,

    // Split actions
    startEditSplits,
    cancelEditSplits,
    initEditSplitsFromExisting,
    addSplitLine,
    removeSplitLine,
    updateSplitLine,
    saveSplits,
  };
}
