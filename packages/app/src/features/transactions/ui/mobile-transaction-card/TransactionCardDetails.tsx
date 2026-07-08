import React from 'react';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Input } from '@shared/ui/input';
import {
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  Calendar as CalendarIcon,
  User,
  Tag,
  Tags,
  CreditCard,
  FileText,
  Split,
} from 'lucide-react';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { DatePickerCell } from '@features/transactions/ui/cells/DatePickerCell';
import { CategorySelectCell } from '@features/transactions/ui/cells/CategorySelectCell';
import { AccountSelectCell } from '@features/transactions/ui/cells/AccountSelectCell';
import { PayeeSelectCell } from '@features/transactions/ui/cells/PayeeSelectCell';
import { LabelSelectCell } from '@features/transactions/ui/cells/LabelSelectCell';
import { EditableCell } from '@features/transactions/ui/cells/EditableCell';
import { ExchangeRateCell } from '@features/transactions/ui/cells/ExchangeRateCell';
import { SecondaryAmount } from '@features/transactions/ui/SecondaryAmount';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import type { GetTransactionsByAccountRow, TransactionSplit } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { asMilli } from '@shared/lib/currency/milli';
import type { SplitLine } from './useMobileTransactionCardState';

/** Combined split type supporting both TransactionSplit and SplitLine properties */
interface SplitDisplayItem {
  id?: number;
  ID?: number;
  category_id?: number | null;
  CategoryID?: number | null;
  category_name?: string;
  CategoryName?: string;
  transfer_account_id?: number | null;
  TransferAccountID?: number | null;
  transfer_account_name?: string;
  TransferAccountName?: string;
  memo?: string;
  Memo?: string;
  amount?: number;
  inflow?: number;
  Inflow?: number;
  outflow?: number;
  Outflow?: number;
}

