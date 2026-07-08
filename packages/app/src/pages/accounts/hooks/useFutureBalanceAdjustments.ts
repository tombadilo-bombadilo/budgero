import { useEffect, useMemo, useState } from 'react';
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import type { Account, GetTransactionsByAccountRow } from '@budgero/core/browser';
import { getTodayISO } from '@shared/lib/date-utils';

/**
 * Scans each account's transactions for future-dated entries (Date > today)
 * and returns the original/converted balance deltas they contribute, so
 * callers can back them out of the displayed (as-of-today) balance.
 */
export function useFutureBalanceAdjustments(accountsData: Account[]) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const [futureAdjustments, setFutureAdjustments] = useState<
    Record<number, { original: number; converted: number }>
  >({});

  const accountIdsKey = useMemo(() => {
    if (accountsData.length === 0) return '';
    return accountsData
      .map((acc) => acc.ID)
      .sort((a, b) => a - b)
      .join(',');
  }, [accountsData]);

  useEffect(() => {
    let cancelled = false;

    const calculateAdjustments = async () => {
      if (!spaceId || accountsData.length === 0) {
        if (!cancelled) setFutureAdjustments({});
        return;
      }

      try {
        const services = runtime.services();
        const cutoff = getTodayISO();

        const results = await Promise.all(
          accountsData.map(async (account) => {
            try {
              const transactions = (await services.transactions.getTransactionsByAccount(
                account.ID
              )) as GetTransactionsByAccountRow[];

              let original = 0;
              let converted = 0;

              for (const tx of transactions) {
                if (!tx?.Date || tx.Date <= cutoff) continue;
                const inflow = tx.Inflow ?? 0;
                const outflow = tx.Outflow ?? 0;
                const inflowOriginal = tx.InflowOriginal ?? inflow;
                const outflowOriginal = tx.OutflowOriginal ?? outflow;
                original += inflowOriginal - outflowOriginal;
                converted += inflow - outflow;
              }

              return [account.ID, { original, converted }] as const;
            } catch (error) {
              console.error(
                'Failed to evaluate future transactions for account',
                account.ID,
                error
              );
              return [account.ID, { original: 0, converted: 0 }] as const;
            }
          })
        );

        if (cancelled) return;

        const map: Record<number, { original: number; converted: number }> = {};
        for (const [accountId, values] of results) {
          map[accountId] = values;
        }
        setFutureAdjustments(map);
      } catch (error) {
        console.error('Failed to calculate account future adjustments', error);
        if (!cancelled) setFutureAdjustments({});
      }
    };

    void calculateAdjustments();
    return () => {
      cancelled = true;
    };
  }, [runtime, spaceId, accountsData, accountIdsKey]);

  return futureAdjustments;
}
