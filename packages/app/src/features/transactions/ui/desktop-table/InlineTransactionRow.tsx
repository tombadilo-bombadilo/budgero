import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { parseISO } from 'date-fns';
import { CornerDownRight, Plus, Split, X } from 'lucide-react';
import { toast } from 'sonner';
import { asMilli, convertScaled } from '@budgero/core/browser';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { TableCell, TableRow } from '@shared/ui/table';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { formatDate as format } from '@shared/lib/date-format';
import { formatMilli, ZERO_MILLI } from '@shared/lib/currency/milli';
import { buildCurrencyLocalizer } from '@shared/store/useUiStore';
import { getExchangeRate, saveManualRate } from '@entities/currency/lib/currency-utils';
import { ManualRatePrompt } from '@features/currencies/ui/ManualRatePrompt';
import { PayeeCombobox } from '@features/payees/ui/PayeeCombobox';
import { useAddTransactionHandler } from '@features/transactions/api/useAddTransactionHandler';
import type { TransactionType } from '@features/transactions/api/useTransactionForm';
import { useAddTransactionForm } from '@features/transactions/ui/add-transaction/useAddTransactionForm';
import { getCurrentDate } from '@features/transactions/ui/add-transaction/add-transaction.utils';
import { AccountSelectCell } from '@features/transactions/ui/cells/AccountSelectCell';
import { CategorySelectCell } from '@features/transactions/ui/cells/CategorySelectCell';
import { DatePickerCell } from '@features/transactions/ui/cells/DatePickerCell';
import { LabelSelectCell } from '@features/transactions/ui/cells/LabelSelectCell';
import {
  assignRemainingToSplit,
  newSplitLine,
  type SplitLine,
} from '@features/transactions/ui/form';
import { PayeeSelectCell } from '@features/transactions/ui/cells/PayeeSelectCell';
import type { TransactionEditorDirectories } from './transaction-editor-types';

interface InlineTransactionRowProps {
  budgetId: number;
  /** The register's account; the Account cell picks one when absent (all-accounts view). */
  accountId?: number;
  hideAccountColumn: boolean;
  showLabelColumn: boolean;
  showExchangeRateColumn: boolean;
  showBalanceColumn: boolean;
  columnCount: number;
  editorDirectories: TransactionEditorDirectories;
  onClose: () => void;
}

const cellTrigger = 'h-8 w-full truncate px-2 text-xs xl:text-sm';

function localizerFor(currency: string, numberFormat: string | undefined): Intl.NumberFormat {
  return buildCurrencyLocalizer(currency, numberFormat ?? '$1,096.56') ?? new Intl.NumberFormat();
}

/**
 * Add-transaction row at the top of the desktop register. It drives the same
 * form hook as the Add Transaction dialog, so saving, transfers (including
 * between currencies), splits, autofill and validation behave identically;
 * only the layout differs.
 */
