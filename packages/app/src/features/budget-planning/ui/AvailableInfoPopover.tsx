/**
 * Available Info Popover Component
 *
 * Shows calculation breakdown for the Available column.
 */

import { Info, CreditCard, Undo2, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { useUpsertAssignment } from '@entities/budget/api/useMonthlyBudget';
import { asMilli } from '@budgero/core/browser';
import { cn } from '@shared/lib/utils';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';

export interface AvailableInfoPopoverProps {
  item: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  /** Trigger button + icon footprint. `'sm'` → h-3/w-3 trigger, `'md'` → h-4/w-4. Default `'md'`. */
  triggerSize?: 'sm' | 'md';
  /** Popover placement side. Default `undefined` (radix default). */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Popover alignment. Default `'end'`. */
  align?: 'start' | 'center' | 'end';
  /** Background tint of the amount breakdown box. Default `'muted/40'`. */
  amountBoxBg?: 'muted/40' | 'muted/50';
  /** Vertical gap between amount rows. Default `'space-y-2'`. */
  amountRowGap?: 'space-y-1' | 'space-y-2';
  /** Label for the non-CC total row. Default `'Available:'`. */
  availableLabel?: string;
  /** Render the "How it works" explanatory block. Default `false`. */
  showHelp?: boolean;
  /**
   * Month + budget context. When provided (and the row is a CC Payment
   * category that is over-assigned), the popover offers a one-click
   * "reduce assignment" action to return the surplus to Ready to Assign.
   */
  month?: string;
  budgetId?: number;
}

export function AvailableInfoPopover({
  item,
  globalLocalizer,
  triggerSize = 'md',
  side,
  align = 'end',
  amountBoxBg = 'muted/40',
  amountRowGap = 'space-y-2',
  availableLabel = 'Available:',
  showHelp = false,
  month,
  budgetId,
}: AvailableInfoPopoverProps) {
  const isCCPayment = item.fundingBreakdown !== undefined;
  const formatAmount = useFormatMaskedMilli(globalLocalizer);
  const upsertAssignment = useUpsertAssignment();

  // CC Payment over-assignment: more set aside than the card's debt. The
  // surplus is real cash (never hidden by the math) — the user resolves it,
  // if they want, by reducing this month's assignment, which returns the
  // money to Ready to Assign through the normal assignment mechanism.
  const cardDebt = item.cardBalance !== undefined ? Math.max(0, 0 - item.cardBalance) : undefined;
  const overAssigned =
    isCCPayment && cardDebt !== undefined && item.available > cardDebt
      ? item.available - cardDebt
      : 0;
  // Only this month's manual assignment can be reduced here.
  const reducible = Math.min(overAssigned, Math.max(0, item.assigned));
  const canReduce = reducible > 0 && month !== undefined && budgetId !== undefined;

  const handleReduceAssignment = () => {
    if (!canReduce) return;
    upsertAssignment.mutate({
      categoryId: item.categoryId,
      amount: asMilli(item.assigned - reducible),
      month: month!,
      budgetId: budgetId!,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={
            overAssigned > 0
              ? `Over-assigned by ${formatAmount(overAssigned)} — details`
              : 'Available calculation details'
          }
          title={overAssigned > 0 ? `Over-assigned by ${formatAmount(overAssigned)}` : undefined}
          className={cn(
            'inline-flex items-center justify-center rounded-full transition-colors',
            triggerSize === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
            // Over-assigned CC Payment: promote the info dot to an amber
            // warning badge so the state is visible without opening anything.
            overAssigned > 0
              ? 'bg-amber-200/90 text-amber-700 hover:bg-amber-300 dark:bg-amber-900/60 dark:text-amber-400 dark:hover:bg-amber-800/70'
              : 'bg-muted/60 hover:bg-muted'
          )}
        >
          {overAssigned > 0 ? (
            <AlertTriangle className="h-2.5 w-2.5" />
          ) : (
            <Info className="h-2.5 w-2.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-4" side={side} align={align}>
        <div className="font-medium text-sm">
          {isCCPayment ? 'CC Payment Calculation' : 'Available Calculation'}
        </div>

        <div
          className={cn(
            'space-y-2 rounded-lg p-3',
            amountBoxBg === 'muted/50' ? 'bg-muted/50' : 'bg-muted/40'
          )}
        >
          <div className={cn('text-xs', amountRowGap)}>
            {isCCPayment ? (
              <>
                <div className="flex justify-between">
                  <span>Assigned:</span>
                  <span className="font-mono">{formatAmount(item.assigned)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Funded from spending:</span>
                  <span className="font-mono">{formatAmount(item.totalFunded || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payments made:</span>
                  <span className="font-mono">{formatAmount(item.activity)}</span>
                </div>
                <div className="border-t pt-1 flex justify-between font-medium">
                  <span>Available for payment:</span>
                  <span className="font-mono">{formatAmount(item.available)}</span>
                </div>
                {item.cardBalance !== undefined && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{item.cardBalance >= 0 ? 'Card credit:' : 'Card balance owed:'}</span>
                    <span className="font-mono">{formatAmount(Math.abs(item.cardBalance))}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Previous month:</span>
                  <span className="font-mono">
                    {formatAmount(item.available - item.assigned - item.activity)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Assigned this month:</span>
                  <span className="font-mono">{formatAmount(item.assigned)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Activity:</span>
                  <span className="font-mono">{formatAmount(item.activity)}</span>
                </div>
                <div className="border-t pt-1 flex justify-between font-medium">
                  <span>{availableLabel}</span>
                  <span className="font-mono">{formatAmount(item.available)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Funding breakdown for CC Payment categories */}
        {isCCPayment && item.fundingBreakdown && item.fundingBreakdown.length > 0 && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
            <div className="flex items-center gap-1.5 mb-2">
              <CreditCard className="h-3 w-3 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                Funded from budgeted spending
              </span>
            </div>
            <div className="space-y-1 text-xs">
              {item.fundingBreakdown.map((source) => (
                <div key={source.categoryId} className="flex justify-between">
                  <span className="text-muted-foreground">{source.categoryName}:</span>
                  <span className="font-mono">{formatAmount(source.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {showHelp && (
          <div className="text-muted-foreground">
            <div className="mb-2 font-medium">How it works:</div>
            <ul className="space-y-1 text-xs">
              {isCCPayment ? (
                <>
                  <li>
                    <strong>Assigned</strong>: Money you manually allocated
                  </li>
                  <li>
                    <strong>Funded</strong>: Auto-moved from budgeted CC spending
                  </li>
                  <li>
                    <strong>Payments</strong>: Transfers made to pay the card
                  </li>
                  <li>
                    <strong>Available</strong>: Ready for your next CC payment
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <strong>Previous month</strong>: Unspent money carried over
                  </li>
                  <li>
                    <strong>Assigned</strong>: Money you allocated this month
                  </li>
                  <li>
                    <strong>Activity</strong>: Your spending (negative) or income (positive)
                  </li>
                  <li>
                    <strong>Available</strong>: What's left to spend
                  </li>
                </>
              )}
            </ul>
          </div>
        )}

        {overAssigned > 0 && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-2">
            <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              Over-assigned by {formatAmount(overAssigned)}
            </div>
            <div className="text-xs text-amber-700/80 dark:text-amber-400/80">
              You have {formatAmount(item.available)} set aside but the card only needs{' '}
              {formatAmount(cardDebt ?? 0)}. The extra is your money — it just isn&apos;t needed for
              this card.
            </div>
            {canReduce && (
              <button
                type="button"
                onClick={handleReduceAssignment}
                disabled={upsertAssignment.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:underline disabled:opacity-50"
              >
                <Undo2 className="h-3 w-3" />
                {upsertAssignment.isPending
                  ? 'Reducing…'
                  : `Reduce assignment by ${formatAmount(reducible)} (back to Ready to Assign)`}
              </button>
            )}
          </div>
        )}

        {item.available < 0 && (
          <div className="p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
            <div className="text-xs text-red-600 dark:text-red-400 font-medium">
              {isCCPayment
                ? `Paid ${formatAmount(Math.abs(item.available))} more than set aside`
                : `Overspent by ${formatAmount(Math.abs(item.available))}`}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
