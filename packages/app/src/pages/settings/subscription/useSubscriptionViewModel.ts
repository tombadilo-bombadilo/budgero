import { useLingui } from '@lingui/react/macro';
import { useState, useMemo, useCallback } from 'react';
import { useProfile } from '@entities/user/api/useAuth';
import {
  useSubscriptionInvoices,
  useSubscriptionPlans,
  useCancelSubscription,
  useResumeSubscription,
  useUpdateSubscriptionPlan,
  useCustomerPortal,
  useSubscriptionDetails,
  useCreateCheckout,
} from '@features/subscription/api/useSubscription';

import { capitalize } from '@shared/lib/utils';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import {
  STATUS_COLORS,
  STATUS_TEXT,
  PLAN_INTERVAL_LABELS,
  type CancelReasonValue,
} from '@pages/settings/subscription/subscription.constants';
import { trackSubscriptionCanceled } from '@shared/lib/analytics/analytics';
import {
  getEffectiveSubscriptionStatus,
  hasActiveBetaAccess,
  hasBillingPortalAccess,
  shouldOfferCheckoutForStatus,
} from '@pages/settings/subscription/subscription-status';

export function useSubscriptionViewModel() {
  const { t } = useLingui();

  const { data: user, isLoading: userLoading } = useProfile();
  const { data: subscriptionDetailsResponse } = useSubscriptionDetails(
    user?.subscription_id ?? undefined
  );
  const subscriptionDetails = subscriptionDetailsResponse?.subscription ?? null;
  const { data: invoicesData, isLoading: invoicesLoading } = useSubscriptionInvoices();
  const { data: plansData } = useSubscriptionPlans();
  const cancelMutation = useCancelSubscription();
  const resumeMutation = useResumeSubscription();
  const updatePlanMutation = useUpdateSubscriptionPlan();
  const portalMutation = useCustomerPortal();
  const checkoutMutation = useCreateCheckout();

  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancelReasonValue | null>(null);
  const [cancelReasonNotes, setCancelReasonNotes] = useState('');
  const [showPlanChangeDialog, setShowPlanChangeDialog] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Capture current time once to avoid impurity
  const [currentTime] = useState(() => Date.now());

  const connectivity = useConnectivity();
  const connectivityReady = connectivity.lastChecked > 0;
  const requiresOnline =
    connectivityReady && (!connectivity.apiReachable || !connectivity.clerkToken);

  const invoices = invoicesData?.invoices || [];
  const plans = useMemo(() => plansData?.plans || [], [plansData?.plans]);

  const betaExpiresAt = useMemo(
    () => (user?.beta_expires_at ? new Date(user.beta_expires_at) : null),
    [user?.beta_expires_at]
  );
  const daysLeftInBeta = useMemo(() => {
    if (!betaExpiresAt) return 0;
    return Math.max(0, Math.floor((betaExpiresAt.getTime() - currentTime) / (1000 * 60 * 60 * 24)));
  }, [betaExpiresAt, currentTime]);

  const trialEndsAtString = subscriptionDetails?.trial_ends_at ?? user?.trial_ends_at ?? null;
  const trialEndsAt = useMemo(
    () => (trialEndsAtString ? new Date(trialEndsAtString) : null),
    [trialEndsAtString]
  );
  const daysLeftInTrial = useMemo(() => {
    if (!trialEndsAt) return 0;
    return Math.max(0, Math.floor((trialEndsAt.getTime() - currentTime) / (1000 * 60 * 60 * 24)));
  }, [trialEndsAt, currentTime]);

  // Human-readable "X days / Y hours / less than an hour" — drops to hours
  // on the last day so the user sees real progress instead of a static
  // "0 days" for 24h. Used in the trial-info table + ending-soon callout.
  const trialTimeLeftLabel = useMemo(() => {
    if (!trialEndsAt) return '0 days';
    const msLeft = trialEndsAt.getTime() - currentTime;
    if (msLeft <= 0) return '0 days';
    const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));
    if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
    const hours = Math.floor(msLeft / (1000 * 60 * 60));
    if (hours >= 1) return hours === 1 ? '1 hour' : `${hours} hours`;
    return t`less than an hour`;
  }, [trialEndsAt, currentTime, t]);

  const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus({
    subscription_status: user?.subscription_status ?? 'inactive',
    trial_ends_at: trialEndsAtString ?? undefined,
    subscription_ends_at: subscriptionDetails?.ends_at ?? user?.subscription_ends_at,
    current_period_end: subscriptionDetails?.current_period_end ?? user?.current_period_end,
  });

  const subscriptionEndsAtString =
    subscriptionDetails?.ends_at ?? user?.subscription_ends_at ?? null;
  const subscriptionEndsAt = useMemo(
    () => (subscriptionEndsAtString ? new Date(subscriptionEndsAtString) : null),
    [subscriptionEndsAtString]
  );
  const userIsCancelled = effectiveSubscriptionStatus === 'cancelled';
  const cancelledEndDate = useMemo(
    () => (userIsCancelled ? subscriptionEndsAt || trialEndsAt : null),
    [userIsCancelled, subscriptionEndsAt, trialEndsAt]
  );
  const daysLeftCancelled = useMemo(() => {
    if (!cancelledEndDate) return 0;
    return Math.max(
      0,
      Math.floor((cancelledEndDate.getTime() - currentTime) / (1000 * 60 * 60 * 24))
    );
  }, [cancelledEndDate, currentTime]);

  const planIntervalKey =
    subscriptionDetails?.interval ?? plans.find((p) => p.id === user?.variant_id)?.interval ?? null;
  const planIntervalLabel = planIntervalKey
    ? PLAN_INTERVAL_LABELS[planIntervalKey] || capitalize(planIntervalKey)
    : null;

  const isTrialing = effectiveSubscriptionStatus === 'trialing';
  const isActive = effectiveSubscriptionStatus === 'active';
  const isLifetime =
    effectiveSubscriptionStatus === 'lifetime' || user?.is_founding_member === true;
  const isExpired =
    effectiveSubscriptionStatus === 'expired' || effectiveSubscriptionStatus === 'inactive';
  const isPastDue = effectiveSubscriptionStatus === 'past_due';
  const isUnpaid = effectiveSubscriptionStatus === 'unpaid';
  const isFoundingMember = user?.is_founding_member ?? false;
  const hasBetaAccess = hasActiveBetaAccess(user, currentTime);
  const billingPortalAvailable = hasBillingPortalAccess(user);
  const isSelfManagedTrial = isTrialing && !billingPortalAvailable;
  const canStartSubscription =
    shouldOfferCheckoutForStatus(effectiveSubscriptionStatus) &&
    !isFoundingMember &&
    !hasBetaAccess;

  const currentPeriodEndString =
    subscriptionDetails?.current_period_end ?? user?.current_period_end ?? null;
  const currentPeriodEnd = currentPeriodEndString ? new Date(currentPeriodEndString) : null;
  const renewsAt = subscriptionDetails?.renews_at ? new Date(subscriptionDetails.renews_at) : null;
  const nextBillingDate = currentPeriodEnd ?? renewsAt;

  const getStatusColor = useCallback(
    (status: string) => {
      if (user?.is_founding_member) return STATUS_COLORS.founding_member;
      if (hasBetaAccess) return STATUS_COLORS.beta_access;
      return STATUS_COLORS[status] || STATUS_COLORS.default;
    },
    [user?.is_founding_member, hasBetaAccess]
  );

  const getStatusText = useCallback(
    (status: string) => {
      if (user?.is_founding_member) return STATUS_TEXT.founding_member;
      if (hasBetaAccess) return STATUS_TEXT.beta_access;
      return STATUS_TEXT[status] || status;
    },
    [user?.is_founding_member, hasBetaAccess]
  );

  const getPlanNameFromVariant = useCallback(
    (variantId?: string) => {
      const plan = plans.find((p) => p.id === variantId);
      if (plan) return plan.name;
      if (user?.is_founding_member) return t`Founding Member`;
      if (hasBetaAccess) return t`Free Access`;
      if (variantId) return t`Plan ${variantId}`;
      return t`Plan not set`;
    },
    [plans, user?.is_founding_member, hasBetaAccess, t]
  );

  const planName = subscriptionDetails?.variant_name ?? getPlanNameFromVariant(user?.variant_id);

  const isOtherReasonSelected = cancelReason === 'other';
  const trimmedNotes = cancelReasonNotes.trim();
  const isCancelConfirmDisabled =
    cancelMutation.isPending ||
    !cancelReason ||
    (isOtherReasonSelected && trimmedNotes.length === 0);

  const handleCancelDialogOpenChange = useCallback((open: boolean) => {
    setShowCancelDialog(open);
    if (!open) {
      setCancelReason(null);
      setCancelReasonNotes('');
    }
  }, []);

  const handleCancelSubscription = useCallback(async () => {
    if (!cancelReason || cancelMutation.isPending) return;
    await cancelMutation.mutateAsync();
    // The reason option only: free-text notes never go to analytics.
    trackSubscriptionCanceled(cancelReason);
    setShowCancelDialog(false);
    setCancelReason(null);
    setCancelReasonNotes('');
  }, [cancelReason, cancelMutation]);

  const handleResumeSubscription = useCallback(async () => {
    await resumeMutation.mutateAsync();
  }, [resumeMutation]);

  const handlePlanChange = useCallback(async () => {
    if (!selectedPlan) return;
    await updatePlanMutation.mutateAsync(selectedPlan);
    setShowPlanChangeDialog(false);
    setSelectedPlan(null);
  }, [selectedPlan, updatePlanMutation]);

  const handleManageSubscription = useCallback(async () => {
    await portalMutation.mutateAsync();
  }, [portalMutation]);

  const handleStartSubscription = useCallback(
    async (variantId: string) => {
      await checkoutMutation.mutateAsync({ variantId });
    },
    [checkoutMutation]
  );

  return {
    user,
    userLoading,
    subscriptionDetails,

    invoices,
    invoicesLoading,
    plans,

    requiresOnline,

    betaExpiresAt,
    daysLeftInBeta,
    trialEndsAt,
    daysLeftInTrial,
    trialTimeLeftLabel,
    cancelledEndDate,
    daysLeftCancelled,
    nextBillingDate,
    currentPeriodEnd,

    effectiveSubscriptionStatus,
    isTrialing,
    isActive,
    isSelfManagedTrial,
    isLifetime,
    isExpired,
    isPastDue,
    isUnpaid,
    isFoundingMember,
    hasBetaAccess,
    userIsCancelled,
    billingPortalAvailable,
    canStartSubscription,

    planName,
    planIntervalLabel,

    getStatusColor,
    getStatusText,

    showCancelDialog,
    setShowCancelDialog,
    cancelReason,
    setCancelReason,
    cancelReasonNotes,
    setCancelReasonNotes,
    isCancelConfirmDisabled,
    handleCancelDialogOpenChange,
    handleCancelSubscription,
    cancelMutation,

    handleResumeSubscription,
    resumeMutation,

    showPlanChangeDialog,
    setShowPlanChangeDialog,
    selectedPlan,
    setSelectedPlan,
    handlePlanChange,
    updatePlanMutation,

    handleManageSubscription,
    portalMutation,

    handleStartSubscription,
    checkoutMutation,
  };
}

export type SubscriptionViewModel = ReturnType<typeof useSubscriptionViewModel>;
