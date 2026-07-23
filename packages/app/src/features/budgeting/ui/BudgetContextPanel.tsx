import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '@shared/ui/echart';
import {
  useChartPalette,
  tooltipBase,
  tooltipHtml,
  BAR_MAX_WIDTH,
  BAR_RADIUS_TOP,
  type TooltipRow,
} from '@shared/lib/charts/echarts-chrome';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { toast } from 'sonner';
import {
  useAssignmentsByMonthForCategories,
  useBatchUpsertAssignments,
  useCategoryAssignmentHelpers,
} from '@entities/budget/api/useMonthlyBudget';
import { useSpendingTotalsByPeriod } from '@features/analytics/api/useAnalyticsQueries';
import { useTransactionsByCategoryAndMonth } from '@entities/transaction/api/useTransactions';
import { useGoalsByCategories, useCycleFinancialsForGoals } from '@entities/goal/api/useGoals';
import {
  format,
  eachMonthOfInterval,
  parse,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  differenceInDays,
  endOfToday,
  isSameMonth,
  parseISO,
} from 'date-fns';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import {
  calculateUnderfundedGoals,
  calculateOverfundedCategories,
} from '@features/budget-planning/ui/assign-dropdown/assign-dropdown.utils';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { GoalSection } from '@features/goal-management/ui/GoalSection';
import {
  Loader2,
  RefreshCcw,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  CalendarRange,
  Layers,
  Wallet,
  ArrowLeftRight,
  Coins,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { cn } from '@shared/lib/utils';
import { extractDateKey } from '@shared/lib/date-utils';
import { toastError } from '@shared/lib/errors';

interface BudgetContextPanelProps {
  budgetId: number;
  currentMonth: string;
  globalLocalizer: Intl.NumberFormat;
  selectedCategoryIds: number[];
  transformedRows: BudgetRow[];
  monthsBack?: number;
}

const cardClass = 'gap-2 py-3 rounded-xl';
const headerClass = 'px-3';
const contentClass = 'px-3';
const titleClass = 'text-sm';

interface QuickActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Disables the button and swaps the icon for a spinner. */
  pending: boolean;
  /** Optional right-aligned monospace annotation (e.g. the amount involved). */
  suffix?: string;
}

function QuickActionButton({
  icon: Icon,
  label,
  onClick,
  pending,
  suffix,
}: QuickActionButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
      className="justify-start gap-2"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
      {suffix !== undefined && (
        <span className="ml-auto font-mono text-xs text-muted-foreground">{suffix}</span>
      )}
    </Button>
  );
}

