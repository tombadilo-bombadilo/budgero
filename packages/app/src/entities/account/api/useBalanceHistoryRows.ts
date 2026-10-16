import type { BalanceHistoryBucket, BalanceHistoryRow } from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';

/**
 * Per-account ledger aggregates for the balance-history charts (see
 * TransactionService.getBalanceHistoryRows). Keyed under the `allTransactions`
 * root so it refreshes on exactly the writes that refreshed the full list the
 * charts used to fold.
 */
export function useBalanceHistoryRows(
  budgetId: number,
  fromDate: string,
  bucket: BalanceHistoryBucket
) {
  return useSpaceQuery<BalanceHistoryRow[]>({
    key: ['allTransactions', budgetId, 'balanceHistory', bucket, fromDate],
    enabled: Boolean(budgetId),
    queryFn: (services) => services.transactions.getBalanceHistoryRows(budgetId, fromDate, bucket),
  });
}
