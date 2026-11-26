import { Trans, useLingui } from '@lingui/react/macro';
import React, { useState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { IconPicker } from '@features/budget-management/ui/IconPicker';
import { FormatSelector } from '@features/budget-management/ui/FormatSelector';
import { CurrencyChangeConfirmDialog } from '@features/budget-management/ui/CurrencyChangeConfirmDialog';
import type { Budget } from '@budgero/core/browser';
import { Spinner } from '@shared/ui/spinner';
import { useUiStore } from '@shared/store/useUiStore';
import { getErrorMessage } from '@shared/lib/errors';
import {
  useUpdateBudgetName,
  useUpdateBudgetCurrency,
  useUpdateBudgetIcon,
  useUpdateBudgetNumberFormat,
} from '@entities/budget/api/useBudgets';

interface EditBudgetFormProps {
  budget: Budget;
  onUpdated?: () => void;
  onError: (error: string | null) => void;
  onClose: () => void;
}

export const EditBudgetForm: React.FC<EditBudgetFormProps> = ({
  budget,
  onUpdated,
  onError,
  onClose,
}) => {
  const { t } = useLingui();

  const { setSelectedBudget, setGlobalLocalizer } = useUiStore();
  const nameInputId = useId();

  const updateNameMutation = useUpdateBudgetName();
  const updateCurrencyMutation = useUpdateBudgetCurrency();
  const updateIconMutation = useUpdateBudgetIcon();
  const updateFormatMutation = useUpdateBudgetNumberFormat();

  // Form state (pre-populated from the passed budget)
  const [name, setName] = useState(budget.Name);
  const [displayCurrency, setDisplayCurrency] = useState(budget.DisplayCurrency || 'USD');
  const [badgeIcon, setBadgeIcon] = useState(budget.BadgeIcon);
  const [selectedFormat, setSelectedFormat] = useState<string>(budget.NumberFormat || '$1,096.56');
  // A currency change converts the whole budget: confirm it (with a backup
  // offer) before anything is saved.
  const [confirmCurrencyOpen, setConfirmCurrencyOpen] = useState(false);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setName(budget.Name);
      setDisplayCurrency(budget.DisplayCurrency || 'USD');
      setBadgeIcon(budget.BadgeIcon);
      setSelectedFormat(budget.NumberFormat || '$1,096.56');
    });
  }, [budget]);

  const isLoading =
    updateNameMutation.isPending ||
    updateCurrencyMutation.isPending ||
    updateIconMutation.isPending ||
    updateFormatMutation.isPending;

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (budget.DisplayCurrency !== displayCurrency) {
      setConfirmCurrencyOpen(true);
      return;
    }
    void applyUpdates();
  };

  const applyUpdates = async () => {
    onError(null);

    try {
      const updatePromises = [];
      let currencyChanged = false;
      let formatChanged = false;

      if (budget.Name !== name) {
        updatePromises.push(updateNameMutation.mutateAsync({ id: budget.ID, name }));
      }
      if (budget.DisplayCurrency !== displayCurrency) {
        updatePromises.push(
          updateCurrencyMutation.mutateAsync({ id: budget.ID, currency: displayCurrency })
        );
        currencyChanged = true;
      }
      if (budget.BadgeIcon !== badgeIcon) {
        updatePromises.push(updateIconMutation.mutateAsync({ id: budget.ID, icon: badgeIcon }));
      }
      if (budget.NumberFormat !== selectedFormat) {
        updatePromises.push(
          updateFormatMutation.mutateAsync({ id: budget.ID, format: selectedFormat })
        );
        formatChanged = true;
      }

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);

        // Only refresh selection state when the edited budget IS the selected
        // one — editing another budget must not switch to it.
        if (useUiStore.getState().selectedBudget?.ID === budget.ID) {
          setSelectedBudget({
            ...budget,
            Name: name,
            DisplayCurrency: displayCurrency,
            BadgeIcon: badgeIcon,
            NumberFormat: selectedFormat,
          });

          if (currencyChanged || formatChanged) {
            setGlobalLocalizer(displayCurrency, selectedFormat);
          }
        }

        if (onUpdated) onUpdated();
      }

      toast.success(t`Budget updated successfully`);
      onClose();
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err, t`Failed to update budget`);
      toast.error(errorMessage);
      onError(errorMessage);
    }
  };

  return (
    <form id="budget-form" onSubmit={handleUpdate} className="space-y-4 mt-4">
      <div>
        <Label htmlFor={nameInputId} className="block text-sm font-medium">
          <Trans>Budget Name</Trans>
        </Label>
        <Input
          id={nameInputId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t`Enter budget name`}
          required
        />
      </div>
      <CurrencySelector
        value={displayCurrency}
        onValueChange={setDisplayCurrency}
        label={t`Display Currency`}
      />
      <div>
        <IconPicker value={badgeIcon} onValueChange={setBadgeIcon} label={t`Badge Icon`} />
      </div>
      <FormatSelector
        value={selectedFormat}
        currency={displayCurrency}
        onValueChange={setSelectedFormat}
        label={t`Number Format`}
      />
      <CurrencyChangeConfirmDialog
        open={confirmCurrencyOpen}
        fromCurrency={budget.DisplayCurrency || 'USD'}
        toCurrency={displayCurrency}
        onCancel={() => setConfirmCurrencyOpen(false)}
        onConfirm={() => {
          setConfirmCurrencyOpen(false);
          void applyUpdates();
        }}
      />
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trans>
            <Spinner />
            Updating...
          </Trans>
        </div>
      )}
    </form>
  );
};
