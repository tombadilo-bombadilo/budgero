import { useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useAllTransactions } from '@entities/transaction/api/useTransactions';
import { LIABILITY_ACCOUNT_TYPES } from '@entities/account/model/accountTypes';
import { computeDailyBalances, groupTransactionsByAccount } from '@entities/account/lib/history';
import { eachDayOfInterval, format, parseISO, isAfter } from 'date-fns';

export interface NetWorthPoint {
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

/**
 * Net worth history combining all account balance histories based on real
 * transaction data.
 *
 * Pure computation over `useAccounts` + `useAllTransactions` — memoized
 * rather than cached in the query client, so it can never serve stale data
 * across spaces.
 */
export function useNetWorthHistory(budgetId: number, periodMonths = 1) {
  const { data: accounts, isLoading: accountsLoading } = useAccounts(budgetId);
  const { data: allTransactions, isLoading: transactionsLoading } = useAllTransactions(budgetId);

  const data = useMemo<NetWorthPoint[] | undefined>(() => {
    if (!budgetId || !accounts || !allTransactions) return undefined;
    if (accounts.length === 0) return [];

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - periodMonths);

    const transactionsByAccount = groupTransactionsByAccount(allTransactions);

    const accountHistories = new Map<number, { date: string; balance: number }[]>();

    for (const account of accounts) {
      const accountTransactions = transactionsByAccount.get(account.ID) || [];

      const sortedTransactions = [...accountTransactions].sort(
        (a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime()
      );

      const earliestTxDate =
        sortedTransactions.length > 0 ? parseISO(sortedTransactions[0].Date) : endDate;

      // Only calculate history from the start of our period OR the first transaction, whichever is later
      const accountStartDate = isAfter(startDate, earliestTxDate) ? startDate : earliestTxDate;

      // If the account has no transactions in our time period, skip it or use current balance only for today
      if (isAfter(accountStartDate, endDate) || sortedTransactions.length === 0) {
        // Account has no transactions in our period - only show current balance for today if it exists
        if (account.Balance !== null && account.Balance !== undefined) {
          accountHistories.set(account.ID, [
            {
              date: format(endDate, 'yyyy-MM-dd'),
              balance: account.BalanceConverted ?? account.Balance ?? 0,
            },
          ]);
        }
        continue;
      }

      accountHistories.set(
        account.ID,
        computeDailyBalances(sortedTransactions, accountStartDate, endDate)
      );
    }

    const dates = eachDayOfInterval({ start: startDate, end: endDate });

    const netWorthHistory: NetWorthPoint[] = dates.map((date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const account of accounts) {
        const accountHistory = accountHistories.get(account.ID);
        const balancePoint = accountHistory?.find((point) => point.date === dateStr);

        if (balancePoint) {
          const currentAccountBalance = account.BalanceConverted ?? account.Balance ?? 0;
          const calculatedBalance = balancePoint.balance;

          // If this is today's date, use the account's converted balance
          // Otherwise use the calculated historical balance (which may need conversion applied)
          const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
          const balance = isToday ? currentAccountBalance : calculatedBalance;

          const isLiability = LIABILITY_ACCOUNT_TYPES.has(account.Type || '');

          if (isLiability) {
            totalLiabilities += Math.abs(balance);
          } else {
            totalAssets += balance;
          }
        }
      }

      return {
        date: dateStr,
        netWorth: totalAssets - totalLiabilities,
        totalAssets,
        totalLiabilities,
      };
    });

    return netWorthHistory.filter((point) => point.totalAssets > 0 || point.totalLiabilities > 0);
  }, [budgetId, accounts, allTransactions, periodMonths]);

  return { data, isLoading: accountsLoading || transactionsLoading };
}
