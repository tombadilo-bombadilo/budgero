import { useMemo } from 'react';
import { ZERO_MILLI, toDecimal } from '@budgero/core/browser';
import { useSpendingByPayees } from '@features/analytics/api/useAnalyticsQueries';
import { PrebuiltDonutCard } from './components/PrebuiltDonutCard';
import { useReportPeriod } from './components/useReportPeriod';

export default function PrebuiltPayeeDonut() {
  const { budgetId, startDate, endDate } = useReportPeriod();

  const { data = [], isLoading } = useSpendingByPayees(startDate, endDate, budgetId);

  // Chart values are decimal currency units, converted at this mapping.
  const donutData = useMemo(
    () =>
      data.map((row) => ({
        name: row.Payee || '(No payee)',
        value: toDecimal(row.Spending || ZERO_MILLI),
      })),
    [data]
  );

  return (
    <PrebuiltDonutCard
      title="Spending by payee"
      description="Where your money goes, grouped by payee"
      data={donutData}
      isLoading={isLoading}
    />
  );
}
