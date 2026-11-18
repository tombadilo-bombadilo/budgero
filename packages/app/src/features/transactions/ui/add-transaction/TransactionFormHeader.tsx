'use client';

import { Trans, useLingui } from '@lingui/react/macro';

/**
 * Transaction Form Header
 *
 * Header section for the Add Transaction form with title, description,
 * and the "Remember last" toggle.
 */

import * as React from 'react';

import { DialogHeader, DialogTitle, DialogDescription } from '@shared/ui/dialog';
import { Switch } from '@shared/ui/switch';
import { Label } from '@shared/ui/label';

interface TransactionFormHeaderProps {
  rememberLast: boolean;
  onRememberLastChange: (value: boolean) => void;
  title?: string;
  description?: string;
  showRememberLast?: boolean;
  recurringEnabled: boolean;
  onRecurringEnabledChange: (value: boolean) => void;
  recurringLocked?: boolean;
}

export const TransactionFormHeader = React.memo(function TransactionFormHeader({
  rememberLast,
  onRememberLastChange,
  title,
  description,
  showRememberLast = true,
  recurringEnabled,
  onRecurringEnabledChange,
  recurringLocked = false,
}: TransactionFormHeaderProps) {
  const { t } = useLingui();
  return (
    <>
      <DialogHeader className="space-y-1.5 pr-6">
        <DialogTitle className="text-lg sm:text-xl font-semibold">
          {title ?? t`Add New Transaction`}
        </DialogTitle>
        {description && (
          <DialogDescription className="hidden sm:block text-xs sm:text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="mt-2 sm:mt-3 flex flex-wrap items-center justify-between gap-3">
        {showRememberLast && (
          <div className="flex items-center gap-2">
            <Switch
              id="remember-last"
              checked={rememberLast}
              onCheckedChange={onRememberLastChange}
              className="scale-90 sm:scale-100"
            />
            <Label
              htmlFor="remember-last"
              className="text-[0.6875rem] sm:text-xs font-normal text-muted-foreground"
            >
              <Trans>Remember last category, payee, account</Trans>
            </Label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Switch
            id="make-recurring"
            checked={recurringEnabled}
            onCheckedChange={onRecurringEnabledChange}
            disabled={recurringLocked}
            className="scale-90 sm:scale-100"
            data-testid="make-recurring-switch"
          />
          <Label
            htmlFor="make-recurring"
            className="text-[0.6875rem] sm:text-xs font-normal text-muted-foreground"
          >
            <Trans>Make recurring</Trans>
          </Label>
        </div>
      </div>
    </>
  );
});
