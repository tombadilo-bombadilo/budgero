import { useEffect, useMemo, useState } from 'react';
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import type { Account } from '@budgero/core/browser';
import { getTodayISO } from '@shared/lib/date-utils';

/**
 * Sums each account's future-dated entries (Date > today) in one aggregate
 * query and returns the original/converted balance deltas they contribute, so
 * callers can back them out of the displayed (as-of-today) balance.
 */
export function useFutureBalanceAdjustments(budgetId: number, accountsData: Account[]) {
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
      if (!spaceId || !budgetId || accountsData.length === 0) {
        if (!cancelled) setFutureAdjustments({});
        return;
      }

      try {
        const services = runtime.services();
        const cutoff = getTodayISO();
        // One grouped SUM over Date > today instead of loading every register.
        const rows = await services.transactions.getFutureBalanceAdjustments(budgetId, cutoff);
        const byAccount = new Map(rows.map((row) => [row.AccountID, row]));

        if (cancelled) return;

        const map: Record<number, { original: number; converted: number }> = {};
        for (const account of accountsData) {
          const row = byAccount.get(account.ID);
          map[account.ID] = { original: row?.Original ?? 0, converted: row?.Converted ?? 0 };
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
  }, [runtime, spaceId, budgetId, accountsData, accountIdsKey]);

  return futureAdjustments;
}
