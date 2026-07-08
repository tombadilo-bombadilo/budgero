import { Fragment, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { useUiStore } from '@shared/store/useUiStore';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { useCategoryTotalsByPeriod } from '@features/analytics/api/useAnalyticsQueries';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Skeleton } from '@shared/ui/skeleton';
import { cn } from '@shared/lib/utils';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { CategoryFilterControl } from './components/CategoryFilterControl';
import { AccountFilterControl } from './components/AccountFilterControl';
import { CategoryTransactionCell } from './components/CategoryTransactionCell';
import { useSpendingFilters } from './components/useSpendingFilters';
import { usePivotData, MAX_MONTHS } from './hooks/usePivotData';

export function PrebuiltCategoryPivot() {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const {
    selectedCategoryIds,
    setSelectedCategoryIds,
    selectedAccountIds,
    setSelectedAccountIds,
    categoryFilterIds,
    accountFilterIds,
    startDate,
    endDate,
    budgetId,
    globalLocalizer,
    privacyMaskNumbers,
  } = useSpendingFilters();

  const dateRange = useUiStore((state) => state.dateRange);

  const { data: categories = [], isLoading: isLoadingCategories } = useCategories(budgetId);
  const { data: categoryGroups = [], isLoading: isLoadingGroups } = useCategoryGroups(budgetId);

  const { data: categoryTotals, isLoading: isLoadingTotals } = useCategoryTotalsByPeriod(
    startDate,
    endDate,
    budgetId,
    'month',
    categoryFilterIds,
    accountFilterIds
  );

  const { months, isTruncated, groupRows, columnTotals, overallTotals } = usePivotData({
    dateRange,
    categories,
    categoryGroups,
    categoryTotals,
    selectedCategoryIds,
  });

  // Adjust expanded groups when data changes - React-approved "adjust state during render" pattern
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevGroupRows, setPrevGroupRows] = useState(groupRows);
  if (groupRows !== prevGroupRows) {
    setPrevGroupRows(groupRows);
    if (groupRows.length > 0) {
      if (expandedGroups.size === 0) {
        // Initial load - expand all groups
        setExpandedGroups(new Set(groupRows.map((row) => row.groupId)));
      } else {
        // Data changed - keep only groups that still exist
        const next = new Set<number>();
        groupRows.forEach((row) => {
          if (expandedGroups.has(row.groupId)) {
            next.add(row.groupId);
          }
        });
        if (next.size !== expandedGroups.size) {
          setExpandedGroups(next);
        }
      }
    }
  }

  const toggleGroup = (groupId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!groupRows.length) return;
    setExpandedGroups(new Set(groupRows.map((row) => row.groupId)));
  };

  const collapseAll = () => {
    if (!groupRows.length) return;
    setExpandedGroups(new Set());
  };

  // Pivot values are integer milliunit sums.
  const formatNet = (value: number) =>
    formatMaskedMilli(globalLocalizer, value, privacyMaskNumbers);

  const isLoading = isLoadingTotals || isLoadingCategories || isLoadingGroups;

  const emptyState = !isLoading && (!months.length || groupRows.length === 0);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold">Category pivot</CardTitle>
          <CardDescription>
            Compare income and spending per category across months with expandable group summaries.
          </CardDescription>
        </div>
        <div className="flex w-full flex-wrap items-stretch gap-2 sm:justify-end">
          <div className="flex min-w-[200px] flex-1 sm:flex-initial">
            <AccountFilterControl
              selectedAccountIds={selectedAccountIds}
              onChange={setSelectedAccountIds}
            />
          </div>
          <div className="flex min-w-[200px] flex-1 sm:flex-initial">
            <CategoryFilterControl
              selectedCategoryIds={selectedCategoryIds}
              onChange={setSelectedCategoryIds}
            />
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={expandAll}
              disabled={!groupRows.length}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={collapseAll}
              disabled={!groupRows.length}
            >
              Collapse all
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[360px] w-full" />
        ) : emptyState ? (
          <div className="flex h-[360px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>No category activity for the selected period.</p>
            <p>Adjust the date range or filters to explore other results.</p>
          </div>
        ) : (
          <>
            {isTruncated && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Showing only the most recent {MAX_MONTHS} months. Narrow your date range to see
                earlier data.
              </div>
            )}
            <div className="w-0 min-w-full rounded-md border overflow-hidden">
              <div className="max-h-[600px] overflow-auto">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr className="border-b border-border/60">
                      <th className="sticky left-0 z-30 min-w-[180px] border-r bg-muted px-3 py-2 text-left font-medium text-muted-foreground shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                        Category
                      </th>
                      {months.map((month) => (
                        <th
                          key={month.key}
                          className="min-w-[100px] whitespace-nowrap bg-muted px-3 py-2 text-right font-medium text-muted-foreground"
                        >
                          {month.label}
                        </th>
                      ))}
                      <th className="sticky right-0 z-30 min-w-[100px] whitespace-nowrap border-l bg-muted px-3 py-2 text-right font-medium text-muted-foreground shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                        Total
                      </th>
                    </tr>
                    <tr className="border-b border-border/40 text-sm font-semibold text-primary">
                      <td className="sticky left-0 z-30 border-r bg-muted px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                        Totals
                      </td>
                      {months.map((month) => {
                        const value = columnTotals.get(month.key) ?? 0;
                        return (
                          <td
                            key={month.key}
                            className="whitespace-nowrap bg-muted px-3 py-2 text-right"
                          >
                            <span className="text-sm font-semibold text-primary">
                              {formatNet(value)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-30 whitespace-nowrap border-l bg-muted px-3 py-2 text-right shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                        <span className="text-sm font-semibold text-primary">
                          {formatNet(overallTotals)}
                        </span>
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.map((group) => {
                      const isExpanded = expandedGroups.has(group.groupId);
                      const isIncomeGroup = group.groupName === 'Income';
                      const groupBg = isIncomeGroup
                        ? 'bg-emerald-50 dark:bg-emerald-950'
                        : 'bg-muted';
                      return (
                        <Fragment key={`group-block-${group.groupId}`}>
                          <tr
                            className={cn(
                              'border-b border-border/40 text-sm font-medium',
                              isIncomeGroup
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                                : 'bg-muted'
                            )}
                          >
                            <td
                              className={cn(
                                'sticky left-0 z-10 border-r px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]',
                                groupBg
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => toggleGroup(group.groupId)}
                                className="flex w-full items-center gap-2 text-left"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                <span className="whitespace-nowrap">{group.groupName}</span>
                              </button>
                            </td>
                            {months.map((month) => {
                              const value = group.monthTotals[month.key] ?? 0;
                              return (
                                <td
                                  key={month.key}
                                  className="whitespace-nowrap px-3 py-2 text-right"
                                >
                                  <span className="text-xs leading-tight">{formatNet(value)}</span>
                                </td>
                              );
                            })}
                            <td
                              className={cn(
                                'sticky right-0 z-10 whitespace-nowrap border-l px-3 py-2 text-right shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]',
                                groupBg
                              )}
                            >
                              <span className="text-sm leading-tight font-semibold text-primary">
                                {formatNet(group.total)}
                              </span>
                            </td>
                          </tr>
                          {isExpanded
                            ? group.categories.map((category) => (
                                <tr
                                  key={`category-${category.id ?? 'uncategorized'}`}
                                  className="border-b border-border/30 bg-background"
                                >
                                  <td className="sticky left-0 z-10 whitespace-nowrap border-r bg-background px-6 py-2 text-muted-foreground shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                                    {category.name}
                                  </td>
                                  {months.map((month) => {
                                    const value = category.monthValues[month.key] ?? 0;
                                    return (
                                      <CategoryTransactionCell
                                        key={month.key}
                                        value={value}
                                        categoryId={category.id}
                                        categoryName={category.name}
                                        budgetId={budgetId}
                                        startDate={month.start}
                                        endDate={month.end}
                                        accountIds={selectedAccountIds}
                                        globalLocalizer={globalLocalizer}
                                        privacyMaskNumbers={privacyMaskNumbers}
                                        label={month.label}
                                        disabled={value === 0}
                                      />
                                    );
                                  })}
                                  <CategoryTransactionCell
                                    value={category.total}
                                    categoryId={category.id}
                                    categoryName={category.name}
                                    budgetId={budgetId}
                                    startDate={startDate}
                                    endDate={endDate}
                                    accountIds={selectedAccountIds}
                                    globalLocalizer={globalLocalizer}
                                    privacyMaskNumbers={privacyMaskNumbers}
                                    label="Total"
                                    disabled={!startDate || !endDate || category.total === 0}
                                    tdClassName="sticky right-0 z-10 border-l bg-background shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.15)]"
                                  />
                                </tr>
                              ))
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
