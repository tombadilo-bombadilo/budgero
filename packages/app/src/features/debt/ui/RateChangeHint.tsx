import { useLingui } from '@lingui/react/macro';
import type { InterestRateEntry } from '@budgero/core/browser';
import { cn } from '@shared/lib/utils';
import { formatRateDate, formatRatePercent } from '../lib/rate-schedule';

/** One-line note about the next scheduled rate change ("Changes to 6.1% on Mar 1, 2027"). */
export function RateChangeHint({
  next,
  className,
}: {
  next: InterestRateEntry | undefined;
  className?: string;
}) {
  const { t } = useLingui();
  if (!next?.effective_date) return null;
  const rate = formatRatePercent(next.rate_annual);
  const date = formatRateDate(next.effective_date);
  return (
    <div className={cn('text-xs text-muted-foreground', className)}>
      {t`Rate changes to ${rate}% on ${date}`}
    </div>
  );
}
