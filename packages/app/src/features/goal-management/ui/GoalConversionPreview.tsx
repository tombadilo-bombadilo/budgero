import { Trans } from '@lingui/react/macro';
import type { MilliUnits } from '@budgero/core/browser';
import { useGoalTargetPreview } from '@entities/goal/api/useGoals';
import { formatMilli } from '@shared/lib/currency/milli';

interface GoalConversionPreviewProps {
  target: MilliUnits;
  currency: string;
  categoryId: number;
  budgetId: number;
  budgetCurrency: string;
  formatter: Intl.NumberFormat;
}

/** "≈ €920.00 today": a target in another currency, in the budget currency. */
export function GoalConversionPreview({
  target,
  currency,
  categoryId,
  budgetId,
  budgetCurrency,
  formatter,
}: GoalConversionPreviewProps) {
  const { data: preview, isLoading } = useGoalTargetPreview(
    categoryId,
    budgetId,
    budgetCurrency,
    target,
    currency
  );
  if (isLoading || !preview) return null;
  const amount = formatMilli(formatter, preview.converted);
  return (
    <p className="font-medium text-foreground" data-testid="goal-currency-preview">
      {preview.source === 'missing' ? (
        <Trans>
          No {currency} → {budgetCurrency} rate yet: counted as {amount} until one is available.
        </Trans>
      ) : (
        <Trans>≈ {amount} today</Trans>
      )}
    </p>
  );
}
