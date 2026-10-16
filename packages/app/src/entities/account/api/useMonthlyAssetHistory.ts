import { useMemo } from 'react';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useBalanceHistoryRows } from '@entities/account/api/useBalanceHistoryRows';
import { useBudgetRevaluations } from '@entities/currency/api/useRevaluationSummary';
import {
  balanceRowsToLedger,
  buildMonthlyAssetHistory,
  monthlyAssetWindowStart,
  type MonthlyAssetPoint,
} from '@entities/account/lib/net-worth-series';

export type { MonthlyAssetPoint } from '@entities/account/lib/net-worth-series';

/**
 * Monthly asset/liability breakdown for the last N months.
 *
 * Computed over `useAccounts` + per-month ledger aggregates +
 * `useBudgetRevaluations` — memoized
 * rather than cached in the query client, so it can never serve stale data
 * across spaces.
 */
export function useMonthlyAssetHistory(budgetId: number, months = 24) {
  const { data: accounts, isLoading: accountsLoading } = useAccounts(budgetId);
  const fromDate = monthlyAssetWindowStart(months);
  const { data: rows, isLoading: rowsLoading } = useBalanceHistoryRows(budgetId, fromDate, 'month');
  const { data: revaluations, isLoading: revaluationsLoading } = useBudgetRevaluations(budgetId);

  const data = useMemo<MonthlyAssetPoint[] | undefined>(() => {
    if (!budgetId || !accounts || !rows || !revaluations) return undefined;
    if (accounts.length === 0) return [];
    return buildMonthlyAssetHistory(accounts, balanceRowsToLedger(rows), revaluations, months);
  }, [budgetId, accounts, rows, revaluations, months]);

  return { data, isLoading: accountsLoading || rowsLoading || revaluationsLoading };
}
