import { Trans, useLingui } from '@lingui/react/macro';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { cn } from '@shared/lib/utils';
import { useUiStore } from '@shared/store/useUiStore';
import { buildCategoryPivot } from '../analytics-model';
import { lastDayOfMonth } from '../analytics-state';
import type { AnalyticsData } from '../useAnalyticsData';
import { longMonthLabel, shortMonthLabel, useMoneyFormatters } from '../components/chart-utils';
import { CategoryTransactionCell } from '../components/CategoryTransactionCell';
import { reportMeta } from '../report-questions';
import { ledgerAnswer } from '../report-answers';
import { ledgerAverage, ledgerAverageStep } from './ledger-columns';
import { useLedgerColumns } from './useLedgerColumns';

/** Keep the table renderable — beyond this many months, show the most recent. */
const MAX_PIVOT_MONTHS = 24;

// On phones the sticky Category+Total pair would cover almost the whole
// viewport and leave no visible scroll area, so the Category column narrows
// and the Total column only pins from `sm` up.
const STICKY_LEFT =
  'sticky left-0 z-10 max-w-[8.125rem] truncate border-r px-2 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)] sm:max-w-none sm:px-3';
const STICKY_RIGHT =
  'z-10 whitespace-nowrap border-l px-2 py-2 text-right sm:sticky sm:right-0 sm:px-3 sm:shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]';
