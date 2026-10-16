import { Trans, useLingui } from '@lingui/react/macro';
/**
 * Available Info Popover Component
 *
 * Shows calculation breakdown for the Available column. Its trigger is also the
 * row's one status indicator for Credit Card Payment categories: a neutral info
 * dot normally, an amber warning when what's set aside doesn't match what the
 * card owes (underfunded or over-assigned), with the details up top.
 */

import { useId, useState } from 'react';
import { Info, CreditCard, Undo2, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { useUpsertAssignment } from '@entities/budget/api/useMonthlyBudget';
import { asMilli } from '@budgero/core/browser';
import { cn } from '@shared/lib/utils';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import {
  getCardDebt,
  getCCOverAssigned,
  getCCUnderfundedInfo,
} from './category-row/cc-payment.utils';
import { CCUnderfundedDetails } from './category-row/CCUnderfundedDetails';

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
  const { t } = useLingui();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const isCCPayment = item.fundingBreakdown !== undefined;
  const formatAmount = useFormatMaskedMilli(globalLocalizer);
  const upsertAssignment = useUpsertAssignment();

  // CC Payment over-assignment: more set aside than the card's debt. The
  // surplus is real cash (never hidden by the math) — the user resolves it,
  // if they want, by reducing this month's assignment, which returns the
  // money to Ready to Assign through the normal assignment mechanism.
  const cardDebt = getCardDebt(item);
  const overAssigned = getCCOverAssigned(item);
  // The opposite mismatch: the card owes more than is set aside.
  const underfundedInfo = getCCUnderfundedInfo(item);
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

  // Regular-category overspend split into cash (red) vs credit (amber). Credit
  // overspend doesn't spend cash — it becomes card debt — so it's flagged
  // distinctly and points at covering it before the debt sticks.
  const creditActivity = item.creditActivity ?? 0;
  const hasCreditActivity = creditActivity !== 0;
  const totalOverspend = item.available < 0 ? 0 - item.available : 0;
  const cashSide = item.available - creditActivity; // available ignoring credit activity
  const cashOverspend = Math.max(0, 0 - cashSide);
  const creditOverspend = Math.max(0, totalOverspend - cashOverspend);

  // Short status for the tooltip; the accessible name adds "— details".
  const warning = underfundedInfo
    ? t`Underfunded ${formatAmount(underfundedInfo.underfunded)}`
    : overAssigned > 0
      ? t`Over-assigned by ${formatAmount(overAssigned)}`
      : null;

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        aria-label={
          underfundedInfo
            ? t`Underfunded ${formatAmount(underfundedInfo.underfunded)} — details`
            : overAssigned > 0
              ? t`Over-assigned by ${formatAmount(overAssigned)} — details`
              : t`Available calculation details`
        }
        data-budget-prevent-row-select="true"
        className={cn(
          // after: widens the tap target without growing the row.
          "relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          triggerSize === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
          // CC Payment out of step with its card: promote the info dot to an
          // amber warning so the state is visible without opening anything.
          warning
            ? 'bg-amber-200/90 text-amber-700 hover:bg-amber-300 dark:bg-amber-900/60 dark:text-amber-400 dark:hover:bg-amber-800/70'
            : 'bg-muted/60 hover:bg-muted'
        )}
      >
        {warning ? (
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
        ) : (
          <Info className="h-2.5 w-2.5" aria-hidden="true" />
        )}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {warning ? (
        <Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="top">{warning}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent
        className={cn(
          'max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto p-4',
          // The debt-source table needs room for category names.
          underfundedInfo?.events.length ? 'w-80' : 'w-72'
        )}
        side={side}
        align={align}
        aria-labelledby={titleId}
      >
        <div id={titleId} className="font-medium text-sm">
          {isCCPayment ? t`CC Payment Calculation` : t`Available Calculation`}
        </div>

        {underfundedInfo && (
          <CCUnderfundedDetails info={underfundedInfo} formatAmount={formatAmount} />
        )}

        {overAssigned > 0 && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-2">
            <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              <Trans>Over-assigned by {formatAmount(overAssigned)}</Trans>
            </div>
            <div className="text-xs text-amber-700/80 dark:text-amber-400/80">
              <Trans>
                You have {formatAmount(item.available)} set aside but the card only needs{' '}
                {formatAmount(cardDebt ?? 0)}. The extra is your money — it just isn't needed for
                this card.
              </Trans>
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
                  ? t`Reducing…`
                  : t`Reduce assignment by ${formatAmount(reducible)} (back to Ready to Assign)`}
              </button>
            )}
          </div>
        )}

        <div
          className={cn(
            'space-y-2 rounded-lg p-3',
            amountBoxBg === 'muted/50' ? 'bg-muted/50' : 'bg-muted/40'
          )}
        >
          <div className={cn('text-xs', amountRowGap)}>
            {isCCPayment ? (
              <>
                {item.paymentCalculation && (
                  <div className="flex justify-between">
                    <span>
                      <Trans>Previous month:</Trans>
                    </span>
                    <span className="font-mono">
                      {formatAmount(item.paymentCalculation.previousAvailable)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>
                    <Trans>Assigned:</Trans>
                  </span>
                  <span className="font-mono">{formatAmount(item.assigned)}</span>
                </div>
                <div className="flex justify-between">
                  <span>
                    <Trans>Funded from spending:</Trans>
                  </span>
                  <span className="font-mono">{formatAmount(item.totalFunded || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>
                    <Trans>Payments made:</Trans>
                  </span>
                  <span className="font-mono">
                    {formatAmount(
                      item.paymentCalculation ? 0 - item.paymentCalculation.payments : item.activity
                    )}
                  </span>
                </div>
                {!!item.paymentCalculation?.refunds && (
                  <div className="flex justify-between">
                    <span>
                      <Trans>Returned to categories:</Trans>
                    </span>
                    <span className="font-mono">
                      {formatAmount(0 - item.paymentCalculation.refunds)}
                    </span>
                  </div>
                )}
                <div className="border-t pt-1 flex justify-between font-medium">
                  <span>
                    <Trans>Available for payment:</Trans>
                  </span>
                  <span className="font-mono">{formatAmount(item.available)}</span>
                </div>
                {item.cardBalance !== undefined && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{item.cardBalance >= 0 ? t`Card credit:` : t`Card balance owed:`}</span>
                    <span className="font-mono">{formatAmount(Math.abs(item.cardBalance))}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>
                    <Trans>Previous month:</Trans>
                  </span>
                  <span className="font-mono">
                    {formatAmount(item.available - item.assigned - item.activity)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>
                    <Trans>Assigned this month:</Trans>
                  </span>
                  <span className="font-mono">{formatAmount(item.assigned)}</span>
                </div>
                {hasCreditActivity ? (
                  <>
                    <div className="flex justify-between">
                      <span>
                        <Trans>Cash spending:</Trans>
                      </span>
                      <span className="font-mono">{formatAmount(item.cashActivity ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        <Trans>Credit spending:</Trans>
                      </span>
                      <span className="font-mono">{formatAmount(item.creditActivity ?? 0)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span>
                      <Trans>Activity:</Trans>
                    </span>
                    <span className="font-mono">{formatAmount(item.activity)}</span>
                  </div>
                )}
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
                <Trans>Funded from budgeted spending</Trans>
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
            <div className="mb-2 font-medium">
              <Trans>How it works:</Trans>
            </div>
            <ul className="space-y-1 text-xs">
              {isCCPayment ? (
                <>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Assigned</Trans>
                      </strong>
                      : Money you manually allocated
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Funded</Trans>
                      </strong>
                      : Auto-moved from budgeted CC spending
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Payments</Trans>
                      </strong>
                      : Transfers made to pay the card
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Available</Trans>
                      </strong>
                      : Ready for your next CC payment
                    </Trans>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Previous month</Trans>
                      </strong>
                      : Unspent money carried over
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Assigned</Trans>
                      </strong>
                      : Money you allocated this month
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Activity</Trans>
                      </strong>
                      : Your spending (negative) or income (positive)
                    </Trans>
                  </li>
                  <li>
                    <Trans>
                      <strong>
                        <Trans>Available</Trans>
                      </strong>
                      : What's left to spend
                    </Trans>
                  </li>
                </>
              )}
            </ul>
          </div>
        )}

        {isCCPayment && item.available < 0 && (
          <div className="p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
            <div className="text-xs text-red-600 dark:text-red-400 font-medium">
              <Trans>Paid {formatAmount(Math.abs(item.available))} more than set aside</Trans>
            </div>
          </div>
        )}

        {!isCCPayment && cashOverspend > 0 && (
          <div className="p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
            <div className="text-xs text-red-600 dark:text-red-400 font-medium">
              <Trans>Overspent by {formatAmount(cashOverspend)} in cash</Trans>
            </div>
          </div>
        )}

        {!isCCPayment && creditOverspend > 0 && (
          <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
            <div className="text-xs text-amber-700 dark:text-amber-400">
              You&apos;ve overspent this category by{' '}
              <span className="font-medium">{formatAmount(creditOverspend)}</span> with credit.
              Cover this overspending to avoid creating debt!
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
