import {
  eachDayOfInterval,
  differenceInDays,
  startOfMonth,
  endOfMonth,
  endOfToday,
  isSameMonth,
  format,
} from 'date-fns';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { asMilli, toDecimal, ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import type { Transaction, CumulativeDataPoint, GoalStatus } from './types';

/**
 * Maps local Transaction type to GetTransactionsByAccountRow for MobileTransactionCard.
 */
export function mapToTransactionRow(
  tx: Transaction
): GetTransactionsByAccountRow & { AccountID?: number } {
  return {
    ID: tx.ID,
    Date: tx.Date,
    Memo: tx.Memo || '',
    Inflow: tx.Inflow,
    Outflow: tx.Outflow,
    InflowOriginal: tx.Inflow_original,
    OutflowOriginal: tx.Outflow_original,
    CategoryID: tx.CategoryID ?? 0,
    Category: tx.Category || '',
    LabelID: tx.LabelID ?? null,
    Label: tx.Label ?? null,
    LabelColor: tx.LabelColor ?? null,
    Reconciled: false,
    RunningBalance: null,
    Account: tx.Account || tx.account_name || '',
    AccountID: tx.AccountID ?? tx.account_id, // Include AccountID for split operations
    Payee: tx.Payee || '',
    ExchangeRate: tx.ExchangeRate,
    ExchangeRateOverride: tx.ExchangeRateOverride,
  };
}

export function getTransactionSignedAmount(
  tx: Pick<Transaction, 'Inflow' | 'Outflow'>
): MilliUnits {
  if ((tx.Inflow || 0) > 0) return tx.Inflow || ZERO_MILLI;
  if ((tx.Outflow || 0) > 0) return asMilli(0 - (tx.Outflow || 0));
  return ZERO_MILLI;
}

/**
 * Filters transactions to only include those up to today for the current month,
 * or all transactions for past months.
 */
export function filterTransactionsByDate(
  transactions: Transaction[],
  currentMonth: string
): Transaction[] {
  if (!transactions || transactions.length === 0) return [];

  const [year, month] = currentMonth.split('-');
  const baseDate = new Date(Number(year), Number(month) - 1, 1);
  const now = new Date();
  const isCurrent = isSameMonth(now, baseDate);

  if (!isCurrent) {
    return transactions;
  }

  const start = startOfMonth(baseDate);
  const end = endOfToday();

  return transactions.filter((tx) => {
    const date = new Date(tx.Date);
    return date >= start && date <= end;
  });
}

/**
 * Calculates cumulative spending data with budget pace.
 *
 * `monthlyGoal` and the returned `totalSpent` are milliunits; the chart data
 * points are converted to decimal currency units so axes and tooltips format
 * directly.
 */
export function calculateCumulativeData(
  filteredTransactions: Transaction[],
  currentMonth: string,
  monthlyGoal: MilliUnits | undefined,
  excludeFromBudgetPace: boolean
): { cumulativeData: CumulativeDataPoint[]; totalSpent: MilliUnits } {
  if (!filteredTransactions || filteredTransactions.length === 0) {
    return { cumulativeData: [], totalSpent: ZERO_MILLI };
  }

  const [year, month] = currentMonth.split('-');
  const startDate = startOfMonth(new Date(Number(year), Number(month) - 1, 1));
  const monthEnd = endOfMonth(startDate);

  const current = new Date();
  const actualEndDate = isSameMonth(current, startDate) ? endOfToday() : monthEnd;

  const shouldShowBudgetPace = monthlyGoal && !excludeFromBudgetPace;

  const totalDaysInMonth = differenceInDays(monthEnd, startDate) + 1;
  // Float milliunits — only ever compared or converted to decimal for the chart.
  const dailyBudgetPace = shouldShowBudgetPace ? monthlyGoal / totalDaysInMonth : 0;

  // Map of spending by local date string (YYYY-MM-DD) to avoid UTC shift issues.
  // Values are exact integer milliunit sums.
  const dailySpendMap: Record<string, number> = {};
  filteredTransactions.forEach((tx) => {
    const dayKey = format(new Date(tx.Date), 'yyyy-MM-dd');
    dailySpendMap[dayKey] = (dailySpendMap[dayKey] || 0) + tx.Outflow;
  });

  const allDates = eachDayOfInterval({
    start: startDate,
    end: actualEndDate,
  });

  let runningTotal = 0;
  const cumulative = allDates.map((date, index) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dailySpending = dailySpendMap[dateStr] || 0;
    runningTotal += dailySpending;

    // Calculate budget pace amount (cumulative), in milliunits
    const budgetPaceAmount = shouldShowBudgetPace ? dailyBudgetPace * (index + 1) : 0;

    return {
      date: dateStr,
      value: toDecimal(asMilli(dailySpending)),
      cumulative: toDecimal(asMilli(runningTotal)),
      budgetPace: toDecimal(roundMilli(budgetPaceAmount)),
      isOverPace: shouldShowBudgetPace ? runningTotal > budgetPaceAmount : false,
    };
  });

  return {
    cumulativeData: cumulative,
    totalSpent: asMilli(runningTotal),
  };
}

/**
 * Calculates the goal status based on total spent and monthly goal (both milliunits).
 */
export function calculateGoalStatus(
  totalSpent: MilliUnits,
  monthlyGoal: MilliUnits | undefined
): GoalStatus | null {
  if (!monthlyGoal) return null;

  return {
    percentage: Math.round((totalSpent / monthlyGoal) * 100),
    isOver: totalSpent > monthlyGoal,
    remaining: asMilli(monthlyGoal - totalSpent),
  };
}

/**
 * Resolves account ID from a transaction.
 */
export function resolveAccountIdForTx(
  tx: Transaction,
  accounts: { ID: number; Name: string }[] | undefined
): number {
  const byField = tx.AccountID ?? tx.account_id;
  if (byField) return Number(byField);
  const name = tx.Account || tx.account_name;
  const acc = accounts?.find((a) => a.Name === name);
  return acc?.ID || 0;
}
