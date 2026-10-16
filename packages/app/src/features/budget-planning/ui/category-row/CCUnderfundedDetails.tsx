import { Trans } from '@lingui/react/macro';
import { formatMonthLabel } from '@shared/lib/date-utils';
import type { CCUnderfundedInfo } from './cc-payment.utils';

interface CCUnderfundedDetailsProps {
  info: CCUnderfundedInfo;
  formatAmount: (amount: number) => string;
}

/**
 * Body of the CC Payment "underfunded" warning, shown inside
 * AvailableInfoPopover: what the card owes vs what's set aside and, when known,
 * the category + month where each credit overspend that created the debt
 * happened.
 *
 * Credit overspending never turns the spending category red long-term (in
 * monthly mode it resets each month; the debt moves to the card), so without
 * this the debt would be easy to miss.
 */
export function CCUnderfundedDetails({ info, formatAmount }: CCUnderfundedDetailsProps) {
  const { owed, setAside, underfunded, events, created, covered } = info;

  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
      <div className="font-medium text-amber-700 dark:text-amber-400">
        <Trans>Underfunded by {formatAmount(underfunded)}</Trans>
      </div>
      <div className="text-amber-700/80 dark:text-amber-400/80">
        <Trans>
          The card owes {formatAmount(owed)} but only {formatAmount(setAside)} is set aside to pay
          it. Assign {formatAmount(underfunded)} here to cover it.
        </Trans>
      </div>

      {events.length > 0 && (
        <div className="border-t border-amber-200 pt-2 dark:border-amber-900">
          <div className="font-medium">
            <Trans>Where this debt came from</Trans>
          </div>
          <div className="mt-0.5 text-muted-foreground">
            <Trans>Credit overspending that wasn't covered when it happened.</Trans>
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto pr-1">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
              <span className="text-muted-foreground">
                <Trans>Category</Trans>
              </span>
              <span className="text-muted-foreground">
                <Trans>Month</Trans>
              </span>
              <span className="text-right text-muted-foreground">
                <Trans>Amount</Trans>
              </span>
              {events.map((e) => (
                <div key={`${e.categoryId}|${e.month}`} className="contents">
                  <span className="truncate">{e.categoryName || `#${e.categoryId}`}</span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {formatMonthLabel(e.month, { month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-right font-mono tabular-nums">
                    {formatAmount(e.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 space-y-1 border-t border-amber-200 pt-2 dark:border-amber-900">
            {covered > 0 && (
              <>
                <div className="flex items-baseline justify-between text-muted-foreground">
                  <span>
                    <Trans>Debt created</Trans>
                  </span>
                  <span className="font-mono tabular-nums">{formatAmount(created)}</span>
                </div>
                <div className="flex items-baseline justify-between text-muted-foreground">
                  <span>
                    <Trans>− Already set aside</Trans>
                  </span>
                  <span className="font-mono tabular-nums">{formatAmount(covered)}</span>
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between font-semibold">
              <span>
                <Trans>Still underfunded</Trans>
              </span>
              <span className="font-mono tabular-nums">{formatAmount(underfunded)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