interface TransactionCardDetailsProps {
  transaction: GetTransactionsByAccountRow;
  budgetId: number;
  selectedBudgetId: number;
  currentFormatter: Intl.NumberFormat;
  accountLocalizer: Intl.NumberFormat;
  globalLocalizer: Intl.NumberFormat;
  transactionCurrencyDisplay: 'budget' | 'account';
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  getSecondaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getSecondaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  onCellCommit: (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => void;
  hideAccountColumn?: boolean;
  hideSecondaryAmounts?: boolean;
  displayCategoryOverride?: string;
  readOnlyCategory?: boolean;

  // Split-related props
  splits: TransactionSplit[];
  splitsLoading: boolean;
  editSplits: SplitLine[] | null;
  showSplitSection: boolean;
  canSplitTransaction: boolean;
  isClearingSplits: boolean;
  splitSaveDisabled: boolean;
  remainingAmount: number;
  splitTarget: number;
  onSplitTargetChange: (value: number) => void;
  onStartSplit: () => void;
  onCancelEditSplits: () => void;
  onInitEditSplitsFromExisting: () => void;
  onAddSplitLine: () => void;
  onRemoveSplitLine: (idx: number) => void;
  onUpdateSplitLine: (idx: number, updates: Partial<SplitLine>) => void;
  onSaveSplits: () => void;
}

export const TransactionCardDetails = React.memo(function TransactionCardDetails({
  transaction,
  budgetId,
  selectedBudgetId,
  currentFormatter,
  accountLocalizer,
  globalLocalizer,
  transactionCurrencyDisplay,
  getPrimaryInflow,
  getPrimaryOutflow,
  getSecondaryInflow,
  getSecondaryOutflow,
  onCellCommit,
  hideAccountColumn = false,
  hideSecondaryAmounts = false,
  displayCategoryOverride,
  readOnlyCategory = false,

  splits,
  splitsLoading,
  editSplits,
  showSplitSection,
  canSplitTransaction,
  isClearingSplits,
  splitSaveDisabled,
  remainingAmount,
  splitTarget,
  onSplitTargetChange,
  onStartSplit,
  onCancelEditSplits,
  onInitEditSplitsFromExisting,
  onAddSplitLine,
  onRemoveSplitLine,
  onUpdateSplitLine,
  onSaveSplits,
}: TransactionCardDetailsProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  // Split/transaction amounts are stored milliunits.
  const formatAmount = (formatter: Intl.NumberFormat, value: number) =>
    formatMaskedMilli(formatter, value, privacyMaskNumbers);

  const categoryValue = displayCategoryOverride || transaction.Category;
  const isSplit = categoryValue === 'Split' || editSplits !== null;

  // Hide inflow/outflow fields when transaction has splits - amounts are managed via split details
  const hasSplits = splits.length > 0;

  return (
    <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
      {/* Inflow/Outflow Grid - hidden for split transactions */}
      {!hasSplits && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Inflow */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ArrowDown className="h-4 w-4 text-success flex-shrink-0" />
              <div className="flex-1">
                <div className="[&>div]:w-full">
                  <CalculatorCell
                    value={asMilli(getPrimaryInflow(transaction) || 0)}
                    onCommit={(newVal) => onCellCommit(transaction.ID, 'Inflow', newVal)}
                    formatter={(val) => currentFormatter.format(val)}
                    displayFormatter={(val) => currentFormatter.format(val)}
                    localizer={currentFormatter}
                    inputAlign="center"
                    placeholder="100 + 25 or 150 / 2"
                    className="text-success"
                    inputClassName="h-10 text-center font-semibold text-success"
                    displayClassName="bg-background border border-input hover:bg-muted/40 px-3 py-2 rounded-md font-mono text-success shadow-sm"
                    useFormatterForDisplay
                  />
                </div>
              </div>
            </div>
            {!hideSecondaryAmounts && (
              <SecondaryAmount
                amount={transaction.Inflow}
                originalAmount={transaction.InflowOriginal}
                value={getSecondaryInflow(transaction)}
                transactionCurrencyDisplay={transactionCurrencyDisplay}
                accountLocalizer={accountLocalizer}
                globalLocalizer={globalLocalizer}
                approxPrefix="≈ +"
                compare="strict"
              />
            )}
          </div>

          {/* Outflow */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ArrowUp className="h-4 w-4 text-destructive flex-shrink-0" />
              <div className="flex-1">
                <div className="[&>div]:w-full">
                  <CalculatorCell
                    value={asMilli(getPrimaryOutflow(transaction) || 0)}
                    onCommit={(newVal) => onCellCommit(transaction.ID, 'Outflow', newVal)}
                    formatter={(val) => currentFormatter.format(val)}
                    displayFormatter={(val) => currentFormatter.format(val)}
                    localizer={currentFormatter}
                    inputAlign="center"
                    placeholder="100 - 25 or 50 * 2"
                    className="text-destructive"
                    inputClassName="h-10 text-center font-semibold text-destructive"
                    displayClassName="bg-background border border-input hover:bg-muted/40 px-3 py-2 rounded-md font-mono text-destructive shadow-sm"
                    useFormatterForDisplay
                  />
                </div>
              </div>
            </div>
            {!hideSecondaryAmounts && (
              <SecondaryAmount
                amount={transaction.Outflow}
                originalAmount={transaction.OutflowOriginal}
                value={getSecondaryOutflow(transaction)}
                transactionCurrencyDisplay={transactionCurrencyDisplay}
                accountLocalizer={accountLocalizer}
                globalLocalizer={globalLocalizer}
                approxPrefix="≈ -"
                compare="strict"
              />
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {/* Date Field */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="[&>div]:text-sm [&>button]:text-sm [&>button]:p-2 [&>button]:h-9 [&>button]:bg-muted/30 [&>button]:border-0 [&>button]:shadow-none [&>button]:hover:bg-muted/50 [&>button]:justify-start [&>button]:w-full [&>button]:truncate">
                <DatePickerCell
                  value={transaction.Date}
                  onCommit={(newVal) => onCellCommit(transaction.ID, 'Date', newVal)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Payee Field */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="[&>button]:text-sm [&>button]:p-2 [&>button]:h-9 [&>button]:bg-muted/30 [&>button]:border-0 [&>button]:shadow-none [&>button]:hover:bg-muted/50 [&>button]:justify-between [&>button]:font-normal [&>button]:w-full [&>button]:truncate">
                <PayeeSelectCell
                  budgetId={budgetId}
                  value={transaction.Payee ?? ''}
                  onCommit={(newVal) => onCellCommit(transaction.ID, 'Payee', newVal)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Label Field */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="[&>button]:text-sm [&>button]:p-2 [&>button]:h-9 [&>button]:bg-muted/30 [&>button]:border-0 [&>button]:shadow-none [&>button]:hover:bg-muted/50 [&>button]:justify-between [&>button]:font-normal [&>button]:w-full [&>button]:truncate">
                <LabelSelectCell
                  budgetId={budgetId}
                  value={transaction.LabelID ?? null}
                  onCommit={(newVal) => onCellCommit(transaction.ID, 'LabelID', newVal)}
                  triggerClassName="h-9 text-sm bg-muted/30 border-0 shadow-none hover:bg-muted/50 rounded-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Account Field (if not hidden) */}
        {!hideAccountColumn && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="[&>button]:text-sm [&>button]:p-2 [&>button]:h-9 [&>button]:bg-muted/30 [&>button]:border-0 [&>button]:shadow-none [&>button]:hover:bg-muted/50 [&>button]:justify-between [&>button]:font-normal [&>button]:w-full [&>button]:truncate">
                  <AccountSelectCell
                    accountName={transaction.Account}
                    onCommit={(newVal) => onCellCommit(transaction.ID, 'AccountID', newVal)}
                    triggerClassName="h-9 text-sm w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Category Field */}
        <div className="space-y-1">
          <div className="flex items-start gap-2">
            <Tag className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {isSplit ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Split</Badge>
                  <span className="text-xs text-muted-foreground">
                    Categories managed per split line
                  </span>
                </div>
              ) : readOnlyCategory ? (
                <div className="text-sm p-2 bg-muted/30 rounded-md truncate">
                  {displayCategoryOverride || transaction.Category || 'Unknown'}
                </div>
              ) : (
                <div className="[&>div]:text-sm [&>button]:text-sm [&>button]:p-2 [&>button]:h-9 [&>button]:bg-muted/30 [&>button]:border-0 [&>button]:shadow-none [&>button]:hover:bg-muted/50 [&>button]:justify-between [&>button]:font-normal [&>button]:w-full [&>button]:truncate">
                  <CategorySelectCell
                    categoryID={transaction.CategoryID}
                    onCommit={(newVal) => onCellCommit(transaction.ID, 'CategoryID', newVal)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Split prompt (when no splits exist) */}
        {!showSplitSection && canSplitTransaction && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Split className="h-4 w-4" />
              <span>Need to split this transaction across categories?</span>
            </div>
            <Button variant="outline" size="sm" onClick={onStartSplit}>
              Split transaction
            </Button>
          </div>
        )}

        {/* Split details */}
        {showSplitSection && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Split details</div>
              {editSplits ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={onCancelEditSplits}>
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={splitSaveDisabled}
                    onClick={onSaveSplits}
                  >
                    {isClearingSplits ? 'Remove splits' : 'Save'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={onInitEditSplitsFromExisting}>
                    Edit
                  </Button>
                </div>
              )}
            </div>

            {/* List */}
            <div className="rounded-md border border-border/50 divide-y">
              {splitsLoading ? (
                <div className="p-2 text-xs text-muted-foreground">Loading splits...</div>
              ) : (editSplits || splits).length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">No split lines yet.</div>
              ) : (
                (editSplits || (splits as SplitDisplayItem[])).map(
                  (s: SplitDisplayItem, idx: number) => (
                    <div key={s.id ?? s.ID ?? idx} className="p-2 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          {editSplits ? (
                            <SearchableCategorySelect
                              budgetId={selectedBudgetId || 0}
                              selectedCategoryId={s.category_id ?? s.CategoryID ?? null}
                              onCategorySelect={(categoryId) =>
                                onUpdateSplitLine(idx, {
                                  category_id: categoryId,
                                  transfer_account_id: undefined,
                                })
                              }
                              triggerClassName="h-8 w-full"
                              popoverContentClassName="w-[280px]"
                            />
                          ) : (
                            <span className="truncate text-sm font-medium text-foreground">
                              {s.category_name ||
                                s.CategoryName ||
                                ((s.category_id ?? s.CategoryID)
                                  ? `Category #${s.category_id ?? s.CategoryID}`
                                  : (s.transfer_account_id ?? s.TransferAccountID)
                                    ? `Transfer to ${
                                        s.transfer_account_name ||
                                        s.TransferAccountName ||
                                        `#${s.transfer_account_id ?? s.TransferAccountID}`
                                      }`
                                    : '—')}
                            </span>
                          )}
                        </div>
                        {editSplits && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-shrink-0"
                            onClick={() => onRemoveSplitLine(idx)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>

                      <div>
                        {editSplits ? (
                          <Input
                            className="h-8"
                            placeholder="Memo"
                            value={s.memo ?? s.Memo ?? ''}
                            onChange={(e) => onUpdateSplitLine(idx, { memo: e.target.value })}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground block truncate">
                            {s.memo ?? s.Memo ?? 'No memo'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground gap-3">
                        <span>Amount</span>
                        {editSplits ? (
                          <CalculatorCell
                            value={asMilli(
                              s.amount ?? s.inflow ?? s.Inflow ?? s.outflow ?? s.Outflow ?? 0
                            )}
                            onCommit={(val) => onUpdateSplitLine(idx, { amount: val })}
                            formatter={(val) => currentFormatter.format(val)}
                            localizer={currentFormatter}
                            inputAlign="right"
                            placeholder="0.00"
                            className="w-28"
                            inputClassName="h-8 text-right font-mono"
                            displayClassName="text-right font-mono"
                            zeroAsEmpty
                          />
                        ) : (
                          (() => {
                            const outflowAmount = s.outflow ?? s.Outflow ?? 0;
                            const inflowAmount = s.inflow ?? s.Inflow ?? 0;
                            const isOutflow = outflowAmount > 0 && outflowAmount >= inflowAmount;
                            const absoluteAmount = isOutflow ? outflowAmount : inflowAmount;
                            const symbol = isOutflow ? '-' : '+';
                            const amountClass = isOutflow ? 'text-destructive' : 'text-success';
                            return (
                              <span className={`font-mono ${amountClass}`}>
                                {symbol}
                                {formatAmount(currentFormatter, absoluteAmount)}
                              </span>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )
                )
              )}
            </div>

            {editSplits && (
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={onAddSplitLine}>
                  + Line
                </Button>
              </div>
            )}

            {/* Totals */}
            {editSplits && (
              <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
                <div>Total amount</div>
                <CalculatorCell
                  value={asMilli(splitTarget)}
                  onCommit={(val) => onSplitTargetChange(Math.abs(val) || 0)}
                  formatter={(val) => currentFormatter.format(val)}
                  localizer={currentFormatter}
                  inputAlign="right"
                  placeholder="0.00"
                  className="w-28"
                  inputClassName="h-8 text-right font-mono"
                  displayClassName="text-right font-mono"
                />
              </div>
            )}
            {(editSplits || splits).length > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
                <div>Remaining</div>
                <div className="font-mono">{formatAmount(currentFormatter, remainingAmount)}</div>
              </div>
            )}
          </div>
        )}

        {/* Memo Field */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0 [&>div]:text-sm [&>input]:text-sm [&>input]:p-2 [&>input]:h-9 [&>input]:bg-muted/30 [&>input]:border-0 [&>input]:shadow-none [&>input]:hover:bg-muted/50 [&>input]:focus:bg-background [&>input]:focus:border [&>input]:focus:shadow-sm [&>input]:truncate">
              <EditableCell
                value={transaction.Memo}
                onCommit={(newVal) => onCellCommit(transaction.ID, 'Memo', newVal)}
              />
            </div>
          </div>
        </div>

        {/* Exchange Rate Field - shown for foreign-currency transactions */}
        {transaction.ExchangeRate != null && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="[&>div]:w-full flex-1">
                    {/* Rates are dimensionless decimals — edited outside the milliunit CalculatorCell */}
                    <ExchangeRateCell
                      value={transaction.ExchangeRate || 0}
                      onCommit={(val) => onCellCommit(transaction.ID, 'ExchangeRate', val)}
                      placeholder="1.00"
                      inputClassName="h-9 text-sm font-mono"
                      className="text-left"
                      displayClassName="block text-sm p-2 bg-muted/30 rounded-md font-mono text-muted-foreground"
                    />
                  </div>
                  {!!transaction.ExchangeRateOverride && (
                    <span className="text-[11px] text-primary flex-shrink-0">manual</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
