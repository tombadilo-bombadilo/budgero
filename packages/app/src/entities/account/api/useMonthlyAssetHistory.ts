import { useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useAllTransactions } from '@entities/transaction/api/useTransactions';
import { LIABILITY_ACCOUNT_TYPES } from '@entities/account/model/accountTypes';
import { groupTransactionsByAccount } from '@entities/account/lib/history';
import { format, parseISO, startOfMonth, eachMonthOfInterval, subMonths, isBefore } from 'date-fns';

/** All amounts are integer milliunits (sums of stored transaction amounts). */
export interface MonthlyAssetPoint {
  month: string; // YYYY-MM format
  label: string; // Display label like "Jan '24"
  // Assets
  cash: number;
  investments: number;
  retirement: number;
  realEstate: number;
  otherAssets: number;
  // Liabilities (stored as positive values for stacking)
  credit: number;
  loans: number;
  // Totals
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

const ACCOUNT_TYPE_CATEGORY: Record<string, string> = {
  Checking: 'cash',
  Savings: 'cash',
  Cash: 'cash',
  Credit: 'credit',
  Loan: 'loans',
  Mortgage: 'loans',
  'Real Estate': 'realEstate',
  'Other Asset': 'otherAssets',
  Investment: 'investments',
  Retirement: 'retirement',
};

/**
 * Monthly asset/liability breakdown for the last N months.
 *
 * Pure computation over `useAccounts` + `useAllTransactions` — memoized
 * rather than cached in the query client, so it can never serve stale data
 * across spaces.
 */
export function useMonthlyAssetHistory(budgetId: number, months = 24) {
  const { data: accounts, isLoading: accountsLoading } = useAccounts(budgetId);
  const { data: allTransactions, isLoading: transactionsLoading } = useAllTransactions(budgetId);

  const data = useMemo<MonthlyAssetPoint[] | undefined>(() => {
    if (!budgetId || !accounts || !allTransactions) return undefined;
    if (accounts.length === 0) return [];

    const endDate = new Date();
    const startDate = subMonths(startOfMonth(endDate), months - 1);

    const monthDates = eachMonthOfInterval({ start: startDate, end: endDate });

    const transactionsByAccount = groupTransactionsByAccount(allTransactions);

    const getAccountBalanceAtEndOfMonth = (accountId: number, monthEnd: Date): number => {
      const accountTransactions = transactionsByAccount.get(accountId) || [];

      // Sum all transactions up to and including this month. Amounts are
      // integer milliunits, so the sum is exact — no rounding needed.
      return accountTransactions
        .filter((tx) => !isBefore(monthEnd, parseISO(tx.Date)))
        .reduce((acc, tx) => acc + (tx.Inflow || 0) - (tx.Outflow || 0), 0);
    };

    const monthlyData: MonthlyAssetPoint[] = monthDates.map((monthDate) => {
      const monthStr = format(monthDate, 'yyyy-MM');
      const monthLabel = format(monthDate, "MMM ''yy");

      const nextMonth = new Date(monthDate);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(0); // Last day of current month

      const categoryTotals: Record<string, number> = {
        cash: 0,
        investments: 0,
        retirement: 0,
        realEstate: 0,
        otherAssets: 0,
        credit: 0,
        loans: 0,
      };

      for (const account of accounts) {
        const category = ACCOUNT_TYPE_CATEGORY[account.Type || ''] || 'otherAssets';
        const balance = getAccountBalanceAtEndOfMonth(account.ID, nextMonth);

        // For liabilities, store as positive for chart stacking
        if (LIABILITY_ACCOUNT_TYPES.has(account.Type || '')) {
          categoryTotals[category] += Math.abs(balance);
        } else {
          categoryTotals[category] += balance;
        }
      }

      const totalAssets =
        categoryTotals.cash +
        categoryTotals.investments +
        categoryTotals.retirement +
        categoryTotals.realEstate +
        categoryTotals.otherAssets;

      const totalLiabilities = categoryTotals.credit + categoryTotals.loans;

      return {
        month: monthStr,
        label: monthLabel,
        cash: categoryTotals.cash,
        investments: categoryTotals.investments,
        retirement: categoryTotals.retirement,
        realEstate: categoryTotals.realEstate,
        otherAssets: categoryTotals.otherAssets,
        credit: categoryTotals.credit,
        loans: categoryTotals.loans,
        totalAssets,
        totalLiabilities,
        netWorth: totalAssets - totalLiabilities,
      };
    });

    return monthlyData.filter((point) => point.totalAssets > 0 || point.totalLiabilities > 0);
  }, [budgetId, accounts, allTransactions, months]);

  return { data, isLoading: accountsLoading || transactionsLoading };
}
