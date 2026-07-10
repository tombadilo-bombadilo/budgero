import { useMemo } from 'react';
import {
  subDays,
  format,
  startOfMonth,
  endOfMonth,
  eachMonthOfInterval,
  differenceInDays,
  parseISO,
} from 'date-fns';
import {
  useOnBudgetBalance,
  useOnBudgetBalanceByDates,
  useSpendingByDatesByCategories,
} from '@features/analytics/api/useAnalyticsQueries';
import { useTotalAssignedForBudgetPace } from '@entities/budget/api/useMonthlyBudget';
import { formatDateISO } from '@shared/lib/date-utils';

interface Trend {
  change: number;
  percentage: number;
}

interface BalanceChartPoint {
  date: string;
  balance: number;
}

/**
 * Shared dashboard derived-state / metrics computation used by both the desktop
 * and mobile dashboards.
 *
 * Callers resolve their own start/end {@link Date} forms (desktop passes the raw
 * range, which may be `null`; mobile passes a fallback-resolved range that is
 * never `null`). The hook owns the shared analytics queries, previous-period
 * derivation and NaN-safe metric computation, and returns both ISO-string and
 * Date forms of the active range for callers that consume them differently.
 */
export function useDashboardMetrics(
  budgetId: number,
  startDate: Date | null,
  endDate: Date | null
) {
  // ISO-string forms used both for the analytics queries and by callers that
  // pass string dates downstream (e.g. CashflowTrendCard).
  const startDateISO = startDate ? formatDateISO(startDate) : '';
  const endDateISO = endDate ? formatDateISO(endDate) : '';

  const { data: totalBalance = 0 } = useOnBudgetBalance(budgetId);

  const { data: balanceData } = useOnBudgetBalanceByDates(startDateISO, endDateISO, budgetId);

  const { data: spendingData } = useSpendingByDatesByCategories(startDateISO, endDateISO, budgetId);

  // Previous period for trends
  const previousPeriod = useMemo(() => {
    if (!startDate || !endDate) return null;
    const daysDiff = differenceInDays(endDate, startDate) + 1;
    return {
      startDate: subDays(startDate, daysDiff),
      endDate: subDays(startDate, 1),
    };
  }, [startDate, endDate]);

  const { data: previousBalanceData } = useOnBudgetBalanceByDates(
    previousPeriod?.startDate ? formatDateISO(previousPeriod.startDate) : '',
    previousPeriod?.endDate ? formatDateISO(previousPeriod.endDate) : '',
    budgetId
  );
  const { data: previousSpendingData } = useSpendingByDatesByCategories(
    previousPeriod?.startDate ? formatDateISO(previousPeriod.startDate) : '',
    previousPeriod?.endDate ? formatDateISO(previousPeriod.endDate) : '',
    budgetId
  );

  // Months in current range for budget pace
  const monthsInRange = useMemo(() => {
    if (!startDate || !endDate) return [];
    return eachMonthOfInterval({
      start: startOfMonth(startDate),
      end: endOfMonth(endDate),
    }).map((d) => format(d, 'yyyy-MM'));
  }, [startDate, endDate]);

  const { data: totalAssignedAmount, isLoading: isLoadingBudgetAmount } =
    useTotalAssignedForBudgetPace(monthsInRange, budgetId);

  const balanceChartData = useMemo<BalanceChartPoint[]>(() => {
    if (!balanceData || balanceData.length === 0) return [];
    return balanceData.map((item) => ({
      date: format(parseISO(item.Date), 'MMM d'),
      balance: item.Balance,
    }));
  }, [balanceData]);

  const totalSpending = useMemo(() => {
    if (!spendingData) return 0;
    return spendingData.reduce((sum, item) => {
      const spending = item.Spending || 0;
      if (isNaN(spending)) {
        return sum;
      }
      return sum + spending;
    }, 0);
  }, [spendingData]);

  const previousTotalSpending = useMemo(() => {
    if (!previousSpendingData) return 0;
    return previousSpendingData.reduce((sum, item) => {
      const spending = item.Spending || 0;
      if (isNaN(spending)) return sum;
      return sum + spending;
    }, 0);
  }, [previousSpendingData]);

  const spendingTrend = useMemo<Trend>(() => {
    const change = totalSpending - previousTotalSpending;
    const percentage =
      previousTotalSpending !== 0 ? (change / Math.abs(previousTotalSpending)) * 100 : 0;
    return { change, percentage };
  }, [totalSpending, previousTotalSpending]);

  const balanceTrend = useMemo<Trend>(() => {
    if (!previousBalanceData || previousBalanceData.length === 0)
      return { change: 0, percentage: 0 };
    const previousBalance = previousBalanceData[previousBalanceData.length - 1]?.Balance || 0;
    const change = totalBalance - previousBalance;
    // Guard against a near-zero baseline (incl. floating-point residue) which would
    // otherwise produce an absurd percentage like +3,067,531,888,378,773,504%.
    const percentage =
      Math.abs(previousBalance) > 1e-6 ? (change / Math.abs(previousBalance)) * 100 : 0;
    return { change, percentage };
  }, [totalBalance, previousBalanceData]);

  const budgetRemaining = useMemo(() => {
    // If still loading budget data, show 0 instead of NaN
    if (isLoadingBudgetAmount) return 0;

    const assignedAmount = totalAssignedAmount || 0;
    const spentAmount = totalSpending || 0;

    if (isNaN(assignedAmount) || isNaN(spentAmount)) return 0;

    return Math.max(0, assignedAmount - spentAmount);
  }, [totalAssignedAmount, totalSpending, isLoadingBudgetAmount]);

  return {
    // Active range, both forms
    startDate,
    endDate,
    startDateISO,
    endDateISO,
    isLoading: isLoadingBudgetAmount,
    // Raw query results consumed by callers
    totalBalance,
    totalAssignedAmount,
    // Derived metrics (NaN-safe)
    balanceChartData,
    totalSpending,
    spendingTrend,
    balanceTrend,
    budgetRemaining,
  };
}
