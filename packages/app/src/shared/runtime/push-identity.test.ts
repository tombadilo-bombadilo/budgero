import { describe, it, expect, vi } from 'vitest';
import { pushMatchReview, withPushIdentity } from './push-identity';

const args = { budgetId: 1, accountId: 2, categoryId: 9, date: '2026-09-03', outflow: 12500 };

describe('Push API matching', () => {
  it('queues a review when a hand-entered match exists, keeping the category', () => {
    const reviewForPushed = vi.fn((input) => ({ ...input, candidateTransactionId: 5 }));
    const pushed = withPushIdentity(args, 'm1');
    const result = pushMatchReview({ bankSync: { reviewForPushed } }, pushed);
    expect(result).toMatchObject({
      budgetId: 1,
      reviews: [
        {
          accountId: 2,
          candidateTransactionId: 5,
          identity: {
            operationId: 'push:m1',
            sourceKey: 'push-api',
            pushArgs: { categoryId: 9, outflow: 12500 },
          },
        },
      ],
    });
  });

  it('adds as usual when nothing matches, and never matches transfers or splits', () => {
    const reviewForPushed = vi.fn(() => null);
    const services = { bankSync: { reviewForPushed } };
    expect(pushMatchReview(services, withPushIdentity(args, 'm2'))).toBeNull();
    const always = { bankSync: { reviewForPushed: vi.fn(() => ({}) as never) } };
    expect(
      pushMatchReview(always, withPushIdentity({ ...args, transferId: 'x' }, 'm3'))
    ).toBeNull();
    expect(
      pushMatchReview(always, withPushIdentity({ ...args, splits: [{ outflow: 1 }] }, 'm4'))
    ).toBeNull();
    expect(always.bankSync.reviewForPushed).not.toHaveBeenCalled();
  });
});
