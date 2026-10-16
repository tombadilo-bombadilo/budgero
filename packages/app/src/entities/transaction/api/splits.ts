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
export type UpsertSplitLineInput = {
  category_id?: number | null;
  transfer_account_id?: number | null;
  memo?: string;
  payee?: string;
  amount?: number;
  inflow?: number;
  outflow?: number;
  order_index?: number;
};

export type UpsertSplitsInput = {
  transactionId: number;
  /** Legacy fallback for callers that still submit one unsigned amount per line. */
  type?: 'inflow' | 'outflow';
  /** Currency represented by `splits[].amount`. Defaults to budget currency. */
  amountCurrency?: 'converted' | 'native';
  splits: UpsertSplitLineInput[];
};

export function prepareSplitMutationLines(
  splits: UpsertSplitLineInput[],
  type: 'inflow' | 'outflow' | undefined,
  amountCurrency: 'converted' | 'native'
) {
  return splits.map((s, idx) => {
    const hasDirectionalAmounts = s.inflow != null || s.outflow != null;
    const inflow = hasDirectionalAmounts
      ? Number(s.inflow) || 0
      : type === 'inflow'
        ? Number(s.amount) || 0
        : 0;
    const outflow = hasDirectionalAmounts
      ? Number(s.outflow) || 0
      : type === 'outflow'
        ? Number(s.amount) || 0
        : 0;
    return {
      category_id: s.category_id ?? null,
      transfer_account_id: s.transfer_account_id ?? null,
      memo: s.memo ?? '',
      payee: s.payee ?? '',
      inflow: amountCurrency === 'converted' ? inflow : 0,
      outflow: amountCurrency === 'converted' ? outflow : 0,
      inflow_original: amountCurrency === 'native' ? inflow : null,
      outflow_original: amountCurrency === 'native' ? outflow : null,
      order_index: s.order_index ?? idx,
    };
  });
}

export function useUpsertSplits() {
  const runtime = useRuntime();
  return useMutation<void, Error, UpsertSplitsInput>({
    mutationFn: async ({ transactionId, splits, type, amountCurrency = 'converted' }) => {
      const prepared = prepareSplitMutationLines(splits, type, amountCurrency);
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.upsertSplits',
        payload: { transactionId, splits: prepared },
        meta: { label: 'useUpsertSplits' },
      });
    },
  });
}

export type SaveSplitsInput = UpsertSplitsInput & {
  /** New parent total (same currency as the lines), when the editor changed it. */
  total?: { inflow: number; outflow: number };
};

/** The split editor's save: parent total and lines in one op and one write. */
export function useSaveSplits() {
  const runtime = useRuntime();
  return useMutation<void, Error, SaveSplitsInput>({
    mutationFn: async ({ transactionId, splits, type, amountCurrency = 'converted', total }) => {
      await executeSpaceMutation<void>(runtime, {
        op: 'transactions.saveSplits',
        payload: {
          transactionId,
          splits: prepareSplitMutationLines(splits, type, amountCurrency),
          ...(total ? { amount: { ...total, currency: amountCurrency } } : {}),
        },
        meta: { label: 'useSaveSplits' },
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
