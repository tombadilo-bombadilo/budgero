import type { TransactionLinks } from '@budgero/core/browser';
import { useSpaceQuery } from '@shared/api/useSpaceQuery';

/**
 * Whether other records (warranty, recurring occurrence, pending bank review) point at
 * a transaction. Converting a row to a transfer and back deletes and re-creates it, which
 * clears those links, so the payee picker only offers conversion when there are none.
 *
 * A single-row lookup meant to run on demand (`enabled` is the picker being open); it is
 * never cached, so the answer is always current.
 */
export function useTransactionLinks(transactionId: number | null, enabled: boolean) {
  return useSpaceQuery<TransactionLinks>({
    key: ['transactionLinks', transactionId ?? 0],
    enabled: enabled && transactionId !== null && transactionId > 0,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (services) => services.transactions.getTransactionLinks(transactionId as number),
  });
}
