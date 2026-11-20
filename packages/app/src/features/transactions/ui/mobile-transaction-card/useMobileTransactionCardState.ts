import { useState, useEffect, useMemo } from 'react';
import type {
  GetTransactionsByAccountRow,
  TransactionSplitWithMirror,
} from '@budgero/core/browser';
import {
  useTransactionSplits,
  useUpsertSplits,
  useClearSplits,
  useUpdateTransactionColumn,
} from '@entities/transaction/api/useTransactions';
import { getRuntime } from '@shared/runtime/global';
import { useUiStore } from '@shared/store/useUiStore';
import { toastError } from '@shared/lib/errors';
import { t } from '@lingui/core/macro';
import {
  editableSplitReceived,
  extractSplitFlows,
  receivedFromMirror,
} from '../desktop-table/table-utils';
import { confirmSplitSave } from '../reconciled-edit/reconciled-edit-confirm';
import {
  followEnteredReceived,
  missingReceivedMessage,
  needsReceivedAmount,
  splitLineCategoryMode,
  type SplitLineCategoryMode,
  type SplitTransferAccount,
} from '../../lib/split-transfer';
import { useSplitParentAccount } from '../split-transfer/useSplitParentAccount';
import { useAutoReceivedAmounts } from '../split-transfer/useAutoReceivedAmounts';

export interface SplitLine {
  id?: number;
  category_id: number | null;
  transfer_account_id?: number | null;
  memo: string;
  payee: string;
  inflow: number;
  outflow: number;
  /** Cross-currency transfer lines: what the other account received (its currency). */
  received_amount?: number | null;
  /** The received amount follows the line amount (estimated) until one is typed. */
  received_auto?: boolean;
  /** The line amount a loaded received amount belongs to. */
  received_base?: number | null;
}

interface UseMobileTransactionCardStateProps {
  transaction: GetTransactionsByAccountRow;
  budgetId: number;
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  forceExpand?: boolean;
  forceLoadSplits?: boolean;
  amountCurrency: 'converted' | 'native';
}

export function useMobileTransactionCardState({
  transaction,
  budgetId,
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
  const { accounts, ownAccount } = useSplitParentAccount(budgetId, transaction);
  const budgetCurrency = useUiStore((state) => state.selectedBudget?.DisplayCurrency);
  const accountById = (id: number | null | undefined) =>
    id ? accounts.find((account) => account.ID === Number(id)) : undefined;
  /** The account a cross-currency transfer line sends to (it asks what was received). */
  const splitReceivedTarget = (line: SplitLine): SplitTransferAccount | undefined => {
    const target = accountById(line.transfer_account_id);
    return target && needsReceivedAmount(ownAccount?.Currency, target) ? target : undefined;
  };
  const splitCategoryMode = (line: SplitLine): SplitLineCategoryMode =>
    splitLineCategoryMode(ownAccount, accountById(line.transfer_account_id));
  const lineAmount = (line: SplitLine) => Number(line.inflow) || Number(line.outflow) || 0;
  // Only an amount the user typed (or entered before) is sent and pinned; an
  // estimate leaves the mirror to the usual conversion.
  const receivedOf = (line: SplitLine) =>
    splitReceivedTarget(line) && line.received_auto === false
      ? (line.received_amount ?? null)
      : null;

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

  // Why Save waits: a cross-currency transfer line has no amount for the other side.
  const missingLine = editSplits?.find(
    (line) => splitReceivedTarget(line) && !(Number(line.received_amount) > 0)
  );
  const splitSaveHint = missingLine
    ? missingReceivedMessage(splitReceivedTarget(missingLine)!, Number(missingLine.inflow) > 0)
    : null;

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
        // A transfer line to another currency needs what the other account received.
        Boolean(splitSaveHint) ||
        splitTargetNet !== draftSplitNet));

  useAutoReceivedAmounts({
    lines: editSplits,
    access: {
      target: (line) => line.transfer_account_id,
      amount: lineAmount,
      received: (line) => line.received_amount,
      auto: (line) => line.received_auto !== false,
      base: (line) => line.received_base,
    },
    onEstimates: (estimates) =>
      setEditSplits((prev) =>
        prev
          ? prev.map((line, i) =>
              estimates.has(i) ? { ...line, received_amount: estimates.get(i) } : line
            )
          : prev
      ),
    accounts,
    parentCurrency: ownAccount?.Currency,
    amountCurrency: amountCurrency === 'native' ? ownAccount?.Currency : budgetCurrency,
    date: String(transaction.Date ?? '').slice(0, 10),
    budgetId,
  });

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
      splits.map((s: TransactionSplitWithMirror) => {
        const flows = extractSplitFlows(s, amountCurrency);
        return {
          id: s.ID,
          category_id: s.CategoryID ?? null,
          transfer_account_id: s.TransferAccountID ?? null,
          memo: s.Memo ?? '',
          payee: s.Payee ?? '',
          ...flows,
          ...receivedFromMirror(s, flows.inflow + flows.outflow),
        };
      })
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

  // An entered received amount scales with its line's amount.
  const updateSplitLine = (idx: number, updates: Partial<SplitLine>) => {
    setEditSplits((prev) =>
      (prev ?? []).map((line, i) =>
        i === idx
          ? followEnteredReceived(line, { ...line, ...updates }, editableSplitReceived())
          : line
      )
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
      // A transfer between on-budget accounts never keeps a category.
      category_id: splitCategoryMode(l) === 'transfer-locked' ? null : (l.category_id ?? null),
      transfer_account_id: l.transfer_account_id ?? null,
      memo: l.memo ?? '',
      payee: l.payee ?? '',
      inflow: Number(l.inflow) || 0,
      outflow: Number(l.outflow) || 0,
      order_index: idx,
      received_amount: receivedOf(l),
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

    const total =
      currentParentInflow - currentParentOutflow !== splitTargetNet
        ? {
            inflow: splitTargetNet >= 0 ? splitTargetNet : 0,
            outflow: splitTargetNet >= 0 ? 0 : Math.abs(splitTargetNet),
          }
        : undefined;
    // A reconciled parent or transfer mirror asks first; cancelling keeps the
    // editor open. A missing rate for an entered amount stops here, before
    // anything is written.
    let confirmed: boolean;
    try {
      confirmed = await confirmSplitSave(
        getRuntime()?.services(),
        transaction.ID,
        total,
        amountCurrency,
        prepared
      );
    } catch (error) {
      toastError(t`Failed to save split transaction`, error);
      return;
    }
    if (!confirmed) return;

    if (total) {
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

    try {
      await upsertSplits.mutateAsync({
        transactionId: transaction.ID,
        splits: prepared,
        amountCurrency,
      });
    } catch (error) {
      // E.g. no exchange rate for an entered received amount: keep the editor open.
      toastError(t`Failed to save split transaction`, error);
      return;
    }
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

    // Transfer lines
    splitReceivedTarget,
    splitSaveHint,
    splitCategoryMode,
  };
}
