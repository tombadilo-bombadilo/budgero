import { useMemo } from 'react';
import { ZERO_MILLI, toDecimal } from '@budgero/core/browser';
import { useSpendingByLabels } from '@features/analytics/api/useAnalyticsQueries';
import { PrebuiltDonutCard } from './components/PrebuiltDonutCard';
import { useReportPeriod } from './components/useReportPeriod';

export default function PrebuiltLabelDonut() {
  const { budgetId, startDate, endDate } = useReportPeriod();

  const { data = [], isLoading } = useSpendingByLabels(startDate, endDate, budgetId);

  // Chart values are decimal currency units, converted at this mapping.
  const donutData = useMemo(
    () =>
      data.map((row) => ({
        name: row.Label || 'Unlabeled',
        value: toDecimal(row.Spending || ZERO_MILLI),
        color: row.LabelColor || '#9CA3AF',
      })),
    [data]
  );

  return (
    <PrebuiltDonutCard
      title="Spending by label"
      description="How spending splits across your labels"
      data={donutData}
      isLoading={isLoading}
    />
  );
}
