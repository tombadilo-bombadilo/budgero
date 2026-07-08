import type { User } from '@shared/model/auth';

type SubscriptionFields = Pick<
  User,
  'subscription_status' | 'trial_ends_at' | 'subscription_ends_at' | 'current_period_end'
>;

export function getEffectiveSubscriptionStatus(
  subscription: SubscriptionFields | null | undefined
): User['subscription_status'] {
  const status = subscription?.subscription_status?.trim().toLowerCase() || 'inactive';
  const now = Date.now();

  if (status === 'trialing' || status === 'on_trial') {
    if (subscription?.trial_ends_at && new Date(subscription.trial_ends_at).getTime() > now) {
      return 'trialing';
    }
    return 'expired';
  }

  if (status === 'cancelled') {
    if (
      subscription?.subscription_ends_at &&
      new Date(subscription.subscription_ends_at).getTime() > now
    ) {
      return 'cancelled';
    }
    return 'expired';
  }

  if (status === 'past_due') {
    if (
      subscription?.current_period_end &&
      new Date(subscription.current_period_end).getTime() > now
    ) {
      return 'past_due';
    }
    return 'expired';
  }

  switch (status) {
    case 'active':
    case 'expired':
    case 'inactive':
    case 'paused':
    case 'lifetime':
    case 'unpaid':
      return status;
    default:
      return 'inactive';
  }
}

export function hasBillingPortalAccess(
  user: Pick<User, 'customer_id' | 'subscription_id'> | null | undefined
): boolean {
  return Boolean(user?.customer_id || user?.subscription_id);
}

export function shouldOfferCheckoutForStatus(
  status: Pick<User, 'subscription_status'>['subscription_status']
): boolean {
  // Trialing users can subscribe early (locks in their earned tier-rewards
  // discount, ends the trial, starts the paid period). 'expired' and
  // 'inactive' are the post-trial / never-subscribed states. The status
  // values that should NOT show a buy button are the ones where the user
  // is already paying or recently was: active, lifetime, cancelled (still
  // active until end_at), past_due (in dunning), paused.
  return (
    status === 'expired' || status === 'inactive' || status === 'trialing' || status === 'on_trial'
  );
}
