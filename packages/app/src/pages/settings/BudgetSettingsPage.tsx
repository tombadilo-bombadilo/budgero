import { Trans, useLingui } from '@lingui/react/macro';
import { trackSettingChanged } from '@shared/lib/analytics/track';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Switch } from '@shared/ui/switch';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { AlertTriangle, Percent, SlidersHorizontal, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAllowOverAssignmentPreference,
  useShowGroupPercentPreference,
} from '@shared/hooks/useUserPreferences';
import { useBudgets, useUpdateBudgetRtaMode } from '@entities/budget/api/useBudgets';
import { useUiStore } from '@shared/store/useUiStore';
import { cn } from '@shared/lib/utils';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';
import { IncomeCategoriesCard } from './components/IncomeCategoriesCard';
import { CalendarSettingsCard } from './components/CalendarSettingsCard';
import { GoalFundingSettingsCard } from './components/GoalFundingSettingsCard';
import { DuplicateHintSettingsCard } from './components/DuplicateHintSettingsCard';

type RtaMode = 'cumulative' | 'monthly';

function RtaModeCard() {
  const { t } = useLingui();

  const RTA_OPTIONS: { value: RtaMode; title: string; blurb: string }[] = [
    {
      value: 'cumulative',
      title: t`Cumulative`,
      blurb: t`All income and assignments add up across all time, so Ready to Assign is one running total that ignores the month you are viewing. Overspending stays inside the category and carries forward.`,
    },
    {
      value: 'monthly',
      title: t`Monthly`,
      blurb: t`Ready to Assign reflects money received through the month you are viewing, minus anything already assigned in future months, and a category’s overspending is pulled out of the next month’s Ready to Assign instead of carrying inside the category. This matches what people moving from YNAB expect.`,
    },
  ];

  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const { data: budgets = [] } = useBudgets();
  const updateRtaMode = useUpdateBudgetRtaMode();

  const budgetId = selectedBudget?.ID ?? 0;
  // Read from the live budgets query so the choice reflects the last saved value.
  const activeBudget = budgets.find((b) => b.ID === budgetId) ?? selectedBudget ?? null;
  const mode: RtaMode = activeBudget?.RtaMode === 'monthly' ? 'monthly' : 'cumulative';

  const handleChange = (next: string) => {
    if (!budgetId || next === mode) return;
    updateRtaMode.mutate(
      { id: budgetId, mode: next as RtaMode },
      {
        onSuccess: () => {
          trackSettingChanged('rta_mode', next as RtaMode);
          toast.success(
            next === 'monthly'
              ? t`Ready to Assign is now calculated monthly`
              : t`Ready to Assign is now calculated cumulatively`
          );
        },
        onError: () => toast.error(t`Could not change the Ready to Assign calculation`),
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <Wallet className="h-5 w-5" />
            Ready to Assign calculation
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Choose how this budget computes Ready to Assign. Switching is instant and
            non-destructive — it only changes the math, never your transactions or assignments.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={mode}
          onValueChange={handleChange}
          className="gap-3"
          disabled={!budgetId || updateRtaMode.isPending}
        >
          {RTA_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              htmlFor={`rta-${opt.value}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition',
                mode === opt.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
              )}
            >
              <RadioGroupItem id={`rta-${opt.value}`} value={opt.value} className="mt-1" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{opt.title}</span>
                  {opt.value === 'cumulative' && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      <Trans>Default</Trans>
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{opt.blurb}</p>
              </div>
            </label>
          ))}
        </RadioGroup>

        <div className="rounded-lg border bg-muted/50 p-4">
          <h4 className="mb-2 text-sm font-medium">
            <Trans>Which should I pick?</Trans>
          </h4>
          <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
            <li>
              <Trans>
                <strong className="text-foreground">
                  <Trans>Cumulative</Trans>
                </strong>
                is best if you think of the budget as one continuous pool and don’t mind Ready to
                Assign staying the same across months.
              </Trans>
            </li>
            <li>
              <Trans>
                <strong className="text-foreground">
                  <Trans>Monthly</Trans>
                </strong>
                is best if you’re coming from YNAB or want each month to stand on its own — income
                counts as it arrives, money assigned in future months is already spoken for, and
                last month’s overspending reduces this month’s Ready to Assign.
              </Trans>
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupPercentCard() {
  const { showGroupPercent, isLoading, updateShowGroupPercent, isUpdating } =
    useShowGroupPercentPreference();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <Percent className="h-5 w-5" />
            Category Group Percentages
          </Trans>
        </CardTitle>
        <CardDescription>
          See how your month&apos;s budget is split across category groups, e.g. Needs 50% / Wants
          30% / Savings 20%.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="show-group-percent" className="font-medium">
              <Trans>Show percentage of assigned on group rows</Trans>
            </Label>
            <p className="text-sm text-muted-foreground max-w-md">
              <Trans>
                Each category group on the Planning page shows its share of everything assigned in
                the selected month, next to its allocated total.
              </Trans>
            </p>
          </div>
          <Switch
            id="show-group-percent"
            checked={showGroupPercent}
            onCheckedChange={(checked) => updateShowGroupPercent(checked)}
            disabled={isLoading || isUpdating}
            className={cn(isUpdating && 'opacity-50 cursor-not-allowed')}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default function BudgetSettingsPage() {
  const { t } = useLingui();

  const { allowOverAssignment, isLoading, updateAllowOverAssignment, isUpdating } =
    useAllowOverAssignmentPreference();

  const handleToggle = (checked: boolean) => {
    updateAllowOverAssignment(checked);
  };

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title={t`Budget Settings`}
        description={t`Manage income categories, budget calculations, calendars, and assignment preferences.`}
      />

      <RtaModeCard />
      <GoalFundingSettingsCard />

      <IncomeCategoriesCard />

      <GroupPercentCard />

      <CalendarSettingsCard />

      <DuplicateHintSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <SlidersHorizontal className="h-5 w-5" />
              Assignment Behavior
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Control whether Budgero enforces the Ready to Assign limit when funding categories.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="allow-over-assignment" className="font-medium">
                  <Trans>Allow over-assignment</Trans>
                </Label>
                {allowOverAssignment && (
                  <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    <Trans>
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Enabled
                    </Trans>
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                <Trans>
                  When enabled, you can assign more money to categories than you have available in
                  Ready to Assign. This will result in a negative Ready to Assign amount.
                </Trans>
              </p>
            </div>
            <Switch
              id="allow-over-assignment"
              checked={allowOverAssignment}
              onCheckedChange={handleToggle}
              disabled={isLoading || isUpdating}
              className={cn(
                'data-[state=checked]:bg-yellow-500',
                isUpdating && 'opacity-50 cursor-not-allowed'
              )}
            />
          </div>

          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="text-sm font-medium mb-2">
              <Trans>What this means</Trans>
            </h4>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
              <li>
                <Trans>
                  <strong className="text-foreground">
                    <Trans>Disabled (default):</Trans>
                  </strong>
                  Budgero prevents you from assigning more than your Ready to Assign amount. You
                  must have cash available before funding categories.
                </Trans>
              </li>
              <li>
                <Trans>
                  <strong className="text-foreground">
                    <Trans>Enabled:</Trans>
                  </strong>
                  You can assign any amount to categories regardless of Ready to Assign. This
                  creates negative Ready to Assign, indicating you've assigned more money than you
                  currently have.
                </Trans>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
