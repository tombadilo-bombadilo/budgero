/**
 * "New" tab of CreateBudgetForm: create a brand-new empty budget.
 */

import type { FormEvent } from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { Field } from '@shared/ui/field';
import { CurrencySelector } from '@features/currencies/ui/CurrencySelector';
import { IconPicker } from '@features/budget-management/ui/IconPicker';
import { FormatSelector } from '@features/budget-management/ui/FormatSelector';

interface ManualBudgetTabProps {
  name: string;
  onNameChange: (value: string) => void;
  displayCurrency: string;
  onDisplayCurrencyChange: (value: string) => void;
  badgeIcon: string;
  onBadgeIconChange: (value: string) => void;
  selectedFormat: string;
  onSelectedFormatChange: (value: string) => void;
  createDefaultCategories: boolean;
  onCreateDefaultCategoriesChange: (value: boolean) => void;
  isPending: boolean;
  onSubmit: (e: FormEvent) => void;
}

export function ManualBudgetTab({
  name,
  onNameChange,
  displayCurrency,
  onDisplayCurrencyChange,
  badgeIcon,
  onBadgeIconChange,
  selectedFormat,
  onSelectedFormatChange,
  createDefaultCategories,
  onCreateDefaultCategoriesChange,
  isPending,
  onSubmit,
}: ManualBudgetTabProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 sm:space-y-4" data-testid="create-budget-form">
      <Field
        label={<span className="text-xs sm:text-sm">Budget Name</span>}
        htmlFor="manualName"
        hint="A short name to identify this budget. You can rename it later."
      >
        <Input
          id="manualName"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder='e.g. "Personal Budget" or "Household"'
          required
          disabled={isPending}
          className="h-8 sm:h-9"
        />
      </Field>

      <div className="space-y-1.5">
        <CurrencySelector
          value={displayCurrency}
          onValueChange={onDisplayCurrencyChange}
          label="Display Currency"
        />
        <p className="text-xs text-muted-foreground">
          The currency shown on amounts. This is for display only and can be changed anytime.
        </p>
      </div>

      <div className="space-y-1.5">
        <IconPicker value={badgeIcon} onValueChange={onBadgeIconChange} label="Badge Icon" />
        <p className="text-xs text-muted-foreground">
          A small icon shown next to your budget name. Handy when you have multiple budgets.
        </p>
      </div>

      <div className="space-y-1.5">
        <FormatSelector
          value={selectedFormat}
          currency={displayCurrency}
          onValueChange={onSelectedFormatChange}
          label="Number Format"
        />
        <p className="text-xs text-muted-foreground">
          How numbers and decimals are displayed throughout the app.
        </p>
      </div>

      <div className="flex items-center justify-between space-x-2 py-2">
        <div className="space-y-1">
          <Label htmlFor="createDefaultCategories" className="text-xs sm:text-sm font-medium">
            Create Default Categories
          </Label>
          <p className="text-xs text-muted-foreground">
            Start with common categories like Rent, Groceries, and Savings. Recommended for new
            users.
          </p>
        </div>
        <Switch
          id="createDefaultCategories"
          data-testid="create-default-categories-switch"
          checked={createDefaultCategories}
          onCheckedChange={onCreateDefaultCategoriesChange}
          disabled={isPending}
        />
      </div>

      <div className="pt-2">
        <Button
          type="submit"
          disabled={isPending}
          loading={isPending}
          className="w-full h-8 sm:h-9"
          data-testid="create-budget-submit"
        >
          {isPending ? 'Creating...' : 'Create Budget'}
        </Button>
      </div>
    </form>
  );
}
