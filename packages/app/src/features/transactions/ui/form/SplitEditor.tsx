import { Trans, useLingui } from '@lingui/react/macro';
/**
 * Split Editor Component
 *
 * Inline editor for split transactions with multiple category assignments.
 */

import { Split } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { PayeeSelectCell } from '@features/transactions/ui/cells/PayeeSelectCell';
import { asMilli, formatMilli, ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { assignRemainingToSplit, newSplitLine } from './split-lines';
import {
  needsReceivedAmount,
  splitLineCategoryMode,
  splitPayeeUpdate,
  splitTransferUpdate,
  type SplitTransferAccount,
} from '../../lib/split-transfer';
import { useAutoReceivedAmounts } from '../split-transfer/useAutoReceivedAmounts';
import {
  SplitReceivedAmount,
  SplitTransferCategoryLocked,
} from '../split-transfer/SplitTransferFields';

export interface SplitLine {
  id: string;
  categoryId?: number | null;
  memo?: string;
  payee?: string;
  /** Positive directional amounts in integer milliunits. */
  inflow: MilliUnits;
  outflow: MilliUnits;
  transferAccountId?: number | null;
  /** Cross-currency transfer lines: what the other account received (its currency). */
  receivedAmount?: number | null;
  /** The received amount follows the line amount (estimated) until one is typed. */
  receivedAuto?: boolean;
}

interface SplitEditorProps {
  budgetId: number;
  isSplit: boolean;
  onToggleSplit: () => void;
  splitLines: SplitLine[];
  onSplitLinesChange: (lines: SplitLine[]) => void;
  /** Milliunits. */
  remaining: number;
  /** Milliunits. */
  parentAmount: number;
  formatter: Intl.NumberFormat;
  /** Accounts a line can transfer to (the parent's own account excluded). */
  transferAccounts?: SplitTransferAccount[];
  /** The parent's account: transfer lines to another currency ask what was received. */
  parentAccount?: SplitTransferAccount;
  /** The parent's date (YYYY-MM-DD), for the received amount's estimate. */
  date?: string;
  /**
   * Lines of a recurring template: a transfer line never takes a category
   * or a received amount there (each posting converts its own).
   */
  templateLines?: boolean;
}

export function SplitEditor({
  budgetId,
  isSplit,
  onToggleSplit,
  splitLines,
  onSplitLinesChange,
  remaining,
  parentAmount,
  formatter,
  transferAccounts = [],
  parentAccount,
  date = '',
  templateLines = false,
}: SplitEditorProps) {
  const { t } = useLingui();
  const transferName = (id?: number | null) => transferAccounts.find((a) => a.ID === id)?.Name;
  const transferTarget = (id?: number | null) =>
    id ? transferAccounts.find((a) => a.ID === id) : undefined;
  const receivedTarget = (line: SplitLine) => {
    const target = transferTarget(line.transferAccountId);
    return !templateLines && target && needsReceivedAmount(parentAccount?.Currency, target)
      ? target
      : undefined;
  };
  const categoryMode = (line: SplitLine) =>
    templateLines && line.transferAccountId
      ? 'transfer-locked'
      : splitLineCategoryMode(parentAccount, transferTarget(line.transferAccountId));

  useAutoReceivedAmounts({
    lines: isSplit && !templateLines ? splitLines : null,
    access: {
      target: (line) => line.transferAccountId,
      amount: (line) => line.inflow || line.outflow,
      received: (line) => line.receivedAmount,
      auto: (line) => line.receivedAuto !== false,
    },
    onEstimates: (estimates) =>
      onSplitLinesChange(
        splitLines.map((line, i) =>
          estimates.has(i) ? { ...line, receivedAmount: estimates.get(i) } : line
        )
      ),
    accounts: transferAccounts,
    parentCurrency: parentAccount?.Currency,
    amountCurrency: parentAccount?.Currency,
    date,
    budgetId,
  });

  const updateLine = (id: string, updates: Partial<SplitLine>) => {
    onSplitLinesChange(splitLines.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const deleteLine = (id: string) => {
    onSplitLinesChange(splitLines.filter((l) => l.id !== id));
  };

  const addLine = () => {
    onSplitLinesChange([...splitLines, newSplitLine()]);
  };

  const splitRemaining = () => {
    onSplitLinesChange(assignRemainingToSplit(splitLines, remaining, parentAmount));
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      <div className="flex items-center gap-2">
        <Split className="h-4 w-4 text-muted-foreground" />
        <Button
          variant="outline"
          size="sm"
          className="h-8 sm:h-10 w-full flex-1"
          type="button"
          onClick={onToggleSplit}
        >
          {isSplit ? t`Disable Split` : t`Enable Split`}
        </Button>
      </div>

      {isSplit && (
        <div className="space-y-2 sm:space-y-3 border rounded-md p-2 sm:p-3">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-muted-foreground">
            <span>
              <Trans>Remaining to assign</Trans>
            </span>
            <span className="font-mono">{formatMilli(formatter, asMilli(remaining))}</span>
          </div>

          {splitLines.map((line) => (
            <div key={line.id} className="grid grid-cols-1 gap-2 items-center">
              <div>
                {categoryMode(line) === 'transfer-locked' ? (
                  <SplitTransferCategoryLocked className="sm:h-9" />
                ) : (
                  <SearchableCategorySelect
                    budgetId={budgetId}
                    selectedCategoryId={line.categoryId || null}
                    // A line to an off-budget account keeps its transfer (spending).
                    onCategorySelect={(categoryId) => {
                      updateLine(
                        line.id,
                        categoryMode(line) === 'transfer-optional'
                          ? { categoryId }
                          : { categoryId, transferAccountId: undefined }
                      );
                    }}
                    placeholder={line.transferAccountId ? t`No category (transfer)` : t`Category`}
                    includeTransfers={categoryMode(line) === 'transfer-optional'}
                    triggerClassName="w-full h-8 sm:h-9"
                    popoverContentClassName="w-[320px] max-w-[90vw]"
                  />
                )}
              </div>
              <div>
                <PayeeSelectCell
                  budgetId={budgetId}
                  value={line.payee || ''}
                  onCommit={(payee) =>
                    updateLine(line.id, splitPayeeUpdate(payee, transferAccounts))
                  }
                  transferAccounts={transferAccounts}
                  onSelectTransfer={(id) => updateLine(line.id, splitTransferUpdate(id))}
                  selectedTransferAccountId={line.transferAccountId ?? null}
                  displayValue={
                    line.transferAccountId
                      ? t`Transfer: ${transferName(line.transferAccountId) ?? ''}`
                      : undefined
                  }
                  triggerClassName="w-full h-8 sm:h-9"
                />
              </div>
              <div>
                <Input
                  value={line.memo || ''}
                  onChange={(e) => updateLine(line.id, { memo: e.target.value })}
                  placeholder={t`Memo`}
                  className="h-8 sm:h-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
                <div className="min-w-0 sm:flex-1">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    <Trans>Outflow</Trans>
                  </div>
                  <CalculatorCell
                    value={line.outflow}
                    onCommit={(val) =>
                      updateLine(line.id, {
                        outflow: asMilli(Math.abs(val)),
                        ...(val ? { inflow: ZERO_MILLI } : {}),
                      })
                    }
                    formatter={(val) => formatter.format(val)}
                    localizer={formatter}
                    inputAlign="right"
                    placeholder="0.00"
                    className=""
                    inputClassName="h-8 text-right sm:h-9"
                    displayClassName="bg-background border-input hover:bg-muted/40 px-2 py-1 rounded-md text-right text-destructive"
                    zeroAsEmpty
                  />
                </div>
                <div className="min-w-0 sm:flex-1">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    <Trans>Inflow</Trans>
                  </div>
                  <CalculatorCell
                    value={line.inflow}
                    onCommit={(val) =>
                      updateLine(line.id, {
                        inflow: asMilli(Math.abs(val)),
                        ...(val ? { outflow: ZERO_MILLI } : {}),
                      })
                    }
                    formatter={(val) => formatter.format(val)}
                    localizer={formatter}
                    inputAlign="right"
                    placeholder="0.00"
                    className=""
                    inputClassName="h-8 text-right sm:h-9"
                    displayClassName="bg-background border-input hover:bg-muted/40 px-2 py-1 rounded-md text-right text-success"
                    zeroAsEmpty
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="col-span-2 h-8 whitespace-nowrap sm:mb-0 sm:self-end"
                  type="button"
                  onClick={() => deleteLine(line.id)}
                >
                  <span className="hidden sm:inline">
                    <Trans>Delete</Trans>
                  </span>
                  <span className="sm:hidden inline">
                    <Trans>Del</Trans>
                  </span>
                </Button>
              </div>
              {receivedTarget(line) && (
                <SplitReceivedAmount
                  target={receivedTarget(line)!}
                  lineIsInflow={line.inflow > 0}
                  value={line.receivedAmount}
                  onCommit={(value) =>
                    updateLine(line.id, { receivedAmount: value || null, receivedAuto: false })
                  }
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8" type="button" onClick={addLine}>
              <Trans>+ Line</Trans>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              type="button"
              onClick={splitRemaining}
            >
              <Trans>Split remaining</Trans>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