/** Total/Average cells that scroll with the months (Average at the end, both at the start). */
const SUMMARY_CELL = 'whitespace-nowrap px-2 py-2 text-right sm:px-3';

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
  const { t } = useLingui();
  const money = useMoneyFormatters();
  const { columns, update: updateColumns } = useLedgerColumns();
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
  // Round averages to what the currency shows, so they never read "-0.00".
  const averageStep = ledgerAverageStep(globalLocalizer.resolvedOptions().maximumFractionDigits);
  const average = (total: number) => ledgerAverage(total, months.length, averageStep);

  /**
   * One row's Total and Average cells, placed after the months (Total pinned
   * to the right edge, Average just before it) or right after Category.
   * `className` styles both cells (background, weight, colour).
   */
  const summaryCells = (
    key: string,
    total: number,
    renderCell: (
      kind: 'total' | 'average',
      value: number
    ) => { className: string; content: ReactNode },
    Cell: 'td' | 'th' = 'td'
  ) => {
    const cell = (kind: 'total' | 'average', value: number) => {
      const { className, content } = renderCell(kind, value);
      const sticky = kind === 'total' && !columns.summaryFirst;
      return (
        <Cell
          key={`${key}-${kind}`}
          data-column={kind}
          className={cn(
            sticky ? STICKY_RIGHT : SUMMARY_CELL,
            // Close the summary block: the last of Total/Average before the months.
            columns.summaryFirst && (kind === 'average' || !columns.average) && 'border-r',
            className
          )}
        >
          {content}
        </Cell>
      );
    };
    const totalCell = cell('total', total);
    const averageCell = columns.average ? cell('average', average(total)) : null;
    return columns.summaryFirst ? [totalCell, averageCell] : [averageCell, totalCell];
  };

  const headerCells = summaryCells(
    'head',
    0,
    (kind) => ({
      className: 'z-30 min-w-[100px] bg-muted font-medium text-muted-foreground',
      content: kind === 'total' ? <Trans>Total</Trans> : <Trans>Average</Trans>,
    }),
    'th'
  );
  const totalsCells = summaryCells('totals', pivot.grandTotal, (_, value) => ({
    className: 'z-30 bg-muted',
    content: money.amount(value),
  }));

  return (
    <section aria-labelledby="ledger-report-heading" className="space-y-4">
      <header className="max-w-3xl space-y-1">
        <h2 id="ledger-report-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
          {reportMeta('ledger').question}
        </h2>
        {data.isLoading ? (
          <Skeleton className="h-5 w-72 max-w-full" />
        ) : (
          <p className="text-base leading-relaxed text-foreground/85" data-testid="report-answer">
            {ledgerAnswer(
              { net: pivot.grandTotal, hasActivity: !isEmpty },
              { money: (milli) => money.amount(milli), monthLabel: longMonthLabel }
            )}
          </p>
        )}
      </header>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpandedGroups(new Set(pivot.groups.map((group) => group.id)))}
          disabled={!pivot.groups.length}
        >
          <Trans>Expand all</Trans>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpandedGroups(new Set())}
          disabled={!pivot.groups.length}
        >
          <Trans>Collapse all</Trans>
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id="ledger-average-column"
            checked={columns.average}
            onCheckedChange={(checked) => updateColumns({ average: checked })}
          />
          <Label htmlFor="ledger-average-column" className="text-sm font-normal">
            <Trans>Average column</Trans>
          </Label>
        </div>
        <Select
          value={columns.summaryFirst ? 'first' : 'last'}
          onValueChange={(value) => updateColumns({ summaryFirst: value === 'first' })}
        >
          <SelectTrigger
            className="h-8 w-auto gap-2 text-sm"
            aria-label={
              columns.average ? t`Where Total and Average go` : t`Where the Total column goes`
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last">
              {columns.average ? t`Total and Average at the end` : t`Total at the end`}
            </SelectItem>
            <SelectItem value="first">
              {columns.average ? t`Total and Average first` : t`Total first`}
            </SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          <Trans>Click any amount to see its transactions.</Trans>
        </span>
      </div>
      <Card className="overflow-hidden rounded-lg p-0 shadow-none">
        <div className="p-3 sm:p-4">
          {data.isLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : isEmpty ? (
            <div className="flex h-[300px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
              <p>
                <Trans>No category activity for the selected period.</Trans>
              </p>
              <p>
                <Trans>Adjust the date range or filters to explore other results.</Trans>
              </p>
            </div>
          ) : (
            <>
              {isTruncated && (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                  <Trans>
                    Showing only the most recent {MAX_PIVOT_MONTHS} months. Narrow your date range
                    to see earlier data.
                  </Trans>
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
                          <Trans>Category</Trans>
                        </th>
                        {columns.summaryFirst && headerCells}
                        {months.map((monthKey) => (
                          <th
                            key={monthKey}
                            className="min-w-[84px] whitespace-nowrap bg-muted px-2 py-2 text-right font-medium text-muted-foreground sm:min-w-[100px] sm:px-3"
                          >
                            {shortMonthLabel(monthKey)}
                          </th>
                        ))}
                        {!columns.summaryFirst && headerCells}
                      </tr>
                      <tr className="border-b border-border/40 text-sm font-semibold text-primary">
                        <td className={cn(STICKY_LEFT, 'z-30 bg-muted')}>
                          <Trans>Totals</Trans>
                        </td>
                        {columns.summaryFirst && totalsCells}
                        {pivot.columnTotals.map((value, index) => (
                          <td
                            key={months[index]}
                            className="whitespace-nowrap bg-muted px-3 py-2 text-right"
                          >
                            {money.amount(value)}
                          </td>
                        ))}
                        {!columns.summaryFirst && totalsCells}
                      </tr>
                    </thead>
                    <tbody>
                      {pivot.groups.map((group) => {
                        const isExpanded = expanded.has(group.id);
                        const groupBg = group.isIncome
                          ? 'bg-emerald-50 dark:bg-emerald-950'
                          : 'bg-muted';
                        const groupCells = summaryCells(
                          `g${group.id}`,
                          group.total,
                          (_, value) => ({
                            className: cn(groupBg, 'font-semibold'),
                            content: money.amount(value),
                          })
                        );
                        const rowCells = (total: number) =>
                          summaryCells('row', total, (_, value) => ({
                            className: cn('bg-card text-xs font-medium', cellClass(value)),
                            content: money.amount(value),
                          }));
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
                              {columns.summaryFirst && groupCells}
                              {group.monthTotals.map((value, index) => (
                                <td
                                  key={months[index]}
                                  className="whitespace-nowrap px-3 py-2 text-right"
                                >
                                  <span className="text-xs leading-tight">
                                    {money.amount(value)}
                                  </span>
                                </td>
                              ))}
                              {!columns.summaryFirst && groupCells}
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
                                  {columns.summaryFirst && rowCells(row.total)}
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
                                  {!columns.summaryFirst && rowCells(row.total)}
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
    </section>
  );
}
