import { useState, useEffect, useMemo } from 'react';
import type { GetTransactionsByAccountRow, TransactionSplit } from '@budgero/core/browser';
import {
  useTransactionSplits,
  useUpsertSplits,
  useClearSplits,
  useUpdateTransactionColumn,
} from '@entities/transaction/api/useTransactions';
import { extractSplitFlows } from '../desktop-table/table-utils';

export interface SplitLine {
  id?: number;
  category_id: number | null;
  transfer_account_id?: number | null;
  memo: string;
  payee: string;
  inflow: number;
  outflow: number;
}

interface UseMobileTransactionCardStateProps {
  transaction: GetTransactionsByAccountRow;
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  forceExpand?: boolean;
  forceLoadSplits?: boolean;
  amountCurrency: 'converted' | 'native';
}

export function useMobileTransactionCardState({
  transaction,
  getPrimaryInflow,
  getPrimaryOutflow,
  forceExpand = false,
  forceLoadSplits = false,
  amountCurrency,
}: UseMobileTransactionCardStateProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editSplits, setEditSplits] = useState<SplitLine[] | null>(null);
  // Edited transaction total while in split edit mode; null = keep current total
  const [editTotal, setEditTotal] = useState<number | null>(null);

  // Projected rows (a split recurring template's) have no stored lines.
  const shouldLoadSplits =
    !transaction.IsProjected &&
    (forceLoadSplits || transaction.Category === 'Split' || editSplits !== null);

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
  const parentSplitNet = useMemo(() => {
    if (splits.length > 0) {
      return splits.reduce((sum, s) => {
        const flows = extractSplitFlows(s, amountCurrency);
        return sum + flows.inflow - flows.outflow;
      }, 0);
    }
    return getPrimaryInflow(transaction) - getPrimaryOutflow(transaction);
  }, [splits, transaction, getPrimaryInflow, getPrimaryOutflow, amountCurrency]);

  const parentIsInflow = parentSplitNet > 0;
  const parentSplitTarget = Math.abs(parentSplitNet);
  const splitTarget = editTotal ?? parentSplitTarget;
  const splitTargetNet = (parentIsInflow ? 1 : -1) * splitTarget;

  const draftSplitNet =
    editSplits?.reduce(
      (sum, line) => sum + (Number(line.inflow) || 0) - (Number(line.outflow) || 0),
      0
    ) ?? 0;

  const isClearingSplits = Boolean(editSplits && editSplits.length === 0 && hasExistingSplits);

  const splitSaveDisabled =
    !editSplits ||
    upsertSplits.isPending ||
    clearSplits.isPending ||
    updateTransactionColumn.isPending ||
    (!isClearingSplits &&
      (editSplits.length === 0 ||
        splitTarget <= 0 ||
        editSplits.some(
          (line) =>
            !(
              (Number(line.inflow) > 0 && Number(line.outflow) === 0) ||
              (Number(line.outflow) > 0 && Number(line.inflow) === 0)
            )
        ) ||
        splitTargetNet !== draftSplitNet));

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
        payee: s.Payee ?? '',
        ...extractSplitFlows(s, amountCurrency),
      }))
    );
  };

  const addSplitLine = () => {
    setEditSplits((prev) => [
      ...(prev || []),
      { id: undefined, category_id: null, memo: '', payee: '', inflow: 0, outflow: 0 },
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
      payee: l.payee ?? '',
      inflow: Number(l.inflow) || 0,
      outflow: Number(l.outflow) || 0,
      order_index: idx,
    }));

    // Check if parent transaction amount needs updating (e.g., when viewing from filtered spending overview)
    // The parent transaction's inflow/outflow must match the split total for backend validation.
    // Both sides are exact integer milliunits.
    const currentParentInflow =
      amountCurrency === 'native'
        ? (transaction.InflowNative ?? transaction.InflowConverted ?? 0)
        : transaction.InflowConverted || 0;
    const currentParentOutflow =
      amountCurrency === 'native'
        ? (transaction.OutflowNative ?? transaction.OutflowConverted ?? 0)
        : transaction.OutflowConverted || 0;

    if (currentParentInflow - currentParentOutflow !== splitTargetNet) {
      const accountId =
        (transaction as GetTransactionsByAccountRow & { AccountID?: number }).AccountID ?? 0;
      const inflowColumn = amountCurrency === 'native' ? 'InflowNative' : 'InflowConverted';
      const outflowColumn = amountCurrency === 'native' ? 'OutflowNative' : 'OutflowConverted';
      await updateTransactionColumn.mutateAsync({
        transactionId: transaction.ID,
        column: splitTargetNet >= 0 ? outflowColumn : inflowColumn,
        value: 0,
        accountId,
      });
      await updateTransactionColumn.mutateAsync({
        transactionId: transaction.ID,
        column: splitTargetNet >= 0 ? inflowColumn : outflowColumn,
        value: Math.abs(splitTargetNet),
        accountId,
      });
    }

    await upsertSplits.mutateAsync({
      transactionId: transaction.ID,
      splits: prepared,
      amountCurrency,
    });
    setEditTotal(null);
    setEditSplits(null);
  };

  const remainingAmount = useMemo(() => {
    if (editSplits) {
      const net = editSplits.reduce(
        (sum, line) => sum + (Number(line.inflow) || 0) - (Number(line.outflow) || 0),
        0
      );
      return splitTargetNet - net;
    }
    const total = splits.reduce((s, l) => {
      const flows = extractSplitFlows(l, amountCurrency);
      return s + flows.inflow - flows.outflow;
    }, 0);
    return parentSplitNet - total;
  }, [editSplits, splits, parentSplitNet, splitTargetNet, amountCurrency]);

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
