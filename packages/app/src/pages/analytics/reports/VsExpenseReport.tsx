import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { cn } from '@shared/lib/utils';
import { useUiStore } from '@shared/store/useUiStore';
import { trendTextClass } from '@shared/lib/amount-color';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { buildCategoryPivot } from '../analytics-model';
import { lastDayOfMonth } from '../analytics-state';
import type { AnalyticsData } from '../useAnalyticsData';
import { shortMonthLabel, useMoneyFormatters } from '../components/chart-utils';
import { CategoryTransactionCell } from '../components/CategoryTransactionCell';

/** Keep the table renderable — beyond this many months, show the most recent. */
const MAX_PIVOT_MONTHS = 24;

// On phones the sticky Category+Total pair would cover almost the whole
// viewport and leave no visible scroll area, so the Category column narrows
// and the Total column only pins from `sm` up.
const STICKY_LEFT =
  'sticky left-0 z-10 max-w-[130px] truncate border-r px-2 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] sm:max-w-none sm:px-3';
const STICKY_RIGHT =
  'z-10 whitespace-nowrap border-l px-2 py-2 text-right sm:sticky sm:right-0 sm:px-3 sm:shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]';

interface VsExpenseReportProps {
  data: AnalyticsData;
  months: string[];
  accountIds: number[];
  categoryIds: number[];
}

/**
 * The category pivot: net income vs expense per category across months, with
 * expandable group rows (Income first) and click-through transaction cells.
 */
