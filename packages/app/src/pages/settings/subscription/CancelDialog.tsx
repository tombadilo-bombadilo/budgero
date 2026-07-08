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
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Label } from '@shared/ui/label';
import { Textarea } from '@shared/ui/textarea';
import {
  CANCEL_REASON_OPTIONS,
  type CancelReasonValue,
} from '@pages/settings/subscription/subscription.constants';
import type { SubscriptionViewModel } from '@pages/settings/subscription/useSubscriptionViewModel';

interface CancelDialogProps {
  vm: SubscriptionViewModel;
}

export const CancelDialog = React.memo(function CancelDialog({ vm }: CancelDialogProps) {
  const {
    showCancelDialog,
    cancelReason,
    setCancelReason,
    cancelReasonNotes,
    setCancelReasonNotes,
    isCancelConfirmDisabled,
    handleCancelDialogOpenChange,
    handleCancelSubscription,
    cancelMutation,
  } = vm;

  return (
    <Dialog open={showCancelDialog} onOpenChange={handleCancelDialogOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel Subscription</DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel your subscription? You'll continue to have access until
            the end of your current billing period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Let us know why you are canceling so we can make Budgero better.
          </p>
          <RadioGroup
            value={cancelReason ?? undefined}
            onValueChange={(value) => {
              setCancelReason(value as CancelReasonValue);
            }}
            className="space-y-3"
          >
            {CANCEL_REASON_OPTIONS.map((option) => {
              const id = `cancel-reason-${option.value}`;
              const isOther = option.value === 'other';
              const isSelected = cancelReason === option.value;

              return (
                <div
                  key={option.value}
                  className={`rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400/60 dark:bg-blue-950/30'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value={option.value} id={id} />
                    <Label htmlFor={id} className="font-medium text-sm">
                      {option.label}
                    </Label>
                  </div>
                  {isSelected && (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={cancelReasonNotes}
                        onChange={(event) => setCancelReasonNotes(event.target.value)}
                        placeholder={
                          isOther
                            ? 'Tell us more (required)'
                            : 'Anything else you want to share? (optional)'
                        }
                        rows={3}
                        required={isOther}
                        aria-required={isOther}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {isOther
                          ? 'A brief description helps us understand the issue.'
                          : 'Optional notes help our team improve Budgero.'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleCancelDialogOpenChange(false)}
            disabled={cancelMutation.isPending}
          >
            Keep Subscription
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancelSubscription}
            disabled={isCancelConfirmDisabled}
            loading={cancelMutation.isPending}
          >
            Cancel Subscription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
