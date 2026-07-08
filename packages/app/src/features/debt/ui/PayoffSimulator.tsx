import React from 'react';
import { Slider } from '@shared/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { ChevronDown, Info } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { PayoffPlanSheet } from '@features/debt/ui/PayoffPlanSheet';
import { PayoffSummaryGrid } from '@features/debt/ui/PayoffSummaryGrid';
import { computePayoffDate } from '@shared/lib/date-utils';
import { simulatePayoffSummary } from '@shared/lib/debt/payoff-schedule';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { formatMilli } from '@shared/lib/currency/milli';
import { cn } from '@shared/lib/utils';
import { activateOnEnterOrSpace } from '@shared/lib/a11y';

const EXPANDED_STORAGE_KEY = 'payoff-simulator-expanded';

// Money props/state are in milliunit space (possibly non-integer floats after
// display-currency conversion); interest math stays float and results round
// back via roundMilli at the display/branding boundary.
type PayoffSimulatorProps = {
  outstanding: number; // remaining principal in milliunits (positive)
  apr?: number; // annual percent, optional
  minPayment?: number; // suggested minimum, milliunits
  formatter: Intl.NumberFormat; // decimal currency formatter
  initial?: number; // optional initial slider value, milliunits
  maxBound?: number; // optional upper bound, milliunits
};

export function PayoffSimulator({
  outstanding,
  apr,
  minPayment,
  formatter,
  initial,
  maxBound,
}: PayoffSimulatorProps) {
  const rMonthly = apr ? apr / 100 / 12 : 0;
  const suggestedMin = (() => {
    const interestOnly = rMonthly > 0 ? outstanding * rMonthly : 0;
    // At least one currency unit (1_000 milliunits)
    const floor = Math.max(1_000, roundMilli(interestOnly + outstanding * 0.01));
    return Math.max(minPayment || 0, floor, 10_000); // ensure a sensible minimum suggestion (10 currency units in milli)
  })();
  const sliderMin = 1_000; // allow exploring lower payments (one currency unit in milli)
  const maxPayment = Math.max(maxBound ?? 0, outstanding); // cap upper bound sensibly (one-shot payment)

  const initialPayment = Math.min(Math.max(initial ?? suggestedMin, sliderMin), maxPayment);
  const [payment, setPayment] = React.useState<number>(initialPayment);

  const [isExpanded, setIsExpanded] = React.useState(() => {
    try {
      return localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleExpanded = React.useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const sim = React.useMemo(
    () => simulatePayoffSummary(outstanding, rMonthly, payment),
    [outstanding, rMonthly, payment]
  );
  const payoffDate = React.useMemo(() => computePayoffDate(sim.months), [sim.months]);

  const formattedPayment = formatMilli(formatter, roundMilli(payment));
  const collapsedSummary =
    sim.months === null
      ? 'Payment too low'
      : payoffDate
        ? `${formattedPayment}/mo · paid off ${payoffDate}`
        : `${formattedPayment}/mo`;

  return (
    <div>
      <div
        className="flex items-center justify-between gap-2 cursor-pointer select-none"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
        onKeyDown={activateOnEnterOrSpace(toggleExpanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
          <span className="font-medium">Payoff Simulator</span>
        </div>
        <div className="flex items-center gap-2">
          {!isExpanded && (
            <span className="hidden truncate text-xs font-mono text-muted-foreground sm:inline">
              {collapsedSummary}
            </span>
          )}
          {/* Shield: keeps clicks on the nested controls from toggling the header. */}
          <div
            className="flex items-center gap-2"
            role="presentation"
            onClick={(e) => e.stopPropagation()}
          >
            <Popover>
              <PopoverTrigger asChild>
                <button aria-label="Info" className="text-muted-foreground hover:text-foreground">
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 text-xs">
                <div className="space-y-2">
                  <p>
                    Drag the slider to test a monthly payment. We estimate the payoff date and total
                    interest assuming fixed payments and no new charges.
                  </p>
                  <p>
                    For credit cards, this approximates a fixed payment schedule. Actual card
                    minimums typically decline as balance drops.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
            <PayoffPlanSheet
              trigger={
                <Button size="sm" variant="secondary">
                  Plan
                </Button>
              }
              outstanding={outstanding}
              apr={apr}
              formatter={formatter}
              initialPayment={payment}
              onPaymentChange={setPayment}
              suggestedMin={suggestedMin}
              maxPayment={maxPayment}
            />
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="space-y-3 mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Monthly payment</span>
            <span className="font-mono">{formattedPayment}</span>
          </div>
          <Slider
            min={sliderMin}
            max={maxPayment}
            step={1_000} // one currency unit in milliunits
            value={[payment]}
            onValueChange={(vals) => setPayment(Array.isArray(vals) ? vals[0] : vals)}
          />
          <PayoffSummaryGrid
            months={sim.months}
            payoffDate={payoffDate}
            totalPaid={sim.totalPaid}
            interestPaid={sim.interestPaid}
            formatter={formatter}
          />
        </div>
      )}
    </div>
  );
}