export function VsExpenseReport({
  data,
  months: allMonths,
  accountIds,
  categoryIds,
}: VsExpenseReportProps) {
  const money = useMoneyFormatters();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const isTruncated = allMonths.length > MAX_PIVOT_MONTHS;
  const months = useMemo(
    () => (isTruncated ? allMonths.slice(-MAX_PIVOT_MONTHS) : allMonths),
    [allMonths, isTruncated]
  );

  const pivot = useMemo(
    () =>
      buildCategoryPivot(
        data.txns,
        months,
        data.categories,
        data.categoryGroups,
        data.onBudgetAccountIds,
        categoryIds
      ),
    [data.txns, months, data.categories, data.categoryGroups, data.onBudgetAccountIds, categoryIds]
  );

  const [expandedGroups, setExpandedGroups] = useState<Set<number> | null>(null);
  const expanded = expandedGroups ?? new Set(pivot.groups.map((group) => group.id));

  const toggleGroup = (groupId: number) => {
    const next = new Set(expanded);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    setExpandedGroups(next);
  };

  const cellClass = (value: number) =>
    value === 0 ? 'text-muted-foreground' : value < 0 ? 'text-rose-500' : 'text-emerald-600';

  const isEmpty = !data.isLoading && (!months.length || !pivot.hasActivity);

  return (
    <Card className="overflow-hidden border-dashed p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6 sm:pb-4">
        <div>
          <h2 className="text-base font-semibold text-muted-foreground">Ledger</h2>
          <p
            className={cn(
              'text-3xl font-semibold tracking-tight',
              trendTextClass(pivot.grandTotal)
            )}
          >
            <AnimatedNumber
              value={pivot.grandTotal}
              formatter={(value) => `${value >= 0 ? '+' : ''}${money.amount(value)}`}
              rounding="integer"
            />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Net per category across months — click any amount to see its transactions
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedGroups(new Set(pivot.groups.map((group) => group.id)))}
            disabled={!pivot.groups.length}
          >
            Expand all
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedGroups(new Set())}
            disabled={!pivot.groups.length}
          >
            Collapse all
          </Button>
        </div>
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {data.isLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : isEmpty ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
            <p>No category activity for the selected period.</p>
            <p>Adjust the date range or filters to explore other results.</p>
          </div>
        ) : (
          <>
            {isTruncated && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Showing only the most recent {MAX_PIVOT_MONTHS} months. Narrow your date range to
                see earlier data.
              </div>
            )}
            <div className="w-0 min-w-full overflow-hidden rounded-md border">
              <div className="max-h-[600px] overflow-auto overscroll-x-contain">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr className="border-b border-border/60">
                      <th
                        className={cn(
                          STICKY_LEFT,
                          'z-30 min-w-[110px] bg-muted text-left font-medium text-muted-foreground sm:min-w-[180px]'
                        )}
                      >
                        Category
                      </th>
                      {months.map((monthKey) => (
                        <th
                          key={monthKey}
                          className="min-w-[84px] whitespace-nowrap bg-muted px-2 py-2 text-right font-medium text-muted-foreground sm:min-w-[100px] sm:px-3"
                        >
                          {shortMonthLabel(monthKey)}
                        </th>
                      ))}
                      <th
                        className={cn(
                          STICKY_RIGHT,
                          'z-30 min-w-[100px] bg-muted font-medium text-muted-foreground'
                        )}
                      >
                        Total
                      </th>
                    </tr>
                    <tr className="border-b border-border/40 text-sm font-semibold text-primary">
                      <td className={cn(STICKY_LEFT, 'z-30 bg-muted')}>Totals</td>
                      {pivot.columnTotals.map((value, index) => (
                        <td
                          key={months[index]}
                          className="whitespace-nowrap bg-muted px-3 py-2 text-right"
                        >
                          {money.amount(value)}
                        </td>
                      ))}
                      <td className={cn(STICKY_RIGHT, 'z-30 bg-muted')}>
                        {money.amount(pivot.grandTotal)}
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    {pivot.groups.map((group) => {
                      const isExpanded = expanded.has(group.id);
                      const groupBg = group.isIncome
                        ? 'bg-emerald-50 dark:bg-emerald-950'
                        : 'bg-muted';
                      return (
                        <Fragment key={group.id}>
                          <tr
                            className={cn(
                              'border-b border-border/40 text-sm font-medium',
                              group.isIncome
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                                : 'bg-muted'
                            )}
                          >
                            <td className={cn(STICKY_LEFT, groupBg)}>
                              <button
                                type="button"
                                onClick={() => toggleGroup(group.id)}
                                className="flex w-full items-center gap-2 text-left"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                <span className="whitespace-nowrap">{group.name}</span>
                              </button>
                            </td>
                            {group.monthTotals.map((value, index) => (
                              <td
                                key={months[index]}
                                className="whitespace-nowrap px-3 py-2 text-right"
                              >
                                <span className="text-xs leading-tight">{money.amount(value)}</span>
                              </td>
                            ))}
                            <td className={cn(STICKY_RIGHT, groupBg, 'font-semibold')}>
                              {money.amount(group.total)}
                            </td>
                          </tr>
                          {isExpanded &&
                            group.categories.map((row) => (
                              <tr
                                key={`${group.id}-${row.id ?? 'uncategorized'}`}
                                className="border-b border-border/30 last:border-b-0 hover:bg-muted/40"
                              >
                                <td className={cn(STICKY_LEFT, 'bg-card pl-6 sm:pl-9')}>
                                  <span className="whitespace-nowrap">{row.name}</span>
                                </td>
                                {row.values.map((value, index) => (
                                  <CategoryTransactionCell
                                    key={months[index]}
                                    value={value}
                                    categoryId={row.id}
                                    categoryName={row.name}
                                    budgetId={data.budgetId}
                                    startDate={`${months[index]}-01`}
                                    endDate={lastDayOfMonth(months[index])}
                                    accountIds={accountIds}
                                    globalLocalizer={globalLocalizer}
                                    privacyMaskNumbers={privacyMaskNumbers}
                                    label={shortMonthLabel(months[index])}
                                  />
                                ))}
                                <td
                                  className={cn(
                                    STICKY_RIGHT,
                                    'bg-card text-xs font-medium',
                                    cellClass(row.total)
                                  )}
                                >
                                  {money.amount(row.total)}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
