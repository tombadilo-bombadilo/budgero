import { useLingui } from '@lingui/react/macro';
import { useGoalFundingSettings } from '@entities/budget/api/useGoalFundingSettings';

export function FundingPriorityBadge({
  budgetId,
  priority = 3,
}: {
  budgetId: number;
  priority?: number;
}) {
  const { t } = useLingui();

  const settings = useGoalFundingSettings(budgetId);
  if (!settings.isReady || !settings.ShowCategoryPriorities || priority === 3) return null;
  return (
    <span
      className="shrink-0 rounded bg-muted px-1 py-0.5 text-[0.625rem] font-medium text-muted-foreground tabular-nums"
      title={t`Funding priority ${priority}`}
      aria-label={t`Funding priority ${priority}`}
    >
      P{priority}
    </span>
  );
}
