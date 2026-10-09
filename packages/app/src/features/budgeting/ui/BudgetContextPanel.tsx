import { Trans, useLingui } from '@lingui/react/macro';
import { useGoalFundingSettings } from '@entities/budget/api/useGoalFundingSettings';
import { FundingPriorityEditor } from '@features/category-management/ui/FundingPriorityEditor';
import { CategoryNoteEditor } from '@features/category-management/ui/CategoryNoteEditor';
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
import {
  useGoals,
  useGoalsByCategories,
  useCycleFinancialsForGoals,
} from '@entities/goal/api/useGoals';
import {
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
import { formatDate as format } from '@shared/lib/date-format';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import {
  calculateUnderfundedGoals,
  calculateOverspentCategories,
  calculateOverfundedCategories,
  prepareUnderfundedAssignments,
  prepareOverspentAssignments,
} from '@features/budget-planning/ui/assign-dropdown/assign-dropdown.utils';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { asMilli, sumMilli, ZERO_MILLI } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
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
  AlertTriangle,
  Coins,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { cn } from '@shared/lib/utils';
import { extractDateKey } from '@shared/lib/date-utils';
import { toastError } from '@shared/lib/errors';
import { useAllowOverAssignment } from '@shared/hooks/useUserPreferences';

interface BudgetContextPanelProps {
  budgetId: number;
  currentMonth: string;
  readyToAssign: number;
  globalLocalizer: Intl.NumberFormat;
  selectedCategoryIds: number[];
  transformedRows: BudgetRow[];
  monthsBack?: number;
}

const cardClass = 'gap-2 py-3 rounded-xl';
const headerClass = 'px-3';
const contentClass = 'px-3';
// leading-snug so titles that wrap to two lines in longer languages stay legible.
const titleClass = 'text-sm leading-snug';

interface QuickActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Disables the button and swaps the icon for a spinner. */
  pending: boolean;
  disabled?: boolean;
  /** Optional right-aligned monospace annotation (e.g. the amount involved). */
  suffix?: string;
}

function QuickActionButton({
  icon: Icon,
  label,
  onClick,
  pending,
  disabled = false,
  suffix,
}: QuickActionButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending || disabled}
      className="h-auto min-h-8 justify-start gap-2 py-1.5 whitespace-normal text-left"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Icon className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {suffix !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{suffix}</span>
      )}
    </Button>
  );
}

