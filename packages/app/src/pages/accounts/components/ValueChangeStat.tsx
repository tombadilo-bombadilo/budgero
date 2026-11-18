import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';
import {
  useRevaluationHistory,
  type RevaluationSummary,
} from '@entities/currency/api/useRevaluationSummary';

interface ValueChangeStatProps {
  accountId: number;
  summary: RevaluationSummary;
  /** Whether this account's value changes feed Ready to Assign. */
  onBudget: boolean;
  /** Formats a budget-currency milliunit amount (masking-aware). */
  formatBudgetMilliAmount: (m: number) => string;
  /** Formats an exchange rate for the "latest rate" line. */
  formatRate: (rate: number) => string;
  accountCurrency: string;
  budgetCurrency: string;
  size?: 'sm' | 'md';
}

/** Signed daily deltas as bars around a zero baseline. Direction carries
 * polarity (up = gain, down = loss) so color is never the only encoding. */
function RevaluationBars({ rows }: { rows: { Date: string; DeltaConverted: number }[] }) {
  const { t } = useLingui();

  const bars = rows.slice(-30);
  const width = 248;
  const height = 72;
  const max = Math.max(...bars.map((r) => Math.abs(r.DeltaConverted)), 1);
  const slot = width / bars.length;
  const barWidth = Math.max(2, Math.min(10, slot - 2));
  const half = height / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={t`Daily value changes from exchange-rate moves`}
    >
      <line
        x1={0}
        x2={width}
        y1={half}
        y2={half}
        className="stroke-current text-muted-foreground/40"
        strokeWidth={1}
      />
      {bars.map((row, i) => {
        const magnitude = Math.max(1, (Math.abs(row.DeltaConverted) / max) * (half - 2));
        const up = row.DeltaConverted >= 0;
        return (
          <rect
            key={row.Date}
            x={i * slot + (slot - barWidth) / 2}
            y={up ? half - magnitude : half}
            width={barWidth}
            height={magnitude}
            rx={1}
            className={cn('fill-current', up ? 'text-success' : 'text-destructive')}
          >
            <title>{row.Date}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/**
 * "Value change (30d)" header stat: market-driven change of the account's
 * worth in budget currency. Tapping it opens the detail popover — history
 * bars, all-time total, latest rate, and whether it feeds Ready to Assign.
 */
export function ValueChangeStat({
  accountId,
  summary,
  onBudget,
  formatBudgetMilliAmount,
  formatRate,
  accountCurrency,
  budgetCurrency,
  size = 'sm',
}: ValueChangeStatProps) {
  const { t } = useLingui();

  const { data: history = [] } = useRevaluationHistory(accountId);
  const positive30 = summary.last30Days >= 0;
  const Icon = positive30 ? ArrowUpRight : ArrowDownRight;
  const colorClass = positive30 ? 'text-success' : 'text-destructive';
  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t`Value change details`}
        >
          <span
            className={cn(
              'flex items-center gap-1 text-muted-foreground',
              size === 'sm' ? 'text-[0.625rem]' : 'text-xs'
            )}
          >
            <Trans>
              <Icon className={cn('h-3 w-3', colorClass)} />
              Value change (30d)
            </Trans>
          </span>
          <p
            className={cn(
              'font-bold tabular-nums',
              size === 'sm' ? 'text-sm' : 'text-base',
              colorClass
            )}
          >
            {formatBudgetMilliAmount(summary.last30Days)}
          </p>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div>
          <p className="text-sm font-medium">
            <Trans>Value change</Trans>
          </p>
          <p className="text-xs text-muted-foreground">
            <Trans>
              How much this account's worth in {budgetCurrency} moved with exchange rates. Your{' '}
              {accountCurrency} balance itself is unchanged.
            </Trans>
          </p>
        </div>

        {history.length > 1 ? (
          <div className="space-y-1">
            <RevaluationBars rows={history} />
            <div className="flex justify-between text-[0.625rem] text-muted-foreground">
              <span>{history[0].Date}</span>
              <span>{history[history.length - 1].Date}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Value changes are journaled once per day — history builds up as rates move.
            </Trans>
          </p>
        )}

        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              <Trans>Last 30 days</Trans>
            </span>
            <span className={cn('font-medium tabular-nums', colorClass)}>
              {formatBudgetMilliAmount(summary.last30Days)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              <Trans>All time</Trans>
            </span>
            <span
              className={cn(
                'font-medium tabular-nums',
                summary.total >= 0 ? 'text-success' : 'text-destructive'
              )}
            >
              {formatBudgetMilliAmount(summary.total)}
            </span>
          </div>
          {latest && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                <Trans>Latest rate ({latest.Date})</Trans>
              </span>
              <span className="font-medium tabular-nums">
                1 {accountCurrency} = {formatRate(latest.NewRate)} {budgetCurrency}
              </span>
            </div>
          )}
        </div>

        <p className="text-[0.6875rem] text-muted-foreground border-t border-border pt-2">
          {onBudget
            ? t`This account is on-budget: these changes are included in Ready to Assign.`
            : t`Tracking-only account: these changes affect net worth but not Ready to Assign.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
