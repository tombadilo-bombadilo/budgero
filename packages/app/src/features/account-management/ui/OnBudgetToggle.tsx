import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { HelpTooltip } from '@shared/ui/HelpTooltip';
import { getAccountTypesByBudgetType } from '@entities/account/model/accountTypes';

interface OnBudgetToggleProps {
  onBudget: boolean;
  setOnBudget: (value: boolean) => void;
  accType: string;
  setAccType: (value: string) => void;
  setIsLiability: (value: boolean) => void;
  /** Test attribute for the Switch (Add modal supplies it; Edit does not). */
  switchTestId?: string;
}

/**
 * Shared On/Off Budget toggle used by AddAccountDialog and EditAccountDialog.
 * Clearing the selected account type when it becomes incompatible with the new
 * budget setting is part of the identical behavior both modals require.
 */
export function OnBudgetToggle({
  onBudget,
  setOnBudget,
  accType,
  setAccType,
  setIsLiability,
  switchTestId,
}: OnBudgetToggleProps) {
  return (
    <div className="flex flex-col space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Label htmlFor="onBudget">Budget Account</Label>
          <HelpTooltip contentClassName="max-w-xs">
            <div className="space-y-2">
              <p>
                <strong>On-Budget:</strong> Affects Ready to Assign and spending calculations
                (checking, savings, credit cards)
              </p>
              <p>
                <strong>Off-Budget:</strong> Tracked for net worth only (mortgages, loans,
                investments)
              </p>
            </div>
          </HelpTooltip>
        </div>
        <Switch
          id="onBudget"
          data-testid={switchTestId}
          checked={onBudget}
          onCheckedChange={(checked) => {
            setOnBudget(checked);

            if (accType) {
              const validTypes = getAccountTypesByBudgetType(checked ? 'on' : 'off');
              const isCompatible = validTypes.some((type) => type === accType);

              if (!isCompatible) {
                setAccType('');
                setIsLiability(false);
              }
            }
          }}
        />
      </div>
      <div className="text-xs text-muted-foreground hidden sm:block">
        {onBudget
          ? 'This account will affect your budget calculations'
          : 'This account will only be tracked for net worth'}
      </div>
    </div>
  );
}
