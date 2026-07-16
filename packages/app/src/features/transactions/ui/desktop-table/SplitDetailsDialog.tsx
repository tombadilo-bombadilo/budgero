import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import {
  useTransactionSplits,
  useUpsertSplits,
  useClearSplits,
  useUpdateTransactionColumn,
} from '@entities/transaction/api/useTransactions';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@shared/ui/dialog';
import { Separator } from '@shared/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { withEditPrecision } from '@shared/lib/number-format';
import {
  type SplitLike,
  type EditableSplit,
  extractSplitAmount,
  toEditableSplit,
  getSplitCategoryLabel,
  isSplitIncomeAmount,
} from './table-utils';

interface SplitDetailsDialogProps {
  transaction: GetTransactionsByAccountRow | null;
  startInEditMode?: boolean;
  onClose: () => void;
  globalLocalizer: Intl.NumberFormat;
  currentFormatter: Intl.NumberFormat;
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  budgetId: number;
}

export function SplitDetailsDialog({
  transaction,
  startInEditMode = false,
  onClose,
  globalLocalizer,
  currentFormatter,
  getPrimaryInflow,
  getPrimaryOutflow,
  budgetId,
}: SplitDetailsDialogProps) {
  const open = Boolean(transaction);
  const transactionId = transaction ? transaction.ID : null;
  // Edit surfaces must show real cents even under a zero-decimal display format.
  const editGlobalLocalizer = withEditPrecision(globalLocalizer);
  const editFormatter = withEditPrecision(currentFormatter);
  const { data: splits = [], isLoading } = useTransactionSplits(transactionId);
  const upsertSplits = useUpsertSplits();
  const clearSplits = useClearSplits();
  const updateTransactionColumn = useUpdateTransactionColumn();

  const createLineId = useCallback(
    () =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  const [editSplits, setEditSplits] = useState<EditableSplit[] | null>(null);
  // Edited transaction total while in edit mode; null = keep current total
  const [editTotal, setEditTotal] = useState<number | null>(null);
  const hasBootstrappedEdit = useRef(false);

  // Reset state when dialog closes - defer to avoid synchronous cascade
  useEffect(() => {
    if (!open) {
      const id = requestAnimationFrame(() => {
        setEditSplits(null);
        setEditTotal(null);
        hasBootstrappedEdit.current = false;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Bootstrap edit mode when dialog opens - defer to avoid synchronous cascade
  useEffect(() => {
    if (!open || !transaction || !startInEditMode) return;
    if (hasBootstrappedEdit.current) return;
    if (editSplits !== null) return;
    if (isLoading) return;
    const id = requestAnimationFrame(() => {
      if (splits.length > 0) {
        setEditSplits(
          splits.map((split, idx) => {
            const editable = toEditableSplit(split as SplitLike, idx);
            return {
              ...editable,
              id: editable.id || createLineId(),
              amount: extractSplitAmount(split as SplitLike),
            };
          })
        );
      } else {
        setEditSplits([]);
      }
      hasBootstrappedEdit.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [open, transaction, startInEditMode, editSplits, splits, isLoading, createLineId]);

  const totalAmount = useMemo(() => {
    if (!transaction) return 0;
    const inflow = getPrimaryInflow(transaction);
    const outflow = getPrimaryOutflow(transaction);
    return inflow > 0 ? inflow : outflow;
  }, [transaction, getPrimaryInflow, getPrimaryOutflow]);

  const isIncome = transaction ? getPrimaryInflow(transaction) > 0 : false;

  const displayedSplits = editSplits ?? splits;

  const formatSplitAmount = (split: SplitLike | null | undefined) => {
    if (!split || typeof split !== 'object') return currentFormatter.format(0);
    // Split amounts are stored milliunits.
    const value = extractSplitAmount(split);
    const prefix = value === 0 ? '' : isSplitIncomeAmount(split, isIncome) ? '+' : '-';
    return `${prefix}${formatMilli(currentFormatter, asMilli(value))}`;
  };

  const parentTotal = totalAmount;
  // The total the splits must add up to — editable while in edit mode.
  // All amounts here are exact integer milliunits.
  const targetTotal = editTotal ?? parentTotal;
  const draftTotal =
    editSplits?.reduce((sum, line) => sum + Math.abs(Number(line.amount) || 0), 0) ?? 0;
  const remaining = editSplits ? targetTotal - draftTotal : 0;
  const hasExistingSplits = splits.length > 0;
  const isClearing = Boolean(editSplits && editSplits.length === 0 && hasExistingSplits);
  const canSave =
    !!editSplits &&
    !upsertSplits.isPending &&
    !clearSplits.isPending &&
    !updateTransactionColumn.isPending &&
    ((editSplits.length > 0 &&
      targetTotal > 0 &&
      editSplits.every((line) => Number(line.amount) > 0) &&
      remaining === 0) ||
      isClearing);

  const startEditing = () => {
    setEditTotal(null);
    setEditSplits(
      (splits.length ? splits : []).map((split, idx) => {
        const editable = toEditableSplit(split as SplitLike, idx);
        return {
          ...editable,
          id: editable.id || createLineId(),
          amount: extractSplitAmount(split as SplitLike),
        };
      })
    );
  };

  const handleAddSplit = () => {
    setEditSplits((prev) => [
      ...(prev ?? []),
      {
        id: createLineId(),
        category_id: null,
        transfer_account_id: null,
        memo: '',
        amount: 0,
      },
    ]);
  };

  const handleUpdateSplit = (
    id: string,
    patch: Partial<{ memo: string; amount: number; category_id: number | null }>
  ) => {
    setEditSplits(
      (prev) => prev?.map((line) => (line.id === id ? { ...line, ...patch } : line)) ?? null
    );
  };

  const handleRemoveSplit = (id: string) => {
    setEditSplits((prev) => prev?.filter((line) => line.id !== id) ?? null);
  };

  const handleSave = async () => {
    if (!transaction || !editSplits) return;

    if (editSplits.length === 0) {
      if (hasExistingSplits) {
        await clearSplits.mutateAsync({ transactionId: transaction.ID });
      }
      setEditSplits(null);
      setEditTotal(null);
      onClose();
      return;
    }

    // If the user edited the original amount, sync the parent transaction
    // first — the splits service requires splits to sum to the parent total.
    // Both sides are exact integer milliunits.
    const currentParentAmount = isIncome ? transaction.Inflow || 0 : transaction.Outflow || 0;
    if (targetTotal !== currentParentAmount) {
      await updateTransactionColumn.mutateAsync({
        transactionId: transaction.ID,
        column: isIncome ? 'Inflow' : 'Outflow',
        value: targetTotal,
        accountId:
          (transaction as GetTransactionsByAccountRow & { AccountID?: number }).AccountID ?? 0,
      });
    }

    const type = isIncome ? 'inflow' : 'outflow';
    const prepared = editSplits.map((line, idx) => ({
      category_id: line.category_id ?? null,
      transfer_account_id: line.transfer_account_id ?? null,
      memo: line.memo ?? '',
      amount: Number(line.amount) || 0,
      order_index: idx,
    }));
    await upsertSplits.mutateAsync({
      transactionId: transaction.ID,
      splits: prepared,
      type,
    });
    setEditSplits(null);
    setEditTotal(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent style={{ width: '800px', maxWidth: '90vw' }}>
        <DialogHeader>
          <DialogTitle>Split details</DialogTitle>
          <DialogDescription className="truncate max-w-full" title={transaction?.Memo || ''}>
            {transaction ? transaction.Memo || `Transaction #${transaction.ID}` : ''}
          </DialogDescription>
        </DialogHeader>
        {transaction && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <div>
                <div className="text-muted-foreground">Original amount</div>
                {editSplits ? (
                  <div
                    className={cn(
                      'flex items-center gap-1 font-semibold',
                      isIncome ? 'text-green-600' : 'text-red-600'
                    )}
                  >
                    <span>{isIncome ? '+' : '-'}</span>
                    <CalculatorCell
                      value={asMilli(targetTotal)}
                      onCommit={(val) => setEditTotal(Math.abs(val) || 0)}
                      formatter={(val) => editGlobalLocalizer.format(val)}
                      localizer={globalLocalizer}
                      inputAlign="left"
                      placeholder="0.00"
                      className="min-w-[120px]"
                      inputClassName="h-8 font-mono"
                      displayClassName="bg-background border border-input hover:bg-muted/40 px-2 py-1 rounded-md text-left font-mono"
                    />
                  </div>
                ) : (
                  <div
                    className={cn('font-semibold', isIncome ? 'text-green-600' : 'text-red-600')}
                  >
                    {isIncome ? '+' : '-'}
                    {formatMilli(globalLocalizer, asMilli(parentTotal))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editSplits ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditSplits(null);
                        setEditTotal(null);
                      }}
                      disabled={upsertSplits.isPending}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={!canSave}>
                      {isClearing ? 'Remove splits' : 'Save'}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={startEditing}>
                    Edit splits
                  </Button>
                )}
              </div>
            </div>
            <Separator />
            {editSplits && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary">
                <span>
                  {remaining >= 0 ? 'Remaining' : 'Over by'}{' '}
                  <strong>{formatMilli(editGlobalLocalizer, asMilli(Math.abs(remaining)))}</strong>
                </span>
                <span>
                  Total:{' '}
                  <strong className={remaining === 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatMilli(editGlobalLocalizer, asMilli(draftTotal))}
                  </strong>{' '}
                  / {formatMilli(editGlobalLocalizer, asMilli(targetTotal))}
                </span>
              </div>
            )}
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading splits...
              </div>
            ) : displayedSplits.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {editSplits
                  ? 'No split lines yet. Add at least one line below.'
                  : 'No split lines for this transaction.'}
              </div>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                <Table className="text-sm table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Category / Transfer</TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead className="text-right w-[120px]">Amount</TableHead>
                      {editSplits && <TableHead className="w-[50px]" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedSplits.map((split, idx) => {
                      const s = split as SplitLike & Record<string, unknown>;
                      const editable =
                        editSplits?.find((line) => line.id === (s.id || s.ID || idx)) ||
                        (editSplits ? editSplits[idx] : split);
                      const isTransferLine =
                        Boolean(
                          (editable as EditableSplit)?.transfer_account_id ??
                            s.transfer_account_id ??
                            s.TransferAccountID
                        ) ||
                        Boolean(
                          (editable as unknown as Record<string, unknown>)?.transfer_account_name ??
                            s.transfer_account_name ??
                            s.TransferAccountName
                        );
                      return (
                        <TableRow key={String(s.id || s.ID || idx)}>
                          <TableCell className="text-sm">
                            {editSplits && !isTransferLine ? (
                              <SearchableCategorySelect
                                budgetId={budgetId}
                                selectedCategoryId={
                                  (editable as EditableSplit)?.category_id ?? null
                                }
                                onCategorySelect={(categoryId) =>
                                  handleUpdateSplit((editable as EditableSplit).id, {
                                    category_id: categoryId,
                                  })
                                }
                                placeholder="Choose category"
                                triggerClassName="h-8 w-full text-left"
                                popoverContentClassName="w-[320px]"
                                includeReadyToAssign
                                showAvailableForMonth
                                month={
                                  transaction?.Date
                                    ? String(transaction.Date).slice(0, 7)
                                    : undefined
                                }
                              />
                            ) : (
                              getSplitCategoryLabel(s)
                            )}
                            {isTransferLine && editSplits && (
                              <p className="text-[11px] text-muted-foreground">
                                Editing transfer splits is not supported.
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {editSplits ? (
                              <Input
                                value={(editable as EditableSplit)?.memo ?? ''}
                                className="h-8"
                                placeholder="Memo"
                                onChange={(e) =>
                                  handleUpdateSplit((editable as EditableSplit).id, {
                                    memo: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              String(s.memo || s.Memo || '-')
                            )}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right font-mono text-sm',
                              isSplitIncomeAmount((editable ?? s) as SplitLike, isIncome)
                                ? 'text-green-600'
                                : 'text-red-600 dark:text-red-400'
                            )}
                          >
                            {editSplits ? (
                              <div className="inline-flex min-w-[120px] justify-end">
                                <CalculatorCell
                                  value={asMilli(
                                    Math.abs((editable as EditableSplit)?.amount ?? 0)
                                  )}
                                  onCommit={(val) => {
                                    const editableSplit = editable as EditableSplit | undefined;
                                    if (editableSplit?.id) {
                                      handleUpdateSplit(editableSplit.id, {
                                        amount: Math.abs(val),
                                      });
                                    }
                                  }}
                                  formatter={(val) => editFormatter.format(val)}
                                  localizer={currentFormatter}
                                  inputAlign="right"
                                  placeholder="0.00"
                                  className="w-full max-w-[140px]"
                                  displayClassName="text-sm"
                                  inputClassName="text-right text-sm"
                                />
                              </div>
                            ) : (
                              formatSplitAmount(s as SplitLike)
                            )}
                          </TableCell>
                          {editSplits && (
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveSplit((editable as EditableSplit).id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {editSplits && (
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddSplit}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add split line
                </Button>
                <span className="text-xs text-muted-foreground">
                  Splits must total {formatMilli(editGlobalLocalizer, asMilli(targetTotal))}.
                </span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