export function BudgetContextPanel({
  budgetId,
  currentMonth,
  globalLocalizer,
  selectedCategoryIds,
  transformedRows,
  monthsBack = 6,
}: BudgetContextPanelProps) {
  const batchUpsertAssignments = useBatchUpsertAssignments();
  // Every amount in this panel (budget rows, goals, analytics totals) is
  // stored milliunits; this formatter converts to decimal at display time.
  const formatAmount = useFormatMaskedMilli(globalLocalizer);
  const maskedFormatter = useMaskedLocalizer(globalLocalizer);
  const palette = useChartPalette();

  const allCategoryRows = useMemo(
    () => transformedRows.filter((row) => !row.isGroup && row.categoryId > 0),
    [transformedRows]
  );

  const effectiveCategoryIds = useMemo(() => {
    const baseIds =
      selectedCategoryIds.length > 0
        ? selectedCategoryIds
        : allCategoryRows.map((row) => row.categoryId);
    return Array.from(new Set(baseIds.filter((id) => id > 0)));
  }, [selectedCategoryIds, allCategoryRows]);

  const selectedRows = useMemo(() => {
    const idSet = new Set(effectiveCategoryIds);
    return allCategoryRows.filter((row) => idSet.has(row.categoryId));
  }, [allCategoryRows, effectiveCategoryIds]);

  const isUsingAllCategories =
    selectedCategoryIds.length === 0 || effectiveCategoryIds.length === 0;

  const selectedCategory = useMemo(() => {
    if (selectedCategoryIds.length === 1) {
      return allCategoryRows.find((row) => row.categoryId === selectedCategoryIds[0]);
    }
    return null;
  }, [selectedCategoryIds, allCategoryRows]);

  // Fetch transactions and goal for single selected category
  const { data: categoryTransactions = [] } = useTransactionsByCategoryAndMonth(
    budgetId,
    selectedCategory?.name || '',
    currentMonth
  );

  const { data: categoryGoals = [] } = useGoalsByCategories(
    selectedCategory ? [selectedCategory.categoryId] : []
  );

  const monthlyGoal = categoryGoals?.find(
    (g) => g.CategoryID === selectedCategory?.categoryId && g.Type === 'monthly'
  )?.Target;

  // Yearly/target-date goals need assignment history for cycle-aware progress
  const { data: cycleFinancials } = useCycleFinancialsForGoals(categoryGoals, currentMonth);

  // Goal-based quick actions for a single selected category. Reuses the same
  // underfunded/overfunded math as the assign dropdown so both surfaces agree.
  const goalQuickActions = useMemo(() => {
    if (!selectedCategory || !categoryGoals || categoryGoals.length === 0) return null;
    const currencyCode = globalLocalizer.resolvedOptions().currency ?? 'USD';
    const rowData = [
      {
        CategoryID: selectedCategory.categoryId,
        Category: selectedCategory.name,
        Assigned: selectedCategory.assigned,
        Activity: selectedCategory.activity,
        Available: selectedCategory.available,
      } as GetMonthlyBudgetRow,
    ];
    return {
      underfunded:
        calculateUnderfundedGoals(
          categoryGoals,
          rowData,
          currencyCode,
          currentMonth,
          cycleFinancials
        )[0] ?? null,
      overfunded:
        calculateOverfundedCategories(
          categoryGoals,
          rowData,
          currencyCode,
          currentMonth,
          cycleFinancials
        )[0] ?? null,
    };
  }, [selectedCategory, categoryGoals, globalLocalizer, currentMonth, cycleFinancials]);

  // Calculate cumulative spending with budget pace for single category with monthly goal
  const budgetPacingData = useMemo(() => {
    if (
      !selectedCategory ||
      !monthlyGoal ||
      !categoryTransactions ||
      categoryTransactions.length === 0
    ) {
      return null;
    }

    const monthDate = parse(`${currentMonth}-01`, 'yyyy-MM-dd', new Date());
    const startDate = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);
    const current = new Date();
    const actualEndDate = isSameMonth(current, monthDate) ? endOfToday() : monthEnd;

    const totalDaysInMonth = differenceInDays(monthEnd, startDate) + 1;
    const dailyBudgetPace = (monthlyGoal as number) / totalDaysInMonth;

    // Compare YYYY-MM-DD keys as strings — parsing tx.Date with new Date()
    // anchors it to UTC and shifts/drops days for users west of UTC.
    const startKey = format(startDate, 'yyyy-MM-dd');
    const endKey = format(actualEndDate, 'yyyy-MM-dd');
    const dailySpendMap: Record<string, number> = {};
    categoryTransactions.forEach((tx) => {
      const dayKey = extractDateKey(tx.Date);
      if (dayKey >= startKey && dayKey <= endKey) {
        dailySpendMap[dayKey] = (dailySpendMap[dayKey] || 0) + (tx.Outflow || 0);
      }
    });

    const allDates = eachDayOfInterval({ start: startDate, end: actualEndDate });

    let runningTotal = 0;
    const cumulative = allDates.map((date, index) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const dailySpending = dailySpendMap[dateStr] || 0;
      runningTotal += dailySpending;
      const budgetPaceAmount = dailyBudgetPace * (index + 1);

      return {
        date: dateStr,
        cumulative: runningTotal,
        budgetPace: budgetPaceAmount,
        isOverPace: runningTotal > budgetPaceAmount,
      };
    });

    return {
      data: cumulative,
      totalSpent: runningTotal,
      goal: monthlyGoal,
    };
  }, [selectedCategory, monthlyGoal, categoryTransactions, currentMonth]);

  const summaryTotals = useMemo(() => {
    return selectedRows.reduce(
      (acc, row) => {
        acc.assigned += row.assigned;
        acc.activity += row.activity;
        acc.available += row.available;
        return acc;
      },
      { assigned: 0, activity: 0, available: 0 }
    );
  }, [selectedRows]);

  const monthDate = parse(`${currentMonth}-01`, 'yyyy-MM-dd', new Date());
  const rangeStartDate = subMonths(monthDate, Math.max(monthsBack - 1, 0));
  const spendingRangeStart = startOfMonth(rangeStartDate);
  const spendingRangeEnd = endOfMonth(monthDate);
  const spendingQuery = useSpendingTotalsByPeriod(
    format(spendingRangeStart, 'yyyy-MM-dd'),
    format(spendingRangeEnd, 'yyyy-MM-dd'),
    budgetId,
    'month',
    effectiveCategoryIds
  );
  const assignmentsQuery = useAssignmentsByMonthForCategories(
    effectiveCategoryIds,
    format(rangeStartDate, 'yyyy-MM'),
    currentMonth,
    budgetId
  );
  const helpersQuery = useCategoryAssignmentHelpers(effectiveCategoryIds, currentMonth);

  const monthsRange = useMemo(() => {
    const start = rangeStartDate;
    const end = monthDate;
    return eachMonthOfInterval({ start, end });
  }, [monthDate, rangeStartDate]);

  const spendingTotalsMap = useMemo(() => {
    const map = new Map<string, number>();
    spendingQuery.data?.forEach((row) => {
      const key = row.Period || extractDateKey(row.PeriodStart).slice(0, 7);
      map.set(key, Math.abs(row.TotalSpending || 0));
    });
    return map;
  }, [spendingQuery.data]);

  const spendingChartData = useMemo(() => {
    return monthsRange.map((date) => {
      const key = format(date, 'yyyy-MM');
      return {
        month: format(date, 'MMM yyyy'),
        rawMonth: key,
        spending: spendingTotalsMap.get(key) || 0,
      };
    });
  }, [monthsRange, spendingTotalsMap]);

  const totalSpending = useMemo(() => {
    return spendingChartData.reduce((acc, item) => acc + item.spending, 0);
  }, [spendingChartData]);

  const averageMonthlySpending = monthsRange.length > 0 ? totalSpending / monthsRange.length : 0;

  const assignmentsMap = useMemo(() => {
    const map = new Map<string, number>();
    assignmentsQuery.data?.forEach((row) => {
      map.set(row.Month, row.TotalAssigned || 0);
    });
    return map;
  }, [assignmentsQuery.data]);

  const combinedChartData = useMemo(() => {
    return monthsRange.map((date) => {
      const key = format(date, 'yyyy-MM');
      return {
        month: format(date, 'MMM yyyy'),
        rawMonth: key,
        spending: spendingTotalsMap.get(key) || 0,
        assigned: assignmentsMap.get(key) || 0,
      };
    });
  }, [monthsRange, spendingTotalsMap, assignmentsMap]);

  const pacingOption = useMemo<EChartsCoreOption | null>(() => {
    if (!budgetPacingData) return null;
    const { chrome } = palette;
    const cumulativeColor = palette.series[0];
    const paceColor = palette.series[1];
    const points = budgetPacingData.data;

    return {
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: points.map((datum) => format(parseISO(datum.date), 'd')),
        boundaryGap: false,
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: { type: 'value' as const, show: false },
      tooltip: {
        ...tooltipBase(chrome),
        // Narrow container — render the tooltip into <body> so it isn't clipped.
        appendToBody: true,
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const datum = points[items[0]?.dataIndex ?? 0];
          if (!datum) return '';
          const rows: TooltipRow[] = [
            { color: cumulativeColor, name: 'Cumulative', value: formatAmount(datum.cumulative) },
            { color: paceColor, name: 'Budget Pace', value: formatAmount(datum.budgetPace) },
            {
              color: datum.isOverPace ? palette.flow.negative : palette.flow.positive,
              name: datum.isOverPace ? 'Over pace' : 'Under pace',
              value: formatAmount(Math.abs(datum.budgetPace - datum.cumulative)),
            },
          ];
          return tooltipHtml(format(parseISO(datum.date), 'MMM d'), rows);
        },
      },
      series: [
        {
          name: 'Cumulative Spending',
          type: 'line' as const,
          data: points.map((datum) => datum.cumulative),
          lineStyle: { color: cumulativeColor, width: 2 },
          itemStyle: { color: cumulativeColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'none',
          areaStyle: { color: cumulativeColor, opacity: 0.1 },
        },
        {
          name: 'Budget Pace',
          type: 'line' as const,
          data: points.map((datum) => datum.budgetPace),
          lineStyle: { color: paceColor, width: 2, opacity: 0.7, type: [5, 5] },
          itemStyle: { color: paceColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'none',
        },
      ],
    };
  }, [budgetPacingData, palette, formatAmount]);

  const historyOption = useMemo<EChartsCoreOption>(() => {
    const { chrome } = palette;
    const spendingColor = palette.flow.negative;
    const assignedColor = palette.flow.positive;

    return {
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: combinedChartData.map((datum) => datum.month),
        axisLine: { lineStyle: { color: chrome.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: chrome.axisText, fontSize: 11, hideOverlap: true },
      },
      yAxis: { type: 'value' as const, show: false },
      tooltip: {
        ...tooltipBase(chrome),
        // Narrow container — render the tooltip into <body> so it isn't clipped.
        appendToBody: true,
        trigger: 'axis' as const,
        axisPointer: { type: 'line' as const, lineStyle: { color: chrome.axisLine } },
        formatter: (params: unknown) => {
          const items = params as { dataIndex: number }[];
          const datum = combinedChartData[items[0]?.dataIndex ?? 0];
          if (!datum) return '';
          return tooltipHtml(datum.month, [
            { color: spendingColor, name: 'Spending', value: formatAmount(datum.spending) },
            { color: assignedColor, name: 'Assigned', value: formatAmount(datum.assigned) },
          ]);
        },
      },
      series: [
        {
          name: 'Spending',
          type: 'bar' as const,
          data: combinedChartData.map((datum) => datum.spending),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: spendingColor, borderRadius: BAR_RADIUS_TOP },
        },
        {
          name: 'Assigned',
          type: 'bar' as const,
          data: combinedChartData.map((datum) => datum.assigned),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: assignedColor, borderRadius: BAR_RADIUS_TOP },
        },
      ],
    };
  }, [combinedChartData, palette, formatAmount]);

  const handleApplyAssignments = (
    assignments: { categoryId: number; amount: number }[],
    message: string
  ) => {
    if (!assignments.length) {
      toast.error('Select at least one category.');
      return;
    }
    batchUpsertAssignments.mutate(
      assignments.map((item) => ({ ...item, month: currentMonth, budgetId })),
      {
        onSuccess: () => {
          toast.success(message);
        },
        onError: (error) => {
          toastError('Update failed', error, 'Please try again.');
        },
      }
    );
  };

  const handleResetAllocations = () => {
    const assignments = effectiveCategoryIds.map((categoryId) => ({ categoryId, amount: 0 }));
    handleApplyAssignments(assignments, 'Allocations reset');
  };

  const handleResetAvailable = () => {
    const assignments = selectedRows.map((row) => ({
      categoryId: row.categoryId,
      amount: row.assigned - row.available,
    }));
    handleApplyAssignments(assignments, 'Available set to zero');
  };

  const handleApplyAverage = () => {
    if (!helpersQuery.data) return;
    const assignments = effectiveCategoryIds.map((categoryId) => ({
      categoryId,
      amount: helpersQuery.data?.average[categoryId] ?? 0,
    }));
    handleApplyAssignments(assignments, 'Applied average assigned amounts');
  };

  const handleApplyLastMonth = () => {
    if (!helpersQuery.data) return;
    // Only apply positive assignments from last month; ignore zero/negative
    const assignments = effectiveCategoryIds
      .map((categoryId) => {
        const amt = helpersQuery.data?.lastMonth[categoryId] ?? 0;
        return amt > 0 ? { categoryId, amount: amt } : null;
      })
      .filter((x): x is { categoryId: number; amount: number } => Boolean(x));
    // Categories WERE selected — they just had nothing assigned last month.
    // Falling through would hit the misleading "Select at least one
    // category" guard.
    if (effectiveCategoryIds.length > 0 && assignments.length === 0) {
      toast.info('Nothing to apply — no assignments last month.');
      return;
    }
    handleApplyAssignments(assignments, 'Applied last month totals');
  };

  const handleFundGoal = () => {
    const underfunded = goalQuickActions?.underfunded;
    if (!underfunded || !selectedCategory) return;
    handleApplyAssignments(
      [
        {
          categoryId: underfunded.categoryId,
          amount: selectedCategory.assigned + underfunded.needed,
        },
      ],
      'Goal funded'
    );
  };

  const handleReduceOverfunding = () => {
    const overfunded = goalQuickActions?.overfunded;
    if (!overfunded) return;
    handleApplyAssignments(
      [
        {
          categoryId: overfunded.categoryId,
          amount: Math.max(0, overfunded.currentAssigned - overfunded.safeReduction),
        },
      ],
      'Overfunding reduced'
    );
  };

  if (effectiveCategoryIds.length === 0) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          Add budget categories to view context insights.
        </CardContent>
      </Card>
    );
  }

  const summaryCard = (
    <Card className={cardClass}>
      <CardHeader className={headerClass}>
        <CardTitle className={titleClass}>
          {selectedCategory ? `${selectedCategory.name} Summary` : 'Summary'}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(contentClass, 'space-y-1.5 text-sm')}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
              <Layers className="h-3.5 w-3.5" />
            </span>
            Categories
          </span>
          <span className="font-medium">{isUsingAllCategories ? 'All' : selectedRows.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <Wallet className="h-3.5 w-3.5" />
            </span>
            Assigned
          </span>
          <span className="font-medium">{formatAmount(summaryTotals.assigned)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/10 text-rose-500">
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </span>
            Activity
          </span>
          <span className="font-medium">{formatAmount(summaryTotals.activity)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-500">
              <Coins className="h-3.5 w-3.5" />
            </span>
            Available
          </span>
          <span className="font-medium">{formatAmount(summaryTotals.available)}</span>
        </div>
      </CardContent>
    </Card>
  );

  const quickActionsCard = (
    <Card className={cardClass}>
      <CardHeader className={headerClass}>
        <CardTitle className={titleClass}>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className={cn(contentClass, 'flex flex-col gap-1.5')}>
        {goalQuickActions?.underfunded && (
          <QuickActionButton
            icon={Target}
            label="Fund goal"
            onClick={handleFundGoal}
            pending={batchUpsertAssignments.isPending}
            suffix={`+${formatAmount(goalQuickActions.underfunded.needed)}`}
          />
        )}
        {goalQuickActions?.overfunded && (
          <QuickActionButton
            icon={TrendingDown}
            label="Reduce overfunding"
            onClick={handleReduceOverfunding}
            pending={batchUpsertAssignments.isPending}
            suffix={`-${formatAmount(goalQuickActions.overfunded.safeReduction)}`}
          />
        )}
        <QuickActionButton
          icon={RotateCcw}
          label="Reset allocations"
          onClick={handleResetAllocations}
          pending={batchUpsertAssignments.isPending}
        />
        <QuickActionButton
          icon={RefreshCcw}
          label="Reset available"
          onClick={handleResetAvailable}
          pending={batchUpsertAssignments.isPending}
        />
        <QuickActionButton
          icon={TrendingUp}
          label="Apply average assigned"
          onClick={handleApplyAverage}
          pending={batchUpsertAssignments.isPending || helpersQuery.isLoading}
        />
        <QuickActionButton
          icon={CalendarRange}
          label="Apply last month assigned"
          onClick={handleApplyLastMonth}
          pending={batchUpsertAssignments.isPending || helpersQuery.isLoading}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {/* When a single category is selected its stats already show in the table row,
          so lead with Quick Actions instead of repeating them. */}
      {selectedCategory ? quickActionsCard : summaryCard}

      {selectedCategory && (
        <Card className={cardClass}>
          <CardHeader className={headerClass}>
            <CardTitle className={titleClass}>{selectedCategory.name} Goal</CardTitle>
          </CardHeader>
          <CardContent className={contentClass}>
            <GoalSection
              categoryId={selectedCategory.categoryId}
              categoryName={selectedCategory.name}
              budgetId={budgetId}
              finances={{
                available: selectedCategory.available,
                assigned: selectedCategory.assigned,
                activity: selectedCategory.activity,
              }}
              currentMonth={currentMonth}
              formatter={maskedFormatter}
              compact={false}
            />
          </CardContent>
        </Card>
      )}

      {budgetPacingData && (
        <Card className={cardClass}>
          <CardHeader className={headerClass}>
            <CardTitle className={titleClass}>Budget Pacing</CardTitle>
          </CardHeader>
          <CardContent className={contentClass}>
            <div className="mb-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Spent:</span>
                <span className="font-medium">{formatAmount(budgetPacingData.totalSpent)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Monthly Goal:</span>
                <span className="font-medium">{formatAmount(budgetPacingData.goal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Progress:</span>
                <span
                  className={`font-medium ${budgetPacingData.totalSpent > budgetPacingData.goal ? 'text-red-600' : 'text-green-600'}`}
                >
                  {Math.round((budgetPacingData.totalSpent / budgetPacingData.goal) * 100)}%
                </span>
              </div>
            </div>
            {pacingOption ? (
              <EChart
                option={pacingOption}
                ariaLabel="Budget pacing chart"
                className="h-[160px] w-full"
              />
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card className={cardClass}>
        <CardHeader className={headerClass}>
          <CardTitle className={titleClass}>Spending & Assignments History</CardTitle>
        </CardHeader>
        <CardContent className={contentClass}>
          <div className="mb-2 text-sm text-muted-foreground">
            Average monthly spend:{' '}
            <span className="font-medium text-foreground">
              {formatAmount(averageMonthlySpending)}
            </span>
          </div>
          {spendingQuery.isLoading || assignmentsQuery.isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <EChart
              option={historyOption}
              ariaLabel="Spending and assignments history chart"
              className="h-[200px] w-full"
            />
          )}
        </CardContent>
      </Card>

      {!selectedCategory && quickActionsCard}
    </div>
  );
}
