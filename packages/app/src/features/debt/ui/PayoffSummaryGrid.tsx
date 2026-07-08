import type { ReactNode } from 'react';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { formatMilli } from '@shared/lib/currency/milli';

interface PayoffSummaryGridProps {
  months: number | null;
  payoffDate: string | null;
  /** Milliunit-space amount (may carry float residue from amortization math). */
  totalPaid?: number;
  /** Milliunit-space amount (may carry float residue from amortization math). */
  interestPaid?: number;
  formatter: Intl.NumberFormat;
  /** Extra cells (e.g. Outstanding, APR) rendered before the shared ones, in the same grid. */
  leading?: ReactNode;
}

/** Shared "Estimated months / Payoff date / Total payments / Interest" 2-col stat grid. */
export function PayoffSummaryGrid({
  months,
  payoffDate,
  totalPaid,
  interestPaid,
  formatter,
  leading,
}: PayoffSummaryGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      {leading}
      <div>
        <div className="text-xs text-muted-foreground">Estimated months</div>
        <div className="font-mono">{months === null ? 'Payment too low' : months}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Payoff date</div>
        <div className="font-mono">{months === null ? '—' : payoffDate || '—'}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Total payments</div>
        <div className="font-mono">
          {totalPaid !== undefined ? formatMilli(formatter, roundMilli(totalPaid)) : '—'}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Interest (from now)</div>
        <div className="font-mono">
          {interestPaid !== undefined ? formatMilli(formatter, roundMilli(interestPaid)) : '—'}
        </div>
      </div>
    </div>
  );
}
