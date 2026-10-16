import { useMemo } from 'react';
import type { AccountUncategorizedCount } from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';
import { useAccounts } from '@entities/account/api/useAccounts';

interface UncategorizedCount {
  total: number;
  byAccount: Record<number, { accountName: string; count: number }>;
}

/**
 * Hook to get count of uncategorized transactions
 * Returns total count and count per account
 *
 * Counts are a SQL GROUP BY (split parents excluded; their lines carry the
 * categories). The key lives under the `allTransactions` root so every write
 * that refreshed the budget transaction list refreshes these counts too.
 */
export function useUncategorizedTransactions(budgetId: number) {
  const { data: counts = [], isLoading: countsLoading } = useSpaceQuery<
    AccountUncategorizedCount[]
  >({
    key: ['allTransactions', budgetId, 'uncategorizedCounts'],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.transactions.getUncategorizedCountsByAccount(budgetId),
  });
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts(budgetId);

  const data = useMemo<UncategorizedCount>(() => {
    const byAccount: Record<number, { accountName: string; count: number }> = {};
    let total = 0;

    for (const { AccountID: accountId, Count: count } of counts) {
      const account = accounts.find((a) => a.ID === accountId);
      byAccount[accountId] = {
        accountName: account?.Name || `Account ${accountId}`,
        count,
      };
      total += count;
    }

    return { total, byAccount };
  }, [counts, accounts]);

  return { data, isLoading: countsLoading || accountsLoading };
}
