import type { BankReviewInput, ImportIdentity } from '@budgero/core/browser';

/** Persist the queue reference in the replicated add payload, before execution. */
export function withPushIdentity(
  args: Record<string, unknown>,
  messageId: string
): Record<string, unknown> {
  const identity: ImportIdentity = {
    operationId: `push:${messageId}`,
    fileRowKey: `push:${messageId}`,
    sourceKey: 'push-api',
    date: String(args.date ?? ''),
    inflow: Number(args.inflow ?? 0),
    outflow: Number(args.outflow ?? 0),
    payee: String(args.payee ?? ''),
    memo: String(args.memo ?? ''),
    currency: '',
  };
  return { ...args, importIdentities: [identity] };
}

interface PushReviewServices {
  bankSync?: {
    reviewForPushed(input: {
      budgetId: number;
      accountId: number;
      identity: ImportIdentity;
    }): BankReviewInput | null;
  };
}

/**
 * A pushed plain transaction (no transfer, no splits) that may be the cleared
 * copy of one typed by hand becomes a match review, like bank sync: returns the
 * bankSync.addReviews args to run instead of transactions.add, or null.
 */
export function pushMatchReview(
  services: PushReviewServices | undefined,
  args: Record<string, unknown>
): { budgetId: number; reviews: BankReviewInput[] } | null {
  const identity = (args.importIdentities as ImportIdentity[] | undefined)?.[0];
  const budgetId = Number(args.budgetId);
  const accountId = Number(args.accountId);
  if (!identity || !services?.bankSync || !budgetId || !accountId) return null;
  if (args.transferId || (Array.isArray(args.splits) && args.splits.length)) return null;
  const { importIdentities: _identities, ...pushArgs } = args;
  const review = services.bankSync.reviewForPushed({
    budgetId,
    accountId,
    identity: { ...identity, pushArgs },
  });
  return review ? { budgetId, reviews: [review] } : null;
}