export function InlineTransactionRow({
  budgetId,
  accountId,
  hideAccountColumn,
  showLabelColumn,
  showExchangeRateColumn,
  showBalanceColumn,
  columnCount,
  editorDirectories,
  onClose,
}: InlineTransactionRowProps) {
  const { t } = useLingui();
  const { handleAddTransaction, handleAddTransfer } = useAddTransactionHandler({
    onDialogClose: onClose,
  });
  const {
    form,
    accounts,
    categories,
    handleSubmit,
    transferInvolvesOffBudget,
    selectedBudget,
    isSplit,
    toggleSplit,
    splitLines,
    setSplitLines,
    remaining,
    parentSigned,
    receivedAmount,
    setReceivedAmount,
  } = useAddTransactionForm({
    budgetId,
    selectedAccountId: accountId,
    onAddTransaction: handleAddTransaction,
    onAddTransfer: handleAddTransfer,
    onCancel: onClose,
    disableLastUsed: true,
  });

  const [rowAccount, setRowAccount] = React.useState(accountId ? String(accountId) : '');
  const [transferAccount, setTransferAccount] = React.useState('');
  const [inflow, setInflow] = React.useState<number | null>(null);
  const [outflow, setOutflow] = React.useState<number | null>(null);
  // Cross-currency transfers: the other account's amount, when typed by hand.
  const [otherAmount, setOtherAmount] = React.useState<number | null>(null);
  // Rate-based estimate of what the other account sent (inflow transfers), keyed
  // by its inputs so a stale result is ignored.
  const [sentEstimate, setSentEstimate] = React.useState<{ key: string; value: number } | null>(
    null
  );
  const [amountEditing, setAmountEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Remounts the amount cells after "Save and add another" so they start empty.
  const [resetKey, setResetKey] = React.useState(0);
  const rowRef = React.useRef<HTMLTableRowElement>(null);

  React.useEffect(() => {
    rowRef.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [resetKey]);

  const accountById = (id: string) => accounts.find((account) => account.ID.toString() === id);
  const rowAccountRecord = accountById(rowAccount);
  const transferAccountRecord = accountById(transferAccount);
  const isInflow = (inflow ?? 0) !== 0;
  const isCrossCurrency =
    !!rowAccountRecord &&
    !!transferAccountRecord &&
    rowAccountRecord.Currency !== transferAccountRecord.Currency;
  const transactionDate = getCurrentDate(form.transactionDate);

  const sentKey =
    isCrossCurrency && isInflow
      ? `${inflow}:${rowAccountRecord.Currency}:${transferAccountRecord.Currency}:${transactionDate}`
      : null;
  const sentAuto = sentEstimate && sentEstimate.key === sentKey ? sentEstimate.value : null;

  // Inflow transfer between currencies: the typed inflow is what this account
  // received; estimate what the other account sent from the exchange rate.
  React.useEffect(() => {
    if (!sentKey || !rowAccountRecord || !transferAccountRecord || !selectedBudget) return;
    let cancelled = false;
    const received = inflow ?? 0;
    const from = rowAccountRecord.Currency;
    const to = transferAccountRecord.Currency;
    void getExchangeRate(from, to, transactionDate, selectedBudget.ID).then((rate) => {
      if (cancelled || !rate) return;
      setSentEstimate({ key: sentKey, value: asMilli(convertScaled(received, rate, from, to)) });
    });
    return () => {
      cancelled = true;
    };
  }, [sentKey, inflow, rowAccountRecord, transferAccountRecord, selectedBudget, transactionDate]);

  // Map the register's columns onto the dialog's form model: one amount plus a
  // type, and for transfers a from/to pair chosen by which column holds the
  // amount. Re-applied whenever the form drifts (it resets the received amount
  // itself when the accounts change).
  const desired: {
    type: TransactionType;
    from: string;
    to: string;
    amount: number | null;
    received: number | null;
  } = (() => {
    if (!transferAccount) {
      return {
        type: isInflow ? 'inflow' : 'outflow',
        from: rowAccount,
        to: '',
        amount: isInflow ? inflow : outflow,
        received: null,
      };
    }
    const from = isInflow ? transferAccount : rowAccount;
    const to = isInflow ? rowAccount : transferAccount;
    if (isCrossCurrency && isInflow) {
      return { type: 'transfer', from, to, amount: otherAmount ?? sentAuto, received: inflow };
    }
    return {
      type: 'transfer',
      from,
      to,
      amount: isInflow ? inflow : outflow,
      received: isCrossCurrency ? otherAmount : null,
    };
  })();
  const {
    setTransactionType,
    setFromAccount,
    setToAccount,
    setAmount,
    setAmountTouched,
    transactionType,
    selectedFromAccount,
    selectedToAccount,
    amount,
  } = form;
  React.useEffect(() => {
    if (transactionType !== desired.type) setTransactionType(desired.type);
    if (selectedFromAccount !== desired.from) setFromAccount(desired.from);
    if (selectedToAccount !== desired.to) setToAccount(desired.to);
    const nextAmount = desired.amount === null ? null : asMilli(desired.amount);
    if (amount !== nextAmount) {
      setAmount(nextAmount);
      setAmountTouched(nextAmount !== null);
    }
    const nextReceived = desired.received === null ? null : asMilli(desired.received);
    if (receivedAmount !== nextReceived) setReceivedAmount(nextReceived);
  }, [
    desired.type,
    desired.from,
    desired.to,
    desired.amount,
    desired.received,
    transactionType,
    selectedFromAccount,
    selectedToAccount,
    amount,
    receivedAmount,
    setTransactionType,
    setFromAccount,
    setToAccount,
    setAmount,
    setAmountTouched,
    setReceivedAmount,
  ]);

  const amountLocalizer = React.useMemo(
    () =>
      localizerFor(
        rowAccountRecord?.Currency ?? selectedBudget?.DisplayCurrency ?? 'USD',
        selectedBudget?.NumberFormat
      ),
    [rowAccountRecord?.Currency, selectedBudget?.DisplayCurrency, selectedBudget?.NumberFormat]
  );
  const otherLocalizer = React.useMemo(
    () => localizerFor(transferAccountRecord?.Currency ?? 'USD', selectedBudget?.NumberFormat),
    [transferAccountRecord?.Currency, selectedBudget?.NumberFormat]
  );

  const resetRow = () => {
    setTransferAccount('');
    setInflow(null);
    setOutflow(null);
    setOtherAmount(null);
    setResetKey((key) => key + 1);
  };

  const save = async (addAnother: boolean) => {
    if (saving || amountEditing) return;
    if (isInflow && (outflow ?? 0) !== 0) {
      toast.error(t`Enter either an inflow or an outflow`);
      return;
    }
    if (isCrossCurrency && isInflow && !form.amount && transferAccountRecord) {
      toast.error(t`Enter the amount sent from ${transferAccountRecord.Name}`);
      return;
    }
    if (!form.canSubmit) {
      toast.error(t`Enter an amount and an account`);
      return;
    }
    setSaving(true);
    try {
      await handleSubmit(addAnother);
    } finally {
      setSaving(false);
    }
    if (addAnother) resetRow();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // React bubbles events out of portaled popovers too; only react to keys
    // pressed inside the row itself, not inside an open picker.
    const target = e.target as HTMLElement;
    if (!target.closest?.('[data-inline-entry]')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      if (target.getAttribute?.('role') === 'combobox') return;
      e.preventDefault();
      void save(false);
    }
  };

  const handleRatePromptConfirm = async (rate: number, base: string, quote: string) => {
    if (selectedBudget) await saveManualRate(base, quote, rate, selectedBudget.ID);
    form.setShowRatePrompt(false);
    const pending = form.pendingAdd;
    if (!pending) return;
    form.setPendingAdd(null);
    await handleAddTransaction(
      pending.date,
      pending.category,
      pending.memo,
      pending.payee,
      pending.outflow,
      pending.inflow,
      pending.accountId,
      pending.labelId,
      pending.transferId,
      false
    );
  };

  const selectedCategoryId =
    categories.find((category) => category.Name === form.selectedCategory)?.ID ?? 0;
  const categoryIsAutomatic = !!transferAccount && !transferInvolvesOffBudget;
  const transferTargets = accounts.filter((account) => account.ID.toString() !== rowAccount);

  const renderAmountCell = (
    kind: 'inflow' | 'outflow' | 'other',
    value: number | null,
    onCommit: (value: number) => void,
    options: { currency?: string; localizer?: Intl.NumberFormat; cellKey: string }
  ) => {
    const colorClass =
      kind === 'inflow' ? 'text-success' : kind === 'outflow' ? 'text-destructive' : '';
    const localizer = options.localizer ?? amountLocalizer;
    return (
      <CalculatorCell
        key={`${options.cellKey}-${resetKey}`}
        value={asMilli(value ?? 0)}
        currencyCode={options.currency ?? rowAccountRecord?.Currency}
        onCommit={onCommit}
        zeroAsEmpty
        placeholder=""
        formatter={(val) => localizer.format(val)}
        displayFormatter={(val) => localizer.format(val)}
        localizer={localizer}
        inputAlign="right"
        className={`text-right font-medium ${colorClass}`}
        displayClassName={`${colorClass} rounded-md border border-input bg-background h-8`}
        inputClassName="text-right"
        useFormatterForDisplay
        onEditingChange={setAmountEditing}
      />
    );
  };

  const otherAmountValue = otherAmount ?? (isInflow ? sentAuto : form.convertedAmount);

  // Cells before the Inflow column, and after the Outflow column, so detail rows
  // can line up with the register's columns.
  const leadingColumns = 5 + (hideAccountColumn ? 0 : 1) + (showLabelColumn ? 1 : 0);
  const trailingCells = (
    <>
      {showExchangeRateColumn && <TableCell />}
      {showBalanceColumn && <TableCell />}
    </>
  );
  const rowTint = 'bg-primary/[0.04] hover:bg-primary/[0.04]';

  const updateSplitLine = (id: string, updates: Partial<SplitLine>) =>
    setSplitLines(splitLines.map((line) => (line.id === id ? { ...line, ...updates } : line)));

  const startSplit = () => {
    toggleSplit();
    if (splitLines.length === 0) setSplitLines([newSplitLine(), newSplitLine()]);
  };

  return (
    <>
      <TableRow
        ref={rowRef}
        className={`h-12 ${rowTint}`}
        onKeyDown={handleKeyDown}
        data-inline-entry
        data-testid="inline-transaction-row"
      >
        <TableCell />

        <TableCell>
          <DatePickerCell
            value={form.transactionDate ? format(form.transactionDate, 'yyyy-MM-dd') : null}
            onCommit={(next) => form.setDate(next ? parseISO(next) : null)}
          />
        </TableCell>

        <TableCell className="max-w-[220px]">
          <Input
            value={form.memo}
            onChange={(e) => form.setMemo(e.target.value)}
            placeholder={t`Memo`}
            aria-label={t`Memo`}
            className="h-8 text-xs xl:text-sm"
          />
        </TableCell>

        {!hideAccountColumn && (
          <TableCell className="max-w-[200px]">
            <AccountSelectCell
              accountName={rowAccountRecord?.Name ?? ''}
              accounts={accounts}
              onCommit={(id) => setRowAccount(String(id))}
              triggerClassName={cellTrigger}
            />
          </TableCell>
        )}

        <TableCell className="max-w-[200px]">
          <PayeeCombobox
            budgetId={budgetId}
            value={form.payee}
            payees={editorDirectories.payees}
            onChange={(payee) => {
              form.setPayee(payee);
              setTransferAccount('');
              setOtherAmount(null);
            }}
            transferAccounts={isSplit ? undefined : transferTargets}
            onSelectTransfer={(id) => {
              form.setPayee('');
              setTransferAccount(String(id));
              setOtherAmount(null);
            }}
            displayValue={
              transferAccountRecord ? t`Transfer: ${transferAccountRecord.Name}` : undefined
            }
            placeholder={t`Payee`}
            triggerClassName={cellTrigger}
          />
        </TableCell>

        {showLabelColumn && (
          <TableCell className="max-w-[180px]">
            <LabelSelectCell
              budgetId={budgetId}
              value={form.selectedLabelId}
              labels={editorDirectories.labels}
              onCommit={form.setLabelId}
              triggerClassName={cellTrigger}
            />
          </TableCell>
        )}

        <TableCell className="max-w-[240px] overflow-hidden">
          {isSplit ? (
            <Badge variant="secondary">
              <Trans>Split</Trans>
            </Badge>
          ) : categoryIsAutomatic ? (
            <div
              className="h-8 truncate rounded-md bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground xl:text-sm"
              title={t`Category is set automatically for on-budget transfers`}
            >
              <Trans>Transfers</Trans>
            </div>
          ) : (
            <div className="min-w-0 text-xs [&>div]:w-full xl:text-sm">
              <CategorySelectCell
                budgetId={budgetId}
                categoryID={selectedCategoryId}
                categories={editorDirectories.categories}
                categoryGroups={editorDirectories.categoryGroups}
                monthlyRows={editorDirectories.monthlyRows}
                readyToAssignAmount={editorDirectories.readyToAssignAmount}
                onCommit={(id) =>
                  form.setCategory(categories.find((category) => category.ID === id)?.Name ?? '')
                }
                triggerClassName={cellTrigger}
                includeTransfers={transferInvolvesOffBudget}
              />
            </div>
          )}
        </TableCell>

        <TableCell className="text-right font-mono text-xs">
          {renderAmountCell('inflow', inflow, setInflow, { cellKey: 'inflow' })}
        </TableCell>
        <TableCell className="text-right font-mono text-xs">
          {renderAmountCell('outflow', outflow, setOutflow, { cellKey: 'outflow' })}
        </TableCell>

        {trailingCells}
        <TableCell />
      </TableRow>

      {isCrossCurrency && transferAccountRecord && (
        <TableRow className={rowTint} onKeyDown={handleKeyDown} data-inline-entry>
          <TableCell
            colSpan={leadingColumns}
            className="py-1 text-right text-xs text-muted-foreground"
          >
            {isInflow ? (
              <Trans>
                Sent from {transferAccountRecord.Name} ({transferAccountRecord.Currency})
              </Trans>
            ) : (
              <Trans>
                Received in {transferAccountRecord.Name} ({transferAccountRecord.Currency})
              </Trans>
            )}
          </TableCell>
          {(['inflow', 'outflow'] as const).map((column) => (
            <TableCell key={column} className="py-1 text-right font-mono text-xs">
              {(column === 'inflow') === isInflow &&
                renderAmountCell('other', otherAmountValue, setOtherAmount, {
                  cellKey: `other-${transferAccount}`,
                  currency: transferAccountRecord.Currency,
                  localizer: otherLocalizer,
                })}
            </TableCell>
          ))}
          {trailingCells}
          <TableCell />
        </TableRow>
      )}

      {isSplit &&
        splitLines.map((line) => (
          <TableRow
            key={line.id}
            className={rowTint}
            onKeyDown={handleKeyDown}
            data-inline-entry
            data-testid="inline-split-line"
          >
            <TableCell />
            <TableCell className="py-1 text-right text-muted-foreground">
              <CornerDownRight className="ml-auto h-4 w-4" />
            </TableCell>
            <TableCell className="max-w-[220px] py-1">
              <Input
                value={line.memo ?? ''}
                onChange={(e) => updateSplitLine(line.id, { memo: e.target.value })}
                placeholder={t`Memo`}
                aria-label={t`Split memo`}
                className="h-8 text-xs xl:text-sm"
              />
            </TableCell>
            {!hideAccountColumn && <TableCell />}
            <TableCell className="max-w-[200px] py-1">
              <PayeeSelectCell
                budgetId={budgetId}
                value={line.payee ?? ''}
                payees={editorDirectories.payees}
                onCommit={(payee) => updateSplitLine(line.id, { payee })}
                triggerClassName={cellTrigger}
              />
            </TableCell>
            {showLabelColumn && <TableCell />}
            <TableCell className="max-w-[240px] overflow-hidden py-1">
              <div className="min-w-0 text-xs [&>div]:w-full xl:text-sm">
                <CategorySelectCell
                  budgetId={budgetId}
                  categoryID={line.categoryId ?? 0}
                  categories={editorDirectories.categories}
                  categoryGroups={editorDirectories.categoryGroups}
                  monthlyRows={editorDirectories.monthlyRows}
                  readyToAssignAmount={editorDirectories.readyToAssignAmount}
                  onCommit={(categoryId) =>
                    updateSplitLine(line.id, { categoryId, transferAccountId: undefined })
                  }
                  triggerClassName={cellTrigger}
                />
              </div>
            </TableCell>
            <TableCell className="py-1 text-right font-mono text-xs">
              {renderAmountCell(
                'inflow',
                line.inflow,
                (val) =>
                  updateSplitLine(line.id, {
                    inflow: asMilli(Math.abs(val)),
                    ...(val ? { outflow: ZERO_MILLI } : {}),
                  }),
                { cellKey: `${line.id}-inflow-${line.outflow}` }
              )}
            </TableCell>
            <TableCell className="py-1 text-right font-mono text-xs">
              {renderAmountCell(
                'outflow',
                line.outflow,
                (val) =>
                  updateSplitLine(line.id, {
                    outflow: asMilli(Math.abs(val)),
                    ...(val ? { inflow: ZERO_MILLI } : {}),
                  }),
                { cellKey: `${line.id}-outflow-${line.inflow}` }
              )}
            </TableCell>
            {trailingCells}
            <TableCell className="py-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t`Remove split line`}
                onClick={() => setSplitLines(splitLines.filter((l) => l.id !== line.id))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}

      {isSplit && (
        <TableRow className={rowTint} onKeyDown={handleKeyDown} data-inline-entry>
          <TableCell colSpan={leadingColumns} className="py-1">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setSplitLines([...splitLines, newSplitLine()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                <Trans>Add line</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() =>
                  setSplitLines(assignRemainingToSplit(splitLines, remaining, parentSigned))
                }
              >
                <Trans>Assign remaining</Trans>
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                <Trans>Remaining to assign</Trans>
              </span>
            </div>
          </TableCell>
          {(['inflow', 'outflow'] as const).map((column) => (
            <TableCell
              key={column}
              className={`py-1 pr-4 text-right font-mono text-xs ${
                column === 'inflow' ? 'text-success' : 'text-destructive'
              }`}
              data-testid={`inline-split-remaining-${column}`}
            >
              {(column === 'inflow' ? remaining > 0 : remaining < 0) &&
                formatMilli(amountLocalizer, asMilli(Math.abs(remaining)))}
            </TableCell>
          ))}
          {trailingCells}
          <TableCell />
        </TableRow>
      )}

      <TableRow className={rowTint} onKeyDown={handleKeyDown} data-inline-entry>
        <TableCell colSpan={columnCount} className="py-1.5">
          <div className="flex items-center justify-end gap-2">
            {!transferAccount && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mr-auto h-7"
                onClick={isSplit ? toggleSplit : startSplit}
              >
                <Split className="mr-1 h-3.5 w-3.5" />
                {isSplit ? <Trans>Remove split</Trans> : <Trans>Split</Trans>}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              disabled={saving}
              onClick={() => void save(true)}
            >
              <Trans>Save and add another</Trans>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={saving}
              onClick={() => void save(false)}
            >
              <Trans>Save</Trans>
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {form.showRatePrompt && form.pendingRatePair && (
        <ManualRatePrompt
          from={form.pendingRatePair.from}
          to={form.pendingRatePair.to}
          budgetId={selectedBudget?.ID}
          rateDate={transactionDate}
          onCancel={() => form.setShowRatePrompt(false)}
          onConfirm={handleRatePromptConfirm}
        />
      )}
    </>
  );
}
