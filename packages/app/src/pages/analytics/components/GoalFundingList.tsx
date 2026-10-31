import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { fundedPercent, type TargetReportGroup, type TargetTotals } from '../target-report';

interface GoalFundingListProps {
  /** Groups from the targets report; only categories with a goal are shown. */
  groups: TargetReportGroup[];
  money: (milli: number) => string;
  positiveColor: string;
  progressColor: string;
}

function FundingBar({
  totals,
  positiveColor,
  progressColor,
}: {
  totals: TargetTotals;
  positiveColor: string;
  progressColor: string;
}) {
  const percent = fundedPercent(totals);
  return (
    <div className="mt-1 h-1 rounded-full bg-muted">
      <div
        className="h-1 rounded-full"
        style={{
          width: `${Math.max(2, percent)}%`,
          backgroundColor: percent >= 100 ? positiveColor : progressColor,
        }}
      />
    </div>
  );
}

/**
 * Goal funding for the period, one line per category group (collapsed by
 * default so long budgets don't stretch the page); a group opens to its goals.
 */
export function GoalFundingList({
  groups,
  money,
  positiveColor,
  progressColor,
}: GoalFundingListProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const goalGroups = groups
    .map((group) => ({ ...group, rows: group.rows.filter((row) => row.target) }))
    .filter((group) => group.rows.length > 0);

  if (goalGroups.length === 0) return null;

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-1">
      {goalGroups.map((group) => {
        const isOpen = open.has(group.name);
        const percent = Math.round(fundedPercent(group));
        const groupFunded = money(group.funded);
        const groupTarget = money(group.target ?? 0);
        return (
          <div key={group.name}>
            <button
              type="button"
              className="w-full rounded-md py-1 text-left hover:bg-muted/40"
              onClick={() => toggle(group.name)}
              aria-expanded={isOpen}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{group.name}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    · {group.rows.length}
                  </span>
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-sm font-medium tabular-nums',
                    percent >= 100 ? 'text-green-600' : 'text-muted-foreground'
                  )}
                >
                  {percent}%
                </span>
              </div>
              <FundingBar
                totals={group}
                positiveColor={positiveColor}
                progressColor={progressColor}
              />
              <div className="mt-0.5 text-xs text-muted-foreground">
                <Trans>
                  {groupFunded} of {groupTarget}
                </Trans>
              </div>
            </button>
            {isOpen ? (
              <div className="mb-2 ml-4 mt-1 space-y-2 border-l border-border/60 pl-3">
                {group.rows.map((row) => {
                  const rowPercent = Math.round(fundedPercent(row));
                  const funded = money(row.funded);
                  const target = money(row.target ?? 0);
                  const { monthsMet, monthsWithTarget } = row;
                  return (
                    <div key={row.categoryId}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                        <span
                          className={cn(
                            'whitespace-nowrap text-sm tabular-nums',
                            rowPercent >= 100 ? 'text-green-600' : 'text-muted-foreground'
                          )}
                        >
                          {rowPercent}%
                        </span>
                      </div>
                      <FundingBar
                        totals={row}
                        positiveColor={positiveColor}
                        progressColor={progressColor}
                      />
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {monthsWithTarget > 1
                          ? t`${funded} of ${target} · met ${monthsMet}/${monthsWithTarget} mo`
                          : t`${funded} of ${target}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
