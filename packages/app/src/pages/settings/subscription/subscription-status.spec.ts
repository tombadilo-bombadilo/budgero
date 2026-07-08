import { describe, expect, it } from 'vitest';

import {
  getEffectiveSubscriptionStatus,
  hasBillingPortalAccess,
  shouldOfferCheckoutForStatus,
} from '@pages/settings/subscription/subscription-status';

describe('subscription-status', () => {
  it('marks expired trials as expired even if the stored status is trialing', () => {
    expect(
      getEffectiveSubscriptionStatus({
        subscription_status: 'trialing',
        trial_ends_at: '2026-03-10T00:00:00.000Z',
        subscription_ends_at: undefined,
        current_period_end: undefined,
      })
    ).toBe('expired');
  });

  it('keeps active trials as trialing', () => {
    expect(
      getEffectiveSubscriptionStatus({
        subscription_status: 'trialing',
        trial_ends_at: '2099-03-10T00:00:00.000Z',
        subscription_ends_at: undefined,
        current_period_end: undefined,
      })
    ).toBe('trialing');
  });

  it('marks cancelled subscriptions past their end date as expired', () => {
    expect(
      getEffectiveSubscriptionStatus({
        subscription_status: 'cancelled',
        trial_ends_at: undefined,
        subscription_ends_at: '2026-03-10T00:00:00.000Z',
        current_period_end: undefined,
      })
    ).toBe('expired');
  });

  it('detects whether a billing portal is available', () => {
    expect(hasBillingPortalAccess({ customer_id: 'cus_123', subscription_id: undefined })).toBe(
      true
    );
    expect(hasBillingPortalAccess({ customer_id: undefined, subscription_id: 'sub_123' })).toBe(
      true
    );
    expect(hasBillingPortalAccess({ customer_id: undefined, subscription_id: undefined })).toBe(
      false
    );
  });

  it('offers checkout for inactive, expired, and trialing states', () => {
    expect(shouldOfferCheckoutForStatus('inactive')).toBe(true);
    expect(shouldOfferCheckoutForStatus('expired')).toBe(true);
    expect(shouldOfferCheckoutForStatus('trialing')).toBe(true);
    expect(shouldOfferCheckoutForStatus('on_trial')).toBe(true);
    expect(shouldOfferCheckoutForStatus('active')).toBe(false);
    expect(shouldOfferCheckoutForStatus('lifetime')).toBe(false);
    expect(shouldOfferCheckoutForStatus('cancelled')).toBe(false);
    expect(shouldOfferCheckoutForStatus('past_due')).toBe(false);
  });
});
