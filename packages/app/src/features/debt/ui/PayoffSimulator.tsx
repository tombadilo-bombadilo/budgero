import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { PayoffPlanSheet } from '@features/debt/ui/PayoffPlanSheet';
import { computePayoffDate, parseDateKey } from '@shared/lib/date-utils';
import { formatDate } from '@shared/lib/date-format';
import { simulatePayoffSummary } from '@shared/lib/debt/payoff-schedule';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { formatMilli } from '@shared/lib/currency/milli';
import { cn } from '@shared/lib/utils';
import type { InterestRateEntry } from '@budgero/core/browser';
import { projectionMonthlyRate } from '@features/debt/lib/rate-schedule';
import { RateChangeHint } from '@features/debt/ui/RateChangeHint';

// Money props/state are in milliunit space (possibly non-integer floats after
// display-currency conversion); interest math stays float and results round
// back via roundMilli at the display/branding boundary.
type PayoffSimulatorProps = {
  outstanding: number; // remaining principal in milliunits (positive)
  apr?: number; // annual percent in effect today, optional
  aprSchedule?: InterestRateEntry[]; // dated rate changes; future ones feed the projection
  nextAprChange?: InterestRateEntry; // the next scheduled change, for the hint
  minPayment?: number; // suggested minimum, milliunits
  formatter: Intl.NumberFormat; // decimal currency formatter
  initial?: number; // optional initial payment, milliunits
  maxBound?: number; // optional upper bound, milliunits
  className?: string; // extra classes for the row button: padding comes from the caller
};

// Label/value scale follows the account header stats (FlowStat): the mobile
// header (below sm) uses 10px labels / xs values, the desktop one xs / sm.
const LABEL_CLASS = 'text-[10px] sm:text-xs text-muted-foreground';
const VALUE_CLASS = 'text-xs sm:text-sm font-mono tabular-nums text-foreground';

function RowStat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      <span className={VALUE_CLASS}>{value}</span>
    </span>
  );
}

/**
 * Compact payoff summary for a liability account: one clickable row with the
 * monthly payment, payoff date and interest from now. Clicking it opens the
 * Payment Plan drawer (PayoffPlanSheet); the payment tried there flows back
 * into the row. The next scheduled rate change, if any, is a muted second
 * line inside the same button.
 */
export function PayoffSimulator({
  outstanding,
  apr,
  aprSchedule,
  nextAprChange,
  minPayment,
  formatter,
  initial,
  maxBound,
  className,
}: PayoffSimulatorProps) {
  const { t } = useLingui();

  const rMonthly = apr ? apr / 100 / 12 : 0;
  // Month-by-month rates when a change is scheduled; else the single rate.
  const projectionRate = React.useMemo(
    () => projectionMonthlyRate(apr, aprSchedule),
    [apr, aprSchedule]
  );
  const suggestedMin = (() => {
    const interestOnly = rMonthly > 0 ? outstanding * rMonthly : 0;
    // At least one currency unit (1_000 milliunits)
    const floor = Math.max(1_000, roundMilli(interestOnly + outstanding * 0.01));
    return Math.max(minPayment || 0, floor, 10_000); // ensure a sensible minimum suggestion (10 currency units in milli)
  })();
  const paymentMin = 1_000; // one currency unit in milli, same floor as the plan's slider
  const maxPayment = Math.max(maxBound ?? 0, outstanding); // cap upper bound sensibly (one-shot payment)

  const initialPayment = Math.min(Math.max(initial ?? suggestedMin, paymentMin), maxPayment);
  const [payment, setPayment] = React.useState<number>(initialPayment);

  const sim = React.useMemo(
    () => simulatePayoffSummary(outstanding, projectionRate, payment),
    [outstanding, projectionRate, payment]
  );
  const payoffDate = React.useMemo(() => computePayoffDate(sim.months), [sim.months]);
  const payoffMonth = React.useMemo(() => {
    const d = payoffDate ? parseDateKey(payoffDate) : null;
    return d ? formatDate(d, 'MMM yyyy') : null;
  }, [payoffDate]);

  const formattedPayment = formatMilli(formatter, roundMilli(payment));
  const { months } = sim;

  return (
    <PayoffPlanSheet
      trigger={
        <button
          type="button"
          aria-haspopup="dialog"
          className={cn(
            'group flex w-full cursor-pointer flex-col gap-0.5 rounded-md text-left transition-colors',
            'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          <span className="flex w-full flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="text-xs sm:text-sm font-medium text-foreground">
              <Trans>Payoff plan</Trans>
            </span>
            <RowStat label={<Trans>Monthly payment</Trans>} value={t`${formattedPayment}/mo`} />
            {months === null ? (
              <span className="text-[10px] sm:text-xs text-destructive">{t`Payment too low`}</span>
            ) : (
              <>
                <RowStat
                  label={<Trans>Payoff date</Trans>}
                  value={
                    payoffMonth
                      ? `${payoffMonth} · ${plural(months, { one: '# month', other: '# months' })}`
                      : '—'
                  }
                />
                {sim.interestPaid !== undefined && (
                  <RowStat
                    label={<Trans>Interest (from now)</Trans>}
                    value={formatMilli(formatter, roundMilli(sim.interestPaid))}
                  />
                )}
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-0.5 self-center text-[10px] sm:text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              <Trans>Adjust</Trans>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </span>
          <RateChangeHint next={nextAprChange} className="text-[10px] sm:text-xs" />
        </button>
      }
      outstanding={outstanding}
      apr={apr}
      aprSchedule={aprSchedule}
      nextAprChange={nextAprChange}
      formatter={formatter}
      initialPayment={payment}
      onPaymentChange={setPayment}
      suggestedMin={suggestedMin}
      maxPayment={maxPayment}
    />
  );
}
