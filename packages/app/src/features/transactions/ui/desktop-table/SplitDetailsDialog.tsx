import { Trans, useLingui } from '@lingui/react/macro';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import {
  useTransactionSplits,
  useSaveSplits,
  useClearSplits,
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
import { PayeeSelectCell } from '@features/transactions/ui/cells/PayeeSelectCell';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { withEditPrecision } from '@shared/lib/number-format';
import {
  type SplitLike,
  type EditableSplit,
  extractSplitFlows,
  toEditableSplit,
  getSplitCategoryLabel,
} from './table-utils';
import { SplitMemoText } from './SplitMemoText';

interface SplitDetailsDialogProps {
  transaction: GetTransactionsByAccountRow | null;
  startInEditMode?: boolean;
  onClose: () => void;
  currentFormatter: Intl.NumberFormat;
  transactionCurrencyDisplay: 'budget' | 'account';
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  budgetId: number;
}

export function SplitDetailsDialog({
  transaction,
  startInEditMode = false,
  onClose,
  currentFormatter,
  transactionCurrencyDisplay,
  getPrimaryInflow,
  getPrimaryOutflow,
  budgetId,
}: SplitDetailsDialogProps) {
  const { t } = useLingui();

  const open = Boolean(transaction);
  const transactionId = transaction ? transaction.ID : null;
  // Edit surfaces must show real cents even under a zero-decimal display format.
  const editFormatter = withEditPrecision(currentFormatter);
  const amountCurrency = transactionCurrencyDisplay === 'account' ? 'native' : 'converted';
  const { data: splits = [], isLoading } = useTransactionSplits(transactionId);
  const saveSplits = useSaveSplits();
  const clearSplits = useClearSplits();

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
            const editable = toEditableSplit(split as SplitLike, idx, amountCurrency);
            return {
              ...editable,
              id: editable.id || createLineId(),
            };
          })
        );
      } else {
        setEditSplits([]);
      }
      hasBootstrappedEdit.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [
    open,
    transaction,
    startInEditMode,
    editSplits,
    splits,
    isLoading,
    createLineId,
    amountCurrency,
  ]);

  const parentNet = useMemo(() => {
    if (!transaction) return 0;
    return getPrimaryInflow(transaction) - getPrimaryOutflow(transaction);
  }, [transaction, getPrimaryInflow, getPrimaryOutflow]);

  const isIncome = parentNet > 0;

  const displayedSplits = editSplits ?? splits;

  const parentTotal = Math.abs(parentNet);
  // The total the splits must add up to — editable while in edit mode.
  // All amounts here are exact integer milliunits.
  const targetTotal = editTotal ?? parentTotal;
  const targetNet = (isIncome ? 1 : -1) * targetTotal;
  const draftNet =
    editSplits?.reduce(
      (sum, line) => sum + (Number(line.inflow) || 0) - (Number(line.outflow) || 0),
      0
    ) ?? 0;
  const remaining = editSplits ? targetNet - draftNet : 0;
  const hasExistingSplits = splits.length > 0;
  const isClearing = Boolean(editSplits && editSplits.length === 0 && hasExistingSplits);
  const canSave =
    !!editSplits &&
    !saveSplits.isPending &&
    !clearSplits.isPending &&
    ((editSplits.length > 0 &&
      targetTotal > 0 &&
      editSplits.every(
        (line) =>
          (Number(line.inflow) > 0 && Number(line.outflow) === 0) ||
          (Number(line.outflow) > 0 && Number(line.inflow) === 0)
      ) &&
      remaining === 0) ||
      isClearing);

  const startEditing = () => {
    setEditTotal(null);
    setEditSplits(
      (splits.length ? splits : []).map((split, idx) => {
        const editable = toEditableSplit(split as SplitLike, idx, amountCurrency);
        return {
          ...editable,
          id: editable.id || createLineId(),
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
        payee: '',
        inflow: 0,
        outflow: 0,
      },
    ]);
  };

  const handleUpdateSplit = (
    id: string,
    patch: Partial<{
      memo: string;
      payee: string;
      inflow: number;
      outflow: number;
      category_id: number | null;
    }>
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

    // A changed total is saved with the lines in one op, so the parent and its
    // lines can never disagree. Both sides are exact integer milliunits.
    const currentParentInflow =
      amountCurrency === 'native'
        ? (transaction.InflowNative ?? transaction.InflowConverted ?? 0)
        : transaction.InflowConverted || 0;
    const currentParentOutflow =
      amountCurrency === 'native'
        ? (transaction.OutflowNative ?? transaction.OutflowConverted ?? 0)
        : transaction.OutflowConverted || 0;
    const total =
      targetNet !== currentParentInflow - currentParentOutflow
        ? {
            inflow: targetNet >= 0 ? targetNet : 0,
            outflow: targetNet >= 0 ? 0 : Math.abs(targetNet),
          }
        : undefined;

    const prepared = editSplits.map((line, idx) => ({
      category_id: line.category_id ?? null,
      transfer_account_id: line.transfer_account_id ?? null,
      memo: line.memo ?? '',
      payee: line.payee ?? '',
      inflow: Number(line.inflow) || 0,
      outflow: Number(line.outflow) || 0,
      order_index: idx,
    }));
    await saveSplits.mutateAsync({
      transactionId: transaction.ID,
      splits: prepared,
      amountCurrency,
      total,
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
      <DialogContent style={{ width: '1100px', maxWidth: '94vw' }}>
        <DialogHeader>
          <DialogTitle>
            <Trans>Split details</Trans>
          </DialogTitle>
          <DialogDescription className="truncate max-w-full" title={transaction?.Memo || ''}>
            {transaction ? transaction.Memo || t`Transaction #${transaction.ID}` : ''}
          </DialogDescription>
        </DialogHeader>
        {transaction && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <div>
                <div className="text-muted-foreground">
                  <Trans>Original amount</Trans>
                </div>
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
                      formatter={(val) => editFormatter.format(val)}
                      localizer={currentFormatter}
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
                    {formatMilli(currentFormatter, asMilli(parentTotal))}
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
                      disabled={saveSplits.isPending}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={!canSave}>
                      {isClearing ? t`Remove splits` : t`Save`}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={startEditing}>
                    <Trans>Edit splits</Trans>
                  </Button>
                )}
              </div>
            </div>
            <Separator />
            {editSplits && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary">
                <span>
                  <Trans>
                    Net remaining{' '}
                    <strong>{formatMilli(editFormatter, asMilli(Math.abs(remaining)))}</strong>
                  </Trans>
                </span>
                <span>
                  <Trans>
                    Net total:{' '}
                    <strong className={remaining === 0 ? 'text-green-600' : 'text-red-600'}>
                      {draftNet > 0 ? '+' : draftNet < 0 ? '-' : ''}
                      {formatMilli(editFormatter, asMilli(Math.abs(draftNet)))}
                    </strong>{' '}
                    / {targetNet > 0 ? '+' : '-'}
                    {formatMilli(editFormatter, asMilli(targetTotal))}
                  </Trans>
                </span>
              </div>
            )}
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Trans>Loading splits...</Trans>
              </div>
            ) : displayedSplits.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {editSplits
                  ? t`No split lines yet. Add at least one line below.`
                  : t`No split lines for this transaction.`}
              </div>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                <Table className="text-sm table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">
                        <Trans>Category / Transfer</Trans>
                      </TableHead>
                      <TableHead className="w-[180px]">
                        <Trans>Payee</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>Memo</Trans>
                      </TableHead>
                      <TableHead className="w-[115px] text-right">
                        <Trans>Outflow</Trans>
                      </TableHead>
                      <TableHead className="w-[115px] text-right">
                        <Trans>Inflow</Trans>
                      </TableHead>
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
                                placeholder={t`Choose category`}
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
                                <Trans>Editing transfer splits is not supported.</Trans>
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal text-xs text-muted-foreground">
                            {editSplits ? (
                              <PayeeSelectCell
                                budgetId={budgetId}
                                value={(editable as EditableSplit)?.payee ?? ''}
                                onCommit={(payee) =>
                                  handleUpdateSplit((editable as EditableSplit).id, { payee })
                                }
                                triggerClassName="h-8 w-full"
                              />
                            ) : (
                              String(s.payee || s.Payee || transaction?.Payee || '-')
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {editSplits ? (
                              <Input
                                value={(editable as EditableSplit)?.memo ?? ''}
                                className="h-8"
                                placeholder={t`Memo`}
                                onChange={(e) =>
                                  handleUpdateSplit((editable as EditableSplit).id, {
                                    memo: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              <SplitMemoText memo={String(s.memo || s.Memo || '')} />
                            )}
                          </TableCell>
                          {(['outflow', 'inflow'] as const).map((flow) => {
                            const flows = extractSplitFlows(
                              (editable ?? s) as SplitLike,
                              amountCurrency
                            );
                            const value = flows[flow];
                            return (
                              <TableCell
                                key={flow}
                                className={cn(
                                  'text-right font-mono text-sm',
                                  flow === 'inflow'
                                    ? 'text-green-600'
                                    : 'text-red-600 dark:text-red-400'
                                )}
                              >
                                {editSplits ? (
                                  <CalculatorCell
                                    value={asMilli(value)}
                                    onCommit={(val) => {
                                      const editableSplit = editable as EditableSplit | undefined;
                                      if (!editableSplit?.id) return;
                                      handleUpdateSplit(editableSplit.id, {
                                        [flow]: Math.abs(val),
                                        ...(val
                                          ? { [flow === 'inflow' ? 'outflow' : 'inflow']: 0 }
                                          : {}),
                                      });
                                    }}
                                    formatter={(val) => editFormatter.format(val)}
                                    localizer={currentFormatter}
                                    inputAlign="right"
                                    placeholder="0.00"
                                    className="w-full"
                                    displayClassName="text-sm"
                                    inputClassName="text-right text-sm"
                                    zeroAsEmpty
                                  />
                                ) : value ? (
                                  formatMilli(currentFormatter, asMilli(value))
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            );
                          })}
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
                  <Trans>
                    <Plus className="h-4 w-4" />
                    Add split line
                  </Trans>
                </Button>
                <span className="text-xs text-muted-foreground">
                  <Trans>
                    Splits must total {formatMilli(editFormatter, asMilli(targetTotal))}.
                  </Trans>
                </span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
