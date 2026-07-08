import { useMemo } from 'react';
import { useTransactions } from '@entities/transaction/api/useTransactions';
import { computeDailyBalances } from '@entities/account/lib/history';

export interface AccountBalancePoint {
  date: string;
  balance: number;
}

/**
 * Historical balance data for an account over a specified period, derived
 * from the account's transactions (running balance per day).
 *
 * Pure computation over `useTransactions` — memoized rather than cached in
 * the query client, so it can never serve stale data across spaces.
 */
export function useAccountBalanceHistory(accountId: number, periodMonths = 6) {
  const { data: transactions, isLoading } = useTransactions(accountId);

  const data = useMemo<AccountBalancePoint[] | undefined>(() => {
    if (!accountId || !transactions) return undefined;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - periodMonths);

    return computeDailyBalances(transactions, startDate, endDate);
  }, [accountId, transactions, periodMonths]);

  return { data, isLoading };
}
