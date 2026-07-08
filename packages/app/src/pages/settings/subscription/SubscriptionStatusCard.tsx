import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  Crown,
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  XCircle,
  ArrowUpDown,
} from 'lucide-react';
import { CardBrandIcon } from '@shared/ui/card-brand-icon';
import type { SubscriptionViewModel } from '@pages/settings/subscription/useSubscriptionViewModel';

interface SubscriptionStatusCardProps {
  vm: SubscriptionViewModel;
}

function StatusIcon({
  status,
  isFoundingMember,
  hasBetaAccess,
}: {
  status: string;
  isFoundingMember: boolean;
  hasBetaAccess: boolean;
}) {
  if (isFoundingMember) return <Crown className="w-4 h-4" />;
  if (hasBetaAccess) return <Clock className="w-4 h-4" />;

  switch (status) {
    case 'active':
      return <CheckCircle className="w-4 h-4" />;
    case 'trialing':
    case 'on_trial':
      return <Clock className="w-4 h-4" />;
    case 'cancelled':
    case 'expired':
    case 'past_due':
    case 'unpaid':
    default:
      return <AlertTriangle className="w-4 h-4" />;
  }
}

export const SubscriptionStatusCard = React.memo(function SubscriptionStatusCard({
  vm,
}: SubscriptionStatusCardProps) {
  const {
    user,
    subscriptionDetails,
    plans,
    effectiveSubscriptionStatus,
    betaExpiresAt,
    daysLeftInBeta,
    trialEndsAt,
    daysLeftInTrial,
    trialTimeLeftLabel,
    cancelledEndDate,
    daysLeftCancelled,
    nextBillingDate,
    currentPeriodEnd,
    isTrialing,
    isActive,
    isLifetime,
    isPastDue,
    isUnpaid,
    isFoundingMember,
    hasBetaAccess,
    userIsCancelled,
    planName,
    planIntervalLabel,
    getStatusColor,
    getStatusText,
    setShowCancelDialog,
    setShowPlanChangeDialog,
    handleResumeSubscription,
    cancelMutation,
    resumeMutation,
    updatePlanMutation,
  } = vm;

  if (!user) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-500" />
              Current Plan
            </CardTitle>
            <CardDescription>Your current subscription status</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={`flex items-center gap-1 ${getStatusColor(effectiveSubscriptionStatus)}`}
            >
              <StatusIcon
                status={effectiveSubscriptionStatus}
                isFoundingMember={isFoundingMember}
                hasBetaAccess={hasBetaAccess}
              />
              {getStatusText(effectiveSubscriptionStatus)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Plan Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Plan:</span>
                <span className="font-medium">{planName || 'Plan not set'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Billing cadence:</span>
                <span className="font-medium">{planIntervalLabel ?? 'Not set'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Status:</span>
                <span className="font-medium">{getStatusText(effectiveSubscriptionStatus)}</span>
              </div>
              {isFoundingMember && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Access Type:</span>
                  <span className="font-medium text-purple-600">Lifetime Access</span>
                </div>
              )}
              {hasBetaAccess && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-300">Access Type:</span>
                  <span className="font-medium text-indigo-600">Free Access</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              Billing Information
            </h3>
            <div className="space-y-2 text-sm">
              {subscriptionDetails?.card_brand && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-300">Payment method:</span>
                  <div className="flex items-center gap-2">
                    <CardBrandIcon brand={subscriptionDetails.card_brand} className="h-5 w-8" />
                    {subscriptionDetails.card_last_four && (
                      <span className="font-medium text-sm">
                        •••• {subscriptionDetails.card_last_four}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {isFoundingMember && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Payment:</span>
                    <span className="font-medium">Founding Member</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Expires:</span>
                    <span className="font-medium text-purple-600">Never</span>
                  </div>
                </>
              )}
              {hasBetaAccess && betaExpiresAt && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Free access ends:</span>
                    <span className="font-medium">{format(betaExpiresAt, 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Days left:</span>
                    <span className="font-medium text-indigo-600">{daysLeftInBeta} days</span>
                  </div>
                </>
              )}
              {isTrialing && trialEndsAt && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Trial ends:</span>
                    <span className="font-medium">{format(trialEndsAt, 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Time left:</span>
                    <span className="font-medium text-blue-600">{trialTimeLeftLabel}</span>
                  </div>
                </>
              )}

              {!isTrialing &&
                effectiveSubscriptionStatus === 'expired' &&
                trialEndsAt &&
                user.subscription_status !== 'expired' && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Trial ended:</span>
                    <span className="font-medium">{format(trialEndsAt, 'MMM dd, yyyy')}</span>
                  </div>
                )}

              {isActive && !isTrialing && trialEndsAt && !currentPeriodEnd && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Trial ends:</span>
                    <span className="font-medium">{format(trialEndsAt, 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Time left:</span>
                    <span className="font-medium text-blue-600">{trialTimeLeftLabel}</span>
                  </div>
                </>
              )}

              {isActive && nextBillingDate && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Next billing:</span>
                    <span className="font-medium">{format(nextBillingDate, 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Renews in:</span>
                    <span className="font-medium">{formatDistanceToNow(nextBillingDate)}</span>
                  </div>
                </>
              )}

              {userIsCancelled && cancelledEndDate && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Access until:</span>
                    <span className="font-medium">{format(cancelledEndDate, 'MMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-300">Days remaining:</span>
                    <span className="font-medium text-orange-600">
                      {daysLeftCancelled} {daysLeftCancelled === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Founding Member Info */}
        {isFoundingMember && (
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Crown className="w-5 h-5 text-purple-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-purple-900 dark:text-purple-100">
                  Founding Member
                </h4>
                <p className="text-sm text-purple-700 dark:text-purple-200 mt-1">
                  You have lifetime access to Budgero. Thank you for being a founding member! Enjoy
                  all features without any recurring payments.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Beta Access Info */}
        {hasBetaAccess && betaExpiresAt && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-indigo-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-indigo-900 dark:text-indigo-100">Free Access</h4>
                <p className="text-sm text-indigo-700 dark:text-indigo-200 mt-1">
                  You have full, unlimited access to every Budgero feature—on us—until{' '}
                  <span className="font-semibold">{format(betaExpiresAt, 'MMMM dd, yyyy')}</span>.
                  Thanks for being part of Budgero.
                  {daysLeftInBeta <= 7 && (
                    <span className="font-semibold"> Only {daysLeftInBeta} days remaining!</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Trial Info */}
        {isTrialing && (
          <div
            className={`border rounded-lg p-4 ${
              daysLeftInTrial <= 7
                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                : 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800'
            }`}
          >
            <div className="flex items-start gap-3">
              <Clock
                className={`w-5 h-5 mt-0.5 ${daysLeftInTrial <= 7 ? 'text-blue-600' : 'text-gray-600'}`}
              />
              <div className="flex-1">
                <h4
                  className={`font-medium ${
                    daysLeftInTrial <= 7
                      ? 'text-blue-900 dark:text-blue-100'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {daysLeftInTrial <= 7 ? 'Trial Ending Soon' : 'Free Trial Active'}
                </h4>
                <p
                  className={`text-sm mt-1 ${
                    daysLeftInTrial <= 7
                      ? 'text-blue-700 dark:text-blue-200'
                      : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  Your free trial expires in {trialTimeLeftLabel}.{' '}
                  {user.customer_id ? (
                    <>
                      We'll process your first subscription charge on{' '}
                      <span className="font-semibold">
                        {trialEndsAt ? format(trialEndsAt, 'MMM dd, yyyy') : 'your trial end date'}
                      </span>{' '}
                      when your trial ends. You can review or change your billing details anytime
                      from the Lemon Squeezy portal below.
                    </>
                  ) : (
                    <>
                      Enjoy full access to Budgero during your trial. When your trial ends, you'll
                      need to subscribe to continue using the app.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Cancellation Warning */}
        {userIsCancelled && cancelledEndDate && new Date() < cancelledEndDate && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-yellow-900 dark:text-yellow-100">
                  Subscription Cancelled
                </h4>
                <p className="text-sm text-yellow-700 dark:text-yellow-200 mt-1">
                  You'll continue to have access until {format(cancelledEndDate, 'MMM dd, yyyy')}.
                  You can reactivate anytime before then.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Past Due Warning */}
        {isPastDue && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-red-900 dark:text-red-100">Payment Failed</h4>
                <p className="text-sm text-red-700 dark:text-red-200 mt-1">
                  Your payment failed. Please update your payment method to continue your
                  subscription.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Unpaid Warning */}
        {isUnpaid && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-red-900 dark:text-red-100">Payment Required</h4>
                <p className="text-sm text-red-700 dark:text-red-200 mt-1">
                  We were unable to collect your subscription payment. Update your billing details
                  in the Lemon Squeezy portal below to restore access.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-2">
          {isActive && !isLifetime && (
            <>
              {plans.length > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setShowPlanChangeDialog(true)}
                  disabled={updatePlanMutation.isPending}
                >
                  <ArrowUpDown className="w-4 h-4 mr-2" />
                  Change Plan
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelMutation.isPending}
                className="text-red-600 hover:text-red-700"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Cancel Subscription
              </Button>
            </>
          )}

          {userIsCancelled && cancelledEndDate && new Date() < cancelledEndDate && (
            <Button
              onClick={handleResumeSubscription}
              disabled={resumeMutation.isPending}
              loading={resumeMutation.isPending}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Resume Subscription
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
