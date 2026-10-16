import { useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useBalanceHistoryRows } from '@entities/account/api/useBalanceHistoryRows';
import {
  balanceRowsToLedger,
  buildNetWorthHistory,
  netWorthWindowStart,
  type NetWorthPoint,
} from '@entities/account/lib/net-worth-series';

export type { NetWorthPoint } from '@entities/account/lib/net-worth-series';

/**
 * Net worth history combining all account balance histories based on real
 * transaction data.
 *
 * Computed over `useAccounts` + per-day ledger aggregates (everything before
 * the window collapsed per account) — memoized rather than cached in the
 * query client, so it can never serve stale data across spaces.
 */
export function useNetWorthHistory(budgetId: number, periodMonths = 1) {
  const { data: accounts, isLoading: accountsLoading } = useAccounts(budgetId);
  const fromDate = netWorthWindowStart(periodMonths);
  const { data: rows, isLoading: rowsLoading } = useBalanceHistoryRows(budgetId, fromDate, 'day');

  const data = useMemo<NetWorthPoint[] | undefined>(() => {
    if (!budgetId || !accounts || !rows) return undefined;
    if (accounts.length === 0) return [];
    return buildNetWorthHistory(accounts, balanceRowsToLedger(rows), periodMonths);
  }, [budgetId, accounts, rows, periodMonths]);

  return { data, isLoading: accountsLoading || rowsLoading };
}
