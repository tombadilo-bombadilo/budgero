import { useLingui } from '@lingui/react/macro';
import { cn } from '@shared/lib/utils';
import { PlanningAnimatedNumber } from '../PlanningNumberAnimation';

interface TargetPillProps {
  /** This month's target in milliunits; null when there is no goal. */
  target: number | null;
  /** Funded share of the target, 0–100. */
  percent: number;
  formatter: (value: number) => string;
  bold?: boolean;
}

/**
 * The goal target as a pill that fills from the left as the target gets
 * funded: green when fully funded, amber while partly funded.
 */
export function TargetPill({ target, percent, formatter, bold = false }: TargetPillProps) {
  const { t } = useLingui();
  if (target === null) {
    return (
      <span
        aria-hidden="true"
        className="flex w-full min-w-[112px] justify-center text-muted-foreground"
      >
        —
      </span>
    );
  }

  const funded = Math.round(Math.min(100, Math.max(0, percent)));
  const complete = funded >= 100;

  return (
    <span
      className={cn(
        'relative flex w-full min-w-[112px] items-center justify-center overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-xs tabular-nums',
        bold && 'font-semibold',
        complete
          ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
          : funded > 0
            ? 'border-amber-500/40 text-foreground'
            : 'border-border text-muted-foreground'
      )}
      title={t`${funded}% funded`}
      data-funded={funded}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 transition-[width] duration-300',
          complete ? 'bg-emerald-500/20' : 'bg-amber-500/20'
        )}
        style={{ width: `${funded}%` }}
      />
      <PlanningAnimatedNumber value={target} formatter={formatter} className="relative" />
      <span className="sr-only">{t`${funded}% funded`}</span>
    </span>
  );
}
