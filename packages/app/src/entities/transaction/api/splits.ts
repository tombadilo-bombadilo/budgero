import { useQuery, useMutation } from '@tanstack/react-query';
// Use runtime services directly instead of db-ops wrappers
import { useRuntime, useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import type { TransactionSplit } from '@budgero/core/browser';

// Invalidation for split upsert/clear is executor-driven from the
// transactions.upsertSplits / clearSplits ops (SPLIT_INVALIDATION_KEYS).

/**
 * Upsert splits for a transaction (replace existing set atomically).
 */
export type UpsertSplitsInput = {
  transactionId: number;
  type: 'inflow' | 'outflow';
  splits: {
    category_id?: number | null;
    transfer_account_id?: number | null;
    memo?: string;
    amount: number; // POSITIVE
    order_index?: number;
  }[];
};

export function useUpsertSplits() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpsertSplitsInput>({
    mutationFn: async ({ transactionId, splits, type }) => {
      // Convert positive amount to inflow/outflow shape expected by backend
      const prepared = splits.map((s, idx) => ({
        category_id: s.category_id ?? null,
        transfer_account_id: s.transfer_account_id ?? null,
        memo: s.memo ?? '',
        inflow: type === 'inflow' ? s.amount : 0,
        outflow: type === 'outflow' ? s.amount : 0,
        inflow_original: null,
        outflow_original: null,
        order_index: s.order_index ?? idx,
      }));
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.upsertSplits',
        payload: { transactionId, splits: prepared },
        meta: { label: 'useUpsertSplits' },
      });
    },
  });
}

export type ClearSplitsInput = {
  transactionId: number;
};

export function useClearSplits() {
  const runtime = useRuntime();
  return useMutation<void, Error, ClearSplitsInput>({
    mutationFn: async ({ transactionId }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.clearSplits',
        payload: { transactionId },
        meta: { label: 'useClearSplits' },
      });
    },
  });
}

// Fetch splits for a given transaction id
export function useTransactionSplits(transactionId: number | null) {
  const runtime = useRuntime();
  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  return useQuery<TransactionSplit[]>({
    queryKey: ['transactionSplits', spaceKey, transactionId],
    queryFn: async () => {
      if (!spaceId || !transactionId) return [];
      const services = runtime.services();
      return services.splits.getSplits(transactionId);
    },
    enabled: Boolean(spaceId) && Boolean(transactionId),
    staleTime: 1000 * 60 * 5,
  });
}
