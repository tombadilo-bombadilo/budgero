import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { CheckCircle } from 'lucide-react';
import { buttonizeProps } from '@shared/lib/a11y';
import type { SubscriptionViewModel } from '@pages/settings/subscription/useSubscriptionViewModel';

interface PlanChangeDialogProps {
  vm: SubscriptionViewModel;
}

export const PlanChangeDialog = React.memo(function PlanChangeDialog({
  vm,
}: PlanChangeDialogProps) {
  const {
    user,
    plans,
    showPlanChangeDialog,
    setShowPlanChangeDialog,
    selectedPlan,
    setSelectedPlan,
    handlePlanChange,
    updatePlanMutation,
  } = vm;

  return (
    <Dialog open={showPlanChangeDialog} onOpenChange={setShowPlanChangeDialog}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Change Subscription Plan</DialogTitle>
          <DialogDescription>
            Select a new plan. The change will take effect immediately and you'll be charged or
            credited the difference.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {plans.map((plan) => {
            const isCurrentPlan = user?.variant_id === plan.id;
            const price = (plan.price / 100).toFixed(2);
            const isYearly = plan.interval === 'year';
            const monthlyPrice = isYearly ? (plan.price / 100 / 12).toFixed(2) : null;

            return (
              <div
                key={plan.id}
                className={`relative border-2 rounded-xl p-5 cursor-pointer transition-all ${
                  selectedPlan === plan.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-lg scale-[1.02]'
                    : isCurrentPlan
                      ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 hover:shadow-md'
                } ${isCurrentPlan ? 'cursor-not-allowed' : ''}`}
                {...buttonizeProps(() => {
                  if (!isCurrentPlan) setSelectedPlan(plan.id);
                })}
                aria-disabled={isCurrentPlan}
              >
                {isYearly && !isCurrentPlan && (
                  <div className="absolute -top-3 left-4">
                    <span className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-sm">
                      Save 17%
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold text-lg">{plan.name}</h4>
                      {isCurrentPlan && (
                        <Badge variant="secondary" className="text-xs">
                          Current Plan
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">${price}</span>
                      <span className="text-gray-500 dark:text-gray-400">/{plan.interval}</span>
                    </div>

                    {monthlyPrice && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Just ${monthlyPrice}/month
                      </p>
                    )}
                  </div>

                  <div className="flex items-center">
                    {selectedPlan === plan.id && !isCurrentPlan && (
                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 text-white" />
                      </div>
                    )}
                    {isCurrentPlan && <CheckCircle className="w-5 h-5 text-gray-400" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setShowPlanChangeDialog(false);
              setSelectedPlan(null);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handlePlanChange}
            disabled={!selectedPlan || updatePlanMutation.isPending}
            loading={updatePlanMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Change Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