export function BudgetContextPanel({
  budgetId,
  currentMonth,
  readyToAssign,
  globalLocalizer,
  selectedCategoryIds,
  transformedRows,
  monthsBack = 6,
}: BudgetContextPanelProps) {
  const { t } = useLingui();

  const batchUpsertAssignments = useBatchUpsertAssignments();
  const { data: allowOverAssignment = false } = useAllowOverAssignment();
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

  const selectedBudgetRows = useMemo(
    () =>
      selectedRows.map(
        (row) =>
          ({
            CategoryID: row.categoryId,
            FundingPriority: row.fundingPriority ?? 3,
            Category: row.name,
            Assigned: row.assigned,
            Activity: row.activity,
            Available: row.available,
          }) as GetMonthlyBudgetRow
      ),
    [selectedRows]
  );

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

  const categoryGoalsQuery = useGoalsByCategories(
    selectedCategory ? [selectedCategory.categoryId] : []
  );

  const categoryGoals = categoryGoalsQuery.data;
  const monthlyGoal = categoryGoals?.find(
    (g) => g.CategoryID === selectedCategory?.categoryId && g.Type === 'monthly'
  )?.Target;

  // All goals of the budget, for the underfunded total in the Summary card.
  const goalsQuery = useGoals(budgetId);
  const allGoals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data]);
  const settings = useGoalFundingSettings(budgetId);

  // Yearly/target-date goals need assignment history for cycle-aware progress
  const cycleQuery = useCycleFinancialsForGoals(allGoals, currentMonth);
  const cycleFinancials = cycleQuery.data;
  const needsCycles = allGoals.some(
    (goal) => goal.Type === 'yearly' || goal.Type === 'target-date'
  );
  const fundingReady =
    settings.isReady &&
    goalsQuery.isSuccess &&
    !goalsQuery.isFetching &&
    (!selectedCategory || (categoryGoalsQuery.isSuccess && !categoryGoalsQuery.isFetching)) &&
    (!needsCycles || (cycleQuery.isSuccess && !cycleQuery.isFetching));

  // Total still needed this month across the goals of the rows in scope
  // (the selection, or every category). Same maths as the assign dropdown's
  // "Fund underfunded goals" so the two surfaces always agree.
  const underfundedSummary = useMemo(() => {
    if (!allGoals.length || !selectedRows.length) {
      return { total: ZERO_MILLI, count: 0, goals: [] };
    }
    const currencyCode = globalLocalizer.resolvedOptions().currency ?? 'USD';
    const idSet = new Set(selectedRows.map((row) => row.categoryId));
    const goalsInScope = allGoals.filter((goal) => idSet.has(goal.CategoryID));
    if (!goalsInScope.length) return { total: ZERO_MILLI, count: 0, goals: [] };
    const underfunded = calculateUnderfundedGoals(
      goalsInScope,
      selectedBudgetRows,
      currencyCode,
      currentMonth,
      cycleFinancials
    );
    return {
      total: roundMilli(underfunded.reduce((sum, g) => sum + g.needed, 0)),
      count: underfunded.length,
      goals: underfunded,
    };
  }, [allGoals, selectedRows, selectedBudgetRows, globalLocalizer, currentMonth, cycleFinancials]);

  const overspentSummary = useMemo(() => {
    const categories = calculateOverspentCategories(selectedBudgetRows);
    return {
      categories,
      total: sumMilli(categories.map((category) => category.overspent)),
    };
  }, [selectedBudgetRows]);

  const overspendingQuickActionAmount = asMilli(
    Math.min(
      overspentSummary.total,
      allowOverAssignment ? overspentSummary.total : Math.max(0, readyToAssign)
    )
  );
  const underfundedQuickActionAmount = asMilli(
    Math.min(
      underfundedSummary.total,
      allowOverAssignment ? underfundedSummary.total : Math.max(0, readyToAssign)
    )
  );

  // Goal-based quick actions for a single selected category. Reuses the same
  // underfunded/overfunded math as the assign dropdown so both surfaces agree.
  const goalQuickActions = useMemo(() => {
    if (!selectedCategory || !categoryGoals || categoryGoals.length === 0) return null;
    const currencyCode = globalLocalizer.resolvedOptions().currency ?? 'USD';
    const rowData = [
      {
        CategoryID: selectedCategory.categoryId,
        FundingPriority: selectedCategory.fundingPriority ?? 3,
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
        dailySpendMap[dayKey] = (dailySpendMap[dayKey] || 0) + (tx.OutflowConverted || 0);
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
            { color: cumulativeColor, name: t`Cumulative`, value: formatAmount(datum.cumulative) },
            { color: paceColor, name: t`Budget Pace`, value: formatAmount(datum.budgetPace) },
            {
              color: datum.isOverPace ? palette.flow.negative : palette.flow.positive,
              name: datum.isOverPace ? t`Over pace` : t`Under pace`,
              value: formatAmount(Math.abs(datum.budgetPace - datum.cumulative)),
            },
          ];
          return tooltipHtml(format(parseISO(datum.date), 'MMM d'), rows);
        },
      },
      series: [
        {
          name: t`Cumulative Spending`,
          type: 'line' as const,
          data: points.map((datum) => datum.cumulative),
          lineStyle: { color: cumulativeColor, width: 2 },
          itemStyle: { color: cumulativeColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'none',
          areaStyle: { color: cumulativeColor, opacity: 0.1 },
        },
        {
          name: t`Budget Pace`,
          type: 'line' as const,
          data: points.map((datum) => datum.budgetPace),
          lineStyle: { color: paceColor, width: 2, opacity: 0.7, type: [5, 5] },
          itemStyle: { color: paceColor, borderColor: chrome.surface, borderWidth: 2 },
          symbol: 'none',
        },
      ],
    };
  }, [budgetPacingData, palette, formatAmount, t]);

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
            { color: spendingColor, name: t`Spending`, value: formatAmount(datum.spending) },
            { color: assignedColor, name: t`Assigned`, value: formatAmount(datum.assigned) },
          ]);
        },
      },
      series: [
        {
          name: t`Spending`,
          type: 'bar' as const,
          data: combinedChartData.map((datum) => datum.spending),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: spendingColor, borderRadius: BAR_RADIUS_TOP },
        },
        {
          name: t`Assigned`,
          type: 'bar' as const,
          data: combinedChartData.map((datum) => datum.assigned),
          barMaxWidth: BAR_MAX_WIDTH,
          itemStyle: { color: assignedColor, borderRadius: BAR_RADIUS_TOP },
        },
      ],
    };
  }, [combinedChartData, palette, formatAmount, t]);

  const handleApplyAssignments = (
    assignments: { categoryId: number; amount: number }[],
    message: string
  ) => {
    if (!assignments.length) {
      toast.error(t`Select at least one category.`);
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
      toast.info(t`Nothing to apply — no assignments last month.`);
      return;
    }
    handleApplyAssignments(assignments, 'Applied last month totals');
  };

  const handleFundGoal = () => {
    const underfunded = goalQuickActions?.underfunded;
    if (!fundingReady || !underfunded || !selectedCategory) return;
    const { batchAssignments } = prepareUnderfundedAssignments(
      [underfunded],
      allowOverAssignment ? underfunded.needed : Math.max(0, readyToAssign),
      selectedBudgetRows,
      settings.GoalFundingDistribution
    );
    if (batchAssignments.length) handleApplyAssignments(batchAssignments, 'Added goal funding');
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

  const handleCoverOverspending = () => {
    const { assignments, batchAssignments } = prepareOverspentAssignments(
      overspentSummary.categories,
      overspendingQuickActionAmount,
      selectedBudgetRows
    );
    const total = sumMilli(assignments.map((assignment) => assignment.amount));
    handleApplyAssignments(
      batchAssignments,
      `Covered ${assignments.length} categor${assignments.length === 1 ? 'y' : 'ies'} (${formatAmount(total)})`
    );
  };

  const handleFundUnderfunded = () => {
    if (!fundingReady || underfundedQuickActionAmount <= 0) return;
    const { assignments, batchAssignments } = prepareUnderfundedAssignments(
      underfundedSummary.goals,
      underfundedQuickActionAmount,
      selectedBudgetRows,
      settings.GoalFundingDistribution
    );
    const total = sumMilli(assignments.map((assignment) => assignment.amount));
    handleApplyAssignments(
      batchAssignments,
      `Funded ${assignments.length} goal${assignments.length === 1 ? '' : 's'} (${formatAmount(total)})`
    );
  };

  if (effectiveCategoryIds.length === 0) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          <Trans>Add budget categories to view context insights.</Trans>
        </CardContent>
      </Card>
    );
  }

  const summaryCard = (
    <Card className={cardClass}>
      <CardHeader className={headerClass}>
        <CardTitle className={titleClass}>
          {selectedCategory ? t`${selectedCategory.name} Summary` : t`Summary`}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(contentClass, 'space-y-1.5 text-sm')}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Trans>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                <Layers className="h-3.5 w-3.5" />
              </span>
              Categories
            </Trans>
          </span>
          <span className="font-medium">{isUsingAllCategories ? t`All` : selectedRows.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Trans>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
                <Wallet className="h-3.5 w-3.5" />
              </span>
              Assigned
            </Trans>
          </span>
          <span className="font-medium">{formatAmount(summaryTotals.assigned)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Trans>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/10 text-rose-500">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </span>
              Activity
            </Trans>
          </span>
          <span className="font-medium">{formatAmount(summaryTotals.activity)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Trans>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-500">
                <Coins className="h-3.5 w-3.5" />
              </span>
              Available
            </Trans>
          </span>
          <span className="font-medium">{formatAmount(summaryTotals.available)}</span>
        </div>
        <div className="flex items-center justify-between" data-testid="summary-underfunded-goals">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Trans>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
                <Target className="h-3.5 w-3.5" />
              </span>
              Underfunded goals
              {underfundedSummary.count > 0 && (
                <span className="text-xs text-muted-foreground/70">
                  · {underfundedSummary.count}
                </span>
              )}
            </Trans>
          </span>
          <span
            className={cn(
              'font-medium',
              underfundedSummary.total > 0 && 'text-amber-600 dark:text-amber-400'
            )}
          >
            {formatAmount(underfundedSummary.total)}
          </span>
        </div>
      </CardContent>
    </Card>
  );

  const quickActionsCard = (
    <Card className={cardClass}>
      <CardHeader className={headerClass}>
        <CardTitle className={titleClass}>
          <Trans>Quick Actions</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(contentClass, 'flex flex-col gap-1.5')}>
        <QuickActionButton
          icon={AlertTriangle}
          label={t`Cover overspending`}
          onClick={handleCoverOverspending}
          pending={batchUpsertAssignments.isPending}
          disabled={
            overspentSummary.categories.length === 0 || (readyToAssign <= 0 && !allowOverAssignment)
          }
          suffix={`+${formatAmount(overspendingQuickActionAmount)}`}
        />
        {!selectedCategory && (
          <QuickActionButton
            icon={Target}
            label={t`Fund underfunded`}
            onClick={handleFundUnderfunded}
            pending={batchUpsertAssignments.isPending}
            disabled={
              !fundingReady ||
              underfundedSummary.count === 0 ||
              (readyToAssign <= 0 && !allowOverAssignment)
            }
            suffix={`+${formatAmount(underfundedQuickActionAmount)}`}
          />
        )}
        {goalQuickActions?.underfunded && (
          <QuickActionButton
            icon={Target}
            label={t`Fund goal`}
            onClick={handleFundGoal}
            pending={batchUpsertAssignments.isPending}
            disabled={!fundingReady || (readyToAssign <= 0 && !allowOverAssignment)}
            suffix={`+${formatAmount(allowOverAssignment ? goalQuickActions.underfunded.needed : Math.min(goalQuickActions.underfunded.needed, Math.max(0, readyToAssign)))}`}
          />
        )}
        {goalQuickActions?.overfunded && (
          <QuickActionButton
            icon={TrendingDown}
            label={t`Reduce overfunding`}
            onClick={handleReduceOverfunding}
            pending={batchUpsertAssignments.isPending}
            suffix={`-${formatAmount(goalQuickActions.overfunded.safeReduction)}`}
          />
        )}
        <QuickActionButton
          icon={RotateCcw}
          label={t`Reset allocations`}
          onClick={handleResetAllocations}
          pending={batchUpsertAssignments.isPending}
        />
        <QuickActionButton
          icon={RefreshCcw}
          label={t`Reset available`}
          onClick={handleResetAvailable}
          pending={batchUpsertAssignments.isPending}
        />
        <QuickActionButton
          icon={TrendingUp}
          label={t`Apply average assigned`}
          onClick={handleApplyAverage}
          pending={batchUpsertAssignments.isPending || helpersQuery.isLoading}
        />
        <QuickActionButton
          icon={CalendarRange}
          label={t`Apply last month assigned`}
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
      {selectedCategoryIds.length > 0 && selectedRows.length > 0 && (
        <Card className={cardClass}>
          <CardContent className={contentClass}>
            <FundingPriorityEditor
              budgetId={budgetId}
              categoryIds={selectedRows.map((row) => row.categoryId)}
              priority={
                selectedRows.every(
                  (row) => (row.fundingPriority ?? 3) === (selectedRows[0].fundingPriority ?? 3)
                )
                  ? (selectedRows[0].fundingPriority ?? 3)
                  : null
              }
            />
          </CardContent>
        </Card>
      )}

      {selectedCategory && (
        <Card className={cardClass}>
          <CardHeader className={headerClass}>
            <CardTitle className={titleClass}>
              <Trans>{selectedCategory.name} Goal</Trans>
            </CardTitle>
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

      {selectedCategory && (
        <Card className={cardClass}>
          <CardHeader className={headerClass}>
            <CardTitle className={titleClass}>
              <Trans>Note</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className={contentClass}>
            <CategoryNoteEditor budgetId={budgetId} categoryId={selectedCategory.categoryId} />
          </CardContent>
        </Card>
      )}

      {budgetPacingData && (
        <Card className={cardClass}>
          <CardHeader className={headerClass}>
            <CardTitle className={titleClass}>
              <Trans>Budget Pacing</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className={contentClass}>
            <div className="mb-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  <Trans>Total Spent:</Trans>
                </span>
                <span className="font-medium">{formatAmount(budgetPacingData.totalSpent)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  <Trans>Monthly Goal:</Trans>
                </span>
                <span className="font-medium">{formatAmount(budgetPacingData.goal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  <Trans>Progress:</Trans>
                </span>
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
          <CardTitle className={titleClass}>
            <Trans>Spending & Assignments History</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className={contentClass}>
          <div className="mb-2 text-sm text-muted-foreground">
            <Trans>
              Average monthly spend:{' '}
              <span className="font-medium text-foreground">
                {formatAmount(averageMonthlySpending)}
              </span>
            </Trans>
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
